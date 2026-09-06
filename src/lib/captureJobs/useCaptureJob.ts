// ═══════════════════════════════════════════════════════════════════════
// REACT BINDINGS for the capture job store. Thin `useSyncExternalStore`
// wrappers only — all the actual logic lives in store.ts/jobReducer.ts,
// which is what makes that logic testable without React Native rendering
// (this repo's Jest config does not exercise that — see capturePhases.ts's
// header for the precedent this follows).
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useSyncExternalStore } from 'react';
import { getJob, getSnapshot, subscribe, watchJob } from './store';
import type { CaptureJob } from './types';

/** Live view of every known job (in-flight + settled-but-not-yet-dismissed), oldest first — what the Today indicator renders. */
export function useCaptureJobsList(): CaptureJob[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Live view of a single job, or `undefined` once it's been dismissed (or was never submitted). Pass `null` for "no job to watch" — the common case before a capture has been submitted yet. */
export function useCaptureJob(jobId: string | null): CaptureJob | undefined {
  return useSyncExternalStore(subscribe, () => (jobId ? getJob(jobId) : undefined));
}

/**
 * Marks `jobId` as watched for as long as the calling component stays
 * mounted — see store.ts's `watchJob` docs for exactly what this changes
 * (suppresses the background notification while the screen itself is
 * about to show the result). A no-op when `jobId` is null, so screens can
 * call this unconditionally with whatever job id they're currently
 * tracking (including none yet).
 */
export function useWatchCaptureJob(jobId: string | null): void {
  useEffect(() => {
    if (!jobId) return;
    return watchJob(jobId);
  }, [jobId]);
}
