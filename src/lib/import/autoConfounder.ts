// ═══════════════════════════════════════════════════════════════════════
// AUTO-CONFOUNDER SUGGESTIONS — PRD §11: "4 hours of sleep + readiness
// crash -> automatically down-weight that morning's reading. Removes the
// need for the user to remember."
//
// This is the one PRD-sanctioned way imported Zepp data is allowed to
// influence anything beyond a chart: `weight_log.confounder` already
// exists specifically so the Kalman filter (src/engine/kalman.ts)
// inflates measurement noise `R` for a flagged day (PRD §4.1) — that
// mechanism is engine-internal and reads weight_log, not external_estimate,
// so using it here does NOT punch a hole in the engine wall. What this
// module does is purely SUGGEST which dates might warrant a confounder,
// based on the imported sleep figure; it never writes anything itself.
//
// "wire it — and make it visible and user-overridable, never silent"
// (task brief): suggestions are surfaced in the import screen as an
// explicit, opt-in list AFTER the import commits, each one individually
// togglable, with an explicit "Apply" step that calls
// weightRepo.setConfounder. Nothing here runs automatically during
// import, and an existing user-set confounder is NEVER overwritten (see
// `suggestConfounders`'s doc).
// ═══════════════════════════════════════════════════════════════════════

import type { ExternalEstimateRow } from '../../db/types';
import type { WeightLogRow } from '../../db/types';
import type { Confounder } from '../../engine/types';

/** Below this, PRD §11's example trigger ("4 hours of sleep") applies. 4 hours = 240 minutes. */
export const SHORT_SLEEP_THRESHOLD_MINUTES = 240;

export type ConfounderSuggestion = {
  date: string;
  suggested: Confounder;
  /** Plain-language reason, shown next to the suggestion so the user can judge it rather than trust it blindly. */
  reason: string;
};

/**
 * Suggest `poor_sleep` confounder flags for dates where:
 *   - the imported Zepp row has a non-null `sleep_minutes` below
 *     SHORT_SLEEP_THRESHOLD_MINUTES, AND
 *   - a weight_log reading exists for that same date, AND
 *   - that weight_log reading has NO confounder set yet.
 *
 * Never suggests overwriting an existing confounder (the user's own
 * judgment, or an earlier suggestion they already applied, always wins —
 * "never silent" cuts both ways: silently replacing what a user
 * deliberately set would be just as wrong as silently setting one in the
 * first place). Never suggests anything for a date with no weight
 * reading at all — there is nothing to flag.
 *
 * Pure and synchronous: takes already-fetched rows, returns suggestions,
 * writes nothing. The caller (ZeppImportScreen) is responsible for
 * fetching weightLog rows for the same range and for actually applying
 * an accepted suggestion via weightRepo.setConfounder.
 */
export function suggestConfounders(
  estimates: readonly ExternalEstimateRow[],
  weightLog: readonly WeightLogRow[]
): ConfounderSuggestion[] {
  const weightByDate = new Map(weightLog.map((w) => [w.date, w]));
  const suggestions: ConfounderSuggestion[] = [];

  for (const estimate of estimates) {
    // `ExternalEstimateRow`'s declared type says `sleep_minutes: number`,
    // but the underlying column has no NOT NULL constraint and a partial
    // Zepp import (e.g. a file that only maps steps) legitimately writes
    // NULL here (see externalEstimateRepo's `UpsertExternalEstimateInput`,
    // which correctly types this field as `number | null`) — a real gap
    // between the read-side and write-side types in src/db/types.ts,
    // flagged in this feature's report rather than fixed here, since
    // widening ExternalEstimateRow would ripple into chart/analytics code
    // outside this feature's ownership. Cast defensively rather than
    // trust the declared type.
    const sleepMinutes = estimate.sleep_minutes as number | null;
    if (sleepMinutes === null || sleepMinutes === undefined) continue;
    if (sleepMinutes >= SHORT_SLEEP_THRESHOLD_MINUTES) continue;

    const weight = weightByDate.get(estimate.date);
    if (!weight) continue;
    if (weight.confounder !== null) continue; // never suggest overwriting an existing flag

    const hours = (sleepMinutes / 60).toFixed(1);
    suggestions.push({
      date: estimate.date,
      suggested: 'poor_sleep',
      reason: `Zepp logged ${hours}h sleep this night, with no confounder flagged on this morning's weight reading.`,
    });
  }

  return suggestions.sort((a, b) => a.date.localeCompare(b.date));
}
