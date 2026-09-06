// ═══════════════════════════════════════════════════════════════════════
// store.ts is the orchestrator: it wires the pure reducer (jobReducer.ts,
// tested on its own) to persistence (real in-memory SQLite here, via
// testDb.ts — the same "genuine engine, not a hand-rolled fake" harness
// every other repo test in this codebase uses) and mocks out the two
// I/O edges this task doesn't own the internals of: the actual Gemini
// call (runner.ts) and native notifications (notify.ts).
// ═══════════════════════════════════════════════════════════════════════

import { AppState } from 'react-native';
import { createTestDatabase } from '../../../db/__tests__/testDb';
import type { Database } from '../../../db/database';

const mockExecuteCaptureJob = jest.fn();
const mockNotifyJobSettled = jest.fn();
const mockAddCaptureJobResponseListener = jest.fn();
const mockGetColdStartCaptureJobId = jest.fn();

jest.mock('../runner', () => ({
  executeCaptureJob: (...args: unknown[]) => mockExecuteCaptureJob(...args),
}));

jest.mock('../notify', () => ({
  notifyJobSettled: (...args: unknown[]) => mockNotifyJobSettled(...args),
  addCaptureJobResponseListener: (...args: unknown[]) => mockAddCaptureJobResponseListener(...args),
  getColdStartCaptureJobId: (...args: unknown[]) => mockGetColdStartCaptureJobId(...args),
}));

import { dismissJob, getJob, getSnapshot, initCaptureJobsRuntime, resetCaptureJobsStoreForTesting, retryJob, submitJob, subscribe, watchJob } from '../store';
import { listJobs, resetCaptureJobsPersistenceForTesting } from '../persistence';
import type { CaptureJobInput } from '../types';

const MEAL_PHOTO_INPUT: CaptureJobInput = { kind: 'meal_photo', photoUri: 'file:///photo.jpg', photoBase64: 'AAAA' };

