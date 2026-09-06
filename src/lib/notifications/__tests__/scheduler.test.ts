// ═══════════════════════════════════════════════════════════════════════
// scheduler.ts is the one file that touches `expo-notifications` directly,
// so it's the one file that mocks it wholesale — no real notification is
// ever scheduled by this test. Mirrors the mocking pattern already used
// for other native/network modules in this codebase (e.g.
// src/lib/foodSources/__tests__/searchCascade.test.ts mocking
// '../openFoodFacts').
// ═══════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';

const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();
const mockSetNotificationHandler = jest.fn();
const mockAddNotificationResponseReceivedListener = jest.fn();
const mockGetLastNotificationResponse = jest.fn();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  setNotificationChannelAsync: (...args: unknown[]) => mockSetNotificationChannelAsync(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) => mockCancelScheduledNotificationAsync(...args),
  setNotificationHandler: (...args: unknown[]) => mockSetNotificationHandler(...args),
  addNotificationResponseReceivedListener: (...args: unknown[]) => mockAddNotificationResponseReceivedListener(...args),
  getLastNotificationResponse: (...args: unknown[]) => mockGetLastNotificationResponse(...args),
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
}));

import * as scheduler from '../scheduler';
import { WEIGH_IN_NOTIFICATION_DATA } from '../weighInReminder';

describe('permission state mapping', () => {
  beforeEach(() => jest.clearAllMocks());

  test('granted maps to granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    expect(await scheduler.getPermissionState()).toBe('granted');
  });

  test('denied maps to denied', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' });
    expect(await scheduler.getPermissionState()).toBe('denied');
  });

  test('undetermined maps to undetermined', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false, status: 'undetermined' });
    expect(await scheduler.getPermissionState()).toBe('undetermined');
  });

  test('iOS provisional counts as granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ granted: false, status: 'undetermined', ios: { status: 3 } });
    expect(await scheduler.getPermissionState()).toBe('granted');
  });

  test('requestPermission proxies to requestPermissionsAsync and maps the result', async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    expect(await scheduler.requestPermission()).toBe('granted');
    expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleDailyReminder', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
    jest.clearAllMocks();
  });

  test('cancels the previous identifier, ensures an Android channel, and schedules a DAILY trigger tagged with the reminder data', async () => {
    Platform.OS = 'android';
    mockScheduleNotificationAsync.mockResolvedValue('new-id');

    const id = await scheduler.scheduleDailyReminder(7, 0, 'old-id');

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('old-id');
    expect(mockSetNotificationChannelAsync).toHaveBeenCalledWith('weigh-in-reminder', expect.objectContaining({ importance: 3 }));
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ data: WEIGH_IN_NOTIFICATION_DATA }),
        trigger: expect.objectContaining({ type: 'daily', hour: 7, minute: 0 }),
      })
    );
    expect(id).toBe('new-id');
  });

  test('skips the Android channel call on iOS', async () => {
    Platform.OS = 'ios';
    mockScheduleNotificationAsync.mockResolvedValue('new-id');

    await scheduler.scheduleDailyReminder(7, 0, null);

    expect(mockSetNotificationChannelAsync).not.toHaveBeenCalled();
    // A null previous identifier must not attempt a cancel call.
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('cancelReminder', () => {
  beforeEach(() => jest.clearAllMocks());

  test('is a no-op for a null identifier', async () => {
    await scheduler.cancelReminder(null);
    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  test('swallows a native cancel failure (e.g. already-fired/unknown id) rather than throwing', async () => {
    mockCancelScheduledNotificationAsync.mockRejectedValue(new Error('not found'));
    await expect(scheduler.cancelReminder('gone')).resolves.toBeUndefined();
  });
});

describe('response listener / cold-start check', () => {
  beforeEach(() => jest.clearAllMocks());

  test('addWeighInResponseListener only invokes the callback for this reminder\'s own data tag', () => {
    let capturedHandler: ((response: unknown) => void) | undefined;
    mockAddNotificationResponseReceivedListener.mockImplementation((handler: (response: unknown) => void) => {
      capturedHandler = handler;
      return { remove: jest.fn() };
    });

    const onTap = jest.fn();
    scheduler.addWeighInResponseListener(onTap);

    capturedHandler?.({ notification: { request: { content: { data: WEIGH_IN_NOTIFICATION_DATA } } } });
    expect(onTap).toHaveBeenCalledTimes(1);

    capturedHandler?.({ notification: { request: { content: { data: { type: 'something-else' } } } } });
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  test('wasLaunchedFromWeighInReminder reflects the last response only when it matches this reminder', () => {
    mockGetLastNotificationResponse.mockReturnValue(null);
    expect(scheduler.wasLaunchedFromWeighInReminder()).toBe(false);

    mockGetLastNotificationResponse.mockReturnValue({
      notification: { request: { content: { data: WEIGH_IN_NOTIFICATION_DATA } } },
    });
    expect(scheduler.wasLaunchedFromWeighInReminder()).toBe(true);

    mockGetLastNotificationResponse.mockReturnValue({
      notification: { request: { content: { data: { type: 'other' } } } },
    });
    expect(scheduler.wasLaunchedFromWeighInReminder()).toBe(false);
  });
});

describe('configureForegroundPresentation', () => {
  test('registers a handler that shows the reminder quietly (no sound/badge) while the app is open', async () => {
    scheduler.configureForegroundPresentation();
    expect(mockSetNotificationHandler).toHaveBeenCalledTimes(1);
    const handler = mockSetNotificationHandler.mock.calls[0][0];
    const behavior = await handler.handleNotification();
    expect(behavior).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});
