// ═══════════════════════════════════════════════════════════════════════
// engineInput — the app-level integrity filter between `day_intake` rows
// and `computeTDEE`.
//
// The engine's contract (src/engine/types.ts, src/engine/tdee.ts) is
// correct as written: it trusts `is_complete` completely, and CLAUDE.md's
// "missing data is never imputed" rule is enforced inside the engine for
// any day that genuinely has no row. The defect this module fixes lives
// one layer up — the app can hand the engine a row whose `is_complete`
// flag is technically `true` but which does NOT represent a completed
// observation. Two concrete ways that happens, both traced to
// `intakeRepo.recomputeDay`'s documented behaviour:
//
//   Rule 1 — IN PROGRESS. `recomputeDay` defaults a day's `is_complete`
//   to 1 the first time it is touched (see intakeRepo.ts). The instant
//   the user logs breakfast, TODAY becomes a "complete" day at whatever
//   partial total has been logged so far — and today sits at the highest
//   possible recency weight in the whole regression window (half-life 14
//   days, PRD §4.2). Measured on a 45-day synthetic 2500 kcal/day series:
//   this alone reads TDEE 114 kcal low, every single day, until logging
//   is finished for the night. That is larger than the engine's entire
//   accuracy budget.
//
//   Rule 2 — EMPTY ROLLUP. If every food_entry row for an already-
//   completed day is later deleted (e.g. a mis-logged meal removed),
//   `recomputeDay` writes kcal/protein/carbs/fat all to 0 while leaving
//   `is_complete = 1` — a genuine *measured* zero-calorie day, which is
//   exactly the "one phantom zero-calorie day corrupts an entire window"
//   failure CLAUDE.md calls out by name. Measured effect: TDEE reads 135
//   kcal low.
//
// A day with NO day_intake row at all is already excluded correctly by
// the engine (measured delta: 0 — see useEngine.ts's callers). Both rules
// below exist purely to make the two defective cases behave like that
// already-correct baseline: "no real observation yet" should read as
// "no observation", not as "a measured value of whatever's been logged
// so far" or "a measured zero".
//
// This module does NOT go in src/engine/** on purpose (see task brief):
// the engine's contract already correctly trusts is_complete, and
// perturbing it here would also perturb src/engine/__tests__/
// calibration.test.ts, the project's accuracy/calibration acceptance
// gate, which must stay untouched. The bug is in what the app hands the
// engine, not in what the engine does with what it's handed — so the fix
// belongs at the app/engine seam, alongside useEngine.ts.
// ═══════════════════════════════════════════════════════════════════════

import type { DayIntake } from '../engine/types';

/**
 * Filters a `DayIntake[]` before it reaches `computeTDEE`, dropping rows
 * that misrepresent completeness (see module header for the two rules).
 * Weight readings are never touched by this function — only the intake
 * series changes; a filtered-out date's weight_log entry (if any) must
 * still reach the Kalman filter unchanged, per CLAUDE.md's
 * "Missing data is never imputed" section: partial/absent intake drops
 * out of the intake window, the weight reading still counts.
 *
 * `today` is taken as an explicit parameter — this function never reads
 * a clock itself — so it stays pure and trivially testable.
 *
 * @param intake Raw DayIntake rows, however they were assembled (a DB
 *   query result mapped to DayIntake, a slice of a longer history, etc).
 * @param today  The caller's notion of "today", ISO yyyy-mm-dd, local.
 */
export function filterIntakeForEngine(intake: DayIntake[], today: string): DayIntake[] {
  return intake.filter((day) => {
    // Rule 1 — in progress: today's rollup is never a completed
    // observation, no matter what is_complete says. Only ever filters
    // the row whose date equals `today`; every other date is untouched,
    // including a HISTORICAL cutoff that happens to render as "today"
    // from an earlier point in time — callers that re-run computeTDEE at
    // past cutoffs (e.g. useTrendsData's chart) pass the real, current
    // `today` here, so a genuinely past day is never affected by this
    // rule even when it's the last day in a truncated slice.
    if (day.date === today) return false;

    // Rule 2 — empty rollup: all four numeric columns at zero is what
    // `recomputeDay` writes when a day has zero food_entry rows (either
    // never logged, or logged-then-fully-deleted). That is the absence
    // of intake data, not a measured zero-calorie day — nobody eats
    // exactly 0 kcal, 0g protein, 0g carbs, and 0g fat and marks the day
    // complete.
    if (day.kcal === 0 && day.protein_g === 0 && day.carbs_g === 0 && day.fat_g === 0) return false;

    return true;
  });
}
