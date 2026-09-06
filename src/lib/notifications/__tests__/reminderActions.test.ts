import { freshDb } from '../../../db/repositories/__tests__/testHelpers';
import type { Database } from '../../../db/database';
import { resetNotificationSettingsStoreForTesting, getNotificationPrefs, saveNotificationPrefs } from '../settingsStore';
import { todayLocalISO } from '../../localDate';

const mockGetPermissionState = jest.fn();
const mockRequestPermission = jest.fn();
const mockScheduleDailyReminder = jest.fn();
const mockCancelReminder = jest.fn();

jest.mock('../scheduler', () => ({
  getPermissionState: (...args: unknown[]) => mockGetPermissionState(...args),
  requestPermission: (...args: unknown[]) => mockRequestPermission(...args),
  scheduleDailyReminder: (...args: unknown[]) => mockScheduleDailyReminder(...args),
  cancelReminder: (...args: unknown[]) => mockCancelReminder(...args),
}));

import { getReminderState, enableReminder, disableReminder, updateReminderTime, reconcileAfterWeightLogged } from '../reminderActions';

describe('reminderActions orchestration (scheduler mocked — no real notification ever scheduled)', () => {
  let db: Database;

  beforeEach(async () => {
    resetNotificationSettingsStoreForTesting();
    db = await freshDb();
    jest.clearAllMocks();
  });

  test('getReminderState combines stored prefs with a live (never cached) permission check', async () => {
    mockGetPermissionState.mockResolvedValue('denied');
    const state = await getReminderState(db);
    expect(state.enabled).toBe(false);
    expect(state.permission).toBe('denied');
    expect(mockGetPermissionState).toHaveBeenCalledTimes(1);
  });

  describe('enableReminder', () => {
    test('requests permission, schedules, and persists enabled+identifier when granted', async () => {
      mockRequestPermission.mockResolvedValue('granted');
      mockScheduleDailyReminder.mockResolvedValue('id-1');

      const result = await enableReminder(db, 7, 30);

      expect(result.permission).toBe('granted');
      expect(mockScheduleDailyReminder).toHaveBeenCalledWith(7, 30, null);
      const prefs = await getNotificationPrefs(db);
      expect(prefs).toEqual({ enabled: true, hour: 7, minute: 30, scheduledIdentifier: 'id-1' });
    });

    test('does NOT enable or schedule when permission is denied — a toggle must never lie about OS state', async () => {
      mockRequestPermission.mockResolvedValue('denied');

      const result = await enableReminder(db, 7, 0);

      expect(result.permission).toBe('denied');
      expect(mockScheduleDailyReminder).not.toHaveBeenCalled();
      const prefs = await getNotificationPrefs(db);
      expect(prefs.enabled).toBe(false);
    });
  });

  describe('disableReminder', () => {
    test('cancels the scheduled notification and clears enabled+identifier', async () => {
      await saveNotificationPrefs(db, { enabled: true, hour: 7, minute: 0, scheduledIdentifier: 'existing-id' });

      await disableReminder(db);

      expect(mockCancelReminder).toHaveBeenCalledWith('existing-id');
      const prefs = await getNotificationPrefs(db);
      expect(prefs).toEqual({ enabled: false, hour: 7, minute: 0, scheduledIdentifier: null });
    });
  });

  describe('updateReminderTime', () => {
    test('reschedules immediately when currently enabled', async () => {
      await saveNotificationPrefs(db, { enabled: true, hour: 7, minute: 0, scheduledIdentifier: 'old-id' });
      mockScheduleDailyReminder.mockResolvedValue('new-id');

      await updateReminderTime(db, 8, 15);

      expect(mockScheduleDailyReminder).toHaveBeenCalledWith(8, 15, 'old-id');
      const prefs = await getNotificationPrefs(db);
      expect(prefs).toEqual({ enabled: true, hour: 8, minute: 15, scheduledIdentifier: 'new-id' });
    });

    test('just remembers the new time without touching the scheduler when disabled', async () => {
      await saveNotificationPrefs(db, { enabled: false, hour: 7, minute: 0, scheduledIdentifier: null });

      await updateReminderTime(db, 9, 0);

      expect(mockScheduleDailyReminder).not.toHaveBeenCalled();
      const prefs = await getNotificationPrefs(db);
      expect(prefs).toEqual({ enabled: false, hour: 9, minute: 0, scheduledIdentifier: null });
    });
  });

  describe('reconcileAfterWeightLogged (the "already weighed today" skip)', () => {
    test('cancels + reschedules the daily trigger when today\'s weight is logged and the reminder is enabled+permitted', async () => {
      await saveNotificationPrefs(db, { enabled: true, hour: 7, minute: 0, scheduledIdentifier: 'id-before' });
      mockGetPermissionState.mockResolvedValue('granted');
      mockScheduleDailyReminder.mockResolvedValue('id-after');

      await reconcileAfterWeightLogged(db, todayLocalISO());

      expect(mockScheduleDailyReminder).toHaveBeenCalledWith(7, 0, 'id-before');
      const prefs = await getNotificationPrefs(db);
      expect(prefs.scheduledIdentifier).toBe('id-after');
    });

    test('does nothing for a past-day edit — only TODAY\'s save may touch the reminder schedule', async () => {
      await saveNotificationPrefs(db, { enabled: true, hour: 7, minute: 0, scheduledIdentifier: 'id-before' });
      mockGetPermissionState.mockResolvedValue('granted');

      await reconcileAfterWeightLogged(db, '2020-01-01');

      expect(mockScheduleDailyReminder).not.toHaveBeenCalled();
    });

    test('does nothing when the reminder is off', async () => {
      await saveNotificationPrefs(db, { enabled: false, hour: 7, minute: 0, scheduledIdentifier: null });

      await reconcileAfterWeightLogged(db, todayLocalISO());

      expect(mockGetPermissionState).not.toHaveBeenCalled();
      expect(mockScheduleDailyReminder).not.toHaveBeenCalled();
    });

    test('does nothing when permission has since been revoked, without throwing', async () => {
      await saveNotificationPrefs(db, { enabled: true, hour: 7, minute: 0, scheduledIdentifier: 'id-before' });
      mockGetPermissionState.mockResolvedValue('denied');

      await reconcileAfterWeightLogged(db, todayLocalISO());

      expect(mockScheduleDailyReminder).not.toHaveBeenCalled();
    });
  });
});
