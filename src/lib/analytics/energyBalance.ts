// ═══════════════════════════════════════════════════════════════════════
// ENERGY BALANCE SERIES — "the single most explanatory view in the app:
// it shows *why* weight is moving" (task brief).
//
// Pairs a per-day logged-intake series with a per-day expenditure series
// (the same TDEE estimate already computed for the TDEE chart — this
// module does NOT call computeTDEE itself; useTrendsData supplies
// pre-computed values so the O(n^2)-ish engine call count doesn't grow).
// The gap discipline carries over exactly: a day with no logged intake
// has `intakeKcal: null`, and the shaded "gap" between intake and
// expenditure for that day is simply not drawn — never a shaded gap
// against a fabricated zero.
//
// Honesty defect fix: expenditure is frequently a Mifflin-St Jeor
// cold-start seed (PRD §4.3), not a measurement. A real user saw
// "Expend. 2,343" after two days of logging and asked how that could
// already exist — it was arithmetic from height/weight/age/activity, with
// zero information from their actual logging. `expenditureByDate` now
// carries the engine's `dataQuality` alongside the kcal value so callers
// (the energy-balance chart, the weekly table) can render seeded figures
// distinctly instead of identically to measured ones (PRD §10 "confidence
// always visible").
// ═══════════════════════════════════════════════════════════════════════

import type { DataQuality } from '../../engine/types';
import { weakestQuality } from './dataQuality';

export type EnergyBalanceIntakeDay = {
  date: string;
  /** null = unlogged day (gap) — never coerced to 0. */
  loggedKcal: number | null;
};

/** An expenditure value plus the engine's confidence in it at the day it was evaluated (or interpolated from). */
export type ExpenditureEstimate = {
  value: number;
  quality: DataQuality;
};

export type EnergyBalancePoint = {
  date: string;
  intakeKcal: number | null;
  expenditureKcal: number | null;
  /** intakeKcal - expenditureKcal for days where BOTH are known; null otherwise — never computed from a partial pair. */
  balanceKcal: number | null;
  /**
   * Quality of the expenditure figure for this day — null only when there
   * is no expenditure value at all. A day whose expenditure came from
   * interpolation between a seeded and a stronger cutoff reports the
   * weaker ('seeding') of the two, per `interpolateExpenditure` below.
   */
  expenditureQuality: DataQuality | null;
};

/**
 * Build the day-by-day intake/expenditure/balance series. `expenditureByDate`
 * is expected to be sparse-friendly too (e.g. only populated at the same
 * bounded set of cutoffs used for the TDEE chart) — dates without an
 * expenditure value simply carry `expenditureKcal: null`, which in turn
 * forces `balanceKcal: null` for that day rather than pretending the gap
 * doesn't exist.
 */
export function buildEnergyBalanceSeries(
  axisDates: string[],
  intakeDays: EnergyBalanceIntakeDay[],
  expenditureByDate: Map<string, ExpenditureEstimate>
): EnergyBalancePoint[] {
  const intakeByDate = new Map(intakeDays.map((d) => [d.date, d.loggedKcal]));

  return axisDates.map((date) => {
    const intakeKcal = intakeByDate.get(date) ?? null;
    const expenditure = expenditureByDate.get(date) ?? null;
    const expenditureKcal = expenditure?.value ?? null;
    const expenditureQuality = expenditure?.quality ?? null;
    const balanceKcal = intakeKcal !== null && expenditureKcal !== null ? intakeKcal - expenditureKcal : null;
    return { date, intakeKcal, expenditureKcal, balanceKcal, expenditureQuality };
  });
}

/**
 * Linearly interpolate a sparse expenditure map onto every date in
 * `axisDates`, so the energy-balance chart can show a continuous
 * expenditure line even though TDEE is only evaluated at ~20 bounded
 * cutoffs (see src/lib/trendsChartMath.ts). Only interpolates BETWEEN two
 * known points — never extrapolates past the first/last known cutoff, so
 * days outside the measured range stay null rather than guessing.
 *
 * Quality of an interpolated point is the WEAKER of its two bracketing
 * cutoffs' qualities (`weakestQuality`, src/lib/analytics/dataQuality.ts).
 * A point interpolated between a seeded cutoff and a converging one is not
 * "half-seeded" — averaging trust the way we average the kcal value would
 * silently launder a seeded figure into something that looks better than
 * it is. The interpolated number sits between the two values, but the
 * confidence in it is only as good as the worse of its two neighbours.
 */
export function interpolateExpenditure(
  axisDates: string[],
  expenditureByDate: Map<string, ExpenditureEstimate>
): Map<string, ExpenditureEstimate> {
  const knownDates = axisDates.filter((d) => expenditureByDate.has(d));
  if (knownDates.length === 0) return new Map();

  const result = new Map<string, ExpenditureEstimate>();
  let lowerIdx = 0;

  for (const date of axisDates) {
    if (expenditureByDate.has(date)) {
      result.set(date, expenditureByDate.get(date)!);
      continue;
    }
    // Find the bracketing known dates around this axis position by index
    // comparison (ISO dates sort lexicographically).
    while (lowerIdx < knownDates.length - 1 && knownDates[lowerIdx + 1] <= date) lowerIdx++;
    const lowerDate = knownDates[lowerIdx];
    const upperDate = knownDates.find((d) => d > date);

    if (date < knownDates[0] || date > knownDates[knownDates.length - 1]) {
      continue; // outside measured range — leave as a genuine gap
    }
    if (!upperDate || lowerDate === upperDate) {
      continue;
    }

    const lower = expenditureByDate.get(lowerDate)!;
    const upper = expenditureByDate.get(upperDate)!;
    const lowerTime = Date.parse(lowerDate);
    const upperTime = Date.parse(upperDate);
    const t = (Date.parse(date) - lowerTime) / (upperTime - lowerTime);
    const value = lower.value + t * (upper.value - lower.value);
    const quality = weakestQuality([lower.quality, upper.quality])!;
    result.set(date, { value, quality });
  }

  return result;
}
