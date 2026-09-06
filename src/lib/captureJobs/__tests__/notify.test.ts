// ═══════════════════════════════════════════════════════════════════════
// notify.ts is the one file in this module that touches
// `expo-notifications` directly — mocked wholesale here, same convention
// as src/lib/notifications/__tests__/scheduler.test.ts. No real
// notification is ever scheduled by this test.
// ═══════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';

const mockSetNotificationChannelAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();
const mockAddNotificationResponseReceivedListener = jest.fn();
const mockGetLastNotificationResponse = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddNotificationResponseReceivedListener(...args),
  getLastNotificationResponse: (...args: unknown[]) => mockGetLastNotificationResponse(...args),
  AndroidImportance: { DEFAULT: 3 },
}));

import { addCaptureJobResponseListener, getColdStartCaptureJobId, notifyJobSettled } from '../notify';
import { createJob, markDone, markError } from '../jobReducer';
import type { CaptureJobInput } from '../types';

const INPUT: CaptureJobInput = { kind: 'meal_photo', photoUri: 'file:///photo.jpg' };

beforeEach(() => {
  jest.clearAllMocks();
  mockScheduleNotificationAsync.mockResolvedValue('notif-id');
});

describe('notifyJobSettled', () => {
  it('never fires for a job still processing', async () => {
    const job = createJob('job_1', '2026-09-05', INPUT, 1000);
    await notifyJobSettled(job);
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('fires an immediate notification tagged with the job id when done', async () => {
    const job = markDone(createJob('job_1', '2026-09-05', INPUT, 1000), [], 2000);
    await notifyJobSettled(job);

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const call = mockScheduleNotificationAsync.mock.calls[0][0];
    expect(call.content.data).toEqual({ type: 'capture_job', jobId: 'job_1' });
    expect(call.content.title).toMatch(/ready/i);
    expect(call.trigger).toEqual({ channelId: 'capture-jobs' });
  });

  it('fires for an error job with distinct copy from a done job', async () => {
    const job = markError(createJob('job_1', '2026-09-05', INPUT, 1000), 'network blip', 2000);
    await notifyJobSettled(job);

    const call = mockScheduleNotificationAsync.mock.calls[0][0];
    expect(call.content.title).not.toMatch(/ready/i);
    expect(call.content.body).toMatch(/failed|retry/i);
  });

  it('ensures the Android channel only on Android', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android';
    const job = markDone(createJob('job_1', '2026-09-05', INPUT, 1000), [], 2000);
    await notifyJobSettled(job);
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith('capture-jobs', expect.any(Object));
    Platform.OS = originalOS;
  });

  it('never throws even if the underlying call rejects (best-effort)', async () => {
    mockScheduleNotificationAsync.mockRejectedValue(new Error('permission denied'));
    const job = markDone(createJob('job_1', '2026-09-05', INPUT, 1000), [], 2000);
    await expect(notifyJobSettled(job)).resolves.toBeUndefined();
  });
});

describe('addCaptureJobResponseListener', () => {
  it('invokes the callback only for capture_job-tagged notifications', () => {
    let capturedHandler: (response: unknown) => void = () => {};
    mockAddNotificationResponseReceivedListener.mockImplementation((handler: (response: unknown) => void) => {
      capturedHandler = handler;
      return { remove: jest.fn() };
    });

    const onTapped = jest.fn();
    addCaptureJobResponseListener(onTapped);

    capturedHandler({ notification: { request: { content: { data: { type: 'capture_job', jobId: 'job_42' } } } } });
    expect(onTapped).toHaveBeenCalledWith('job_42');

    onTapped.mockClear();
    capturedHandler({ notification: { request: { content: { data: { type: 'some_other_type', jobId: 'job_99' } } } } });
    expect(onTapped).not.toHaveBeenCalled();
  });
});

describe('getColdStartCaptureJobId', () => {
  it('returns the job id when the app was launched by tapping a capture-job notification', () => {
    mockGetLastNotificationResponse.mockReturnValue({
      notification: { request: { content: { data: { type: 'capture_job', jobId: 'job_7' } } } },
    });
    expect(getColdStartCaptureJobId()).toBe('job_7');
  });

  it('returns null when there was no launching notification', () => {
    mockGetLastNotificationResponse.mockReturnValue(null);
    expect(getColdStartCaptureJobId()).toBeNull();
  });

  it('returns null for an unrelated notification type', () => {
    mockGetLastNotificationResponse.mockReturnValue({
      notification: { request: { content: { data: { type: 'weigh_in_reminder' } } } },
    });
    expect(getColdStartCaptureJobId()).toBeNull();
  });
});
