// ═══════════════════════════════════════════════════════════════════════
// SCHEDULER — the only file in this module that imports `expo-notifications`
// directly (mirrors src/lib/db.ts being the only file importing
// `expo-sqlite`). Everything native-facing (permissions, the actual
// schedule/cancel calls, the Android notification channel, the
// foreground-handler config, the tap-response listener) lives here so it
// can be mocked wholesale in tests — no real notification is ever
// scheduled by `npx jest`.
//
// ─── Why a DAILY trigger, not a rescheduled one-shot ─────────────────────
// CLAUDE.md is explicit: "scheduled with a daily repeating trigger — not
// a one-shot rescheduled on launch, which silently stops if the app isn't
// opened." `Notifications.SchedulableTriggerInputTypes.DAILY` is a true
// native repeating trigger (confirmed against
// node_modules/expo-notifications/build/scheduleNotificationAsync.js:
// `parseDailyTrigger` is a first-class branch of `parseTrigger`, handled
// entirely on the native side) — once scheduled it keeps firing every day
// at hour:minute forever, with zero JS involvement, even if the app is
// never opened again. That is the property this feature cannot give up.
// ═══════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import {
  WEIGH_IN_REMINDER_TITLE,
  WEIGH_IN_REMINDER_BODY,
  WEIGH_IN_NOTIFICATION_DATA,
  isWeighInReminderData,
} from './weighInReminder';

/** Android 8+ requires a channel for a notification to display at all; harmless no-op on iOS. */
const ANDROID_CHANNEL_ID = 'weigh-in-reminder';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

function toPermissionState(response: Notifications.NotificationPermissionsStatus): PermissionState {
  if (response.granted) return 'granted';
  // iOS "provisional" (quiet, no alert/sound) still counts as granted for our purposes —
  // we'd rather show the reminder quietly than report it as denied when it isn't.
  if (response.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  if (response.status === 'denied') return 'denied';
  return 'undetermined';
}

/** Read-only permission check — never prompts. Safe to call at any time, including app startup. */
export async function getPermissionState(): Promise<PermissionState> {
  return toPermissionState(await Notifications.getPermissionsAsync());
}

/** Prompts the OS permission dialog. Callers must only invoke this in direct response to a user turning the reminder on (CLAUDE.md: never at startup). */
export async function requestPermission(): Promise<PermissionState> {
  return toPermissionState(await Notifications.requestPermissionsAsync());
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Weigh-in reminder',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * (Re)schedules the daily reminder at hour:minute, cancelling whatever
 * was previously scheduled first (both the caller's known previous
 * identifier and, defensively, any other lingering copy of this specific
 * reminder — see cancelReminder). Returns the new identifier to persist.
 */
export async function scheduleDailyReminder(
  hour: number,
  minute: number,
  previousIdentifier: string | null
): Promise<string> {
  await ensureAndroidChannel();
  await cancelReminder(previousIdentifier);
  return Notifications.scheduleNotificationAsync({
    content: {
      title: WEIGH_IN_REMINDER_TITLE,
      body: WEIGH_IN_REMINDER_BODY,
      data: WEIGH_IN_NOTIFICATION_DATA,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
}

/** Cancels a specific previously-scheduled reminder by identifier. A no-op (not an error) if `identifier` is null or already gone. */
export async function cancelReminder(identifier: string | null): Promise<void> {
  if (!identifier) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Already cancelled/expired/unknown id — nothing to do. Never let a
    // stale identifier turn "turn the reminder off" into a crash.
  }
}

/**
 * Sets the in-app (foreground) notification presentation. Without this,
 * expo-notifications' default behavior is to NOT show a notification
 * while the app is in the foreground at all — this reminder should still
 * show (quietly, no sound) if it happens to fire while Joule is open.
 * Call once at app startup (App.tsx).
 */
export function configureForegroundPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Registers the tap-response listener: `onWeighInTapped` fires only when
 * the notification the user tapped is THIS reminder (checked via its
 * `data.type` tag), never for some other future notification type.
 * Returns the subscription to clean up on unmount.
 */
export function addWeighInResponseListener(onWeighInTapped: () => void): EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    if (isWeighInReminderData(response.notification.request.content.data)) {
      onWeighInTapped();
    }
  });
}

/**
 * Cold-start case: the app was launched BY tapping the notification, so
 * the response listener above (registered after this launch already
 * happened) may miss the event that caused the launch. Call once at
 * startup alongside the listener — if the most recent response on record
 * is this reminder, treat it the same as a live tap.
 */
export function wasLaunchedFromWeighInReminder(): boolean {
  const last = Notifications.getLastNotificationResponse();
  return last !== null && isWeighInReminderData(last.notification.request.content.data);
}
