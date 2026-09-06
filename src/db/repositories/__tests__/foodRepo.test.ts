import * as foodRepo from '../foodRepo';
import { freshDb } from './testHelpers';
import type { Database } from '../../database';

describe('foodRepo — food_entry CRUD', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('adds and reads back an entry', async () => {
    const row = await foodRepo.addEntry(db, {
      id: 'e1',
      date: '2026-08-01',
      logged_at: 1000,
      name: 'Chicken breast',
      grams: 150,
      kcal: 250,
      protein_g: 45,
      carbs_g: 0,
      fat_g: 6,
      source: 'manual',
      confidence: 'exact',
    });
    expect(row.name).toBe('Chicken breast');
    expect(await foodRepo.getEntry(db, 'e1')).toEqual(row);
  });

  it('lists entries for a date ordered by logged_at', async () => {
    await foodRepo.addEntry(db, {
      id: 'e2',
      date: '2026-08-01',
      logged_at: 2000,
      name: 'second',
      grams: 1,
      kcal: 1,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 1,
      source: 'manual',
      confidence: 'exact',
    });
    await foodRepo.addEntry(db, {
      id: 'e1',
      date: '2026-08-01',
      logged_at: 1000,
      name: 'first',
      grams: 1,
      kcal: 1,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 1,
      source: 'manual',
      confidence: 'exact',
    });

    const entries = await foodRepo.getEntriesForDate(db, '2026-08-01');
    expect(entries.map((e) => e.name)).toEqual(['first', 'second']);
  });

  it('deleteEntry on a nonexistent id is a no-op, not an error', async () => {
    await expect(foodRepo.deleteEntry(db, 'nope')).resolves.toBeUndefined();
  });
});

describe('foodRepo — saved_food CRUD + quick-add ranking', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('CRUDs a saved food', async () => {
    const food = await foodRepo.addSavedFood(db, {
      id: 'sf1',
      name: 'Rice, cooked',
      kcal_per_100g: 130,
      protein_per_100g: 2.7,
      carbs_per_100g: 28,
      fat_per_100g: 0.3,
      default_grams: 200,
    });
    expect(food.use_count).toBe(0);
    expect(food.last_used).toBeNull();

    const updated = await foodRepo.updateSavedFood(db, 'sf1', { default_grams: 250 });
    expect(updated.default_grams).toBe(250);

    await foodRepo.deleteSavedFood(db, 'sf1');
    expect(await foodRepo.getSavedFood(db, 'sf1')).toBeNull();
  });

  it('incrementUse bumps use_count and last_used', async () => {
    await foodRepo.addSavedFood(db, {
      id: 'sf1',
      name: 'Rice',
      kcal_per_100g: 130,
      protein_per_100g: 2.7,
      carbs_per_100g: 28,
      fat_per_100g: 0.3,
      default_grams: 200,
    });

    await foodRepo.incrementUse(db, 'sf1', 5000);
    const row = await foodRepo.getSavedFood(db, 'sf1');
    expect(row?.use_count).toBe(1);
    expect(row?.last_used).toBe(5000);

    await foodRepo.incrementUse(db, 'sf1', 6000);
    const row2 = await foodRepo.getSavedFood(db, 'sf1');
    expect(row2?.use_count).toBe(2);
    expect(row2?.last_used).toBe(6000);
  });

  it('getQuickAddCandidates ranks by use_count desc, then last_used desc, excludes never-used', async () => {
    await foodRepo.addSavedFood(db, {
      id: 'never',
      name: 'Never used',
      kcal_per_100g: 100,
      protein_per_100g: 1,
      carbs_per_100g: 1,
      fat_per_100g: 1,
      default_grams: 100,
    });
    await foodRepo.addSavedFood(db, {
      id: 'low',
      name: 'Low freq',
      kcal_per_100g: 100,
      protein_per_100g: 1,
      carbs_per_100g: 1,
      fat_per_100g: 1,
      default_grams: 100,
    });
    await foodRepo.addSavedFood(db, {
      id: 'high-older',
      name: 'High freq, older use',
      kcal_per_100g: 100,
      protein_per_100g: 1,
      carbs_per_100g: 1,
      fat_per_100g: 1,
      default_grams: 100,
    });
    await foodRepo.addSavedFood(db, {
      id: 'high-newer',
      name: 'High freq, newer use',
      kcal_per_100g: 100,
      protein_per_100g: 1,
      carbs_per_100g: 1,
      fat_per_100g: 1,
      default_grams: 100,
    });

    // 'low': used once
    await foodRepo.incrementUse(db, 'low', 1000);
    // 'high-older': used 5 times, most recent at t=2000
    for (let i = 0; i < 5; i++) await foodRepo.incrementUse(db, 'high-older', 2000);
    // 'high-newer': used 5 times, most recent at t=9000 (tiebreak winner over high-older)
    for (let i = 0; i < 5; i++) await foodRepo.incrementUse(db, 'high-newer', 9000);

    const candidates = await foodRepo.getQuickAddCandidates(db, 3);
    expect(candidates.map((c) => c.id)).toEqual(['high-newer', 'high-older', 'low']);
    // 'never' must not appear even though limit allows 4.
    expect(candidates.find((c) => c.id === 'never')).toBeUndefined();
  });

  it('searchSavedFood matches by substring, case handled by caller (LIKE is case-insensitive for ASCII in SQLite)', async () => {
    await foodRepo.addSavedFood(db, {
      id: 'sf1',
      name: 'Greek yoghurt',
      kcal_per_100g: 60,
      protein_per_100g: 10,
      carbs_per_100g: 4,
      fat_per_100g: 0.5,
      default_grams: 150,
    });
    const results = await foodRepo.searchSavedFood(db, 'yoghurt');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('sf1');
  });
});
