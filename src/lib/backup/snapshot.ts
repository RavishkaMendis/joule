// ═══════════════════════════════════════════════════════════════════════
// BACKUP SNAPSHOT — the actual payload written to a backup file.
//
// src/db/export.ts's `exportFullJson` already covers the PRD §3 "core"
// tables (day_intake, weight_log, external_estimate, food_entry,
// saved_food, pot, supplement, user_profile). It deliberately does not
// know about the small additive `app_*` tables that live in src/lib
// (app_target_snapshot, app_household_prefs, app_checkin_history) — those
// were built after export.ts, in files that (per their own header
// comments) intentionally avoid touching src/db.
//
// A snapshot that omits those three tables would restore a user's food
// log and weight history but silently drop their *accepted TDEE targets*
// and onboarding household prefs — exactly the "loses weeks of
// convergence" failure this feature exists to prevent, just for targets
// instead of the engine. So this module wraps exportFullJson's result
// with the three app-level tables, reading them with a plain SELECT
// rather than duplicating their ENSURE_TABLE_SQL (each of those modules
// already guarantees its own table exists via its own ensureTable() call,
// invoked the moment anything reads/writes it — see getAcceptedTargets /
// getHouseholdPrefs / getLastCheckIn below).
//
// This file owns no I/O (no filesystem, no share sheet) — it only reads
// the DB and shapes JSON. autoBackup.ts and restore.ts are the ones that
// touch expo-file-system.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import { exportFullJson, type FullExport } from '../../db/export';
import { LATEST_SCHEMA_VERSION } from '../../db/migrations';
import { getAcceptedTargets } from '../targetsStore';
import { getHouseholdPrefs } from '../onboardingActions';
import { getLastCheckIn } from '../checkInHistory';
import { getNotificationPrefs } from '../notifications/settingsStore';

/** Raw row shapes for the three app-level tables, as stored in SQLite. */
export type AppTargetSnapshotRow = {
  id: 1;
  target_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  rail_reason_json: string | null;
  accepted_at: number;
  week_label: string | null;
};

export type AppHouseholdPrefsRow = {
  id: 1;
  who_cooks: string;
  meals_per_day: number | null;
};

export type AppCheckinHistoryRow = {
  id: 1;
  tdee: number;
  confidence_low: number;
  confidence_high: number;
  trend_kg_per_week: number;
  smoothed_weight_kg: number;
  data_quality: string;
  days_of_data: number;
  logged_days_in_window: number;
  goal_rate_kg_per_week: number;
  recorded_at: number;
};

/**
 * Weigh-in reminder preferences, minus the OS handle.
 *
 * `scheduled_identifier` is deliberately NOT part of the backup: it is a
 * device-local id returned by expo-notifications when the reminder was
 * scheduled on THIS install. Restoring it onto another device (or after a
 * reinstall) would leave a stale handle pointing at a notification that
 * doesn't exist, so cancelling or rescheduling would silently target
 * nothing. Only the user's actual intent — on/off and what time — travels;
 * the app re-schedules fresh against the local OS on restore.
 */
export type AppNotificationPrefsBackup = {
  enabled: boolean;
  hour: number;
  minute: number;
};

/**
 * Full backup payload: everything exportFullJson covers, plus the
 * app-level singleton tables. Each app_* field is `null` when the user
 * hasn't reached that point yet (e.g. a fresh install with a profile but
 * no accepted check-in) — never an empty-but-wrong placeholder row.
 */
export type BackupSnapshot = FullExport & {
  /** Bumped independently of schema_version if this wrapper's own shape changes. */
  backup_format_version: number;
  app_target_snapshot: AppTargetSnapshotRow | null;
  app_household_prefs: AppHouseholdPrefsRow | null;
  app_checkin_history: AppCheckinHistoryRow | null;
  /** Absent in snapshots taken before reminders existed — restore must tolerate undefined. */
  app_notification_prefs?: AppNotificationPrefsBackup | null;
};

export const BACKUP_FORMAT_VERSION = 1;

/** Build a complete backup snapshot: every table this app owns, in one JSON-serializable object. */
export async function buildBackupSnapshot(db: Database): Promise<BackupSnapshot> {
  const [core, targets, household, checkin, notifications] = await Promise.all([
    exportFullJson(db, LATEST_SCHEMA_VERSION),
    getAcceptedTargets(db),
    getHouseholdPrefs(db),
    getLastCheckIn(db),
    getNotificationPrefs(db),
  ]);

  return {
    ...core,
    backup_format_version: BACKUP_FORMAT_VERSION,
    app_target_snapshot: targets
      ? {
          id: 1,
          target_kcal: targets.targetKcal,
          protein_g: targets.proteinG,
          fat_g: targets.fatG,
          carbs_g: targets.carbsG,
          rail_reason_json: targets.railReason ? JSON.stringify(targets.railReason) : null,
          accepted_at: targets.acceptedAt,
          week_label: targets.weekLabel,
        }
      : null,
    app_household_prefs: household
      ? { id: 1, who_cooks: household.whoCooks, meals_per_day: household.mealsPerDay }
      : null,
    // Intent only — never the OS-local scheduled_identifier. See the
    // AppNotificationPrefsBackup docstring.
    app_notification_prefs: {
      enabled: notifications.enabled,
      hour: notifications.hour,
      minute: notifications.minute,
    },
    app_checkin_history: checkin
      ? {
          id: 1,
          tdee: checkin.tdee.tdee,
          confidence_low: checkin.tdee.confidenceLow,
          confidence_high: checkin.tdee.confidenceHigh,
          trend_kg_per_week: checkin.tdee.trendKgPerWeek,
          smoothed_weight_kg: checkin.tdee.smoothedWeightKg,
          data_quality: checkin.tdee.dataQuality,
          days_of_data: checkin.tdee.daysOfData,
          logged_days_in_window: checkin.tdee.loggedDaysInWindow,
          goal_rate_kg_per_week: checkin.goalRateKgPerWeek,
          recorded_at: checkin.recordedAt,
        }
      : null,
  };
}

/** Serialize a snapshot to pretty-printed JSON text (the on-disk file format). */
export function serializeSnapshot(snapshot: BackupSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Parse and minimally validate backup file text. Throws a descriptive
 * error rather than a cryptic JSON.parse/undefined-property failure if
 * the file isn't a Joule backup at all (e.g. the user picked the wrong
 * file from their Drive folder).
 */
export function parseSnapshot(text: string): BackupSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON — it does not look like a Joule backup.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('This file does not look like a Joule backup (expected a JSON object).');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.backup_format_version !== 'number' || !Array.isArray(obj.day_intake) || !Array.isArray(obj.weight_log)) {
    throw new Error('This file does not look like a Joule backup (missing expected fields).');
  }

  return parsed as BackupSnapshot;
}
