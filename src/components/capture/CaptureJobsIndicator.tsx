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
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../../lib/theme';
import { getDatabase } from '../../lib/db';
import { ConfirmSheet } from '../ConfirmSheet';
import {
  describeJob,
  dismissJob,
  getJob,
  initCaptureJobsRuntime,
  retryJob,
  useCaptureJobsList,
  type CaptureJob,
} from '../../lib/captureJobs';

export function CaptureJobsIndicator() {
  const jobs = useCaptureJobsList();
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  // Shared by both a tap on the in-app pill and a tap on the OS
  // notification (the task brief's "tapping either opens the ConfirmSheet
  // for that job") — a `done` job opens the sheet, an `error` job retries
  // immediately, matching what tapping an errored pill already does.
  // Reads straight from the store (not the `jobs` list closed over by
  // `initCaptureJobsRuntime`'s one-time effect below) so a notification
  // tap always sees the job's current status, not whatever it was when
  // this component last rendered.
  const openOrRetryJob = useCallback((jobId: string) => {
    const job = getJob(jobId);
    if (!job) return;
    if (job.status === 'done') {
      setOpenJobId(job.id);
    } else if (job.status === 'error') {
      void (async () => {
        const db = await getDatabase();
        retryJob(db, job.id);
      })();
    }
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      const db = await getDatabase();
      unsubscribe = initCaptureJobsRuntime(db, openOrRetryJob);
    })();
    return () => unsubscribe?.();
  }, [openOrRetryJob]);

  const openJob = jobs.find((j) => j.id === openJobId && j.status === 'done');

  const handlePress = (job: CaptureJob) => openOrRetryJob(job.id);

  const closeSheet = () => setOpenJobId(null);

  return (
    <>
      {jobs.length > 0 && (
        <View style={styles.stack}>
          {jobs.map((job) => (
            <Pressable
              key={job.id}
              onPress={() => handlePress(job)}
              disabled={job.status === 'processing'}
              style={({ pressed }) => [styles.pill, pressed && job.status !== 'processing' && styles.pillPressed]}
              accessibilityRole={job.status === 'processing' ? undefined : 'button'}
            >
              {job.status === 'processing' && <ActivityIndicator size="small" color={colors.textSecondary} />}
              <Text style={styles.pillText}>{describeJob(job)}</Text>
            </Pressable>
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
            void (async () => {
              const db = await getDatabase();
              dismissJob(db, openJob.id);
            })();
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
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
});
