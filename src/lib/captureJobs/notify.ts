// ═══════════════════════════════════════════════════════════════════════
// CAPTURE JOB NOTIFICATIONS — the one file in this module that imports
// `expo-notifications` directly (same isolation convention as src/lib/
// notifications/scheduler.ts, which owns the weigh-in reminder's native
// calls). Mockable wholesale in tests — no real notification is ever
// scheduled by `npx jest`.
//
// Deliberately a SEPARATE channel/module from scheduler.ts rather than
// extending it: scheduler.ts's exported surface (schedule/cancel a daily
// reminder) is shaped for exactly one recurring reminder, and its
// tap-listener already filters to weigh-in-only data. A capture job is a
// different notification shape entirely (fires once, immediately, tagged
// with a job id) — forking a second isolation module is simpler and
// safer than widening scheduler.ts's contract for an unrelated feature.
// `Notifications.addNotificationResponseReceivedListener` supports many
// simultaneous listeners, so this one coexists with scheduler.ts's
// without either needing to know about the other.
//
// Foreground presentation (whether a notification shows while the app is
// already open) is configured GLOBALLY, once, by scheduler.ts's
// `configureForegroundPresentation` — already wired at app startup in
// App.tsx — so it is not repeated here.
// ═══════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import { describeJob } from './jobReducer';
import type { CaptureJob } from './types';

const ANDROID_CHANNEL_ID = 'capture-jobs';
const NOTIFICATION_DATA_TYPE = 'capture_job';

type CaptureJobNotificationData = { type: typeof NOTIFICATION_DATA_TYPE; jobId: string };

function isCaptureJobNotificationData(data: unknown): data is CaptureJobNotificationData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).type === NOTIFICATION_DATA_TYPE &&
    typeof (data as Record<string, unknown>).jobId === 'string'
  );
}

/** Android 8+ requires a channel for a notification to display at all; harmless no-op on iOS. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Scan results',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Fires a local notification for a job that has just settled (done or
 * error). Callers (store.ts) only invoke this when nobody is actively
 * watching the job from its own screen — see store.ts's `watchJob` docs —
 * so a fast scan the user stayed to watch never produces a redundant
 * notification on top of the ConfirmSheet that already popped up.
 *
 * Best-effort: swallows its own failures (e.g. permission never granted)
 * — a missed push notification must never be the only way a completed
 * job is discoverable. The Today indicator pill (reading the same store)
 * is the reliable fallback regardless of OS notification permission.
 */
export async function notifyJobSettled(job: CaptureJob): Promise<void> {
  if (job.status === 'processing') return;
  try {
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: job.status === 'done' ? 'Ready to confirm' : "Couldn't finish",
        body: describeJob(job),
        data: { type: NOTIFICATION_DATA_TYPE, jobId: job.id },
      },
      trigger: { channelId: ANDROID_CHANNEL_ID },
    });
  } catch {
    // Best-effort — see docstring.
  }
}

/** Registers the tap-response listener: fires only for a notification this module scheduled, with the job id it was tagged with. Returns the subscription to clean up on unmount. */
export function addCaptureJobResponseListener(onJobTapped: (jobId: string) => void): EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (isCaptureJobNotificationData(data)) {
      onJobTapped(data.jobId);
    }
  });
}

/**
 * Cold-start case: the app was launched BY tapping a capture-job
 * notification, so the response listener above (registered after this
 * launch already happened) may miss the event that caused it. Mirrors
 * scheduler.ts's `wasLaunchedFromWeighInReminder` for the same reason.
 */
export function getColdStartCaptureJobId(): string | null {
  const last = Notifications.getLastNotificationResponse();
  const data = last?.notification.request.content.data;
  return isCaptureJobNotificationData(data) ? data.jobId : null;
}