/** Flushes the microtask queue enough times for a submitJob's fire-and-forget chain (persist + execute + settle + persist again) to fully resolve. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

let db: Database;

beforeEach(() => {
  jest.clearAllMocks();
  resetCaptureJobsStoreForTesting();
  resetCaptureJobsPersistenceForTesting();
  db = createTestDatabase();
  mockAddCaptureJobResponseListener.mockReturnValue({ remove: jest.fn() });
  mockGetColdStartCaptureJobId.mockReturnValue(null);
  AppState.currentState = 'active';
});

describe('submitJob', () => {
  it('returns the new job synchronously in `processing`, before the AI call resolves', () => {
    mockExecuteCaptureJob.mockReturnValue(new Promise(() => {})); // never resolves within this test
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    expect(job.status).toBe('processing');
    expect(job.date).toBe('2026-09-05');
    expect(getJob(job.id)).toEqual(job);
  });

  it('persists the initial row without the caller having to await anything', async () => {
    mockExecuteCaptureJob.mockReturnValue(new Promise(() => {}));
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    await flush();
    const rows = await listJobs(db);
    expect(rows.map((r) => r.id)).toContain(job.id);
  });

  it('transitions to done in the store and on disk once the AI call resolves', async () => {
    mockExecuteCaptureJob.mockResolvedValue({ ok: true, entries: [{ name: 'Rice', grams: 100, kcal: 130, protein_g: 3, carbs_g: 28, fat_g: 0, confidence: 'high', source: 'label_ocr' }], rejectedCount: 0 });
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    await flush();

    expect(getJob(job.id)?.status).toBe('done');
    expect(getJob(job.id)?.entries).toHaveLength(1);
    const [row] = await listJobs(db);
    expect(row.status).toBe('done');
  });

  it('transitions to error with the real failure reason, never a generic message', async () => {
    mockExecuteCaptureJob.mockResolvedValue({ ok: false, reason: 'network', detail: 'HTTP 500' });
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    await flush();

    expect(getJob(job.id)?.status).toBe('error');
    expect(getJob(job.id)?.errorMessage).toContain('HTTP 500');
  });

  it('never writes food_entry-shaped state itself — settling only ever produces PendingEntry[] on the job, nothing is auto-saved', async () => {
    const entries = [{ name: 'Rice', grams: 100, kcal: 130, protein_g: 3, carbs_g: 28, fat_g: 0, confidence: 'high' as const, source: 'label_ocr' as const }];
    mockExecuteCaptureJob.mockResolvedValue({ ok: true, entries, rejectedCount: 0 });
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    await flush();

    // The only DB table this whole module touches is its own app_capture_jobs.
    const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.map((t) => t.name)).toEqual(['app_capture_jobs']);
    expect(getJob(job.id)?.entries).toEqual(entries);
  });

  it('supports multiple concurrent jobs independently', async () => {
    mockExecuteCaptureJob
      .mockResolvedValueOnce({ ok: true, entries: [], rejectedCount: 0 })
      .mockResolvedValueOnce({ ok: false, reason: 'network', detail: 'timeout' });

    const jobA = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    const jobB = submitJob(db, '2026-09-05', { kind: 'label_ocr', photoUri: 'file:///label.jpg', photoBase64: 'BBBB' });
    await flush();

    expect(getJob(jobA.id)?.status).toBe('done');
    expect(getJob(jobB.id)?.status).toBe('error');
    expect(getSnapshot().map((j) => j.id).sort()).toEqual([jobA.id, jobB.id].sort());
  });

  it('notifies listeners on every transition', () => {
    mockExecuteCaptureJob.mockReturnValue(new Promise(() => {}));
    const listener = jest.fn();
    subscribe(listener);
    submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    expect(listener).toHaveBeenCalled();
  });
});

describe('watchJob / notification suppression', () => {
  it('does NOT notify when the job settles while its screen is actively watching it (the fast path)', async () => {
    mockExecuteCaptureJob.mockResolvedValue({ ok: true, entries: [], rejectedCount: 0 });
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    const unwatch = watchJob(job.id);
    await flush();

    expect(mockNotifyJobSettled).not.toHaveBeenCalled();
    unwatch();
  });

  it('DOES notify when nobody is watching (the screen was left)', async () => {
    mockExecuteCaptureJob.mockResolvedValue({ ok: true, entries: [], rejectedCount: 0 });
    submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    await flush();

    expect(mockNotifyJobSettled).toHaveBeenCalledTimes(1);
  });

  it('DOES notify even while "watched" once the app itself is no longer foregrounded (closing the app must still surface the result)', async () => {
    mockExecuteCaptureJob.mockResolvedValue({ ok: true, entries: [], rejectedCount: 0 });
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    watchJob(job.id);
    AppState.currentState = 'background';
    await flush();

    expect(mockNotifyJobSettled).toHaveBeenCalledTimes(1);
  });

  it('stops suppressing once unwatched (screen navigated away before settling)', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockExecuteCaptureJob.mockReturnValue(new Promise((r) => (resolve = r)));
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    const unwatch = watchJob(job.id);
    unwatch();
    resolve({ ok: true, entries: [], rejectedCount: 0 });
    await flush();

    expect(mockNotifyJobSettled).toHaveBeenCalledTimes(1);
  });
});

describe('dismissJob', () => {
  it('removes the job from memory and disk', async () => {
    mockExecuteCaptureJob.mockResolvedValue({ ok: true, entries: [], rejectedCount: 0 });
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    await flush();

    dismissJob(db, job.id);
    await flush();

    expect(getJob(job.id)).toBeUndefined();
    expect(await listJobs(db)).toEqual([]);
  });

  it('a job dismissed while still in flight is simply dropped when the call later resolves', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockExecuteCaptureJob.mockReturnValue(new Promise((r) => (resolve = r)));
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    await flush();

    dismissJob(db, job.id);
    resolve({ ok: true, entries: [], rejectedCount: 0 });
    await flush();

    expect(getJob(job.id)).toBeUndefined();
    expect(mockNotifyJobSettled).not.toHaveBeenCalled();
  });
});

describe('retryJob', () => {
  it('re-runs an errored job and can succeed the second time', async () => {
    mockExecuteCaptureJob.mockResolvedValueOnce({ ok: false, reason: 'network', detail: 'timeout' });
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    await flush();
    expect(getJob(job.id)?.status).toBe('error');

    mockExecuteCaptureJob.mockResolvedValueOnce({ ok: true, entries: [], rejectedCount: 0 });
    retryJob(db, job.id);
    expect(getJob(job.id)?.status).toBe('processing');
    await flush();
    expect(getJob(job.id)?.status).toBe('done');
  });

  it('is a no-op for a job not currently in error', async () => {
    mockExecuteCaptureJob.mockReturnValue(new Promise(() => {}));
    const job = submitJob(db, '2026-09-05', MEAL_PHOTO_INPUT);
    retryJob(db, job.id); // still processing
    expect(getJob(job.id)?.status).toBe('processing');
    expect(mockExecuteCaptureJob).toHaveBeenCalledTimes(1);
  });
});

describe('initCaptureJobsRuntime — surviving an app kill mid-flight', () => {
  it('flips a job left "processing" by a previous session into a retryable error, on disk and in memory', async () => {
    // Simulate a previous process dying mid-job: a row sits in `processing`
    // with nothing in memory (this is a FRESH store, nothing submitted yet).
    const { upsertJob } = jest.requireActual('../persistence');
    await upsertJob(db, {
      id: 'stale_job',
      date: '2026-09-04',
      input: MEAL_PHOTO_INPUT,
      status: 'processing',
      createdAt: 1,
      updatedAt: 1,
    });

    const unsubscribe = initCaptureJobsRuntime(db, jest.fn());
    await flush();

    expect(getJob('stale_job')?.status).toBe('error');
    expect(getJob('stale_job')?.errorMessage).toMatch(/retry/i);
    const [row] = await listJobs(db);
    expect(row.status).toBe('error');
    unsubscribe();
  });

  it('leaves an already-settled job untouched on rehydrate', async () => {
    const { upsertJob } = jest.requireActual('../persistence');
    await upsertJob(db, {
      id: 'done_job',
      date: '2026-09-04',
      input: MEAL_PHOTO_INPUT,
      status: 'done',
      entries: [],
      createdAt: 1,
      updatedAt: 1,
    });

    const unsubscribe = initCaptureJobsRuntime(db, jest.fn());
    await flush();

    expect(getJob('done_job')?.status).toBe('done');
    unsubscribe();
  });

  it('opens the job a cold-started notification tap named, once hydration has run', async () => {
    const { upsertJob } = jest.requireActual('../persistence');
    await upsertJob(db, {
      id: 'tapped_job',
      date: '2026-09-04',
      input: MEAL_PHOTO_INPUT,
      status: 'done',
      entries: [],
      createdAt: 1,
      updatedAt: 1,
    });
    mockGetColdStartCaptureJobId.mockReturnValue('tapped_job');

    const onOpenJob = jest.fn();
    const unsubscribe = initCaptureJobsRuntime(db, onOpenJob);
    await flush();

    expect(onOpenJob).toHaveBeenCalledWith('tapped_job');
    unsubscribe();
  });

  it('registers a live tap listener that opens jobs for the rest of the session', () => {
    let capturedHandler: (jobId: string) => void = () => {};
    mockAddCaptureJobResponseListener.mockImplementation((handler: (jobId: string) => void) => {
      capturedHandler = handler;
      return { remove: jest.fn() };
    });

    const onOpenJob = jest.fn();
    initCaptureJobsRuntime(db, onOpenJob);
    capturedHandler('some_job');
    expect(onOpenJob).toHaveBeenCalledWith('some_job');
  });
});
