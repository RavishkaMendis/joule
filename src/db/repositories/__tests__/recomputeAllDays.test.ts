// ═══════════════════════════════════════════════════════════════════════
// recomputeAllDays — the full-database repair path for day_intake/
// food_entry drift (task brief: "run after a bulk edit"). Covers: rebuild
// matches per-date food_entry sums, is_complete preserved, dates that
// exist on only one side of the join, drift correction (a rollup that
// disagrees with its entries gets fixed), the zero-date no-op, and a
// batch-boundary-crossing volume to exercise the multi-statement batching
// path (RECOMPUTE_ALL_BATCH_SIZE = 100) without relying on its internals.
// ═══════════════════════════════════════════════════════════════════════

import * as foodRepo from '../foodRepo';
import * as intakeRepo from '../intakeRepo';
import { freshDb } from './testHelpers';
import type { Database } from '../../database';
import type { NewFoodEntry } from '../foodRepo';

function entry(overrides: Partial<NewFoodEntry> & { id: string; date: string }): NewFoodEntry {
  return {
    logged_at: Date.now(),
    name: 'test food',
    grams: 100,
    kcal: 100,
    protein_g: 10,
    carbs_g: 10,
    fat_g: 5,
    source: 'manual',
    confidence: 'exact',
    ...overrides,
  };
}

describe('recomputeAllDays', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('returns 0 and touches nothing on an empty database', async () => {
    const result = await intakeRepo.recomputeAllDays(db);
    expect(result).toEqual({ daysTouched: 0 });
  });

  it('rebuilds a rollup that had drifted away from its food_entry rows', async () => {
    await foodRepo.addEntry(db, entry({ id: 'e1', date: '2026-08-01', kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 10 }));
    await foodRepo.addEntry(db, entry({ id: 'e2', date: '2026-08-01', kcal: 200, protein_g: 15, carbs_g: 20, fat_g: 5 }));

    // Simulate drift: something (a direct write, a bad import) desynced
    // the rollup from its entries without going through recomputeDay.
    await db.runAsync('UPDATE day_intake SET kcal = 9999, protein_g = 1, carbs_g = 1, fat_g = 1 WHERE date = ?', [
      '2026-08-01',
    ]);
    let day = await intakeRepo.getDay(db, '2026-08-01');
    expect(day?.kcal).toBe(9999);

    const result = await intakeRepo.recomputeAllDays(db);

    day = await intakeRepo.getDay(db, '2026-08-01');
    expect(day).toEqual({
      date: '2026-08-01',
      kcal: 500,
      protein_g: 35,
      carbs_g: 50,
      fat_g: 15,
      is_complete: 1,
    });
    expect(result.daysTouched).toBeGreaterThanOrEqual(1);
  });

  it('preserves is_complete for every date it rebuilds', async () => {
    await foodRepo.addEntry(db, entry({ id: 'e1', date: '2026-08-02', kcal: 400 }));
    await intakeRepo.setComplete(db, '2026-08-02', false);

    await intakeRepo.recomputeAllDays(db);

    const day = await intakeRepo.getDay(db, '2026-08-02');
    expect(day?.is_complete).toBe(0);
    expect(day?.kcal).toBe(400);
  });

  it('builds a day_intake row for a date that has food_entry rows but never got one (e.g. inserted by a bulk import that bypassed foodRepo)', async () => {
    // Insert a food_entry row directly, bypassing foodRepo.addEntry (and
    // therefore recomputeDay) entirely, to simulate exactly that gap.
    await db.runAsync(
      `INSERT INTO food_entry (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['bulk1', '2026-08-03', Date.now(), 'bulk import row', 100, 250, 20, 25, 8, 'manual', 'exact']
    );

    expect(await intakeRepo.getDay(db, '2026-08-03')).toBeNull();

    await intakeRepo.recomputeAllDays(db);

    const day = await intakeRepo.getDay(db, '2026-08-03');
    expect(day).toEqual({
      date: '2026-08-03',
      kcal: 250,
      protein_g: 20,
      carbs_g: 25,
      fat_g: 8,
      is_complete: 1, // first-touch default, matching recomputeDay
    });
  });

  it('re-zeroes a day_intake row whose entries were all deleted, without deleting the row itself', async () => {
    const date = '2026-08-04';
    await foodRepo.addEntry(db, entry({ id: 'only', date, kcal: 500 }));
    await foodRepo.deleteEntry(db, 'only'); // already zeroed by recomputeDay via foodRepo

    await intakeRepo.recomputeAllDays(db);

    const day = await intakeRepo.getDay(db, date);
    expect(day).toEqual({
      date,
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      is_complete: 1,
    });
  });

  it('leaves an already-correct rollup unchanged in value', async () => {
    await foodRepo.addEntry(db, entry({ id: 'e1', date: '2026-08-05', kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 10 }));

    const before = await intakeRepo.getDay(db, '2026-08-05');
    await intakeRepo.recomputeAllDays(db);
    const after = await intakeRepo.getDay(db, '2026-08-05');

    expect(after).toEqual(before);
  });

  it('reports the correct count of distinct dates touched, across both day_intake-only and food_entry-only dates', async () => {
    await foodRepo.addEntry(db, entry({ id: 'e1', date: '2026-08-06', kcal: 100 }));
    await foodRepo.addEntry(db, entry({ id: 'e2', date: '2026-08-07', kcal: 200 }));
    // A day_intake row with no entries at all (e.g. via setComplete on an
    // empty day) — still a date that must be touched/rebuilt.
    await intakeRepo.setComplete(db, '2026-08-08', false);

    const result = await intakeRepo.recomputeAllDays(db);
    expect(result.daysTouched).toBe(3);
  });

  it('handles more dates than one internal batch (exercises the multi-statement batching path) and rebuilds every one correctly', async () => {
    const totalDates = 250; // > RECOMPUTE_ALL_BATCH_SIZE (100), forces 3 batches
    for (let i = 0; i < totalDates; i++) {
      const date = `2027-01-${String((i % 28) + 1).padStart(2, '0')}-${String(i).padStart(4, '0')}`;
      // Dates must be distinct strings for this test's purposes even
      // though they're not all valid calendar dates — recomputeAllDays
      // treats `date` as an opaque grouping key, never parses it.
      await db.runAsync(
        `INSERT INTO food_entry (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`bulk-${i}`, date, Date.now(), 'row', 100, 100, 10, 10, 5, 'manual', 'exact']
      );
    }

    const result = await intakeRepo.recomputeAllDays(db);
    expect(result.daysTouched).toBe(totalDates);

    const rows = await db.getAllAsync<{ date: string; kcal: number }>('SELECT date, kcal FROM day_intake');
    expect(rows).toHaveLength(totalDates);
    expect(rows.every((r) => r.kcal === 100)).toBe(true);
  });
});
