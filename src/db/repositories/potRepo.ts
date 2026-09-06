// ═══════════════════════════════════════════════════════════════════════
// potRepo — `pot` batch-cooking logging (PRD §3, §7.5).
//
// Phase 3 builds the UI; this repo exists now because the schema is
// already here and the logic is cheap. Kept intentionally simple:
//  - createPot derives kcal_per_g etc. from total ingredient macros over
//    the finished cooked weight (PRD §7.5: "App computes kcal_per_g for
//    the batch"). Raw vs cooked weight is the caller's problem to get
//    right (PRD §7.5 warns default ingredient entry is raw weight) — this
//    repo just takes whatever `total_weight_g` (cooked) and ingredient
//    totals it's given.
//  - logServing decrements remaining_g and writes a food_entry with
//    source = 'pot', then triggers intakeRepo.recomputeDay like any other
//    food_entry mutation. Auto-archives (`is_active = 0`) once
//    remaining_g reaches (or would go below) zero.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { PotRow, FoodEntryRow, PotContainerRow, EntryConfidence } from '../types';
import * as intakeRepo from './intakeRepo';

export type PotIngredient = {
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /**
   * Per-ingredient confidence (task brief "per-ingredient barcode
   * upgrade"): 'exact' for a scanned barcode/label panel, whatever the
   * photo/search source reported otherwise (typically 'low'/'medium' for
   * a Gemini visual guess, 'exact' for a saved-food/AFCD/OFF hit, 'exact'
   * for a directly-typed manual row — see potActions.ts's
   * `pendingEntryToDraftParam` for where each value comes from).
   *
   * Optional/absent for every ingredient created before this field
   * existed — see potActions.ts's `computePotConfidenceSummary` for how
   * a missing value is treated (never silently counted as 'exact').
   */
  confidence?: EntryConfidence;
  /**
   * Per-100g basis this ingredient's macros were derived from, when one
   * is known — a photo/barcode/search/OFF hit's own `PendingEntry.per100g`
   * (see potActions.ts's `pendingEntryToPotIngredient`), or one
   * synthesized from a directly-typed row's grams+macros the moment it's
   * edited (see potActions.ts's `synthesizeIngredientBasis`: "700g of
   * potato worth X kcal" implies X/7 kcal/100g just as validly as a
   * scanned panel does).
   *
   * This is the fix for the bug where editing an ingredient's grams
   * changed the gram figure but never the calories/macros: without a
   * retained basis there was nothing to rescale FROM, only a number to
   * overwrite. `PotCreateScreen`'s grams/macro TextInput handlers now go
   * through `potActions.ts`'s `applyIngredientGramsEdit`/
   * `applyIngredientMacroEdit` (built on `scaleFromPer100g` — the same
   * function ConfirmSheet uses, never a second scaling path) to keep
   * grams and macros in sync.
   *
   * Purely additive — `pot.ingredients` is a JSON blob column
   * (schema.ts), so adding this field needs no migration. A pot created
   * before this field existed simply parses back with `per100g:
   * undefined` on every ingredient; `applyIngredientGramsEdit` degrades
   * that honestly by synthesizing a basis from the row's current numbers
   * the first time it's edited (when they're already complete), rather
   * than refusing to rescale or silently leaving a stale number — and
   * leaves the row as plain editable text, with no auto-scale attempted,
   * when there isn't yet a complete set of numbers to derive one from.
   */
  per100g?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
};

export type NewPot = {
  id: string;
  name: string;
  created_at: number;
  /**
   * Weight of the finished cooked batch, in grams — or `null` to create
   * the pot from ingredients alone (task brief #1: cooked weight is only
   * needed to VALUE a serving, `kcal_per_g` = total kcal / cooked weight;
   * the batch's total kcal/macros are already fully known from the
   * ingredients, with nothing to divide by). `setPotCookedWeight`/
   * `updatePot` below fill it in later — "at first serve" (when the user
   * is already holding a scale) or any time from the pot.
   */
  total_weight_g: number | null;
  ingredients: PotIngredient[];
};

type IngredientTotals = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };

