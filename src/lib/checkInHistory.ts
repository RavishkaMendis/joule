// ═══════════════════════════════════════════════════════════════════════
// CHECK-IN HISTORY — remembers the TDEEResult that produced the LAST
// accepted target snapshot, so the next check-in can explain "TDEE rose
// 40 kcal" against the actual previous measurement rather than
// reconstructing an approximate one from targetKcal + the CURRENT rate.
//
// Why this exists separately from targetsStore.ts: app_target_snapshot
// (targetsStore.ts) stores the TARGET a user accepted — proteinG/fatG/
// carbsG/targetKcal — which is the correct, minimal thing for Today to
// read. It does not store the TDEEResult that produced it. Reconstructing
// "previous TDEE" from `previousTarget.targetKcal + rate` is only correct
// if the rate never changed between check-ins; after an "Adjust rate" or
// a goal change, that reconstruction silently uses the WRONG rate and
// produces a misleading "(was X)" number — exactly the kind of quietly
// wrong number PRD §9.3's "always explain why, truthfully" rules out.
// Storing the real previous TDEEResult alongside the target snapshot
// removes that whole failure mode.
//
// Owned entirely by WeeklyCheckInScreen — like onboardingActions.ts's
// app_household_prefs, this is a tiny additive table via `CREATE TABLE IF
// NOT EXISTS`, since src/db/** is off-limits to modify for this task.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../db/database';
import type { DataQuality, TDEEResult } from '../engine/types';

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_checkin_history (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  tdee                REAL NOT NULL,
  confidence_low      REAL NOT NULL,
  confidence_high     REAL NOT NULL,
  trend_kg_per_week   REAL NOT NULL,
  smoothed_weight_kg  REAL NOT NULL,
  data_quality        TEXT NOT NULL,
  days_of_data        INTEGER NOT NULL,
  logged_days_in_window INTEGER NOT NULL,
  goal_rate_kg_per_week REAL NOT NULL,
  recorded_at         INTEGER NOT NULL
);
`;

type HistoryRow = {
  id: 1;
  tdee: number;
  confidence_low: number;
  confidence_high: number;
  trend_kg_per_week: number;
  smoothed_weight_kg: number;
  data_quality: DataQuality;
  days_of_data: number;
  logged_days_in_window: number;
  goal_rate_kg_per_week: number;
  recorded_at: number;
};

export type CheckInHistoryEntry = {
  tdee: TDEEResult;
  goalRateKgPerWeek: number;
  recordedAt: number;
};

let ensuredTable = false;

async function ensureTable(db: Database): Promise<void> {
  if (ensuredTable) return;
  await db.execAsync(ENSURE_TABLE_SQL);
  ensuredTable = true;
}

/** Read the TDEEResult (+ goal rate) recorded at the last accepted check-in, or null if there hasn't been one yet. */
export async function getLastCheckIn(db: Database): Promise<CheckInHistoryEntry | null> {
  await ensureTable(db);
  const row = await db.getFirstAsync<HistoryRow>('SELECT * FROM app_checkin_history WHERE id = 1');
  if (!row) return null;
  return {
    tdee: {
      tdee: row.tdee,
      confidenceLow: row.confidence_low,
      confidenceHigh: row.confidence_high,
      trendKgPerWeek: row.trend_kg_per_week,
      smoothedWeightKg: row.smoothed_weight_kg,
      dataQuality: row.data_quality,
      daysOfData: row.days_of_data,
      loggedDaysInWindow: row.logged_days_in_window,
    },
    goalRateKgPerWeek: row.goal_rate_kg_per_week,
    recordedAt: row.recorded_at,
  };
}

/** Persist the TDEEResult that justified this check-in's decision (Accept/Keep current/Adjust rate all count — any of them reflects "this was the state reviewed at week N"). */
export async function recordCheckIn(
  db: Database,
  tdee: TDEEResult,
  goalRateKgPerWeek: number,
  recordedAt: number = Date.now()
): Promise<void> {
  await ensureTable(db);
  await db.runAsync(
    `INSERT INTO app_checkin_history
       (id, tdee, confidence_low, confidence_high, trend_kg_per_week, smoothed_weight_kg, data_quality, days_of_data, logged_days_in_window, goal_rate_kg_per_week, recorded_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tdee = excluded.tdee,
       confidence_low = excluded.confidence_low,
       confidence_high = excluded.confidence_high,
       trend_kg_per_week = excluded.trend_kg_per_week,
       smoothed_weight_kg = excluded.smoothed_weight_kg,
       data_quality = excluded.data_quality,
       days_of_data = excluded.days_of_data,
       logged_days_in_window = excluded.logged_days_in_window,
       goal_rate_kg_per_week = excluded.goal_rate_kg_per_week,
       recorded_at = excluded.recorded_at`,
    [
      tdee.tdee,
      tdee.confidenceLow,
      tdee.confidenceHigh,
      tdee.trendKgPerWeek,
      tdee.smoothedWeightKg,
      tdee.dataQuality,
      tdee.daysOfData,
      tdee.loggedDaysInWindow,
      goalRateKgPerWeek,
      recordedAt,
    ]
  );
}

/** Test-only: forget the "table ensured" cache. */
export function resetCheckInHistoryForTesting(): void {
  ensuredTable = false;
}
