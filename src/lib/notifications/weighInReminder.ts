// ═══════════════════════════════════════════════════════════════════════
// WEIGH-IN REMINDER — pure logic only (PRD §9.6, CLAUDE.md's morning
// weigh-in reminder brief). No `expo-notifications` import here at all —
// that keeps this file trivially unit-testable without mocking a native
// module, and is what "Pure, tested logic for next-occurrence time
// computation ... and the already-weighed-today skip predicate" (task
// brief's quality bar) actually means: the *decisions* are pure functions,
// the native scheduling calls live in `scheduler.ts`.
//
// ─── Copy (PRD §10 / CLAUDE.md "Copy — this is not decoration") ─────────
// "No streaks, no guilt, no red... because a user who logs dishonestly to
// protect a number poisons the engine." The title/body below are the one
// and only place this reminder's wording lives — neutral, factual, states
// the five-second cost, never references a streak or a miss.
// ═══════════════════════════════════════════════════════════════════════

/** Default reminder time (PRD §9.6: "morning prompt") — 7:00am, editable in Settings. */
export const DEFAULT_REMINDER_HOUR = 7;
export const DEFAULT_REMINDER_MINUTE = 0;

export const WEIGH_IN_REMINDER_TITLE = 'Morning weigh-in';
export const WEIGH_IN_REMINDER_BODY = 'One number, about five seconds — log today’s weight when you’re ready.';

/**
 * Tag carried in the notification's `data` payload so the response
 * listener (App.tsx) can tell "the user tapped OUR reminder" apart from
 * any other local/push notification the app might schedule in future,
 * and so the scheduler can identify stray copies of this notification.
 */
export const WEIGH_IN_NOTIFICATION_TYPE = 'weigh-in-reminder';
export const WEIGH_IN_NOTIFICATION_DATA = { type: WEIGH_IN_NOTIFICATION_TYPE } as const;

/** True if a notification's `data` payload is this reminder (not some other future notification type). */
export function isWeighInReminderData(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).type === WEIGH_IN_NOTIFICATION_TYPE
  );
}

/**
 * The next Date at which `hour:minute` occurs, relative to `now` — today
 * if that time hasn't passed yet today, tomorrow if it has (or is exactly
 * now, treated as "already passed" so a boundary tick never double-fires
 * the same minute). Seconds/milliseconds on `now` are ignored; the result
 * is always exactly on the `:00.000` of the target minute.
 *
 * This mirrors the semantics `expo-notifications`' native `DailyTriggerInput`
 * uses internally (its "next occurrence" is always the soonest future
 * match) — surfaced here as a pure, testable function so Settings can
 * display "Next reminder: ..." and so the reschedule-on-log trade-off
 * (see reminderActions.ts) can be explained and verified without a device.
 */
export function nextOccurrence(now: Date, hour: number, minute: number): Date {
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (candidate.getTime() > now.getTime()) {
    return candidate;
  }
  candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

/** Whether the most recently logged weight date is today — the "already weighed today" skip predicate. */
export function hasLoggedToday(mostRecentWeightDate: string | null, todayISO: string): boolean {
  return mostRecentWeightDate === todayISO;
}

/** Add (or subtract) minutes from an hour:minute pair, wrapping within a single 24h day. Used by Settings' time stepper. */
export function shiftTime(hour: number, minute: number, deltaMinutes: number): { hour: number; minute: number } {
  const totalMinutes = ((hour * 60 + minute + deltaMinutes) % 1440 + 1440) % 1440;
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
}

/** Format hour:minute as a 12-hour clock string, e.g. "7:00 AM". */
export function formatTime12h(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}
