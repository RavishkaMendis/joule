import { createJob, markDone, markError, toRetrying } from '../jobReducer';
import { describeFailedJobPrompt, jobTapAction } from '../jobPrompt';
import type { CaptureJobInput } from '../types';

const MEAL_PHOTO_INPUT: CaptureJobInput = { kind: 'meal_photo', photoUri: 'file:///photo.jpg', photoBase64: 'AAAA' };

describe('jobTapAction', () => {
  // The bug this whole file exists to fix: a tap on a failed job used to
  // call retryJob directly, with no dismiss path — a job whose retry was
  // guaranteed to fail (source file gone) would auto-retry forever. The
  // fix makes "a tap never itself retries" a fact about this function's
  // return TYPE, not a habit the component has to remember: 'kind' can
  // only ever be 'open_confirm' | 'prompt_failed' | 'none' — there is no
  // retry action a tap can produce at all.
  it('never resolves a tap on any job to a direct retry', () => {
    const processing = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    const done = markDone(processing, [], 1500);
    const errored = markError(processing, 'boom', 1500);

    for (const job of [processing, done, errored]) {
      const action = jobTapAction(job);
      expect(action.kind).not.toBe('retry');
    }
  });

  it('opens the confirm sheet for a done job', () => {
    const job = markDone(createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000), [], 1500);
    expect(jobTapAction(job)).toEqual({ kind: 'open_confirm' });
  });

  it('prompts (Try again / Discard) for an error job, rather than retrying', () => {
    const job = markError(createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000), 'boom', 1500);
    expect(jobTapAction(job)).toEqual({ kind: 'prompt_failed' });
  });

  it('does nothing for a still-processing job', () => {
    const job = createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000);
    expect(jobTapAction(job)).toEqual({ kind: 'none' });
  });
});

describe('describeFailedJobPrompt', () => {
  it('offers a retry and surfaces the real error message when the source file still exists', () => {
    const job = markError(createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000), "Couldn't reach Gemini (HTTP 500)", 1500);
    const prompt = describeFailedJobPrompt(job, true);

    expect(prompt.canRetry).toBe(true);
    expect(prompt.title).toBe('Photo failed');
    expect(prompt.message).toContain("Couldn't reach Gemini (HTTP 500)");
    expect(prompt.message).not.toMatch(/no longer on this device/i);
  });

  // The specific bug from the task brief: a two-day-old capture whose
  // camera cache file the OS has already reclaimed must NOT be offered a
  // retry that is guaranteed to fail.
  it('refuses to offer a retry and says so plainly when the source file is gone', () => {
    const job = markError(createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000), 'Interrupted — the app closed before this finished analysing. Tap to retry.', 1500);
    const prompt = describeFailedJobPrompt(job, false);

    expect(prompt.canRetry).toBe(false);
    expect(prompt.message).toMatch(/no longer on this device/i);
    expect(prompt.message).toMatch(/can't be retried/i);
  });

  it('omits any attempt count on the first failure', () => {
    const job = markError(createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000), 'boom', 1500);
    const prompt = describeFailedJobPrompt(job, true);
    expect(prompt.message).not.toMatch(/attempt/i);
  });

  it('names the attempt number once a job has failed more than once', () => {
    const firstError = markError(createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000), 'boom', 1500);
    const retried = toRetrying(firstError, 2000);
    const secondError = markError(retried, 'boom again', 2500);

    const prompt = describeFailedJobPrompt(secondError, true);
    expect(prompt.message).toMatch(/^Attempt 2\./);
    expect(prompt.message).toContain('boom again');
  });

  it('falls back to a generic reason if somehow no error message was recorded', () => {
    const job = { ...markError(createJob('job_1', '2026-09-05', MEAL_PHOTO_INPUT, 1000), 'x', 1500), errorMessage: undefined };
    const prompt = describeFailedJobPrompt(job, true);
    expect(prompt.message).toMatch(/something went wrong/i);
  });
});
