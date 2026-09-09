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
import type { SQLBindValue } from '../database';
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

/** How many dates' worth of params get bundled into a single bulk upsert statement (see recomputeAllDays). 100 dates * 6 params/date = 600 bind params, safely under SQLite's default 999-parameter compile-time limit (SQLITE_MAX_VARIABLE_NUMBER) with headroom for older builds. */
const RECOMPUTE_ALL_BATCH_SIZE = 100;

export type RecomputeAllResult = {
  /** Number of distinct dates rebuilt (every date that had a day_intake row and/or food_entry rows). */
  daysTouched: number;
};

/**
 * Rebuilds EVERY day_intake rollup from food_entry in one pass — the
 * repair path for historical drift between the two (a bulk import/edit
 * that bypassed foodRepo, a restored backup, or just wanting to confirm
 * the rollups are trustworthy after the data-health scan fixes some
 * entries by hand). `is_complete` is preserved per-date exactly as
 * `recomputeDay` preserves it for a single date; a date that has
 * food_entry rows but no existing day_intake row yet defaults to
 * complete (1), matching `recomputeDay`'s own first-touch default.
 *
 * Deliberately NOT implemented as `recomputeDay` called once per date:
 * that would be 2 SELECTs + 1 upsert round-trip PER DATE (a year of
 * daily data is 365 dates -> ~1095 round-trips). Instead this does
 * exactly 2 SELECTs total (one aggregate GROUP BY over all of
 * food_entry, one full read of day_intake), unions the dates in memory,
 * then upserts in a handful of multi-row batched statements wrapped in a
 * single transaction — O(1) SELECT round-trips and O(days / batch size)
 * write round-trips, not O(days) of both.
 */
export async function recomputeAllDays(db: Database): Promise<RecomputeAllResult> {
  const [sumRows, existingRows] = await Promise.all([
    db.getAllAsync<{ date: string } & SumRow>(
      `SELECT date, SUM(kcal) as kcal, SUM(protein_g) as protein_g, SUM(carbs_g) as carbs_g, SUM(fat_g) as fat_g
       FROM food_entry
       GROUP BY date`
    ),
    db.getAllAsync<{ date: string; is_complete: number }>('SELECT date, is_complete FROM day_intake'),
  ]);

  const sumsByDate = new Map(sumRows.map((r) => [r.date, r]));
  const completeByDate = new Map(existingRows.map((r) => [r.date, r.is_complete]));

  const allDates = [...new Set<string>([...sumsByDate.keys(), ...completeByDate.keys()])];
  if (allDates.length === 0) {
    return { daysTouched: 0 };
  }

  await db.execAsync('BEGIN');
  try {
    for (let i = 0; i < allDates.length; i += RECOMPUTE_ALL_BATCH_SIZE) {
      const batch = allDates.slice(i, i + RECOMPUTE_ALL_BATCH_SIZE);
      const valuesSql = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: SQLBindValue[] = [];
      for (const date of batch) {
        const sums = sumsByDate.get(date);
        params.push(
          date,
          sums?.kcal ?? 0,
          sums?.protein_g ?? 0,
          sums?.carbs_g ?? 0,
          sums?.fat_g ?? 0,
          completeByDate.get(date) ?? 1
        );
      }

      await db.runAsync(
        `INSERT INTO day_intake (date, kcal, protein_g, carbs_g, fat_g, is_complete)
         VALUES ${valuesSql}
         ON CONFLICT(date) DO UPDATE SET
           kcal = excluded.kcal,
           protein_g = excluded.protein_g,
           carbs_g = excluded.carbs_g,
           fat_g = excluded.fat_g,
           is_complete = excluded.is_complete`,
        params
      );
    }
    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }

  return { daysTouched: allDates.length };
}
