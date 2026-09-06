// ═══════════════════════════════════════════════════════════════════════
// NOTIFICATION SETTINGS STORE — persists the weigh-in reminder's
// enabled/hour/minute + the OS notification identifier currently
// scheduled for it, in the same additive-table pattern as
// src/lib/targetsStore.ts / onboardingActions.ts (`CREATE TABLE IF NOT
// EXISTS app_*`), since src/db/** is off-limits to modify for this task.
//
// `scheduled_identifier` is an OS-local handle from
// `scheduleNotificationAsync` — meaningful only on the device that
// scheduled it. It is persisted so a later cancel/reschedule (e.g. after
// today's weight is logged, see reminderActions.ts) can cancel the exact
// previous notification rather than guessing. If this table is ever
// included in a JSON backup/restore, `scheduled_identifier` must NOT be
// restored verbatim (a restored id is stale — it names a notification
// that was never scheduled on *this* install) — see this task's final
// report for the flag to the backup owner.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import { DEFAULT_REMINDER_HOUR, DEFAULT_REMINDER_MINUTE } from './weighInReminder';

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_notification_prefs (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  enabled               INTEGER NOT NULL DEFAULT 0,
  hour                  INTEGER NOT NULL DEFAULT ${DEFAULT_REMINDER_HOUR},
  minute                INTEGER NOT NULL DEFAULT ${DEFAULT_REMINDER_MINUTE},
  scheduled_identifier  TEXT
);
`;

export type NotificationPrefs = {
  enabled: boolean;
  hour: number;
  minute: number;
  scheduledIdentifier: string | null;
};

type PrefsRow = {
  id: 1;
  enabled: number;
  hour: number;
  minute: number;
  scheduled_identifier: string | null;
};

/** Off by default (CLAUDE.md: "ask permission only when the user turns it on, never at startup"). */
const DEFAULT_PREFS: NotificationPrefs = {
  enabled: false,
  hour: DEFAULT_REMINDER_HOUR,
  minute: DEFAULT_REMINDER_MINUTE,
  scheduledIdentifier: null,
};

let ensuredTable = false;

async function ensureTable(db: Database): Promise<void> {
  if (ensuredTable) return;
  await db.execAsync(ENSURE_TABLE_SQL);
  ensuredTable = true;
}

/** Read current prefs, or the (disabled) defaults if the user has never touched this setting. */
export async function getNotificationPrefs(db: Database): Promise<NotificationPrefs> {
  await ensureTable(db);
  const row = await db.getFirstAsync<PrefsRow>('SELECT * FROM app_notification_prefs WHERE id = 1');
  if (!row) return DEFAULT_PREFS;
  return {
    enabled: row.enabled === 1,
    hour: row.hour,
    minute: row.minute,
    scheduledIdentifier: row.scheduled_identifier,
  };
}

/** Persist prefs (full replace — callers read-modify-write via getNotificationPrefs). */
export async function saveNotificationPrefs(db: Database, prefs: NotificationPrefs): Promise<void> {
  await ensureTable(db);
  await db.runAsync(
    `INSERT INTO app_notification_prefs (id, enabled, hour, minute, scheduled_identifier)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       hour = excluded.hour,
       minute = excluded.minute,
       scheduled_identifier = excluded.scheduled_identifier`,
    [prefs.enabled ? 1 : 0, prefs.hour, prefs.minute, prefs.scheduledIdentifier]
  );
}

/** Test-only: forget the "table ensured" cache so tests against fresh in-memory DBs re-create it. */
export function resetNotificationSettingsStoreForTesting(): void {
  ensuredTable = false;
}
