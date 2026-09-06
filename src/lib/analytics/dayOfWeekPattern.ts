// ═══════════════════════════════════════════════════════════════════════
// DAY-OF-WEEK PATTERN — average intake by weekday.
//
// "Genuinely actionable (weekends usually differ) and computable from
// very little data" (task brief). Groups logged days by weekday
// (Mon..Sun) and averages kcal ONLY over days that were actually logged —
// a weekday with zero logged occurrences reports null (never 0, never an
// average diluted by unlogged days).
// ═══════════════════════════════════════════════════════════════════════

export type DayOfWeekIntakeDay = {
  date: string;
  /** null = gap/unlogged day — excluded entirely from the weekday average. */
  loggedKcal: number | null;
};

export type DayOfWeekPoint = {
  /** 0=Monday .. 6=Sunday, matching the ISO week convention used elsewhere in this module set. */
  weekdayIndex: number;
  label: string;
  avgKcal: number | null;
  sampleCount: number;
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** ISO weekday index: 0=Monday..6=Sunday (JS getUTCDay is 0=Sunday..6=Saturday). */
function isoWeekdayIndex(date: string): number {
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Average logged kcal per weekday across the whole window. Returns one
 * entry per weekday, Monday first, each independently null-safe: a
 * weekday with zero logged samples in the window reports
 * `avgKcal: null, sampleCount: 0`, never a fabricated 0.
 */
export function buildDayOfWeekPattern(days: DayOfWeekIntakeDay[]): DayOfWeekPoint[] {
  const buckets: number[][] = Array.from({ length: 7 }, () => []);

  for (const day of days) {
    if (day.loggedKcal === null) continue;
    const idx = isoWeekdayIndex(day.date);
    buckets[idx].push(day.loggedKcal);
  }

  return buckets.map((values, idx) => ({
    weekdayIndex: idx,
    label: WEEKDAY_LABELS[idx],
    avgKcal: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
    sampleCount: values.length,
  }));
}
