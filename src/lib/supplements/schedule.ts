// ═══════════════════════════════════════════════════════════════════════
// SUPPLEMENT SCHEDULE — pure parse/serialize/due-check logic.
//
// `supplement.schedule` (schema.ts) stores one of these, JSON-encoded, as
// plain TEXT. Three shapes (task brief: "daily / specific days /
// as-needed"):
//   daily          — due every calendar day.
//   days_of_week   — due on a fixed subset of weekdays (0=Sunday..6=
//                    Saturday, matching JS Date#getDay()).
//   as_needed      — never "due" in the CLAUDE.md/PRD §10 sense (no
//                    streaks, no guilt): it has no fixed cadence to fall
//                    behind on, so it must never render as an outstanding/
//                    undone item. It's always available to log on demand
//                    from the full supplement list; isDueOn() intentionally
//                    always returns false for it — see dueToday.ts for how
//                    an already-logged as-needed dose still surfaces today.
//
// Pure, synchronous, zero I/O — directly unit-testable and safe to import
// from both the DB-facing repo layer and screens.
// ═══════════════════════════════════════════════════════════════════════

export type ScheduleSpec =
  | { type: 'daily' }
  | { type: 'days_of_week'; days: number[] }
  | { type: 'as_needed' };

export const DEFAULT_SCHEDULE: ScheduleSpec = { type: 'daily' };

export function serializeSchedule(spec: ScheduleSpec): string {
  return JSON.stringify(spec);
}

function isValidDayOfWeek(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6;
}

/**
 * Parse a stored `supplement.schedule` string into a ScheduleSpec. Never
 * throws: malformed JSON, an unrecognised `type`, or a pre-v5 free-text
 * value (the column was an unused Phase-2 stub before this migration, but
 * defending against it costs nothing) all fall back to `as_needed` —
 * chosen deliberately over `daily` as the safe default, since `daily`
 * would make a supplement with corrupted schedule data suddenly appear as
 * an outstanding, unticked "due today" item (exactly the false-guilt
 * signal PRD §10 bans), whereas `as_needed` just makes it quietly
 * available to log on demand.
 */
export function parseSchedule(raw: string): ScheduleSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: 'as_needed' };
  }

  if (typeof parsed !== 'object' || parsed === null) return { type: 'as_needed' };
  const obj = parsed as Record<string, unknown>;

  if (obj.type === 'daily') return { type: 'daily' };
  if (obj.type === 'as_needed') return { type: 'as_needed' };
  if (obj.type === 'days_of_week' && Array.isArray(obj.days)) {
    const days = obj.days.filter(isValidDayOfWeek);
    // An empty/entirely-invalid days array means "due on no day of the
    // week" — technically valid but functionally identical to as_needed
    // for isDueOn's purposes, so no special-casing needed here; isDueOn
    // just returns false for every date, same as the encoded intent.
    return { type: 'days_of_week', days };
  }

  return { type: 'as_needed' };
}

/**
 * True if `spec` schedules a dose on `dateISO` (yyyy-mm-dd, local
 * calendar date — parsed with local Date fields, matching the rest of
 * this app's date convention, see src/lib/localDate.ts). `as_needed` is
 * always false: it has nothing to be "due" against (see file header).
 */
export function isDueOn(spec: ScheduleSpec, dateISO: string): boolean {
  if (spec.type === 'daily') return true;
  if (spec.type === 'as_needed') return false;

  const [y, m, d] = dateISO.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return spec.days.includes(dow);
}

/** Short, factual label for the "manage supplements" list — never editorial, never a compliance judgment. */
export function describeSchedule(spec: ScheduleSpec): string {
  if (spec.type === 'daily') return 'Daily';
  if (spec.type === 'as_needed') return 'As needed';
  if (spec.days.length === 0) return 'No days set';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sorted = [...spec.days].sort((a, b) => a - b);
  return sorted.map((d) => names[d]).join(', ');
}
