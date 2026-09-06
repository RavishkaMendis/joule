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

describe('day_intake rollup consistency', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('recomputes the rollup when an entry is added', async () => {
    await foodRepo.addEntry(db, entry({ id: 'e1', date: '2026-08-01', kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 10 }));
    await foodRepo.addEntry(db, entry({ id: 'e2', date: '2026-08-01', kcal: 200, protein_g: 15, carbs_g: 20, fat_g: 5 }));

    const day = await intakeRepo.getDay(db, '2026-08-01');
    expect(day).toEqual({
      date: '2026-08-01',
      kcal: 500,
      protein_g: 35,
      carbs_g: 50,
      fat_g: 15,
      is_complete: 1,
    });
  });

  it('recomputes an OLD day correctly when one of its entries is edited (PRD §10)', async () => {
    const oldDate = '2026-08-01'; // "3 weeks ago" relative to today (2026-08-26)
    await foodRepo.addEntry(db, entry({ id: 'old1', date: oldDate, kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 10 }));
    await foodRepo.addEntry(db, entry({ id: 'old2', date: oldDate, kcal: 200, protein_g: 15, carbs_g: 20, fat_g: 5 }));

    let day = await intakeRepo.getDay(db, oldDate);
    expect(day?.kcal).toBe(500);

    // Edit the older entry's macros.
    await foodRepo.updateEntry(db, 'old1', { kcal: 450, protein_g: 40, carbs_g: 35, fat_g: 12 });

    day = await intakeRepo.getDay(db, oldDate);
    expect(day).toEqual({
      date: oldDate,
      kcal: 650, // 450 + 200
      protein_g: 55, // 40 + 15
      carbs_g: 55, // 35 + 20
      fat_g: 17, // 12 + 5
      is_complete: 1,
    });
  });

  it('recomputes correctly when an old entry is deleted', async () => {
    const oldDate = '2026-08-01';
    await foodRepo.addEntry(db, entry({ id: 'old1', date: oldDate, kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 10 }));
    await foodRepo.addEntry(db, entry({ id: 'old2', date: oldDate, kcal: 200, protein_g: 15, carbs_g: 20, fat_g: 5 }));

    await foodRepo.deleteEntry(db, 'old1');

    const day = await intakeRepo.getDay(db, oldDate);
    expect(day).toEqual({
      date: oldDate,
      kcal: 200,
      protein_g: 15,
      carbs_g: 20,
      fat_g: 5,
      is_complete: 1,
    });
  });

  it('deleting the last entry of a day zeroes the rollup rather than leaving stale numbers', async () => {
    const date = '2026-08-05';
    await foodRepo.addEntry(db, entry({ id: 'only', date, kcal: 500, protein_g: 30, carbs_g: 40, fat_g: 15 }));
    await foodRepo.deleteEntry(db, 'only');

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

  it('recomputes BOTH the old and new date when an entry is moved to a different day', async () => {
    await foodRepo.addEntry(db, entry({ id: 'moving', date: '2026-08-01', kcal: 400, protein_g: 30, carbs_g: 30, fat_g: 10 }));
    await foodRepo.addEntry(db, entry({ id: 'stays', date: '2026-08-01', kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 2 }));

    await foodRepo.updateEntry(db, 'moving', { date: '2026-08-02' });

    const oldDay = await intakeRepo.getDay(db, '2026-08-01');
    expect(oldDay?.kcal).toBe(100); // only 'stays' remains

    const newDay = await intakeRepo.getDay(db, '2026-08-02');
    expect(newDay?.kcal).toBe(400);
  });

  it('preserves is_complete across recomputation triggered by entry edits', async () => {
    const date = '2026-08-01';
    await foodRepo.addEntry(db, entry({ id: 'e1', date, kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 10 }));
    await intakeRepo.setComplete(db, date, false);

    await foodRepo.addEntry(db, entry({ id: 'e2', date, kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 2 }));

    const day = await intakeRepo.getDay(db, date);
    expect(day?.is_complete).toBe(0);
    expect(day?.kcal).toBe(400);
  });

  it('setComplete creates a zeroed rollup row for a day with no entries yet', async () => {
    await intakeRepo.setComplete(db, '2026-08-09', false);
    const day = await intakeRepo.getDay(db, '2026-08-09');
    expect(day).toEqual({
      date: '2026-08-09',
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      is_complete: 0,
    });
  });

  it('getRange returns rollups ascending by date within bounds', async () => {
    await foodRepo.addEntry(db, entry({ id: 'a', date: '2026-08-01', kcal: 100 }));
    await foodRepo.addEntry(db, entry({ id: 'b', date: '2026-08-05', kcal: 200 }));
    await foodRepo.addEntry(db, entry({ id: 'c', date: '2026-08-10', kcal: 300 }));

    const range = await intakeRepo.getRange(db, '2026-08-01', '2026-08-05');
    expect(range.map((r) => r.date)).toEqual(['2026-08-01', '2026-08-05']);
  });
});
