// ═══════════════════════════════════════════════════════════════════════
// DUE-TODAY LIST — pure composition of supplements + today's log rows.
//
// CLAUDE.md/PRD §10: "An unticked supplement is neutral information,
// never red, never a nag, no streak counter." This module only computes
// WHICH items belong on the list and whether each is logged — it renders
// nothing and scores nothing. The screen is responsible for keeping the
// display itself neutral (no colour-coding done vs not-done beyond a
// plain checkbox state).
// ═══════════════════════════════════════════════════════════════════════

import type { SupplementRow, SupplementLogRow } from '../../db/types';
import { parseSchedule, isDueOn } from './schedule';

export type DueTodayItem = {
  supplement: SupplementRow;
  /** True if this supplement's schedule says today is a scheduled day. Always false for as_needed. */
  due: boolean;
  /** True if a supplement_log row already exists for this supplement today. */
  logged: boolean;
};

/**
 * Builds today's checklist from every ACTIVE supplement plus today's log
 * rows. Included:
 *   - any active supplement whose schedule is due today (daily, or a
 *     matching days_of_week), logged or not — this is the "outstanding"
 *     part of the list.
 *   - any active as_needed supplement that HAS been logged today, so an
 *     already-taken as-needed dose is visible (and un-loggable) alongside
 *     the scheduled ones, without ever appearing as an outstanding item
 *     on a day it wasn't taken (as_needed has no schedule to fall behind
 *     on — see schedule.ts's isDueOn doc).
 * Archived supplements (is_active = 0) never appear here regardless of
 * schedule or log state — they still exist for history via
 * supplementRepo.listAll / getLogsForSupplement.
 *
 * Order is stable (input order — callers pass an already-sorted list,
 * e.g. supplementRepo.listActive's created_at DESC, name ASC) and does
 * NOT resort logged items to the bottom or otherwise visually segregate
 * "done" from "not done" — that framing is exactly the completion-
 * affordance-as-scoreboard pattern PRD §10 warns this feature is most
 * tempted toward.
 */
export function buildDueTodayList(
  supplements: readonly SupplementRow[],
  logsForDate: readonly SupplementLogRow[],
  dateISO: string
): DueTodayItem[] {
  // Defensive filter, not just a documentation promise: even though
  // callers are expected to pass logs already scoped to `dateISO` (e.g.
  // supplementRepo.getLogsForDate), a stray row for a different date
  // must never be misread as "logged today" — that would surface a false
  // "done" checkmark for a supplement that wasn't actually taken today.
  const loggedIds = new Set(logsForDate.filter((l) => l.date === dateISO).map((l) => l.supplement_id));
  const items: DueTodayItem[] = [];

  for (const supplement of supplements) {
    if (supplement.is_active !== 1) continue;

    const spec = parseSchedule(supplement.schedule);
    const due = isDueOn(spec, dateISO);
    const logged = loggedIds.has(supplement.id);

    if (due || logged) {
      items.push({ supplement, due, logged });
    }
  }

  return items;
}
