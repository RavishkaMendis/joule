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
import {
  logQuickAdd,
  logManualEntry,
  LEGACY_SAVED_FOOD_CONFIDENCE,
  pendingEntryFromSavedFood,
  recordSavedFoodUse,
} from '../foodEntryActions';
import { scaleFromPer100g } from '../pendingEntry';
import type { SavedFoodRow } from '../../db/types';

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

// ═══════════════════════════════════════════════════════════════════════
// FoodsScreen "Saved foods" tab — tap-to-log path (task brief: "how to
// add saved food to my current day? He can't."). `pendingEntryFromSavedFood`
// feeds the shared ConfirmSheet; ConfirmSheet itself does the eventual
// foodRepo.addEntry write (its own header explains why — this component
// is off-limits to edit for this task), so the "full flow" test below
// writes the entry via the exact same foodRepo.addEntry shape ConfirmSheet
// uses, scaled from `pendingEntryFromSavedFood`'s `per100g`, rather than
// re-implementing a parallel write path.
// ═══════════════════════════════════════════════════════════════════════

function makeSavedFood(overrides: Partial<SavedFoodRow> = {}): SavedFoodRow {
  return {
    id: 'sf-default',
    name: 'Chicken breast',
    barcode: null,
    kcal_per_100g: 165,
    protein_per_100g: 31,
    carbs_per_100g: 0,
    fat_per_100g: 3.6,
    default_grams: 100,
    use_count: 0,
    last_used: null,
    confidence: 'high',
    ...overrides,
  };
}

describe('pendingEntryFromSavedFood', () => {
  it('builds a PendingEntry at default_grams with per100g/confidence/source carried from the saved food', () => {
    const food = makeSavedFood({
      id: 'sf1',
      name: 'Rice, cooked',
      kcal_per_100g: 200,
      protein_per_100g: 4,
      carbs_per_100g: 44,
      fat_per_100g: 0.4,
      default_grams: 150,
      confidence: 'medium',
    });

    const entry = pendingEntryFromSavedFood(food);

    expect(entry.name).toBe('Rice, cooked');
    expect(entry.grams).toBe(150);
    // 150g of a 200 kcal/100g food = 300 kcal, scaled identically for every macro.
    expect(entry.kcal).toBeCloseTo(300);
    expect(entry.protein_g).toBeCloseTo(6);
    expect(entry.carbs_g).toBeCloseTo(66);
    expect(entry.fat_g).toBeCloseTo(0.6);
    expect(entry.confidence).toBe('medium');
    expect(entry.source).toBe('manual');
    expect(entry.per100g).toEqual({ kcal: 200, protein_g: 4, carbs_g: 44, fat_g: 0.4 });
  });

  it('falls back to LEGACY_SAVED_FOOD_CONFIDENCE for a pre-v3 (confidence NULL) row — never hardcodes exact', () => {
    const food = makeSavedFood({ confidence: null });
    const entry = pendingEntryFromSavedFood(food);
    expect(entry.confidence).toBe(LEGACY_SAVED_FOOD_CONFIDENCE);
    expect(entry.confidence).not.toBe('exact');
  });

  it('carries a low-confidence saved food through unchanged (never promoted just for being tapped)', () => {
    const food = makeSavedFood({ confidence: 'low' });
    const entry = pendingEntryFromSavedFood(food);
    expect(entry.confidence).toBe('low');
  });

  it('a gram amount different from default_grams scales macros correctly via scaleFromPer100g — the exact mechanism ConfirmSheet uses when the user edits grams', () => {
    const food = makeSavedFood({
      kcal_per_100g: 200,
      protein_per_100g: 20,
      carbs_per_100g: 10,
      fat_per_100g: 4,
      default_grams: 100,
    });
    const entry = pendingEntryFromSavedFood(food);

    // A 50g portion of a 200 kcal/100g food is 100 kcal — asserted as a
    // real number, not just "less than the 100g figure".
    const scaled = scaleFromPer100g(entry.per100g!, 50);
    expect(scaled.kcal).toBe(100);
    expect(scaled.protein_g).toBe(10);
    expect(scaled.carbs_g).toBe(5);
    expect(scaled.fat_g).toBe(2);
  });
});

