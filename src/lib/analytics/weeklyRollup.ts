// ═══════════════════════════════════════════════════════════════════════
// WEEKLY ROLLUP — "a table beats a chart here."
//
// Groups the trends window into ISO-ish calendar weeks (Monday-start, to
// match how the weekly check-in already thinks in "Week N" terms — see
// src/lib/checkInLogic.ts) and summarises each week: avg intake, avg TDEE
// (from the already-computed TDEE chart series, never recomputed here —
// this module does not import the engine), weight change across the week,
// and days logged out of days elapsed.
//
// Gaps-not-zeros discipline: a week's avg intake is the mean over LOGGED
// days only. A week with 2 logged days out of 7 still reports a real
// average of those 2 days, not an average diluted by 5 phantom zeros. If
// a week has zero logged days, avgIntakeKcal is null — never 0, never
// NaN. Same for weight change: computed from whatever smoothed-weight
// readings fall in the window; a week with no weight series overlap
// reports null, not a fabricated 0kg change.
//
// Honesty defect fix: `avgExpenditureKcal` is frequently averaged from
// Mifflin-St Jeor cold-start seed days (PRD §4.3), not measured
// expenditure — a real user saw "Expend. 2,343" after two days of logging
// and asked how that could already exist. `expenditureQuality` reports the
// WEAKEST `DataQuality` (src/engine/types.ts) among the days that
// contributed to this week's average, via `weakestQuality`
// (src/lib/analytics/dataQuality.ts) — "a week is only as trustworthy as
// its worst input." A week mixing one seeded day with six stable days is
// still reported as seeded, not diluted into something better-looking.
// ═══════════════════════════════════════════════════════════════════════

import { addDaysISO, dayOffset } from '../../engine/date';
import type { DataQuality } from '../../engine/types';
import { weakestQuality } from './dataQuality';
import type { ExpenditureEstimate } from './energyBalance';

export type WeeklyRollupIntakeDay = {
  date: string;
  /** null/absent day = gap, never a zero-kcal day. Pass only logged days in here, or use loggedKcal===null to mark a gap. */
  loggedKcal: number | null;
};

export type WeeklyRollupWeightPoint = {
  date: string;
  smoothedKg: number;
};

export type WeeklyRollupRow = {
  /** ISO date of the Monday this week starts on. */
  weekStart: string;
  /** ISO date of the last day of this week actually inside the requested window (may be < 7 days for a partial first/last week). */
  weekEnd: string;
  /** Human label for the week's RANGE, e.g. "24–30 Aug" or "24 Aug – 6 Sep". */
  label: string;
  avgIntakeKcal: number | null;
  avgExpenditureKcal: number | null;
  /**
   * Weakest `DataQuality` among the days whose expenditure estimate fed
   * `avgExpenditureKcal` this week. Null only when there were zero
   * contributing days (avgExpenditureKcal is also null in that case) — a
   * week with no expenditure data is a different, honest state from one
   * genuinely averaging seeded figures, and must not default to 'stable'.
   */
  expenditureQuality: DataQuality | null;
  /** Positive = gained, negative = lost, null = insufficient weight data this week. */
  weightChangeKg: number | null;
  daysLogged: number;
  daysInWeek: number;
};

/**
 * Formats a week as a RANGE, never a single date.
 *
 * A real user asked why the weekly summary showed "an entry on Aug 24th"
 * — it was the row for the week of the 24th–30th, labelled with just its
 * Monday. In a table full of dates, a bare "Aug 24" reads as a day. Both
 * ends are always shown so a week can never be mistaken for an entry.
 *
 * The month is repeated only when the week straddles two months
 * ("29 Aug – 4 Sep"), otherwise it stays compact ("24–30 Aug").
 */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(`${weekEnd}T00:00:00Z`);
  const day = (d: Date) => d.getUTCDate();
  const month = (d: Date) => d.toLocaleDateString('en-AU', { month: 'short', timeZone: 'UTC' });

  if (weekStart === weekEnd) return `${day(start)} ${month(start)}`;
  if (month(start) === month(end)) return `${day(start)}–${day(end)} ${month(start)}`;
  return `${day(start)} ${month(start)} – ${day(end)} ${month(end)}`;
}

/** Snap an ISO date back to the Monday of its week (UTC calendar, Mon=start). */
function weekStartFor(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  return addDaysISO(date, offsetToMonday);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Build one row per calendar week spanning [startDate, endDate]. Weeks at
 * either edge of the window may be partial (daysInWeek < 7) — the row
 * still reports honestly over just the days actually in range.
 */
export function buildWeeklyRollup(
  startDate: string,
  endDate: string,
  intakeDays: WeeklyRollupIntakeDay[],
  expenditureByDate: Map<string, ExpenditureEstimate>,
  weightPoints: WeeklyRollupWeightPoint[]
): WeeklyRollupRow[] {
  if (dayOffset(startDate, endDate) < 0) return [];

  const intakeByDate = new Map(intakeDays.map((d) => [d.date, d.loggedKcal]));
  const weightByDate = new Map(weightPoints.map((p) => [p.date, p.smoothedKg]));

  // Group every date in [startDate, endDate] by its Monday-week-start.
  const weeks = new Map<string, string[]>();
  const totalDays = dayOffset(startDate, endDate);
  for (let i = 0; i <= totalDays; i++) {
    const date = addDaysISO(startDate, i);
    const wk = weekStartFor(date);
    const bucket = weeks.get(wk);
    if (bucket) bucket.push(date);
    else weeks.set(wk, [date]);
  }

  const sortedWeekStarts = Array.from(weeks.keys()).sort();

  return sortedWeekStarts.map((weekStart) => {
    const days = weeks.get(weekStart)!;
    const weekEnd = days[days.length - 1];

    const loggedKcals: number[] = [];
    let daysLogged = 0;
    for (const date of days) {
      const kcal = intakeByDate.get(date);
      if (kcal !== undefined && kcal !== null) {
        loggedKcals.push(kcal);
        daysLogged++;
      }
    }

    const expenditureVals: number[] = [];
    const expenditureQualities: DataQuality[] = [];
    for (const date of days) {
      const est = expenditureByDate.get(date);
      if (est !== undefined && Number.isFinite(est.value)) {
        expenditureVals.push(est.value);
        expenditureQualities.push(est.quality);
      }
    }

    // Weight change: first vs last smoothed reading actually present in
    // this week's date range. Requires at least 2 distinct readings —
    // one reading alone tells you a level, not a change.
    const weightReadingsInWeek = days
      .map((date) => weightByDate.get(date))
      .filter((v): v is number => v !== undefined);
    const weightChangeKg =
      weightReadingsInWeek.length >= 2
        ? weightReadingsInWeek[weightReadingsInWeek.length - 1] - weightReadingsInWeek[0]
        : null;

    const label = formatWeekRange(weekStart, weekEnd);

    return {
      weekStart,
      weekEnd,
      label,
      avgIntakeKcal: mean(loggedKcals),
      avgExpenditureKcal: mean(expenditureVals),
      expenditureQuality: weakestQuality(expenditureQualities),
      weightChangeKg,
      daysLogged,
      daysInWeek: days.length,
    };
  });
}
