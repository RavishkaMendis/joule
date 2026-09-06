// ═══════════════════════════════════════════════════════════════════════
// foodRepo — CRUD on `food_entry` and `saved_food` (PRD §3, §9.1, §9.4).
//
// Every food_entry mutation (add/update/delete) triggers
// intakeRepo.recomputeDay for the affected date so day_intake never
// drifts from its source rows. On update, if `date` itself changes, both
// the old and new dates are recomputed.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { FoodEntryRow, SavedFoodRow } from '../types';
import * as intakeRepo from './intakeRepo';

export type NewFoodEntry = {
  id: string;
  date: string;
  logged_at: number;
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  source: FoodEntryRow['source'];
  confidence: FoodEntryRow['confidence'];
  pot_id?: string | null;
  raw_input?: string | null;
  /** Schema v2, all additive/optional — every existing caller keeps compiling and keeps writing NULL here. */
  meal_type?: FoodEntryRow['meal_type'];
  meal_group_id?: string | null;
  meal_name?: string | null;
};

export async function addEntry(db: Database, entry: NewFoodEntry): Promise<FoodEntryRow> {
  await db.runAsync(
    `INSERT INTO food_entry
       (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input, meal_type, meal_group_id, meal_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.date,
      entry.logged_at,
      entry.name,
      entry.grams,
      entry.kcal,
      entry.protein_g,
      entry.carbs_g,
      entry.fat_g,
      entry.source,
      entry.confidence,
      entry.pot_id ?? null,
      entry.raw_input ?? null,
      entry.meal_type ?? null,
      entry.meal_group_id ?? null,
      entry.meal_name ?? null,
    ]
  );

  await intakeRepo.recomputeDay(db, entry.date);

  const row = await getEntry(db, entry.id);
  if (!row) throw new Error(`addEntry: failed to read back food_entry ${entry.id}`);
  return row;
}

export async function getEntry(db: Database, id: string): Promise<FoodEntryRow | null> {
  return db.getFirstAsync<FoodEntryRow>('SELECT * FROM food_entry WHERE id = ?', [id]);
}

export async function getEntriesForDate(db: Database, date: string): Promise<FoodEntryRow[]> {
  return db.getAllAsync<FoodEntryRow>('SELECT * FROM food_entry WHERE date = ? ORDER BY logged_at ASC', [date]);
}

export async function getEntriesInRange(db: Database, startDate: string, endDate: string): Promise<FoodEntryRow[]> {
  return db.getAllAsync<FoodEntryRow>(
    'SELECT * FROM food_entry WHERE date >= ? AND date <= ? ORDER BY date ASC, logged_at ASC',
    [startDate, endDate]
  );
}

/**
 * Partial update. If `date` is included in `patch` and differs from the
 * entry's current date, both the old and new day's rollups are
 * recomputed — this is the "editing a 3-week-old entry" case from PRD
 * §10 in its most awkward form (moving an entry between two different
 * past days).
 */
export async function updateEntry(
  db: Database,
  id: string,
  patch: Partial<Omit<NewFoodEntry, 'id'>>
): Promise<FoodEntryRow> {
  const existing = await getEntry(db, id);
  if (!existing) throw new Error(`updateEntry: no food_entry with id ${id}`);

  const merged: FoodEntryRow = {
    ...existing,
    ...patch,
    pot_id: patch.pot_id !== undefined ? patch.pot_id : existing.pot_id,
    raw_input: patch.raw_input !== undefined ? patch.raw_input : existing.raw_input,
    meal_type: patch.meal_type !== undefined ? patch.meal_type : existing.meal_type,
    meal_group_id: patch.meal_group_id !== undefined ? patch.meal_group_id : existing.meal_group_id,
    meal_name: patch.meal_name !== undefined ? patch.meal_name : existing.meal_name,
  };

  await db.runAsync(
    `UPDATE food_entry SET
       date = ?, logged_at = ?, name = ?, grams = ?, kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?,
       source = ?, confidence = ?, pot_id = ?, raw_input = ?, meal_type = ?, meal_group_id = ?, meal_name = ?
     WHERE id = ?`,
    [
      merged.date,
      merged.logged_at,
      merged.name,
      merged.grams,
      merged.kcal,
      merged.protein_g,
      merged.carbs_g,
      merged.fat_g,
      merged.source,
      merged.confidence,
      merged.pot_id,
      merged.raw_input,
      merged.meal_type,
      merged.meal_group_id,
      merged.meal_name,
      id,
    ]
  );

  await intakeRepo.recomputeDay(db, merged.date);
  if (merged.date !== existing.date) {
    await intakeRepo.recomputeDay(db, existing.date);
  }

  const row = await getEntry(db, id);
  if (!row) throw new Error(`updateEntry: failed to read back food_entry ${id}`);
  return row;
}

export async function deleteEntry(db: Database, id: string): Promise<void> {
  const existing = await getEntry(db, id);
  if (!existing) return;

  await db.runAsync('DELETE FROM food_entry WHERE id = ?', [id]);
  await intakeRepo.recomputeDay(db, existing.date);
}

// ─── meal grouping (schema v2) ──────────────────────────────────────────

/** All entries sharing a meal_group_id, in log order — the components of one collapsed Today row. */
export async function getEntriesByGroup(db: Database, mealGroupId: string): Promise<FoodEntryRow[]> {
  return db.getAllAsync<FoodEntryRow>(
    'SELECT * FROM food_entry WHERE meal_group_id = ? ORDER BY logged_at ASC',
    [mealGroupId]
  );
}

/**
 * Deletes every entry in a meal group, recomputing the rollup for every
 * distinct date touched (almost always one date, since a group is one
 * capture, but this stays correct even if entries were individually
 * moved to different days afterwards). Mirrors deleteEntry's contract:
 * safe to call for a group with zero remaining rows (no-op).
 */
export async function deleteGroup(db: Database, mealGroupId: string): Promise<void> {
  const members = await getEntriesByGroup(db, mealGroupId);
  if (members.length === 0) return;

  await db.runAsync('DELETE FROM food_entry WHERE meal_group_id = ?', [mealGroupId]);

  const affectedDates = new Set(members.map((m) => m.date));
  for (const date of affectedDates) {
    await intakeRepo.recomputeDay(db, date);
  }
}

// ─── saved_food ──────────────────────────────────────────────────────────

export type NewSavedFood = {
  id: string;
  name: string;
  barcode?: string | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  default_grams: number;
  /**
   * Schema v3, additive/optional — every existing caller keeps compiling
   * and keeps writing NULL here. Callers that DO know the originating
   * entry's confidence (ConfirmSheet.tsx, foodEntryActions.logManualEntry)
   * pass it through explicitly; see saved_food.confidence's doc in
   * src/db/types.ts for why NULL is not the same as `exact`.
   */
  confidence?: SavedFoodRow['confidence'];
};

export async function addSavedFood(db: Database, food: NewSavedFood): Promise<SavedFoodRow> {
  await db.runAsync(
    `INSERT INTO saved_food
       (id, name, barcode, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, default_grams, use_count, last_used, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    [
      food.id,
      food.name,
      food.barcode ?? null,
      food.kcal_per_100g,
      food.protein_per_100g,
      food.carbs_per_100g,
      food.fat_per_100g,
      food.default_grams,
      food.confidence ?? null,
    ]
  );
  const row = await getSavedFood(db, food.id);
  if (!row) throw new Error(`addSavedFood: failed to read back saved_food ${food.id}`);
  return row;
}

export async function getSavedFood(db: Database, id: string): Promise<SavedFoodRow | null> {
  return db.getFirstAsync<SavedFoodRow>('SELECT * FROM saved_food WHERE id = ?', [id]);
}

export async function updateSavedFood(
  db: Database,
  id: string,
  patch: Partial<Omit<NewSavedFood, 'id'>>
): Promise<SavedFoodRow> {
  const existing = await getSavedFood(db, id);
  if (!existing) throw new Error(`updateSavedFood: no saved_food with id ${id}`);

  const merged: SavedFoodRow = {
    ...existing,
    ...patch,
    barcode: patch.barcode !== undefined ? patch.barcode : existing.barcode,
  };

  await db.runAsync(
    `UPDATE saved_food SET
       name = ?, barcode = ?, kcal_per_100g = ?, protein_per_100g = ?, carbs_per_100g = ?, fat_per_100g = ?, default_grams = ?
     WHERE id = ?`,
    [
      merged.name,
      merged.barcode,
      merged.kcal_per_100g,
      merged.protein_per_100g,
      merged.carbs_per_100g,
      merged.fat_per_100g,
      merged.default_grams,
      id,
    ]
  );

  const row = await getSavedFood(db, id);
  if (!row) throw new Error(`updateSavedFood: failed to read back saved_food ${id}`);
  return row;
}

export async function deleteSavedFood(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM saved_food WHERE id = ?', [id]);
}

export async function searchSavedFood(db: Database, query: string): Promise<SavedFoodRow[]> {
  return db.getAllAsync<SavedFoodRow>(
    'SELECT * FROM saved_food WHERE name LIKE ? ORDER BY use_count DESC, last_used DESC',
    [`%${query}%`]
  );
}

/** Bump use_count and last_used — call whenever a saved_food is logged. */
export async function incrementUse(db: Database, id: string, usedAtMs: number = Date.now()): Promise<void> {
  await db.runAsync('UPDATE saved_food SET use_count = use_count + 1, last_used = ? WHERE id = ?', [usedAtMs, id]);
}

/**
 * Frequency-ranked candidates for the Today screen's quick-add chips
 * (PRD §9.1: "4-6 most frequent foods ... one tap each"). Ranked by
 * use_count desc, then most-recently-used first as a tiebreak — matches
 * the `idx_saved_food_frequency` index so this is index-only, no sort.
 */
export async function getQuickAddCandidates(db: Database, limit: number): Promise<SavedFoodRow[]> {
  return db.getAllAsync<SavedFoodRow>(
    'SELECT * FROM saved_food WHERE use_count > 0 ORDER BY use_count DESC, last_used DESC LIMIT ?',
    [limit]
  );
}
