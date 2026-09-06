// ═══════════════════════════════════════════════════════════════════════
// CAPTURE JOB STORE — the module-level, navigation-surviving home for
// in-flight scans (task brief: "Track in-flight jobs in a store that
// survives navigation ... not screen state").
//
// This is a plain module-scoped singleton (a Map + a set of listener
// callbacks), not React state and not a Context provider — it exists
// exactly once per JS process, so a screen that submits a job and then
// unmounts (back to Today, a different capture, the app backgrounded)
// never takes the job's promise chain down with it. React components
// read it via `useSyncExternalStore` in useCaptureJob.ts.
//
// ─── Fast path vs. background path — ONE mechanism, no timeout guess ────
// Task brief: "Keep the synchronous path available when it's fast... Say
// how you decided." The decision here is to not special-case "which
// capture kinds are fast": every submission goes through this exact same
// store, and whether it FEELS synchronous is decided by nothing more than
// whether the originating screen is still mounted and watching when the
// job settles:
//   - Still there (the common case — label scans finish in a few
//     seconds, well within how long someone naturally stares at a
//     progress spinner): the screen's own `useCaptureJob` subscription
//     sees the transition to `done`/`error` immediately and renders
//     ConfirmSheet/the error screen exactly as it always did. No
//     notification fires (see `watchJob` below) — a fast scan is exactly
//     as fast as before this queue existed, because nothing here adds a
//     delay, a poll, or a mandatory round trip.
//   - Gone (explicit "leave in background", back button leaving the
//     screen, or the app backgrounded/killed): nobody's watching, so the
//     result is surfaced globally instead — a local notification plus the
//     Today indicator pill, both reading this same store.
// This needed no timeout heuristic because "is anyone watching" is a
// fact the store can just check, not a guess it has to make.
//
// ─── Surviving an app kill mid-flight ────────────────────────────────────
// Every transition (submit / done / error / retry) is written through to
// SQLite (persistence.ts) before this module considers it settled in
// memory. `initCaptureJobsRuntime` replays that table at startup: any job
// still `processing` at that point belonged to a process that no longer
// exists (nothing killed it gracefully — see jobReducer.ts's
// `markInterrupted`), so it is flipped to a plain retryable error rather
// than left stuck forever or silently dropped.
// ═══════════════════════════════════════════════════════════════════════

import { AppState } from 'react-native';
import type { Database } from '../../db/database';
import { createJob, describeAiFailure, markDone, markError, markInterrupted, toRetrying } from './jobReducer';
import { addCaptureJobResponseListener, getColdStartCaptureJobId, notifyJobSettled } from './notify';
import { deleteJob, listJobs, upsertJob } from './persistence';
import { executeCaptureJob } from './runner';
import type { CaptureJob, CaptureJobInput } from './types';

type Listener = () => void;

const jobs = new Map<string, CaptureJob>();
const listeners = new Set<Listener>();
/** Jobs whose originating screen is currently mounted and rendering their live status — see the file header's "fast path vs. background path". */
const watchedJobIds = new Set<string>();

let cachedSnapshot: CaptureJob[] | null = null;
let hydratePromise: Promise<void> | null = null;
let responseListenerSubscription: { remove: () => void } | null = null;

function invalidateSnapshot(): void {
  cachedSnapshot = null;
}

function emit(): void {
  invalidateSnapshot();
  for (const listener of listeners) listener();
}

function generateJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Subscribes to any change in the job list or any individual job's fields. Used by React via `useSyncExternalStore` (see useCaptureJob.ts) — not intended to be called directly by screens. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** All known jobs (in-memory + hydrated-from-disk), oldest first. Referentially stable between calls when nothing has changed, as `useSyncExternalStore` requires. */
export function getSnapshot(): CaptureJob[] {
  if (!cachedSnapshot) {
    cachedSnapshot = Array.from(jobs.values()).sort((a, b) => a.createdAt - b.createdAt);
  }
  return cachedSnapshot;
}

export function getJob(id: string): CaptureJob | undefined {
  return jobs.get(id);
}

/**
 * Marks a job as actively watched by a live screen — call on mount,
 * call the returned function on unmount (a React `useEffect` cleanup
 * fits this exactly; see useCaptureJob.ts). While watched AND the app is
 * foregrounded, a settling job skips the background notification, since
 * the screen itself is about to show the result. Leaving the app
 * entirely (AppState no longer 'active') always notifies regardless —
 * task brief: "close the app" must still surface the result.
 */
export function watchJob(id: string): () => void {
  watchedJobIds.add(id);
  return () => watchedJobIds.delete(id);
}

