import { freshDb } from '../../../db/repositories/__tests__/testHelpers';
import type { Database } from '../../../db/database';
import {
  getNotificationPrefs,
  saveNotificationPrefs,
  resetNotificationSettingsStoreForTesting,
} from '../settingsStore';
import { DEFAULT_REMINDER_HOUR, DEFAULT_REMINDER_MINUTE } from '../weighInReminder';

describe('notification settings persistence round-trip', () => {
  let db: Database;

  beforeEach(async () => {
    resetNotificationSettingsStoreForTesting();
    db = await freshDb();
  });

  test('defaults to disabled with the default reminder time when never set', async () => {
    const prefs = await getNotificationPrefs(db);
    expect(prefs).toEqual({
      enabled: false,
      hour: DEFAULT_REMINDER_HOUR,
      minute: DEFAULT_REMINDER_MINUTE,
      scheduledIdentifier: null,
    });
  });

  test('round-trips enabled/hour/minute/identifier', async () => {
    await saveNotificationPrefs(db, {
      enabled: true,
      hour: 6,
      minute: 45,
      scheduledIdentifier: 'abc-123',
    });

    const prefs = await getNotificationPrefs(db);
    expect(prefs).toEqual({
      enabled: true,
      hour: 6,
      minute: 45,
      scheduledIdentifier: 'abc-123',
    });
  });

  test('a second save overwrites rather than duplicating (single-row upsert)', async () => {
    await saveNotificationPrefs(db, { enabled: true, hour: 7, minute: 0, scheduledIdentifier: 'first' });
    await saveNotificationPrefs(db, { enabled: false, hour: 8, minute: 30, scheduledIdentifier: null });

    const prefs = await getNotificationPrefs(db);
    expect(prefs).toEqual({ enabled: false, hour: 8, minute: 30, scheduledIdentifier: null });
  });

  test('clearing the identifier back to null persists correctly', async () => {
    await saveNotificationPrefs(db, { enabled: true, hour: 7, minute: 0, scheduledIdentifier: 'to-be-cleared' });
    await saveNotificationPrefs(db, { enabled: true, hour: 7, minute: 0, scheduledIdentifier: null });

    const prefs = await getNotificationPrefs(db);
    expect(prefs.scheduledIdentifier).toBeNull();
  });
});
