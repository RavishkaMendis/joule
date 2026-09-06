// ═══════════════════════════════════════════════════════════════════════
// LOCAL-TIME DATE HELPERS
//
// PRD §3: every date column in the schema (day_intake.date, weight_log.date,
// food_entry.date) is "ISO yyyy-mm-dd, local time" — i.e. what calendar day
// it is on the user's device, not UTC. This is deliberately distinct from
// src/engine/date.ts, which operates on ISO strings that already exist and
// does its day-index arithmetic in UTC (to dodge DST edge cases in pure
// day-offset math). App code producing "what date is it right now for the
// user" belongs here, at the app layer, not in the engine.
// ═══════════════════════════════════════════════════════════════════════

/** Today's date as an ISO yyyy-mm-dd string, in the device's local time zone. */
export function todayLocalISO(): string {
  return toLocalISO(new Date());
}

/** Format a JS Date as ISO yyyy-mm-dd using its local (not UTC) calendar fields. */
export function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True if `dateISO` (yyyy-mm-dd) is today in local time. */
export function isToday(dateISO: string): boolean {
  return dateISO === todayLocalISO();
}

/** Human label for a date relative to today: "Today", "Yesterday", or the ISO date. */
export function relativeDayLabel(dateISO: string): string {
  const today = todayLocalISO();
  if (dateISO === today) return 'Today';
  const [y, m, d] = dateISO.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const diffDays = Math.round(
    (Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / (24 * 60 * 60 * 1000)
  );
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 1) return 'Tomorrow';
  return dateISO;
}

/**
 * Short weekday-and-date label, e.g. "Tue 26 Aug" — used by the capture
 * screens' "Logging to <date>" banner (task fix: capture routes must make
 * a non-today logging date visible, not just correct). Deliberately a
 * calendar-style label rather than `relativeDayLabel`'s "Today"/"Yesterday"
 * words for anything beyond one day back/forward, so a date a week or a
 * month in the past still reads unambiguously rather than falling back to
 * a bare ISO string.
 */
export function formatDayLabel(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
