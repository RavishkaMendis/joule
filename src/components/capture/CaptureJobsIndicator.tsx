// ═══════════════════════════════════════════════════════════════════════
// CaptureJobsIndicator — the Today-screen surface for background scans
// (task brief: "a local notification plus an in-app indicator ... e.g. a
// pill on Today: '1 photo ready to confirm'. Tapping either opens the
// ConfirmSheet for that job.").
//
// This is the ONE component TodayScreen renders from this task (per the
// task's ownership split — "you may add a component but do not
// restructure TodayScreen beyond rendering your indicator"). It owns its
// own runtime wiring entirely: mounting it is what starts hydrating
// src/lib/captureJobs' store from disk and registers the notification-
// tap listener (`initCaptureJobsRuntime`) — TodayScreen doesn't need to
// know any of that happens. Today is the app's initial/default tab, so
// this mounts once at startup and — because react-navigation's bottom
// tabs keep visited tabs mounted rather than unmounting them on tab
// switch — stays mounted (and its listener registered) for the rest of
// the session even while the user is looking at Trends/Foods.
//
// Renders nothing when there are no known jobs (the overwhelmingly
// common case) — same "silence is the normal state" principle as
// CaptureDateBanner.
//
// PRD §7's non-negotiable rule applies here exactly as it does in every
// capture screen: tapping a `done` row opens the shared ConfirmSheet for
// that job's `PendingEntry[]`; nothing here ever writes to `food_entry`
// itself. Confirming or cancelling dismisses the job from the queue (via
// `dismissJob`), same as every capture screen's own ConfirmSheet wiring.
//
// ─── Failed jobs: no auto-retry, always dismissable ──────────────────────
// A tap on a `done`/`error` row used to be dispatched entirely inline
// here, and an `error` row's ONLY behaviour was an immediate retry — no
// dismiss path existed at all. That's a trap once the source photo/audio
// file is gone (types.ts's header: `*Base64` isn't persisted, and a
// retry re-reads the file at its `*Uri` — "as long as the OS hasn't
// cleared that cache file"): the app would silently keep retrying
// something it could prove would never work, forever, with no way off
// the pill. `jobTapAction`/`describeFailedJobPrompt` (jobPrompt.ts) and
// `captureJobSourceExists` (runner.ts) now do that classification and
// copy as pure, independently-tested functions — this component is a
// thin dispatch over them plus the actual `Alert`/`retryJob`/`dismissJob`
// calls, so "a tap never itself retries" is a fact about jobPrompt.ts's
// return type, not a habit this file has to remember to keep.
//
// The small "✕" on every pill (any status) is the other half of the fix:
// a VISIBLE, always-available way to drop a job outright, independent of
// whichever choice a failed job's prompt offers. The owner has already
// been burned once by a hidden long-press gesture elsewhere in this app,
// so this is a plain on-screen control, not a gesture to discover.
// Dismissing a `processing` job is safe even mid-flight — store.ts's
// `settleJob` already no-ops once the job is gone ("dismissed while the
// call was in flight — nothing left to settle").
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, type AlertButton } from 'react-native';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../../lib/theme';
import { getDatabase } from '../../lib/db';
import { ConfirmSheet } from '../ConfirmSheet';
import {
  captureJobSourceExists,
  describeFailedJobPrompt,
  describeJob,
  dismissJob,
  getJob,
  initCaptureJobsRuntime,
  jobTapAction,
  retryJob,
  useCaptureJobsList,
  type CaptureJob,
} from '../../lib/captureJobs';

