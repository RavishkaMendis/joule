// ═══════════════════════════════════════════════════════════════════════
// WEEKLY CHECK-IN LOGIC — PRD §9.3.
//
// Pure, Node-testable helpers backing WeeklyCheckInScreen. Two things live
// here deliberately:
//
//   1. `explainTargetChange` — PRD §9.3's hard requirement: "Always explain
//      why the number moved, in one sentence." This generates a REAL
//      sentence from the previous/new TDEEResult and TargetResult, not a
//      canned string — it looks at which of TDEE, trend, or rate changed
//      and picks the dominant driver.
//   2. `logsAdherenceLabel` — renders "6/7 days" neutrally (PRD §10: a
//      missed day is data-neutral, never framed as failure).
//
// This module is app-layer (imports engine types, not engine internals),
// so it lives in src/lib, not src/engine — it has no business being
// import-walled the way the engine itself is.
// ═══════════════════════════════════════════════════════════════════════

import type { TDEEResult } from '../engine/types';
import type { TargetResult } from '../engine/targets';

export type CheckInComparison = {
  previousTdee: TDEEResult | null;
  newTdee: TDEEResult;
  previousTargetKcal: number | null;
  newTargets: TargetResult;
  /** Desired weekly rate from the profile, positive = loss magnitude (see targets.ts). */
  goalRateKgPerWeek: number;
};

const TDEE_NOISE_FLOOR_KCAL = 15;
const TREND_NOISE_FLOOR_KG_PER_WEEK = 0.03;

/**
 * Generate a one-sentence, data-grounded explanation of why the target
 * moved (PRD §9.3). Picks the dominant driver among:
 *  - TDEE estimate itself moved (measured expenditure changed)
 *  - Weight trend diverged from the goal rate (adherence/behaviour signal)
 *  - A safety rail clamped the requested number
 *  - Nothing meaningfully changed (target held essentially flat)
 *
 * Never a generic "Your target has been updated" placeholder — every
 * branch below is computed from the actual before/after numbers passed in.
 */
export function explainTargetChange(cmp: CheckInComparison): string {
  const { previousTdee, newTdee, previousTargetKcal, newTargets, goalRateKgPerWeek } = cmp;

  const railReason = newTargets.railReason;
  if (railReason) {
    if (railReason.rail === 'deficit_cap') {
      return `Your goal rate would need a deficit deeper than ${Math.round(
        railReason.maxDeficitFraction * 100
      )}% of TDEE, so the target is capped at ${Math.round(railReason.cappedKcal)} kcal rather than the ${Math.round(
        railReason.requestedKcal
      )} kcal your rate implies.`;
    }
    return `Your requested rate would drop below the ${Math.round(
      railReason.floorKcal
    )} kcal safety floor, so the target is held at ${Math.round(railReason.cappedKcal)} kcal instead.`;
  }

  if (newTdee.dataQuality === 'seeding') {
    return `Still estimating from your onboarding details — not enough logged days yet to measure TDEE directly, so the target is based on the seed estimate.`;
  }

  if (previousTdee === null || previousTargetKcal === null) {
    return `First measured target: TDEE is ${Math.round(newTdee.tdee)} kcal (±${Math.round(
      (newTdee.confidenceHigh - newTdee.confidenceLow) / 2
    )}), so your target is set to ${Math.round(newTargets.targetKcal)} kcal for your goal rate.`;
  }

  const tdeeDelta = newTdee.tdee - previousTdee.tdee;
  // Change in the measured trend week-over-week (kg/week). This is the
  // signal that actually explains a target move driven by "you lost
  // faster/slower than expected" — NOT trend-vs-goal-rate, which doesn't
  // tell you what changed since last week.
  const trendChangeKgPerWeek = newTdee.trendKgPerWeek - previousTdee.trendKgPerWeek;
  const targetDelta = newTargets.targetKcal - previousTargetKcal;

  if (Math.abs(targetDelta) < 1) {
    return `TDEE and your weight trend both held steady this week, so the target stays at ${Math.round(
      newTargets.targetKcal
    )} kcal.`;
  }

  const direction = targetDelta > 0 ? 'rose' : 'fell';
  const magnitude = Math.round(Math.abs(targetDelta));

  // kcal-equivalent of the trend CHANGE, so it's directly comparable in
  // magnitude to tdeeDelta (both in kcal/day) when picking the dominant driver.
  const trendChangeKcalEquivalent = (trendChangeKgPerWeek * 7700) / 7;

  if (Math.abs(tdeeDelta) >= TDEE_NOISE_FLOOR_KCAL && Math.abs(tdeeDelta) >= Math.abs(trendChangeKcalEquivalent)) {
    const tdeeDirection = tdeeDelta > 0 ? 'rose' : 'fell';
    return `TDEE ${tdeeDirection} ${Math.round(Math.abs(tdeeDelta))} kcal because your measured expenditure ${
      tdeeDelta > 0 ? 'came in higher' : 'came in lower'
    } than last week's estimate, so the target ${direction} ${magnitude} kcal.`;
  }

  if (Math.abs(trendChangeKgPerWeek) >= TREND_NOISE_FLOOR_KG_PER_WEEK) {
    // trendKgPerWeek convention: negative = losing. A trend that became
    // LESS negative (moved toward/above zero) means weight loss slowed —
    // "flattened". A trend that became MORE negative means loss sped up.
    const trendDescription =
      trendChangeKgPerWeek > 0 ? 'your weight trend flattened' : 'your weight trend picked up pace';
    return `The target ${direction} ${magnitude} kcal because ${trendDescription} while intake ${
      Math.abs(tdeeDelta) < TDEE_NOISE_FLOOR_KCAL ? 'held roughly steady' : 'also shifted'
    } (trend now ${Math.abs(newTdee.trendKgPerWeek).toFixed(2)} kg/wk vs. a ${goalRateKgPerWeek.toFixed(
      2
    )} kg/wk goal).`;
  }

  return `The target ${direction} ${magnitude} kcal from small movements in both the measured TDEE and weight trend — nothing large enough to call out on its own.`;
}

/** Neutral "N/7 days logged" label — never framed as a streak or a failure (PRD §10). */
export function adherenceLabel(loggedDays: number, totalDays: number): string {
  return `Logged ${loggedDays}/${totalDays} days`;
}

/** Week label used for the stored target snapshot, e.g. "Week 6". Derived from days of data. */
export function weekLabelFromDaysOfData(daysOfData: number): string {
  const week = Math.max(1, Math.ceil(daysOfData / 7));
  return `Week ${week}`;
}
