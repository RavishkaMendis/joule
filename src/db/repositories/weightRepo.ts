// ═══════════════════════════════════════════════════════════════════════
// weightRepo — CRUD on `weight_log` (PRD §3, §9.6).
//
// One reading per day: `date` is the PRIMARY KEY, so "log weight" is
// always an upsert. PRD §10: "Everything editable forever, including past
// days" — upsert must work identically for today and for a date weeks in
// the past; there is no separate "edit" codepath.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { WeightLogRow } from '../types';
import type { Confounder } from '../../engine/types';

/** Insert a new reading for `date`, or overwrite the existing one. */
export async function upsertWeight(
  db: Database,
  entry: {
    date: string;
    weight_kg: number;
    confounder?: Confounder | null;
    source?: string;
  }
): Promise<void> {
  await db.runAsync(
    `INSERT INTO weight_log (date, weight_kg, confounder, source)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       confounder = excluded.confounder,
       source = excluded.source`,
    [entry.date, entry.weight_kg, entry.confounder ?? null, entry.source ?? 'manual']
  );
}

/** Read all readings with `date` in [startDate, endDate], inclusive, ascending. */
export async function getRange(db: Database, startDate: string, endDate: string): Promise<WeightLogRow[]> {
  return db.getAllAsync<WeightLogRow>(
    'SELECT * FROM weight_log WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [startDate, endDate]
  );
}

/** Read every weight_log row, ascending by date. Convenience for exports/engine callers. */
export async function getAll(db: Database): Promise<WeightLogRow[]> {
  return db.getAllAsync<WeightLogRow>('SELECT * FROM weight_log ORDER BY date ASC');
}

export async function getByDate(db: Database, date: string): Promise<WeightLogRow | null> {
  return db.getFirstAsync<WeightLogRow>('SELECT * FROM weight_log WHERE date = ?', [date]);
}

export async function deleteWeight(db: Database, date: string): Promise<void> {
  await db.runAsync('DELETE FROM weight_log WHERE date = ?', [date]);
}

/** Set (or clear, with `null`) the confounder flag for an existing reading. */
export async function setConfounder(db: Database, date: string, confounder: Confounder | null): Promise<void> {
  await db.runAsync('UPDATE weight_log SET confounder = ? WHERE date = ?', [confounder, date]);
}

export async function clearConfounder(db: Database, date: string): Promise<void> {
  await setConfounder(db, date, null);
}