export function CaptureJobsIndicator() {
  const jobs = useCaptureJobsList();
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  // The one path that removes a job for good — used by the explicit "✕"
  // on every pill, the failed-job prompt's "Discard", and ConfirmSheet's
  // own Cancel (which already discarded with no extra confirmation, so
  // this matches that existing precedent rather than adding a new one).
  const discardJob = useCallback((jobId: string) => {
    void (async () => {
      const db = await getDatabase();
      dismissJob(db, jobId);
    })();
  }, []);

  // Try again / Discard — the choice a failed job's tap now opens instead
  // of retrying blind. "Try again" is only offered when
  // `captureJobSourceExists` says the retry could even attempt to read
  // its source bytes (see runner.ts's doc on why that check exists).
  const promptFailedJob = useCallback(
    (job: CaptureJob) => {
      const prompt = describeFailedJobPrompt(job, captureJobSourceExists(job.input));
      const buttons: AlertButton[] = [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => discardJob(job.id) },
      ];
      if (prompt.canRetry) {
        buttons.push({
          text: 'Try again',
          onPress: () => {
            void (async () => {
              const db = await getDatabase();
              retryJob(db, job.id);
            })();
          },
        });
      }
      Alert.alert(prompt.title, prompt.message, buttons);
    },
    [discardJob]
  );

  // Shared by both a tap on the in-app pill and a tap on the OS
  // notification (the task brief's "tapping either opens the ConfirmSheet
  // for that job"). Reads straight from the store (not the `jobs` list
  // closed over by `initCaptureJobsRuntime`'s one-time effect below) so a
  // notification tap always sees the job's current status, not whatever
  // it was when this component last rendered.
  const openOrPromptJob = useCallback(
    (jobId: string) => {
      const job = getJob(jobId);
      if (!job) return;
      const action = jobTapAction(job);
      if (action.kind === 'open_confirm') {
        setOpenJobId(job.id);
      } else if (action.kind === 'prompt_failed') {
        promptFailedJob(job);
      }
    },
    [promptFailedJob]
  );

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const db = await getDatabase();
      unsubscribe = initCaptureJobsRuntime(db, openOrPromptJob);
    })();
    return () => unsubscribe?.();
  }, [openOrPromptJob]);

  const openJob = jobs.find((j) => j.id === openJobId && j.status === 'done');

  const handlePress = (job: CaptureJob) => openOrPromptJob(job.id);

  const closeSheet = () => setOpenJobId(null);

  return (
    <>
      {jobs.length > 0 && (
        <View style={styles.stack}>
          {jobs.map((job) => (
            <View key={job.id} style={styles.pill}>
              <Pressable
                onPress={() => handlePress(job)}
                disabled={job.status === 'processing'}
                style={({ pressed }) => [styles.pillMain, pressed && job.status !== 'processing' && styles.pillPressed]}
                accessibilityRole={job.status === 'processing' ? undefined : 'button'}
              >
                {job.status === 'processing' && <ActivityIndicator size="small" color={colors.textSecondary} />}
                <Text style={styles.pillText} numberOfLines={2}>
                  {describeJob(job)}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => discardJob(job.id)}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss: ${describeJob(job)}`}
                hitSlop={8}
                style={({ pressed }) => [styles.dismissButton, pressed && styles.dismissButtonPressed]}
              >
                <Text style={styles.dismissText}>{'✕'}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {openJob && (
        <ConfirmSheet
          entries={openJob.entries ?? []}
          date={openJob.date}
          onConfirm={async () => {
            const db = await getDatabase();
            dismissJob(db, openJob.id);
            closeSheet();
          }}
          onCancel={() => {
            discardJob(openJob.id);
            closeSheet();
          }}
          fallbackAction={undefined}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // The tappable "body" of the pill — everything except the dismiss "✕",
  // which is a separate Pressable so the two never fight over the same
  // touch (see the file header on why dismissal must be its own control).
  pillMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pillPressed: {
    opacity: 0.85,
  },
  pillText: {
    ...type.body,
    ...numeric,
    color: colors.text,
    flexShrink: 1,
  },
  // Universal dismiss control (file header) — quiet by default (textTertiary,
  // no fill) so it doesn't compete with the pill's own label, but always a
  // real minTouchTarget-sized button, never a gesture.
  dismissButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  dismissButtonPressed: {
    opacity: 0.6,
  },
  dismissText: {
    ...type.body,
    color: colors.textTertiary,
  },
});
