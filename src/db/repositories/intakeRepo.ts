// ═══════════════════════════════════════════════════════════════════════
// intakeRepo — `day_intake` is a DERIVED ROLLUP of `food_entry`.
//
// PRD §3 lists day_intake as a standalone table (and it is one of the two
// tables the TDEE engine may read), but its kcal/protein_g/carbs_g/fat_g
// columns must always equal the sum of that date's food_entry rows — it is
// never hand-edited independently of the entries. `is_complete` is the one
// exception: it is a user-settable flag ("I didn't log everything today")
// that recomputeDay must preserve across recomputation, since it carries
// no information derivable from food_entry itself.
//
// Every mutation to food_entry (insert/update/delete) MUST call
// recomputeDay for the affected date(s) afterwards — see foodRepo, which
// is the only place that calls this on food_entry's behalf. Never let the
// two drift: recomputeDay is the single source of truth for how a rollup
// is derived, so no other code should hand-write day_intake's numeric
// columns.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { DayIntakeRow } from '../types';

type SumRow = {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
};

/**
 * Recompute `date`'s day_intake row from its current food_entry rows.
 * Safe to call for any date, past or present (PRD §10: "everything
 * editable forever, including past days"). If there are zero entries for
 * the date, the rollup's numeric columns become 0 rather than the row
 * being deleted — this keeps day_intake existing (and gap-free) for any
 * date the user has ever touched, while `is_complete` still reflects
 * whatever the user last set (defaulting to 1 / complete on first touch).
 */
export async function recomputeDay(db: Database, date: string): Promise<DayIntakeRow> {
  const sums = await db.getFirstAsync<SumRow>(
    `SELECT
       SUM(kcal) as kcal,
       SUM(protein_g) as protein_g,
       SUM(carbs_g) as carbs_g,
       SUM(fat_g) as fat_g
     FROM food_entry
     WHERE date = ?`,
    [date]
  );

  const kcal = sums?.kcal ?? 0;
  const protein_g = sums?.protein_g ?? 0;
  const carbs_g = sums?.carbs_g ?? 0;
  const fat_g = sums?.fat_g ?? 0;

  // Preserve is_complete if a row already exists; default to 1 (complete)
  // for a day being touched for the first time.
  const existing = await db.getFirstAsync<{ is_complete: number }>(
    'SELECT is_complete FROM day_intake WHERE date = ?',
    [date]
  );
  const is_complete = existing?.is_complete ?? 1;

  await db.runAsync(
    `INSERT INTO day_intake (date, kcal, protein_g, carbs_g, fat_g, is_complete)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       kcal = excluded.kcal,
       protein_g = excluded.protein_g,
       carbs_g = excluded.carbs_g,
       fat_g = excluded.fat_g,
       is_complete = excluded.is_complete`,
    [date, kcal, protein_g, carbs_g, fat_g, is_complete]
  );

  return { date, kcal, protein_g, carbs_g, fat_g, is_complete };
}

export async function getDay(db: Database, date: string): Promise<DayIntakeRow | null> {
  return db.getFirstAsync<DayIntakeRow>('SELECT * FROM day_intake WHERE date = ?', [date]);
}

export async function getRange(db: Database, startDate: string, endDate: string): Promise<DayIntakeRow[]> {
  return db.getAllAsync<DayIntakeRow>(
    'SELECT * FROM day_intake WHERE date >= ? AND date <= ? ORDER BY date ASC',
    [startDate, endDate]
  );
}

export async function getAll(db: Database): Promise<DayIntakeRow[]> {
  return db.getAllAsync<DayIntakeRow>('SELECT * FROM day_intake ORDER BY date ASC');
}

/**
 * User-settable "didn't log everything today" flag (PRD §3, §4.4: partial
 * logs drop out of the intake series but the weight reading still
 * counts). Ensures a day_intake row exists (creating an all-zero rollup
 * if the day has no entries yet) rather than silently no-op'ing.
 */
export async function setComplete(db: Database, date: string, isComplete: boolean): Promise<void> {
  const existing = await db.getFirstAsync<{ date: string }>('SELECT date FROM day_intake WHERE date = ?', [date]);
  if (!existing) {
    await recomputeDay(db, date);
  }
  await db.runAsync('UPDATE day_intake SET is_complete = ? WHERE date = ?', [isComplete ? 1 : 0, date]);
}
