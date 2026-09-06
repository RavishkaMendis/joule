// ═══════════════════════════════════════════════════════════════════════
// FOOD ENTRY ACTIONS — confidence-carrying tests (PRD §10 fix).
//
// `logQuickAdd` used to hardcode `confidence: 'exact'` for every
// quick-add, which laundered a low-confidence meal-photo item saved via
// "Save to my foods" into an apparent-certainty entry the moment it was
// quick-added. This file proves:
//   1. logQuickAdd now carries the saved_food row's own confidence.
//   2. logManualEntry's "save to my foods" path stores the ORIGINATING
//      entry's confidence on the new saved_food row, not a hardcoded value.
//   3. A saved_food row with confidence = NULL (every pre-v3 row) falls
//      back to the documented default (LEGACY_SAVED_FOOD_CONFIDENCE =
//      'high'), never 'exact'.
// ═══════════════════════════════════════════════════════════════════════

import { freshDb } from '../../db/repositories/__tests__/testHelpers';
import * as foodRepo from '../../db/repositories/foodRepo';
import { logQuickAdd, logManualEntry, LEGACY_SAVED_FOOD_CONFIDENCE } from '../foodEntryActions';

describe('logQuickAdd — confidence carried from saved_food, never hardcoded exact', () => {
  it('carries a low-confidence saved_food through to the logged entry', async () => {
    const db = await freshDb();
    const saved = await foodRepo.addSavedFood(db, {
      id: 'sf-low',
      name: 'Leftover curry (photo estimate)',
      kcal_per_100g: 180,
      protein_per_100g: 8,
      carbs_per_100g: 20,
      fat_per_100g: 7,
      default_grams: 350,
      confidence: 'low',
    });

    const entry = await logQuickAdd(db, saved, '2026-08-20');

    expect(entry.confidence).toBe('low');
    expect(entry.confidence).not.toBe('exact');
  });

  it('carries a medium/high-confidence saved_food through unchanged', async () => {
    const db = await freshDb();
    const savedMedium = await foodRepo.addSavedFood(db, {
      id: 'sf-medium',
      name: 'Meal-photo item',
      kcal_per_100g: 200,
      protein_per_100g: 10,
      carbs_per_100g: 25,
      fat_per_100g: 6,
      default_grams: 250,
      confidence: 'medium',
    });
    const entryMedium = await logQuickAdd(db, savedMedium, '2026-08-20');
    expect(entryMedium.confidence).toBe('medium');

    const savedHigh = await foodRepo.addSavedFood(db, {
      id: 'sf-high',
      name: 'Stated-quantity oil',
      kcal_per_100g: 884,
      protein_per_100g: 0,
      carbs_per_100g: 0,
      fat_per_100g: 100,
      default_grams: 14,
      confidence: 'high',
    });
    const entryHigh = await logQuickAdd(db, savedHigh, '2026-08-20');
    expect(entryHigh.confidence).toBe('high');
  });

  it('a genuinely barcode/label-sourced saved_food stays exact', async () => {
    const db = await freshDb();
    const saved = await foodRepo.addSavedFood(db, {
      id: 'sf-exact',
      name: 'Scanned product',
      barcode: '9312345678901',
      kcal_per_100g: 250,
      protein_per_100g: 12,
      carbs_per_100g: 30,
      fat_per_100g: 9,
      default_grams: 100,
      confidence: 'exact',
    });
    const entry = await logQuickAdd(db, saved, '2026-08-20');
    expect(entry.confidence).toBe('exact');
  });

  it('a pre-v3 saved_food (confidence NULL) defaults to the documented LEGACY_SAVED_FOOD_CONFIDENCE, not exact', async () => {
    const db = await freshDb();
    // Exactly what a row saved before schema v3 looks like: no confidence
    // passed at all, so the column is NULL.
    const saved = await foodRepo.addSavedFood(db, {
      id: 'sf-legacy',
      name: 'Rice',
      kcal_per_100g: 130,
      protein_per_100g: 2.7,
      carbs_per_100g: 28,
      fat_per_100g: 0.3,
      default_grams: 200,
    });
    expect(saved.confidence).toBeNull();

    const entry = await logQuickAdd(db, saved, '2026-08-20');

    expect(LEGACY_SAVED_FOOD_CONFIDENCE).toBe('high');
    expect(entry.confidence).toBe('high');
    expect(entry.confidence).not.toBe('exact');
  });
});

describe('logManualEntry — "save to my foods" stores the originating confidence', () => {
  it('a low-confidence manual entry saved to my foods keeps low on the saved_food row', async () => {
    const db = await freshDb();
    const { entry, savedFood } = await logManualEntry(db, {
      date: '2026-08-20',
      name: 'Mystery meal-photo leftovers',
      grams: 300,
      kcal: 450,
      protein_g: 20,
      carbs_g: 40,
      fat_g: 18,
      confidence: 'low',
      source: 'meal_photo',
      saveToMyFoods: true,
    });

    expect(entry.confidence).toBe('low');
    expect(savedFood).not.toBeNull();
    expect(savedFood?.confidence).toBe('low');

    // And quick-adding it back later must not launder it to exact.
    const requoted = await logQuickAdd(db, savedFood!, '2026-08-21');
    expect(requoted.confidence).toBe('low');
  });

  it('an exact (default) manual entry saved to my foods keeps exact', async () => {
    const db = await freshDb();
    const { savedFood } = await logManualEntry(db, {
      date: '2026-08-20',
      name: 'Hand-typed macros',
      grams: 100,
      kcal: 200,
      protein_g: 20,
      carbs_g: 10,
      fat_g: 5,
      saveToMyFoods: true,
    });

    expect(savedFood?.confidence).toBe('exact');
  });
});
