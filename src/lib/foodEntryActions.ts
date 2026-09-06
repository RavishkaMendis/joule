// ═══════════════════════════════════════════════════════════════════════
// FOOD ENTRY ACTIONS — thin, testable orchestration over foodRepo.
//
// Kept out of components so the "what happens when you tap a quick-add
// chip" / "what happens when you save a manual entry" logic is plain,
// Node-testable functions rather than buried in a component's onPress.
// This is also where the PRD §9.1 10-second test is enforced structurally:
// `logQuickAdd` is a single call, no confirmation step, one tap in the UI.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../db/database';
import type { FoodEntryRow, SavedFoodRow } from '../db/types';
import * as foodRepo from '../db/repositories/foodRepo';
import { generateId } from './ids';

/**
 * Quick-add's default confidence for a saved_food row that predates
 * schema v3 (saved_food.confidence is NULL) — see that column's doc in
 * src/db/types.ts. `exact` is wrong: we have no record the underlying
 * numbers came from a barcode/label scan, only that the user saved them
 * at some point in the past, possibly from a low-confidence photo/voice
 * estimate (PRD §10: "A ±15% photo estimate must not look identical to a
 * barcode scan" — silently promoting an old save to `exact` is exactly
 * that violation). `high` is chosen instead: the user deliberately saved
 * this food and is now deliberately re-selecting it from their own
 * library, which is a real, repeated assertion — the same reasoning
 * PRD §7.4 already applies to a stated quantity on a quick-add oil/ghee
 * preset (pendingEntry.ts's `pendingEntryFromQuickAdd`, also `high`, never
 * `exact`). `exact` stays reserved for barcode/label-panel reads, which
 * this is not.
 */
export const LEGACY_SAVED_FOOD_CONFIDENCE: FoodEntryRow['confidence'] = 'high';

/**
 * Log a quick-add chip / saved-food tap: one call, no dialog. Scales the
 * saved food's per-100g macros by its stored `default_grams`, writes a
 * food_entry with source 'manual' (it's a manually-curated saved food, not
 * an AI/barcode read) and confidence carried over from the saved_food row
 * itself (schema v3) — not hardcoded 'exact', since the food may have been
 * saved from a `low`/`medium` photo or voice estimate (PRD §10: "Confidence
 * always visible"). A saved_food row from before this column existed has
 * `confidence: null`; see LEGACY_SAVED_FOOD_CONFIDENCE for the documented
 * default applied in that case. Bumps use_count/last_used so quick-add
 * ranking keeps adapting. Defaults to logging against today, but the date
 * is threaded through explicitly (PRD §10: everything editable forever) so
 * a caller editing a past day can reuse this.
 */
export async function logQuickAdd(
  db: Database,
  savedFood: SavedFoodRow,
  date: string,
  loggedAt: number = Date.now()
): Promise<FoodEntryRow> {
  const grams = savedFood.default_grams;
  const scale = grams / 100;

  const entry = await foodRepo.addEntry(db, {
    id: generateId('entry'),
    date,
    logged_at: loggedAt,
    name: savedFood.name,
    grams,
    kcal: savedFood.kcal_per_100g * scale,
    protein_g: savedFood.protein_per_100g * scale,
    carbs_g: savedFood.carbs_per_100g * scale,
    fat_g: savedFood.fat_per_100g * scale,
    source: 'manual',
    confidence: savedFood.confidence ?? LEGACY_SAVED_FOOD_CONFIDENCE,
  });

  await foodRepo.incrementUse(db, savedFood.id, loggedAt);

  return entry;
}

export type ManualEntryInput = {
  date: string;
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Confidence is a plain-text estimate typed in by the user unless stated otherwise. */
  confidence?: FoodEntryRow['confidence'];
  /**
   * Defaults to 'manual'. FoodEntryScreen passes 'afcd' or 'barcode' when
   * the entry originated from a search-cascade hit (PRD §10: "Confidence
   * always visible" — an AFCD/OFF-sourced entry should keep the source
   * icon that reflects where its numbers actually came from, not be
   * silently relabelled 'manual' just because it went through the same
   * free-text form as a hand-typed entry).
   */
  source?: FoodEntryRow['source'];
  saveToMyFoods?: boolean;
};

/**
 * Free-text manual entry (PRD §9.1 "manual food entry"). Optionally saves
 * the food to `saved_food` so the personal library grows and it becomes a
 * future quick-add candidate — the per-100g macros stored are derived from
 * whatever grams/macros the user entered this time.
 */
export async function logManualEntry(
  db: Database,
  input: ManualEntryInput,
  loggedAt: number = Date.now()
): Promise<{ entry: FoodEntryRow; savedFood: SavedFoodRow | null }> {
  const entry = await foodRepo.addEntry(db, {
    id: generateId('entry'),
    date: input.date,
    logged_at: loggedAt,
    name: input.name,
    grams: input.grams,
    kcal: input.kcal,
    protein_g: input.protein_g,
    carbs_g: input.carbs_g,
    fat_g: input.fat_g,
    source: input.source ?? 'manual',
    confidence: input.confidence ?? 'exact',
  });

  let savedFood: SavedFoodRow | null = null;
  if (input.saveToMyFoods && input.grams > 0) {
    const scale = 100 / input.grams;
    savedFood = await foodRepo.addSavedFood(db, {
      id: generateId('food'),
      name: input.name,
      kcal_per_100g: input.kcal * scale,
      protein_per_100g: input.protein_g * scale,
      carbs_per_100g: input.carbs_g * scale,
      fat_per_100g: input.fat_g * scale,
      default_grams: input.grams,
      // The originating entry's own confidence, not hardcoded 'exact' —
      // see saved_food.confidence's doc (src/db/types.ts) and
      // logQuickAdd's doc above for why this matters (PRD §10).
      confidence: entry.confidence,
    });
  }

  return { entry, savedFood };
}

export type ManualEntryEditInput = Partial<ManualEntryInput>;

/** Edit an existing entry — works identically for today or any past day (PRD §10). */
export async function editFoodEntry(
  db: Database,
  id: string,
  patch: ManualEntryEditInput
): Promise<FoodEntryRow> {
  return foodRepo.updateEntry(db, id, {
    date: patch.date,
    name: patch.name,
    grams: patch.grams,
    kcal: patch.kcal,
    protein_g: patch.protein_g,
    carbs_g: patch.carbs_g,
    fat_g: patch.fat_g,
  });
}

export async function deleteFoodEntry(db: Database, id: string): Promise<void> {
  await foodRepo.deleteEntry(db, id);
}