function isActivelyWatched(id: string): boolean {
  return watchedJobIds.has(id) && AppState.currentState === 'active';
}

/**
 * Submits a new job and returns it immediately (`status: 'processing'`) —
 * the caller never awaits the actual analysis. Persisting the initial row
 * happens fire-and-forget too; the in-memory job is already visible to
 * every subscriber (including the Today indicator) the instant this
 * returns, which is what lets a screen call this and navigate away in
 * the same gesture.
 */
export function submitJob(db: Database, date: string, input: CaptureJobInput): CaptureJob {
  const now = Date.now();
  const job = createJob(generateJobId(), date, input, now);
  jobs.set(job.id, job);
  emit();
  void upsertJob(db, job);
  void runJob(db, job.id);
  return job;
}

async function runJob(db: Database, id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;

  const result = await executeCaptureJob(job.input).catch((err: unknown) => ({
    ok: false as const,
    reason: 'network' as const,
    detail: err instanceof Error ? err.message : String(err),
  }));

  await settleJob(db, id, result.ok ? { ok: true, entries: result.entries } : { ok: false, message: describeAiFailure(job.input.kind, result) });
}

async function settleJob(db: Database, id: string, outcome: { ok: true; entries: CaptureJob['entries'] } | { ok: false; message: string }): Promise<void> {
  const job = jobs.get(id);
  if (!job) return; // dismissed while the call was in flight — nothing left to settle.

  const now = Date.now();
  const settled = outcome.ok ? markDone(job, outcome.entries ?? [], now) : markError(job, outcome.message, now);
  jobs.set(id, settled);
  await upsertJob(db, settled);
  emit();

  if (!isActivelyWatched(id)) {
    void notifyJobSettled(settled);
  }
}

/** Re-runs a job that ended in `error`, re-reading its bytes from disk when they aren't already in memory (see runner.ts). No-op for a job not currently in `error`. */
export function retryJob(db: Database, id: string): void {
  const job = jobs.get(id);
  if (!job || job.status !== 'error') return;
  const retrying = toRetrying(job, Date.now());
  jobs.set(id, retrying);
  emit();
  void upsertJob(db, retrying);
  void runJob(db, id);
}

/**
 * Drops a job entirely — called once its entries have been confirmed
 * (written to `food_entry` by ConfirmSheet) or explicitly discarded by
 * the user. There is nothing left for this job to await after either
 * outcome, so it is removed from memory and disk rather than lingering.
 */
export function dismissJob(db: Database, id: string): void {
  jobs.delete(id);
  watchedJobIds.delete(id);
  emit();
  void deleteJob(db, id);
}

async function hydrate(db: Database): Promise<void> {
  const persisted = await listJobs(db);
  const now = Date.now();
  for (const job of persisted) {
    const settled = markInterrupted(job, now);
    jobs.set(settled.id, settled);
    if (settled !== job) {
      void upsertJob(db, settled);
    }
  }
  emit();
}

/**
 * Call once from wherever mounts first (the Today indicator — see
 * CaptureJobsIndicator.tsx): loads any jobs left over from a previous
 * session (flipping stale `processing` rows to a retryable error) and
 * registers the notification-tap listener for the rest of this process's
 * lifetime. Safe to call more than once — hydration only runs once per
 * process, and each call's listener is independently cleaned up by the
 * function it returns.
 *
 * `onOpenJob` is invoked with a job id whenever the user taps a capture-
 * job notification, both for a live tap (app already running) and for a
 * cold start caused by tapping one (checked once, here, since app launch
 * already happened before any listener could have caught it).
 */
export function initCaptureJobsRuntime(db: Database, onOpenJob: (jobId: string) => void): () => void {
  if (!hydratePromise) {
    hydratePromise = hydrate(db);
  }

  const coldStartId = getColdStartCaptureJobId();
  if (coldStartId) {
    void hydratePromise.then(() => onOpenJob(coldStartId));
  }

  const subscription = addCaptureJobResponseListener(onOpenJob);
  responseListenerSubscription = subscription;
  return () => {
    subscription.remove();
    if (responseListenerSubscription === subscription) {
      responseListenerSubscription = null;
    }
  };
}

/** Test-only: drop all in-memory state so each test starts from an empty store. */
export function resetCaptureJobsStoreForTesting(): void {
  jobs.clear();
  listeners.clear();
  watchedJobIds.clear();
  cachedSnapshot = null;
  hydratePromise = null;
  responseListenerSubscription?.remove();
  responseListenerSubscription = null;
}
