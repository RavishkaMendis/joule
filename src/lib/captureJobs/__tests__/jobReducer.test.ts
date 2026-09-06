import {
  createJob,
  describeAiFailure,
  describeJob,
  markDone,
  markError,
  markInterrupted,
  toRetrying,
} from '../jobReducer';
import type { CaptureJobInput } from '../types';
import type { PendingEntry } from '../../pendingEntry';
import type { AiRunResult } from '../../ai/runs';

const MEAL_PHOTO_INPUT: CaptureJobInput = { kind: 'meal_photo', photoUri: 'file:///photo.jpg', photoBase64: 'AAAA' };
const LABEL_INPUT: CaptureJobInput = { kind: 'label_ocr', photoUri: 'file:///label.jpg', photoBase64: 'BBBB' };
const VOICE_INPUT: CaptureJobInput = { kind: 'voice', audioUri: 'file:///note.m4a', mimeType: 'audio/m4a' };

const ENTRIES: PendingEntry[] = [
  { name: 'Rice', grams: 150, kcal: 200, protein_g: 4, carbs_g: 44, fat_g: 0.5, confidence: 'medium', source: 'meal_photo' },
];

describe('createJob', () => {
  it('starts a fresh job in processing with matching created/updated timestamps', () => {
    const job = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    expect(job).toEqual({
      id: 'job_1',
      date: '2026-09-05',
      input: MEAL_PHOTO_INPUT,
      status: 'processing',
      createdAt: 1000,
      updatedAt: 1000,
    });
  });
});

describe('markDone', () => {
  it('attaches entries, clears any prior error, and bumps updatedAt', () => {
    const job = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    const errored = markError(job, 'network blip', 1500);
    const done = markDone(errored, ENTRIES, 2000);
    expect(done.status).toBe('done');
    expect(done.entries).toBe(ENTRIES);
    expect(done.errorMessage).toBeUndefined();
    expect(done.updatedAt).toBe(2000);
    // createdAt is never touched by any transition.
    expect(done.createdAt).toBe(1000);
  });
});

describe('markError', () => {
  it('records the message and clears any stale entries', () => {
    const job = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    const done = markDone(job, ENTRIES, 1500);
    const errored = markError(done, 'Gemini timed out', 2000);
    expect(errored.status).toBe('error');
    expect(errored.errorMessage).toBe('Gemini timed out');
    expect(errored.entries).toBeUndefined();
  });
});

describe('markInterrupted', () => {
  it('turns a job stuck in processing into a retryable error', () => {
    const job = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    const interrupted = markInterrupted(job, 5000);
    expect(interrupted.status).toBe('error');
    expect(interrupted.errorMessage).toMatch(/interrupted/i);
    expect(interrupted.errorMessage).toMatch(/retry/i);
  });

  it('is a no-op for a job that already settled — never overwrites a real result', () => {
    const job = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    const done = markDone(job, ENTRIES, 1500);
    expect(markInterrupted(done, 5000)).toBe(done);

    const errored = markError(job, 'network blip', 1500);
    expect(markInterrupted(errored, 5000)).toBe(errored);
  });
});

describe('toRetrying', () => {
  it('moves an error job back to processing and clears the message', () => {
    const job = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    const errored = markError(job, 'network blip', 1500);
    const retrying = toRetrying(errored, 2000);
    expect(retrying.status).toBe('processing');
    expect(retrying.errorMessage).toBeUndefined();
  });

  it('is a no-op from any status other than error', () => {
    const job = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    expect(toRetrying(job, 2000)).toBe(job);

    const done = markDone(job, ENTRIES, 1500);
    expect(toRetrying(done, 2000)).toBe(done);
  });
});

describe('describeJob', () => {
  it.each([
    ['meal_photo' as const, 'processing' as const, /photo/i],
    ['label_ocr' as const, 'processing' as const, /label scan/i],
    ['voice' as const, 'processing' as const, /voice log/i],
    ['meal_photo' as const, 'done' as const, /photo.*ready to confirm/i],
    ['label_ocr' as const, 'error' as const, /label scan.*failed/i],
  ])('describes a %s job in status %s', (kind, status, expected) => {
    const input: CaptureJobInput =
      kind === 'meal_photo' ? MEAL_PHOTO_INPUT : kind === 'label_ocr' ? LABEL_INPUT : VOICE_INPUT;
    let job = createJob('job_1', '2026-09-05', input, 1000);
    if (status === 'done') job = markDone(job, ENTRIES, 1500);
    if (status === 'error') job = markError(job, 'boom', 1500);
    expect(describeJob(job)).toMatch(expected);
  });
});

describe('describeAiFailure', () => {
  const failure = (reason: Extract<AiRunResult, { ok: false }>['reason'], detail?: string): Extract<AiRunResult, { ok: false }> => ({
    ok: false,
    reason,
    detail,
  });

  it('gives the missing-key message regardless of kind', () => {
    expect(describeAiFailure('meal_photo', failure('missing_key'))).toMatch(/api key/i);
  });

  it('gives a photo-specific no_items message for meal_photo', () => {
    expect(describeAiFailure('meal_photo', failure('no_items'))).toMatch(/identify any food/i);
  });

  it('gives a label-specific no_items message for label_ocr', () => {
    expect(describeAiFailure('label_ocr', failure('no_items'))).toMatch(/nutrition panel/i);
  });

  it('gives a voice-specific no_items message for voice', () => {
    expect(describeAiFailure('voice', failure('no_items'))).toMatch(/make out any food/i);
  });

  it('surfaces the real network detail rather than a generic message', () => {
    expect(describeAiFailure('label_ocr', failure('network', 'HTTP 503: overloaded'))).toContain('HTTP 503: overloaded');
  });

  it('gives the parse_failed message', () => {
    expect(describeAiFailure('voice', failure('parse_failed'))).toMatch(/couldn't be understood/i);
  });
});
