// ═══════════════════════════════════════════════════════════════════════
// DATE HELPERS — ISO yyyy-mm-dd ↔ day-index math.
//
// All arithmetic here is done against UTC midnight for the given calendar
// date, never the local timezone. If we parsed with `new Date('2024-03-10')`
// vs `new Date(2024, 2, 10)` interchangeably, DST transitions in the host's
// local zone could shift a day boundary by ±1 hour and, near midnight,
// flip which calendar day an index resolves to. Treating every ISO date as
// a UTC calendar date sidesteps that entirely — day-index math becomes
// plain integer division, independent of the host's timezone or DST rules.
// ═══════════════════════════════════════════════════════════════════════

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse an ISO `yyyy-mm-dd` string into a UTC-midnight epoch-ms timestamp. */
export function parseISODateUTC(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid ISO date: ${date}`);
  }
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

/** Format a UTC-midnight epoch-ms timestamp back into ISO `yyyy-mm-dd`. */
export function formatISODateUTC(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Whole-day offset between two ISO dates (`b - a`, in days). UTC-safe:
 * both sides are normalized to UTC midnight before subtracting, so this
 * is immune to local-timezone DST shifts.
 */
export function dayOffset(a: string, b: string): number {
  return Math.round((parseISODateUTC(b) - parseISODateUTC(a)) / MS_PER_DAY);
}

/** Add `days` (may be negative) to an ISO date, returning a new ISO date. */
export function addDaysISO(date: string, days: number): string {
  return formatISODateUTC(parseISODateUTC(date) + days * MS_PER_DAY);
}

/**
 * Build the continuous list of ISO dates from `start` to `end` inclusive,
 * one per calendar day, with no gaps — this is the daily axis the Kalman
 * filter walks, regardless of which days actually have a weight_log row.
 */
export function buildDailyAxis(start: string, end: string): string[] {
  const totalDays = dayOffset(start, end);
  if (totalDays < 0) {
    throw new Error(`start (${start}) must not be after end (${end})`);
  }
  const axis: string[] = new Array(totalDays + 1);
  for (let i = 0; i <= totalDays; i++) {
    axis[i] = addDaysISO(start, i);
  }
  return axis;
}
