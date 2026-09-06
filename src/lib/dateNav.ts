// ═══════════════════════════════════════════════════════════════════════
// DATE NAVIGATION — pure bounds/step logic for Today's date switcher.
//
// "Today" remains the default landing state (this module has no state of
// its own — TodayScreen owns the selected date, defaulting to
// todayLocalISO() on mount) and is always one tap away via `today()`
// below. The one hard rule: logging into the future would corrupt the
// TDEE engine's daily axis (src/engine/date.ts's buildDailyAxis walks a
// contiguous day range assuming every date up to "today" either has data
// or is a legitimate gap — a future-dated row is neither), so `clampToToday`
// is the single choke point every date-nav interaction must pass through
// before it reaches the DB layer.
//
// Deliberately independent of src/engine/date.ts's UTC day-index math:
// the Today screen's "what day is the user looking at" is a local-time
// concept (see localDate.ts's header comment on the same distinction),
// so this module works in local-date arithmetic via localDate.ts/Date,
// not UTC.
// ═══════════════════════════════════════════════════════════════════════

import { toLocalISO, todayLocalISO } from './localDate';

/** Add `days` (may be negative) to an ISO local date, in local calendar time. */
export function addLocalDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toLocalISO(dt);
}

/** True if `dateISO` is strictly after today (local time) — the one state date-nav must never reach. */
export function isFutureDate(dateISO: string): boolean {
  return dateISO > todayLocalISO();
}

/**
 * Clamps a candidate date to at most today. This is the single choke
 * point for "do not allow logging into the future": every date-nav step
 * (next-day tap, date-picker selection) must run its result through this
 * before it becomes the screen's selected date or reaches any repo call.
 */
export function clampToToday(dateISO: string): string {
  const today = todayLocalISO();
  return dateISO > today ? today : dateISO;
}

/** One day back from `dateISO`. Never clamped — the past is unbounded (PRD §10: everything editable forever). */
export function previousDay(dateISO: string): string {
  return addLocalDaysISO(dateISO, -1);
}

/** One day forward from `dateISO`, clamped so it can never cross into the future. */
export function nextDay(dateISO: string): string {
  return clampToToday(addLocalDaysISO(dateISO, 1));
}

/** Whether the "next day" control should be disabled — true once already viewing today (there is no valid forward step). */
export function isNextDayDisabled(dateISO: string): boolean {
  return dateISO >= todayLocalISO();
}

/**
 * Resolves the date a capture route (barcode/label/photo/voice) should log
 * against: the `date` param TodayScreen passed when opening the route
 * (task fix — these routes used to always hardcode `todayLocalISO()`,
 * silently landing a backfilled capture on today even when the user was
 * browsing a past day), falling back to today only when the param is
 * absent (an older caller/deep-link that predates this fix, or a
 * directly-opened route with no Today context at all).
 *
 * Also runs the result through `clampToToday` — the one choke point every
 * date-nav interaction must pass through (see this module's header) —
 * so a malformed/future param can never bypass the "no logging into the
 * future" guardrail just because it arrived via a route param instead of
 * DateHeader's own controls.
 */
export function resolveCaptureDate(paramDate: string | undefined): string {
  return clampToToday(paramDate ?? todayLocalISO());
}
