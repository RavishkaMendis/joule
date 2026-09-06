// ═══════════════════════════════════════════════════════════════════════
// Priority cascade tests — PRD §6: local saved_food must win over Open
// Food Facts even when both would resolve the same barcode. Network layer
// is mocked (module-mocked openFoodFacts) so these never hit the network.
// ═══════════════════════════════════════════════════════════════════════

import { freshDb } from '../../../db/repositories/__tests__/testHelpers';
import * as foodRepo from '../../../db/repositories/foodRepo';
import type { Database } from '../../../db/database';
import { lookupByBarcode } from '../lookupCascade';
import * as offModule from '../openFoodFacts';

jest.mock('../openFoodFacts', () => ({
  lookupBarcode: jest.fn(),
}));

describe('lookupByBarcode cascade', () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
    jest.clearAllMocks();
  });

  it('returns the local saved_food hit without calling Open Food Facts at all', async () => {
    await foodRepo.addSavedFood(db, {
      id: 'f1',
      name: 'My Protein Bar',
      barcode: '111222333',
      kcal_per_100g: 400,
      protein_per_100g: 30,
      carbs_per_100g: 40,
      fat_per_100g: 10,
      default_grams: 60,
    });

    const result = await lookupByBarcode(db, '111222333');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hitSource).toBe('saved_food');
    expect(result.entry.name).toBe('My Protein Bar');
    expect(result.entry.confidence).toBe('exact');
    expect(result.entry.grams).toBe(60);
    // 60g at 400 kcal/100g = 240 kcal
    expect(result.entry.kcal).toBeCloseTo(240, 5);
    expect(offModule.lookupBarcode).not.toHaveBeenCalled();
  });

  it('falls through to Open Food Facts when there is no local saved_food match', async () => {
    (offModule.lookupBarcode as jest.Mock).mockResolvedValue({
      ok: true,
      entry: {
        name: 'OFF Product',
        grams: 100,
        kcal: 250,
        protein_g: 10,
        carbs_g: 20,
        fat_g: 5,
        confidence: 'exact',
        source: 'barcode',
        per100g: { kcal: 250, protein_g: 10, carbs_g: 20, fat_g: 5 },
        barcode: '999888777',
      },
    });

    const result = await lookupByBarcode(db, '999888777');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hitSource).toBe('open_food_facts');
    expect(result.entry.name).toBe('OFF Product');
    expect(offModule.lookupBarcode).toHaveBeenCalledWith('999888777');
  });

  it('propagates a typed miss when both saved_food and Open Food Facts come up empty', async () => {
    (offModule.lookupBarcode as jest.Mock).mockResolvedValue({ ok: false, reason: 'not_found' });

    const result = await lookupByBarcode(db, '000000000');

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('propagates a network_error miss without throwing', async () => {
    (offModule.lookupBarcode as jest.Mock).mockResolvedValue({ ok: false, reason: 'network_error' });

    const result = await lookupByBarcode(db, '555');

    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });
});
