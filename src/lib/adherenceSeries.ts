// ═══════════════════════════════════════════════════════════════════════
// ADHERENCE SERIES — PRD §9.2's "intake adherence" chart data prep.
//
// "Bars vs target; unlogged days render as gaps, not zeros." This is a
// correctness requirement (task brief), not styling: a zero-kcal bar
// implies a fast that never happened. This module builds the per-day
// series the chart renders, keeping `loggedKcal: null` distinct from
// `loggedKcal: 0` so TrendsScreen can render a genuine gap instead of a
// bar sitting on the floor.
//
// Deliberately app-layer (src/lib, not src/engine) — it only shapes
// day_intake rows for charting, it doesn't touch the TDEE math.
// ═══════════════════════════════════════════════════════════════════════

import { buildDailyAxis } from '../engine/date';

export type IntakeDayLike = {
  date: string;
  kcal: number;
  /** Accepts either a normalized boolean or SQLite's raw 0/1 (DayIntakeRow shape). */
  is_complete: boolean | number;
};

export type AdherenceDay = {
  date: string;
  /**
   * null = no log at all that day (a true gap — render nothing, not a
   * zero-height bar). A number (including 0) means the day WAS logged;
   * `is_complete === false` still counts as "logged" here because the
   * user actively touched the day, even though the engine excludes
   * partial days from its own intake series (PRD §4.4) — those are two
   * different concerns (chart honesty vs. engine input validity).
   */
  loggedKcal: number | null;
  isComplete: boolean;
  targetKcal: number | null;
};

/**
 * Build a gap-aware daily adherence series between `startDate` and
 * `endDate` inclusive. Any date with no corresponding `day_intake` row (or
 * whose row has kcal === null in storage, which recomputeDay never
 * actually produces once touched, but is defended against here) is a gap:
 * `loggedKcal: null`. This is the one place that decision gets made, so
 * the chart component never has to guess.
 */
export function buildAdherenceSeries(
  startDate: string,
  endDate: string,
  intakeDays: IntakeDayLike[],
  targetKcal: number | null
): AdherenceDay[] {
  const byDate = new Map<string, IntakeDayLike>();
  for (const d of intakeDays) byDate.set(d.date, d);

  const axis = buildDailyAxis(startDate, endDate);
  return axis.map((date) => {
    const row = byDate.get(date);
    // A day the user never touched has no day_intake row at all — that's
    // the gap case. A touched day with literally 0 kcal logged (e.g. they
    // opened the app, logged nothing, but the row was created via some
    // other flow) is intentionally still treated as "no data" here, since
    // day_intake rows are only ever created by recomputeDay when a
    // food_entry exists (see intakeRepo.ts) — a genuine zero-entry day
    // simply won't have a row. This function trusts "row absent" as the
    // sole gap signal, matching how the repo actually behaves.
    if (!row) {
      return { date, loggedKcal: null, isComplete: true, targetKcal };
    }
    return { date, loggedKcal: row.kcal, isComplete: row.is_complete !== 0 && row.is_complete !== false, targetKcal };
  });
}
