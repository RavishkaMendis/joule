// ═══════════════════════════════════════════════════════════════════════
// ZEPP IMPORT — date parsing (PRD §11/§12: generic reference-data import).
//
// Zepp's export format is not standardized across region/app
// version/export type, so this module does not assume a single date
// shape. It tries, in order: ISO (yyyy-mm-dd, optionally with a time
// component), epoch milliseconds, epoch seconds, and DD/MM/YYYY or
// MM/DD/YYYY with slash/dash/dot separators.
//
// The dangerous case is a slash-separated date where both interpretations
// are plausible (e.g. "03/04/2026" — 3 April or March 4th). Silently
// guessing here is exactly the kind of "reasonable at 2am" mistake this
// codebase's engine wall exists to prevent one layer up (PRD §3) — so for
// reference data too, we surface the ambiguity rather than picking one
// silently:
//   - If exactly one of the two componen ts is > 12, the date is
//     unambiguous (that component must be the day) regardless of locale.
//   - If both components are <= 12, we default to DD/MM/YYYY (this app
//     and its target user are Australian — PRD's AFCD/kJ sections make
//     that locale explicit throughout) and report which interpretation
//     was used so the caller can surface it, rather than silently
//     assuming US MM/DD/YYYY.
// ═══════════════════════════════════════════════════════════════════════

export type DateParseResult = {
  /** ISO yyyy-mm-dd, or null if the input could not be parsed at all. */
  iso: string | null;
  /**
   * Set only when a slash/dash/dot two-numeric-leading-component date was
   * ambiguous (both components <= 12) and a locale default (DD/MM/YYYY)
   * had to be assumed. Callers should surface this to the user rather
   * than silently trusting the parse.
   */
  ambiguityNote: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Reject e.g. Feb 30 — construct via UTC and check it round-trips.
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Parse an epoch-looking numeric string. Zepp (and most wearable exports)
 * use milliseconds for JS-derived timestamps but some CSV exports store
 * seconds. Heuristic: 10-digit-ish numbers (< ~4.1e9) are seconds,
 * 13-digit-ish numbers are milliseconds. Returns null if the string isn't
 * purely numeric or doesn't fall in a plausible date range (2000-2100).
 */
function parseEpoch(raw: string): string | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  // Plausible seconds range for 2000-01-01 .. 2100-01-01.
  const MIN_S = 946684800;
  const MAX_S = 4102444800;
  let ms: number;
  if (n >= MIN_S && n <= MAX_S) {
    ms = n * 1000;
  } else if (n >= MIN_S * 1000 && n <= MAX_S * 1000) {
    ms = n;
  } else {
    return null;
  }

  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  // Use UTC fields: epoch timestamps are instants, not local wall-clock
  // dates — treating them as UTC is the least-surprising, most reproducible
  // choice for a pure function (no ambient timezone dependency in tests).
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Parse one date cell from a Zepp export into ISO yyyy-mm-dd, trying
 * multiple formats. Never throws — returns `{ iso: null, ... }` on
 * failure so a bad cell can be reported and skipped rather than crashing
 * the whole import.
 */
export function parseZeppDate(raw: string): DateParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { iso: null, ambiguityNote: null };

  // ISO 8601: yyyy-mm-dd, optionally followed by a time/offset/'T'.
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (isValidYmd(year, month, day)) {
      return { iso: toIso(year, month, day), ambiguityNote: null };
    }
    return { iso: null, ambiguityNote: null };
  }

  // Pure numeric: epoch seconds or milliseconds.
  if (/^\d+$/.test(trimmed)) {
    const iso = parseEpoch(trimmed);
    return { iso, ambiguityNote: null };
  }

  // Slash/dash/dot separated: D/M/Y, M/D/Y, or Y/M/D (rare but Zepp's
  // Chinese-region export has been observed using yyyy/mm/dd).
  const slashMatch = trimmed.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/);
  if (slashMatch) {
    const [, a, b, c] = slashMatch;
    const aNum = Number(a);
    const bNum = Number(b);
    const cNum = Number(c);

    // Y/M/D — first component is a 4-digit year.
    if (a.length === 4) {
      if (isValidYmd(aNum, bNum, cNum)) {
        return { iso: toIso(aNum, bNum, cNum), ambiguityNote: null };
      }
      return { iso: null, ambiguityNote: null };
    }

    // D/M/Y or M/D/Y — last component is the (2 or 4-digit) year.
    const year = c.length === 2 ? 2000 + cNum : cNum;

    const aIsDayOnly = aNum > 12; // a can't be a month -> must be day (D/M/Y)
    const bIsDayOnly = bNum > 12; // b can't be a month -> must be day (M/D/Y)

    if (aIsDayOnly && !bIsDayOnly) {
      // Unambiguous D/M/Y.
      return isValidYmd(year, bNum, aNum)
        ? { iso: toIso(year, bNum, aNum), ambiguityNote: null }
        : { iso: null, ambiguityNote: null };
    }
    if (bIsDayOnly && !aIsDayOnly) {
      // Unambiguous M/D/Y.
      return isValidYmd(year, aNum, bNum)
        ? { iso: toIso(year, aNum, bNum), ambiguityNote: null }
        : { iso: null, ambiguityNote: null };
    }
    if (aIsDayOnly && bIsDayOnly) {
      // Neither can be a month at all (both > 12) — not a valid calendar date.
      return { iso: null, ambiguityNote: null };
    }

    // Both components <= 12: genuinely ambiguous. Default to DD/MM/YYYY
    // (this app's locale is Australian throughout the PRD) and say so
    // explicitly rather than silently assuming US MM/DD/YYYY.
    if (isValidYmd(year, bNum, aNum)) {
      return {
        iso: toIso(year, bNum, aNum),
        ambiguityNote: `"${trimmed}" is ambiguous (both parts <= 12) — read as DD/MM/YYYY (${toIso(year, bNum, aNum)}), not US MM/DD/YYYY.`,
      };
    }
    return { iso: null, ambiguityNote: null };
  }

  return { iso: null, ambiguityNote: null };
}