function sumIngredients(ingredients: PotIngredient[]): IngredientTotals {
  return ingredients.reduce(
    (acc, i) => ({
      kcal: acc.kcal + i.kcal,
      protein_g: acc.protein_g + i.protein_g,
      carbs_g: acc.carbs_g + i.carbs_g,
      fat_g: acc.fat_g + i.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

/** Per-gram macros from ingredient totals over a (known, positive) cooked weight — the one division this whole feature hinges on, so it lives in exactly one place shared by `createPot` and `updatePot`. */
function derivePerGram(totals: IngredientTotals, totalWeightG: number) {
  return {
    kcal_per_g: totals.kcal / totalWeightG,
    protein_per_g: totals.protein_g / totalWeightG,
    carbs_per_g: totals.carbs_g / totalWeightG,
    fat_per_g: totals.fat_g / totalWeightG,
  };
}

/** Create a pot, computing per-gram macros from total ingredients / cooked weight — or leaving them `null` when `total_weight_g` is omitted (see `NewPot.total_weight_g`'s doc). */
export async function createPot(db: Database, pot: NewPot): Promise<PotRow> {
  const totalWeightG = pot.total_weight_g;
  if (totalWeightG !== null && !(totalWeightG > 0)) {
    throw new Error('createPot: total_weight_g (cooked weight), when given, must be > 0');
  }

  const totals = sumIngredients(pot.ingredients);
  const derived = totalWeightG !== null ? derivePerGram(totals, totalWeightG) : null;

  await db.runAsync(
    `INSERT INTO pot
       (id, name, created_at, total_weight_g, remaining_g, kcal_per_g, protein_per_g, carbs_per_g, fat_per_g, ingredients, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      pot.id,
      pot.name,
      pot.created_at,
      totalWeightG,
      // remaining_g starts equal to the cooked weight (nothing served
      // yet) — null exactly when the cooked weight itself is unknown, per
      // PotRow.remaining_g's own doc.
      totalWeightG,
      derived?.kcal_per_g ?? null,
      derived?.protein_per_g ?? null,
      derived?.carbs_per_g ?? null,
      derived?.fat_per_g ?? null,
      JSON.stringify(pot.ingredients),
    ]
  );

  const row = await getPot(db, pot.id);
  if (!row) throw new Error(`createPot: failed to read back pot ${pot.id}`);
  return row;
}

export type PotUpdate = {
  id: string;
  name: string;
  ingredients: PotIngredient[];
  /** New cooked weight, or `null` to leave it unset (still no way to value a serving). */
  total_weight_g: number | null;
};

/**
 * Edits an existing pot's name/ingredients/cooked weight (task brief
 * "Pots edit — fix it": there was previously no way to fix a wrong
 * ingredient short of recreating the whole batch). Recomputes
 * `kcal_per_g` etc. from the CURRENT ingredients + cooked weight via the
 * exact same `derivePerGram` `createPot` uses — never a second formula.
 *
 * Deliberately touches ONLY this `pot` row. Every already-logged
 * `food_entry` (source='pot') row is untouched — those record what was
 * logged AT THE TIME, per PRD §10's "everything editable forever"
 * applying to the pot, not to history rewriting the log. Only a serving
 * logged AFTER this edit sees the new `kcal_per_g` (the caller is
 * responsible for saying so in the UI — see PotCreateScreen's edit-mode
 * notice).
 *
 * `remaining_g` semantics when the cooked weight changes (task brief's
 * explicit question): the amount ALREADY SERVED is treated as ground
 * truth and preserved, not the remaining fraction. `servedSoFar =
 * oldTotalWeightG - oldRemainingG` (0 when the pot had no cooked weight
 * yet — nothing could have been served without one; `logServing` refuses
 * to run against a pot with a null `kcal_per_g`). The new `remaining_g` is
 * `newTotalWeightG - servedSoFar`, clamped to `[0, newTotalWeightG]`.
 * Shrinking the cooked weight below what's already been served clamps to
 * 0 (re-archiving the pot) rather than going negative; raising it past a
 * previously-fully-served pot's total un-archives it.
 */
export async function updatePot(db: Database, update: PotUpdate): Promise<PotRow> {
  const existing = await getPot(db, update.id);
  if (!existing) throw new Error(`updatePot: no pot with id ${update.id}`);

  const newTotalWeightG = update.total_weight_g;
  if (newTotalWeightG !== null && !(newTotalWeightG > 0)) {
    throw new Error('updatePot: total_weight_g, when given, must be > 0');
  }

  const totals = sumIngredients(update.ingredients);
  const derived = newTotalWeightG !== null ? derivePerGram(totals, newTotalWeightG) : null;

  const servedSoFar =
    existing.total_weight_g !== null && existing.remaining_g !== null
      ? Math.max(0, existing.total_weight_g - existing.remaining_g)
      : 0;

  const newRemaining = newTotalWeightG === null ? null : Math.min(newTotalWeightG, Math.max(0, newTotalWeightG - servedSoFar));

  const isActive = newRemaining === null || newRemaining > 0 ? 1 : 0;

  await db.runAsync(
    `UPDATE pot
        SET name = ?, total_weight_g = ?, remaining_g = ?, kcal_per_g = ?, protein_per_g = ?, carbs_per_g = ?, fat_per_g = ?, ingredients = ?, is_active = ?
      WHERE id = ?`,
    [
      update.name,
      newTotalWeightG,
      newRemaining,
      derived?.kcal_per_g ?? null,
      derived?.protein_per_g ?? null,
      derived?.carbs_per_g ?? null,
      derived?.fat_per_g ?? null,
      JSON.stringify(update.ingredients),
      isActive,
      update.id,
    ]
  );

  const row = await getPot(db, update.id);
  if (!row) throw new Error(`updatePot: failed to read back pot ${update.id}`);
  return row;
}

export async function getPot(db: Database, id: string): Promise<PotRow | null> {
  return db.getFirstAsync<PotRow>('SELECT * FROM pot WHERE id = ?', [id]);
}

export async function getActivePots(db: Database): Promise<PotRow[]> {
  return db.getAllAsync<PotRow>('SELECT * FROM pot WHERE is_active = 1 ORDER BY created_at DESC');
}

export async function getAllPots(db: Database): Promise<PotRow[]> {
  return db.getAllAsync<PotRow>('SELECT * FROM pot ORDER BY created_at DESC');
}

/**
 * Log a serving: weigh the bowl, enter grams, done (PRD §7.5's "2 taps").
 * Decrements remaining_g, writes a food_entry with source='pot', and
 * auto-archives the pot when remaining_g hits zero (or would go
 * negative — servings are clamped to what's left).
 *
 * `args.grams` is ALWAYS the net (food-only) weight — any tare/container
 * subtraction has already happened by the time this is called (see
 * src/lib/potActions.ts's `computeNetServingGrams`, the one place that
 * arithmetic lives). `args.tareG` is pure bookkeeping recorded alongside
 * the entry (schema v6, food_entry.tare_g — see schema.ts's v6 header for
 * the NULL/0/>0 semantics); it is never applied to `grams` again here.
 *
 * Confidence is `'high'`, not `'exact'`: a scale reading against a
 * computed kcal_per_g is genuinely trustworthy — materially better than a
 * photo estimate — but the pot's own kcal_per_g inherits whatever
 * uncertainty its ingredients were entered with (typed macros, an AI
 * photo-identified ingredient, a barcode scan…). `exact` stays reserved
 * for a scanned nutrition panel read directly off a package, which this
 * is one derivation step removed from.
 *
 * Throws (rather than a typed result) when the pot has no cooked weight
 * yet — `pot.kcal_per_g`/`remaining_g` are `null` (task brief #1: a pot
 * may be created from ingredients alone). This is treated the same as
 * "archived pot"/"grams <= 0": an invariant the UI is responsible for
 * never reaching, because `potActions.logPotServing` already checks
 * `total_weight_g` up front and returns a typed `needs_cooked_weight`
 * result before ever calling this — see that function's own doc. Kept
 * here too as a defensive backstop (and because TypeScript needs it to
 * narrow the four now-nullable per-gram fields below).
 */
export async function logServing(
  db: Database,
  args: { potId: string; grams: number; entryId: string; date: string; loggedAt: number; tareG?: number | null }
): Promise<{ entry: FoodEntryRow; pot: PotRow }> {
  const pot = await getPot(db, args.potId);
  if (!pot) throw new Error(`logServing: no pot with id ${args.potId}`);
  if (!pot.is_active) throw new Error(`logServing: pot ${args.potId} is archived`);
  if (args.grams <= 0) throw new Error('logServing: grams must be > 0');
  if (
    pot.remaining_g === null ||
    pot.kcal_per_g === null ||
    pot.protein_per_g === null ||
    pot.carbs_per_g === null ||
    pot.fat_per_g === null
  ) {
    throw new Error(`logServing: pot ${args.potId} has no cooked weight yet — set one before logging a serving`);
  }

  const servedGrams = Math.min(args.grams, pot.remaining_g);
  const newRemaining = Math.max(0, pot.remaining_g - servedGrams);
  const tareG = args.tareG ?? null;

  await db.runAsync('UPDATE pot SET remaining_g = ?, is_active = ? WHERE id = ?', [
    newRemaining,
    newRemaining > 0 ? 1 : 0,
    args.potId,
  ]);

  await db.runAsync(
    `INSERT INTO food_entry
       (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input, tare_g)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pot', 'high', ?, NULL, ?)`,
    [
      args.entryId,
      args.date,
      args.loggedAt,
      pot.name,
      servedGrams,
      servedGrams * pot.kcal_per_g,
      servedGrams * pot.protein_per_g,
      servedGrams * pot.carbs_per_g,
      servedGrams * pot.fat_per_g,
      args.potId,
      tareG,
    ]
  );

  await intakeRepo.recomputeDay(db, args.date);

  const entry = await db.getFirstAsync<FoodEntryRow>('SELECT * FROM food_entry WHERE id = ?', [args.entryId]);
  const updatedPot = await getPot(db, args.potId);
  if (!entry || !updatedPot) throw new Error('logServing: failed to read back entry/pot after write');

  return { entry, pot: updatedPot };
}

export async function archivePot(db: Database, id: string): Promise<void> {
  await db.runAsync('UPDATE pot SET is_active = 0 WHERE id = ?', [id]);
}

// ─────────────────────────────────────────────────────────────────────────
// POT CONTAINERS (schema v6) — saved tare weights for one-tap reuse at
// serving time. PRD-driven (task brief, the user's own words): "sometimes
// with the plate weight and sometimes without" — this is the "remember
// commonly used container weights" half of that fix; the actual
// gross-minus-tare arithmetic lives in src/lib/potActions.ts, pure and
// unit-tested, so it stays in exactly one place.
// ─────────────────────────────────────────────────────────────────────────

export async function saveContainer(
  db: Database,
  container: { id: string; name: string; tareG: number }
): Promise<PotContainerRow> {
  if (!(container.tareG >= 0)) {
    throw new Error('saveContainer: tareG must be >= 0');
  }
  await db.runAsync(
    `INSERT INTO pot_container (id, name, tare_g, use_count, last_used) VALUES (?, ?, ?, 0, NULL)`,
    [container.id, container.name, container.tareG]
  );
  const row = await db.getFirstAsync<PotContainerRow>('SELECT * FROM pot_container WHERE id = ?', [container.id]);
  if (!row) throw new Error(`saveContainer: failed to read back container ${container.id}`);
  return row;
}

/** Frequency-ranked saved containers (most-used first) — same ranking shape as foodRepo's quick-add candidates. */
export async function getContainers(db: Database): Promise<PotContainerRow[]> {
  return db.getAllAsync<PotContainerRow>('SELECT * FROM pot_container ORDER BY use_count DESC, last_used DESC');
}

/** Bump use_count/last_used — call whenever a saved container is actually used to log a serving. */
export async function touchContainer(db: Database, id: string, usedAtMs: number = Date.now()): Promise<void> {
  await db.runAsync('UPDATE pot_container SET use_count = use_count + 1, last_used = ? WHERE id = ?', [usedAtMs, id]);
}

export async function deleteContainer(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM pot_container WHERE id = ?', [id]);
}

/**
 * Renames a saved container (task brief "Container rename/delete UI" —
 * `deleteContainer` above already existed; this is the missing other
 * half). Leaves `tare_g`/`use_count`/`last_used` untouched — a rename is
 * purely cosmetic, never a reason to reset a container's usage ranking.
 */
export async function renameContainer(db: Database, id: string, name: string): Promise<void> {
  await db.runAsync('UPDATE pot_container SET name = ? WHERE id = ?', [name, id]);
}
