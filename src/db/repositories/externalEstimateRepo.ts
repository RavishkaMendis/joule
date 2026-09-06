// ═══════════════════════════════════════════════════════════════════════
// externalEstimateRepo — CRUD on `external_estimate` (PRD §3, §11).
//
// REFERENCE ONLY. This table, and every function in this file, exists
// solely to store and surface wearable/Zepp data for calibration display
// on the Trends chart (PRD §9.2, §11: "your strap runs 19% high"). Nothing
// here is imported by src/engine/** — that boundary is enforced
// structurally by eslint.config.js's no-restricted-imports zone on
// src/engine/**, not by convention.
//
// `date` is the PRIMARY KEY (one row per day, like weight_log), so
// importing is always an upsert — re-importing the same Zepp export file
// must not duplicate rows, only overwrite same-day values with whatever
// the (possibly re-exported) file says now.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { ExternalEstimateRow } from '../types';

export type UpsertExternalEstimateInput = {
  date: string;
  source: string;
  tdee_est: number | null;
  active_kcal: number | null;
  steps: number | null;
  sleep_minutes: number | null;
  readiness: number | null;
};

/** Insert a new reference-data row for `date`, or overwrite the existing one (upsert by date — idempotent re-import). */
export async function upsertEstimate(db: Database, entry: UpsertExternalEstimateInput): Promise<void> {
  await db.runAsync(
    `INSERT INTO external_estimate (date, source, tdee_est, active_kcal, steps, sleep_minutes, readiness)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       source = excluded.source,
       tdee_est = excluded.tdee_est,
       active_kcal = excluded.active_kcal,
       steps = excluded.steps,
       sleep_minutes = excluded.sleep_minutes,
       readiness = excluded.readiness`,
    [entry.date, entry.source, entry.tdee_est, entry.active_kcal, entry.steps, entry.sleep_minutes, entry.readiness]
  );
}

/** Bulk upsert, sequential (SQLite has no multi-row upsert with mixed columns worth the complexity here — import volumes are at most a few thousand days). */
export async function upsertMany(db: Database, entries: readonly UpsertExternalEstimateInput[]): Promise<void> {
  for (const entry of entries) {
    await upsertEstimate(db, entry);
  }
}

/** Read all rows with `date` in [startDate, endDate], inclusive, ascending. */
export async function getRange(db: Database, startDate: string, endDate: string): Promise<ExternalEstimateRow[]> {
  return db.getAllAsync<ExternalEstimateRow>(
    'SELECT * FROM external_estimate WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [startDate, endDate]
  );
}

export async function getByDate(db: Database, date: string): Promise<ExternalEstimateRow | null> {
  return db.getFirstAsync<ExternalEstimateRow>('SELECT * FROM external_estimate WHERE date = ?', [date]);
}

/** Read every row, ascending by date. Convenience for exports. */
export async function getAll(db: Database): Promise<ExternalEstimateRow[]> {
  return db.getAllAsync<ExternalEstimateRow>('SELECT * FROM external_estimate ORDER BY date ASC');
}

export async function deleteEstimate(db: Database, date: string): Promise<void> {
  await db.runAsync('DELETE FROM external_estimate WHERE date = ?', [date]);
}
