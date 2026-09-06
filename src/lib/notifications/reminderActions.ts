// ═══════════════════════════════════════════════════════════════════════
// REMINDER ACTIONS — orchestrates settingsStore.ts (persistence) +
// scheduler.ts (native calls) behind one small API that SettingsScreen.tsx
// and weightEntryActions.ts call into. Neither of those two files talks to
// `expo-notifications` or `app_notification_prefs` directly.
//
// ─── The "already weighed today" skip — chosen approach + trade-off ─────
// CLAUDE.md's brief lays out two honest options and asks for one, fully
// implemented, with the trade-off named:
//
//   (a) cancel/reschedule the next occurrence when a weight is saved, or
//   (b) check on notification response (i.e. only react after the user
//       has already been shown/tapped it).
//
// This module implements (a): `reconcileAfterWeightLogged` below cancels
// the standing reminder and reschedules a fresh DAILY trigger the instant
// today's weight is saved. `nextOccurrence` (weighInReminder.ts) documents
// why that's enough in the common case: expo-notifications' native DAILY
// trigger always fires at the *soonest future* hour:minute, so if the log
// happens after today's reminder time has already passed — the ordinary
// flow, since most people log in response to seeing the notification —
// the freshly-scheduled DAILY trigger's next occurrence is naturally
// tomorrow, and today stays silent for the rest of the day.
//
// The trade-off: if someone logs weight BEFORE today's chosen reminder
// time (e.g. wakes at 6am and logs immediately, with the reminder set for
// 7am), today's notification still fires once. There is no
// `expo-notifications` API to tell a repeating trigger "skip just this
// one occurrence, then resume" — the only way to guarantee that would be
// to drop to a one-shot for tomorrow and rely on *something* running
// again afterwards to re-arm a recurring schedule, which reintroduces
// exactly the "silently stops if the app isn't opened" failure mode
// CLAUDE.md rules out for the steady-state schedule. A once-in-a-while
// redundant reminder on an early-riser's already-logged day is a much
// smaller cost than a reminder that can go permanently silent, so this
// module always keeps the DAILY trigger as the one and only schedule
// primitive and accepts that one-day gap rather than engineering around
// it with a fragile one-shot chain.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import { todayLocalISO } from '../localDate';
import * as scheduler from './scheduler';
import type { PermissionState } from './scheduler';
import { getNotificationPrefs, saveNotificationPrefs, type NotificationPrefs } from './settingsStore';

export type ReminderState = NotificationPrefs & {
  /** Live OS permission state — read fresh every time, never cached, so Settings never shows a toggle that looks on while permission is actually denied. */
  permission: PermissionState;
};

/** Full current state for Settings to render: stored prefs + the live OS permission. */
export async function getReminderState(db: Database): Promise<ReminderState> {
  const prefs = await getNotificationPrefs(db);
  const permission = await scheduler.getPermissionState();
  return { ...prefs, permission };
}

export type EnableResult = { permission: PermissionState };

/**
 * Turns the reminder on: requests permission (this is the ONLY place that
 * may prompt — called only from the Settings toggle, i.e. direct user
 * action, never at startup), and schedules the daily trigger if granted.
 * If denied, prefs are saved with `enabled: false` — a toggle that looked
 * "on" while permission was denied would be a lie (CLAUDE.md).
 */
export async function enableReminder(db: Database, hour: number, minute: number): Promise<EnableResult> {
  const permission = await scheduler.requestPermission();
  const prefs = await getNotificationPrefs(db);

  if (permission !== 'granted') {
    await saveNotificationPrefs(db, { ...prefs, enabled: false, hour, minute });
    return { permission };
  }

  const identifier = await scheduler.scheduleDailyReminder(hour, minute, prefs.scheduledIdentifier);
  await saveNotificationPrefs(db, { enabled: true, hour, minute, scheduledIdentifier: identifier });
  return { permission };
}

/** Turns the reminder off: cancels the scheduled notification and persists `enabled: false`. */
export async function disableReminder(db: Database): Promise<void> {
  const prefs = await getNotificationPrefs(db);
  await scheduler.cancelReminder(prefs.scheduledIdentifier);
  await saveNotificationPrefs(db, { ...prefs, enabled: false, scheduledIdentifier: null });
}

/** Changes the reminder time. Reschedules immediately if currently enabled; otherwise just remembers the new time for next time it's turned on. */
export async function updateReminderTime(db: Database, hour: number, minute: number): Promise<void> {
  const prefs = await getNotificationPrefs(db);
  if (!prefs.enabled) {
    await saveNotificationPrefs(db, { ...prefs, hour, minute });
    return;
  }
  const identifier = await scheduler.scheduleDailyReminder(hour, minute, prefs.scheduledIdentifier);
  await saveNotificationPrefs(db, { ...prefs, hour, minute, scheduledIdentifier: identifier });
}

/**
 * Call this after ANY successful weight save (see weightEntryActions.ts).
 * Only reconciles the schedule when `date` is today — editing a past
 * day's weight (PRD §10: "everything editable forever") must not touch
 * today's reminder state at all. A no-op if the reminder is off.
 */
export async function reconcileAfterWeightLogged(db: Database, date: string): Promise<void> {
  if (date !== todayLocalISO()) return;

  const prefs = await getNotificationPrefs(db);
  if (!prefs.enabled) return;

  const permission = await scheduler.getPermissionState();
  if (permission !== 'granted') return;

  const identifier = await scheduler.scheduleDailyReminder(prefs.hour, prefs.minute, prefs.scheduledIdentifier);
  await saveNotificationPrefs(db, { ...prefs, scheduledIdentifier: identifier });
}