describe('saved-food-tap full flow — writes food_entry on the selected date, scaled to the chosen grams, with confidence carried from saved_food, and bumps use_count', () => {
  it('logs against the date passed in, not always today, with correctly scaled macros and confidence', async () => {
    const db = await freshDb();
    const saved = await foodRepo.addSavedFood(db, {
      id: 'sf-tap',
      name: 'Chicken breast',
      kcal_per_100g: 165,
      protein_per_100g: 31,
      carbs_per_100g: 0,
      fat_per_100g: 3.6,
      default_grams: 100,
      confidence: 'high',
    });
    expect(saved.use_count).toBe(0);

    const pending = pendingEntryFromSavedFood(saved);
    // Simulate the user adjusting grams in ConfirmSheet before confirming
    // (task brief #2 — grams must be adjustable, not committed blindly).
    const chosenGrams = 150;
    const scaled = scaleFromPer100g(pending.per100g!, chosenGrams);

    // A date that is deliberately NOT "today" — proving nothing in this
    // path silently substitutes today's date regardless of what's passed.
    const selectedDate = '2026-08-15';

    // Mirrors exactly the foodRepo.addEntry shape/fields ConfirmSheet's own
    // handleConfirm uses for a row (see ConfirmSheet.tsx) — not a parallel
    // write path, the same call with pendingEntryFromSavedFood's output.
    const entry = await foodRepo.addEntry(db, {
      id: 'entry-tap',
      date: selectedDate,
      logged_at: Date.now(),
      name: pending.name,
      grams: chosenGrams,
      kcal: scaled.kcal,
      protein_g: scaled.protein_g,
      carbs_g: scaled.carbs_g,
      fat_g: scaled.fat_g,
      source: pending.source,
      confidence: pending.confidence,
    });

    // This is the part FoodsScreen's confirm handler does that ConfirmSheet
    // cannot (it has no notion the PendingEntry came from a saved_food row).
    await recordSavedFoodUse(db, saved.id);

    expect(entry.date).toBe(selectedDate);
    expect(entry.grams).toBe(150);
    // 150g of 165 kcal/100g chicken = 247.5 kcal.
    expect(entry.kcal).toBeCloseTo(247.5);
    expect(entry.protein_g).toBeCloseTo(46.5);
    expect(entry.carbs_g).toBe(0);
    expect(entry.fat_g).toBeCloseTo(5.4);
    expect(entry.source).toBe('manual');
    // Confidence came from the saved food, not a hardcoded literal.
    expect(entry.confidence).toBe('high');

    const refreshed = await foodRepo.getSavedFood(db, saved.id);
    expect(refreshed?.use_count).toBe(1);
    expect(refreshed?.last_used).not.toBeNull();
  });

  it('carries a low-confidence saved food through the full flow unchanged, still bumping use_count', async () => {
    const db = await freshDb();
    const saved = await foodRepo.addSavedFood(db, {
      id: 'sf-tap-low',
      name: 'Leftover curry (photo estimate)',
      kcal_per_100g: 180,
      protein_per_100g: 8,
      carbs_per_100g: 20,
      fat_per_100g: 7,
      default_grams: 350,
      confidence: 'low',
    });

    const pending = pendingEntryFromSavedFood(saved);
    const entry = await foodRepo.addEntry(db, {
      id: 'entry-tap-low',
      date: '2026-08-16',
      logged_at: Date.now(),
      name: pending.name,
      grams: pending.grams,
      kcal: pending.kcal,
      protein_g: pending.protein_g,
      carbs_g: pending.carbs_g,
      fat_g: pending.fat_g,
      source: pending.source,
      confidence: pending.confidence,
    });
    await recordSavedFoodUse(db, saved.id);

    expect(entry.confidence).toBe('low');
    expect(entry.confidence).not.toBe('exact');

    const refreshed = await foodRepo.getSavedFood(db, saved.id);
    expect(refreshed?.use_count).toBe(1);
  });
});
