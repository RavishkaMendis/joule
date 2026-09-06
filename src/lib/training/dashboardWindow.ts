// ═══════════════════════════════════════════════════════════════════════
// dashboardWindow — the training dashboard's selectable time window
// ("4 weeks" / "12 weeks" / "all time"). Pulled out of the screen so the
// date-range math (the off-by-one-prone part) is plain-Node-testable, same
// rationale as src/lib/chartScale.ts.
//
// Windowing here only ever NARROWS which real sessions are included — it
// never fabricates a session, a zero-volume day, or a zero-volume week for
// dates the window spans but no session touches. "All time" (`windowStart
// === null`) has no lower bound at all, so a brand-new account with one
// session three days ago sees that session under every window option.
// ═══════════════════════════════════════════════════════════════════════

import { addDaysISO } from '../../engine/date';

export type DashboardWindow = '4w' | '12w' | 'all';

export const DASHBOARD_WINDOW_OPTIONS: { value: DashboardWindow; label: string }[] = [
  { value: '4w', label: '4 wks' },
  { value: '12w', label: '12 wks' },
  { value: 'all', label: 'All time' },
];

const WINDOW_DAYS: Record<Exclude<DashboardWindow, 'all'>, number> = {
  '4w': 28,
  '12w': 84,
};

/**
 * Inclusive lower bound (ISO yyyy-mm-dd) for a window ending on `todayISO`,
 * or `null` for 'all' (no lower bound — every session ever logged counts).
 */
export function windowStartDate(window: DashboardWindow, todayISO: string): string | null {
  if (window === 'all') return null;
  return addDaysISO(todayISO, -(WINDOW_DAYS[window] - 1));
}

/** True if `date` (ISO yyyy-mm-dd) falls within [start, end] — start === null means unbounded below. */
export function isWithinWindow(date: string, start: string | null, end: string): boolean {
  if (date > end) return false;
  if (start !== null && date < start) return false;
  return true;
}
