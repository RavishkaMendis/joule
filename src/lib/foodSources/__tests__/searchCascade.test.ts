// ═══════════════════════════════════════════════════════════════════════
// Search cascade tests — mirrors lookupCascade.test.ts's ordering guard,
// but for text search: local saved_food must always be included/checked
// first, and AFCD must resolve entirely offline (no OFF mock needed for
// searchLocal at all — the network module is never touched by it).
// ═══════════════════════════════════════════════════════════════════════

import { freshDb } from '../../../db/repositories/__tests__/testHelpers';
import * as foodRepo from '../../../db/repositories/foodRepo';
import type { Database } from '../../../db/database';
import { searchLocal, searchRemote } from '../searchCascade';
import * as offModule from '../openFoodFacts';

jest.mock('../openFoodFacts', () => ({
  searchOpenFoodFacts: jest.fn(),
}));

describe('searchLocal', () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
    jest.clearAllMocks();
  });

  it('returns both saved_food and AFCD matches without touching the network module', async () => {
    await foodRepo.addSavedFood(db, {
      id: 'f1',
      name: 'My Chicken Breast Prep',
      kcal_per_100g: 165,
      protein_per_100g: 31,
      carbs_per_100g: 0,
      fat_per_100g: 3.6,
      default_grams: 150,
    });

    const result = await searchLocal(db, 'chicken');

    expect(result.savedFood.length).toBeGreaterThan(0);
    expect(result.savedFood[0].name).toBe('My Chicken Breast Prep');
    expect(result.afcd.length).toBeGreaterThan(0); // AFCD has many "chicken" entries
    expect(offModule.searchOpenFoodFacts).not.toHaveBeenCalled();
  });

  it('returns empty local results for a fresh install with no saved_food, but still finds AFCD staples', async () => {
    // This is the bug this task fixes: a fresh install has empty
    // saved_food, but the cascade must not come up completely empty —
    // AFCD tier 2 fills the gap offline.
    const result = await searchLocal(db, 'rice');
    expect(result.savedFood).toEqual([]);
    expect(result.afcd.length).toBeGreaterThan(0);
  });

  it('returns empty arrays for a genuinely unmatched query (e.g. "sushi") rather than throwing', async () => {
    const result = await searchLocal(db, 'sushi');
    expect(result.savedFood).toEqual([]);
    expect(result.afcd).toEqual([]);
  });

  it('returns empty arrays for an empty query without querying the db', async () => {
    const result = await searchLocal(db, '   ');
    expect(result).toEqual({ savedFood: [], afcd: [] });
  });

  it('respects the limit parameter for both tiers', async () => {
    for (let i = 0; i < 5; i++) {
      await foodRepo.addSavedFood(db, {
        id: `f${i}`,
        name: `Chicken thing ${i}`,
        kcal_per_100g: 100,
        protein_per_100g: 10,
        carbs_per_100g: 10,
        fat_per_100g: 5,
        default_grams: 100,
      });
    }
    const result = await searchLocal(db, 'chicken', 3);
    expect(result.savedFood.length).toBeLessThanOrEqual(3);
    expect(result.afcd.length).toBeLessThanOrEqual(3);
  });
});

describe('searchRemote', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates directly to searchOpenFoodFacts (single source of truth for OFF network logic)', async () => {
    (offModule.searchOpenFoodFacts as jest.Mock).mockResolvedValue({ ok: true, results: [] });
    const result = await searchRemote('sushi');
    expect(offModule.searchOpenFoodFacts).toHaveBeenCalledWith('sushi', expect.any(Function));
    expect(result).toEqual({ ok: true, results: [] });
  });

  it('propagates a network_error miss without throwing', async () => {
    (offModule.searchOpenFoodFacts as jest.Mock).mockResolvedValue({ ok: false, reason: 'network_error' });
    const result = await searchRemote('sushi');
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });
});
