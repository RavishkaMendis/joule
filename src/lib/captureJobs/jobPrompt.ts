// ═══════════════════════════════════════════════════════════════════════
// FAILED-JOB PROMPT — pure decision logic for what tapping a capture-job
// pill (or its OS notification) should do, and what to say once a job has
// failed.
//
// The bug this file exists to fix: CaptureJobsIndicator used to treat a
// tap on an `error` job as "retry immediately" — there was no dismiss
// path at all, so a job that could never succeed again (see runner.ts's
// captureJobSourceExists — a camera cache file a couple of days old is
// usually already reclaimed by the OS) would auto-retry, fail, and sit
// there forever, looking retriable but never actually being retriable.
//
// `jobTapAction`'s return type makes "a tap never itself retries" a
// structural fact rather than a convention the component has to
// remember — retrying isn't a value this function can produce at all.
// The actual retry only ever happens from the user's explicit "Try
// again" tap on the prompt this file also builds the copy for.
//
// Same split as jobReducer.ts/store.ts: this file is pure and
// I/O-free (no SQLite, no expo-file-system, no Alert) so it's testable
// without any of that; CaptureJobsIndicator.tsx is the only caller and
// stays a thin dispatch over these two functions plus the actual
// `Alert.alert`/`retryJob`/`dismissJob` calls.
// ═══════════════════════════════════════════════════════════════════════

import { captureJobKindLabel } from './jobReducer';
import type { CaptureJob } from './types';

export type JobTapAction =
  | { kind: 'open_confirm' } // status === 'done' — open the shared ConfirmSheet, exactly as today.
  | { kind: 'prompt_failed' } // status === 'error' — show the Try again / Discard choice. NEVER retries directly.
  | { kind: 'none' }; // status === 'processing' — nothing to do yet.

/** What tapping a job's pill, or its OS notification, should do. */
export function jobTapAction(job: CaptureJob): JobTapAction {
  switch (job.status) {
    case 'done':
      return { kind: 'open_confirm' };
    case 'error':
      return { kind: 'prompt_failed' };
    case 'processing':
      return { kind: 'none' };
  }
}

export type FailedJobPrompt = {
  title: string;
  message: string;
  /** Whether "Try again" should even be offered. False once the source file is confirmed gone — see runner.ts's `captureJobSourceExists`. */
  canRetry: boolean;
};

/**
 * Builds the title/message for the Try again / Discard choice on a
 * failed job. `sourceExists` is the caller's own
 * `captureJobSourceExists(job.input)` read — kept as a parameter rather
 * than called from in here so this function stays synchronous and pure,
 * with no `expo-file-system` import of its own (mirrors why jobReducer.ts
 * never imports SQLite or expo-notifications).
 */
export function describeFailedJobPrompt(job: CaptureJob, sourceExists: boolean): FailedJobPrompt {
  const kindLabel = captureJobKindLabel(job.input.kind);
  const attemptNote = job.attempts > 1 ? `Attempt ${job.attempts}. ` : '';
  const reason = job.errorMessage ?? 'Something went wrong.';
  const unretryableNote = sourceExists
    ? ''
    : `\n\nThe photo is no longer on this device, so this can't be retried.`;

  return {
    title: `${kindLabel} failed`,
    message: `${attemptNote}${reason}${unretryableNote}`,
    canRetry: sourceExists,
  };
}
