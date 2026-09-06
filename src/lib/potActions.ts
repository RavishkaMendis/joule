// ═══════════════════════════════════════════════════════════════════════
// POT ACTIONS — thin, testable orchestration over potRepo (PRD §7.5, §9.4).
//
// Mirrors foodEntryActions.ts's pattern: keep ID generation and "what
// happens when you tap a pot" out of components. potRepo already
// implements the serving/decrement/auto-archive logic (task brief: "wire
// it up; do not reimplement") — these are just generateId + date
// plumbing on top.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../db/database';
import type { PotRow, FoodEntryRow, PotContainerRow, EntryConfidence } from '../db/types';
import * as potRepo from '../db/repositories/potRepo';
import { generateId } from './ids';
import { scaleFromPer100g, type PendingEntry, type QuickAddPreset } from './pendingEntry';
import type { PotIngredientDraftParam } from './navigation';
import type { CascadeMissReason, CascadeResult } from './foodSources/lookupCascade';
import { parseRequiredNumber } from './numericInput';

export type NewPotInput = {
  name: string;
  /**
   * Cooked/finished weight in grams — PRD §7.5 warns this must be
   * unmistakably the COOKED weight. `null` when creating a pot from
   * ingredients alone (task brief #1: "the total weight is not needed"
   * for the batch's total kcal — only for VALUING a serving —
   * `computePotConfidenceSummary`/`potIngredientTotals` below still
   * report the honest total). Set it later via `updatePot` — "at first
   * serve" (PotLogServingScreen) or any time from the pot
   * (PotCreateScreen's edit mode).
   */
  totalWeightG: number | null;
  ingredients: potRepo.PotIngredient[];
};

export async function createPot(db: Database, input: NewPotInput, createdAt: number = Date.now()): Promise<PotRow> {
  return potRepo.createPot(db, {
    id: generateId('pot'),
    name: input.name,
    created_at: createdAt,
    total_weight_g: input.totalWeightG,
    ingredients: input.ingredients,
  });
}

export type UpdatePotInput = {
  id: string;
  name: string;
  ingredients: potRepo.PotIngredient[];
  /** New cooked weight, or `null` to leave/set it unweighed. */
  totalWeightG: number | null;
};

/**
 * Edits an existing pot (task brief #4, "Pots edit — fix it"). Thin
 * passthrough to `potRepo.updatePot` — see that function's own doc for
 * the `kcal_per_g` recomputation, the "never rewrites an already-logged
 * food_entry row" guarantee, and the `remaining_g`-preservation semantics
 * when the cooked weight itself changes.
 */
export async function updatePot(db: Database, input: UpdatePotInput): Promise<PotRow> {
  return potRepo.updatePot(db, {
    id: input.id,
    name: input.name,
    ingredients: input.ingredients,
    total_weight_g: input.totalWeightG,
  });
}

/**
 * Sets (or corrects) just a pot's cooked weight, keeping its name and
 * ingredients exactly as they are — the "capture the cooked weight at
 * first serve" path (task brief #1): PotLogServingScreen calls this the
 * moment the user, already holding a scale, weighs the whole pot for the
 * first time, without sending them through the full edit screen for a
 * single number. Built on `updatePot` (never a second write path), so a
 * pot that already had servings logged against it keeps the exact same
 * `remaining_g`-preservation behavior as any other cooked-weight edit.
 */
export async function setPotCookedWeight(db: Database, potId: string, totalWeightG: number): Promise<PotRow> {
  const pot = await potRepo.getPot(db, potId);
  if (!pot) throw new Error(`setPotCookedWeight: no pot with id ${potId}`);
  return updatePot(db, { id: potId, name: pot.name, ingredients: parsePotIngredients(pot), totalWeightG });
}

/**
 * Converts a resolved PendingEntry (from a pot-ingredients photo, a
 * barcode scan, or an AFCD/saved-food search hit) into a `PotIngredient`
 * for `potRepo.createPot`. A PendingEntry's `grams`/`kcal`/`protein_g`/
 * `carbs_g`/`fat_g` are already absolute totals for whatever quantity was
 * resolved (scaled from `per100g` when one exists), which is exactly the
 * shape `PotIngredient` wants — this is a pure re-shaping, no unit math of
 * its own, so the kJ conversion and 0-900 plausibility rail already
 * applied upstream (mapToPendingEntry.ts, PRD §6) are never re-derived or
 * re-checked here.
 *
 * NOTE on current wiring: PotCreateScreen's three AI/lookup entry points
 * (photo, barcode, search) each go through this exact shape internally,
 * but hand the RESULT to the screen as plain text-field strings
 * (`PotIngredientDraftParam`) rather than calling this function directly —
 * every ingredient is user-EDITABLE text before it ever becomes a
 * `PotIngredient`, matching how the pre-existing manual-entry row already
 * worked and how ConfirmSheet treats every AI result as a draft, never a
 * silent write. This function stays exported and unit-tested (see
 * src/lib/__tests__/potActions.test.ts) as the documented pure mapping for
 * exactly this shape, for a caller that has a resolved PendingEntry and
 * genuinely wants the non-text-editable numeric conversion.
 *
 * `grams` on the resulting ingredient is whatever the source called it —
 * for a photo-of-raw-ingredients capture that is genuinely the RAW,
 * pre-cook weight (the prompt asks for it explicitly); for a barcode/
 * search hit it's however many grams of that packaged/generic ingredient
 * the user says went in. Either way it is reference-only (potRepo.createPot
 * only ever divides ingredient kcal/macro TOTALS by the separately-entered
 * COOKED batch weight — see that function's own doc), so this function
 * does not and must not attempt any raw-vs-cooked conversion itself.
 */
export function pendingEntryToPotIngredient(entry: PendingEntry): potRepo.PotIngredient {
  return {
    name: entry.name,
    grams: entry.grams,
    kcal: entry.kcal,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    fat_g: entry.fat_g,
    confidence: entry.confidence,
    // BUG FIX (task brief #1, "editing an ingredient's grams doesn't
    // rescale its macros"): this used to be dropped on the floor here,
    // which is the root cause — PotCreateScreen's grams-edit handler had
    // an absolute grams/kcal/macro snapshot to overwrite but nothing to
    // rescale FROM. Every source that populates `PendingEntry.per100g`
    // (photo, barcode, search/AFCD, OFF, the oil/ghee quick-add presets)
    // now survives the trip into a `PotIngredient` unchanged.
    per100g: entry.per100g,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DRAFT-ROW FORMATTING — the one "resolved numbers -> editable ingredient-
// row text" helper for every AI/lookup entry point (photo, barcode-add,
// search). Previously duplicated three times (once per screen, each with
// its own private `round1`); consolidated here so a future fifth digit-
// formatting bug has exactly one place to fix, not four.
// ─────────────────────────────────────────────────────────────────────────

/** Rounds to 1 decimal place and formats as a draft-field string (PotCreateScreen's ingredient rows are plain editable text inputs, never raw numbers). */
export function round1String(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * Converts a resolved `PendingEntry` (photo/barcode/search hit) into an
 * editable `PotIngredientDraftParam` row for PotCreateScreen — going
 * through `pendingEntryToPotIngredient` (the documented PendingEntry ->
 * PotIngredient shape) so every entry point produces textually identical
 * rows, then formatting each field with `round1String`. This is what
 * finally wires `pendingEntryToPotIngredient` into the photo/barcode/
 * search paths — it was previously exported and unit-tested but never
 * called by any screen (each one re-implemented an equivalent mapping
 * inline).
 */
export function pendingEntryToDraftParam(entry: PendingEntry): PotIngredientDraftParam {
  return potIngredientToDraftParam(pendingEntryToPotIngredient(entry), entry.confidence);
}

/**
 * Formats an already-resolved `PotIngredient` (e.g. the output of
 * `applyPanelToRow`/`resolveBarcodeUpgrade` below) as an editable
 * `PotIngredientDraftParam` row — the numeric half of
 * `pendingEntryToDraftParam`, split out so a caller that already has a
 * `PotIngredient` (rather than a full `PendingEntry`) doesn't need to
 * fabricate one just to reuse the formatting.
 */
export function potIngredientToDraftParam(ingredient: potRepo.PotIngredient, confidence: EntryConfidence): PotIngredientDraftParam {
  return {
    name: ingredient.name,
    gramsRaw: round1String(ingredient.grams),
    kcal: round1String(ingredient.kcal),
    protein_g: round1String(ingredient.protein_g),
    carbs_g: round1String(ingredient.carbs_g),
    fat_g: round1String(ingredient.fat_g),
    confidence,
    // Carried through so a later grams edit in PotCreateScreen has a basis
    // to rescale from — see the field's own doc in navigation.ts.
    per100g: ingredient.per100g,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PER-INGREDIENT BARCODE UPGRADE — the headline feature (task brief):
// "photo for coverage, barcode for precision, per ingredient row." Every
// ingredient row PotIngredientsPhotoScreen (or search/manual entry)
// produces gets its own "Scan barcode" action in PotCreateScreen. A hit
// replaces that row's macros with the scanned panel's per-100g basis
// scaled to the row's EXISTING raw grams (never re-asking for/overwriting
// grams — PRD §7.5's raw-vs-cooked rule) and raises confidence to the
// better of what the row already had and what the scan reported (never a
// silent downgrade). A miss returns a typed failure and the caller simply
// never applies it — the Gemini estimate and its original confidence are
// left completely alone, exactly like every other "never dead-end the
// user" miss in this app (PRD §7.2).
// ─────────────────────────────────────────────────────────────────────────

const CONFIDENCE_RANK: Record<EntryConfidence, number> = { low: 0, medium: 1, high: 2, exact: 3 };

/** The more-trusted of two confidences — never lets a scan downgrade a row that was already at least as trustworthy (e.g. re-scanning an already-'exact' row with a barcode whose OFF panel happens to be incomplete). */
export function maxConfidence(a: EntryConfidence, b: EntryConfidence): EntryConfidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b;
}

/** Resolves (or synthesizes) a per-100g basis for a PendingEntry that doesn't already carry one — mirrors the scaling every other per100g consumer in this app uses. */
function per100gOf(entry: PendingEntry): NonNullable<PendingEntry['per100g']> {
  if (entry.per100g) return entry.per100g;
  if (!entry.grams || entry.grams <= 0) {
    return { kcal: entry.kcal, protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g };
  }
  const scale = 100 / entry.grams;
  return {
    kcal: entry.kcal * scale,
    protein_g: entry.protein_g * scale,
    carbs_g: entry.carbs_g * scale,
    fat_g: entry.fat_g * scale,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// INGREDIENT-ROW GRAMS/MACRO RESCALING — the fix for BUG 1 ("I changed the
// potatoes from 700g to 800g and it never changed the calories"). Every
// PotCreateScreen ingredient row is a `PotIngredientDraftParam` (plain
// editable text fields), so the actual bug lived one level up from
// `scaleFromPer100g` itself: `pendingEntryToPotIngredient`/
// `potIngredientToDraftParam`/`applyPanelToRow` were all silently
// dropping the per-100g basis a scan/search/photo hit had already
// resolved, so by the time the user touched the grams field there was
// nothing left to rescale FROM — see the fixes to those three functions
// above. These two functions are what PotCreateScreen's TextInput
// handlers now call instead of a bare `updateIngredient(i, { gramsRaw })`
// patch.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Synthesizes a per-100g basis from an already-resolved grams+macros
 * combination — "700g of potato worth 650 kcal" implies ~92.9 kcal/100g
 * just as validly as a scanned nutrition panel does. Returns `null` when
 * `grams` isn't a usable positive number (nothing to derive a basis
 * from), never a divide-by-zero or a fabricated figure.
 *
 * This is the "legacy ingredient" degradation path (task brief): a row
 * that has no `per100g` yet — either a from-scratch manually-typed
 * ingredient, or (were a pot-editing screen ever added) a pot saved
 * before this field existed — gets an HONEST basis derived from its own
 * numbers the moment it's next a complete, valid row, rather than being
 * left to silently go stale or refusing to scale at all.
 */
export function synthesizeIngredientBasis(
  grams: number,
  macros: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
): NonNullable<potRepo.PotIngredient['per100g']> | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const scale = 100 / grams;
  return {
    kcal: macros.kcal * scale,
    protein_g: macros.protein_g * scale,
    carbs_g: macros.carbs_g * scale,
    fat_g: macros.fat_g * scale,
  };
}

function draftMacroFields(row: PotIngredientDraftParam) {
  return {
    grams: parseRequiredNumber(row.gramsRaw),
    kcal: parseRequiredNumber(row.kcal),
    protein_g: parseRequiredNumber(row.protein_g),
    carbs_g: parseRequiredNumber(row.carbs_g),
    fat_g: parseRequiredNumber(row.fat_g),
  };
}

function macrosToDraftStrings(macros: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }) {
  return {
    kcal: round1String(macros.kcal),
    protein_g: round1String(macros.protein_g),
    carbs_g: round1String(macros.carbs_g),
    fat_g: round1String(macros.fat_g),
  };
}

/**
 * Applies a grams-field edit to an ingredient draft row — the direct fix
 * for Bug 1. Reuses `scaleFromPer100g` (never a second scaling path):
 *
 *  - Row already has a `per100g` basis (every photo/barcode/search/OFF/
 *    oil-preset row does, and so does any row this function has already
 *    synthesized a basis for): macros are re-derived from it at the new
 *    grams, exactly like ConfirmSheet's `applyGramsEdit`.
 *  - No basis yet, but the row's macro fields were ALREADY fully and
 *    validly typed at the row's PRIOR grams (a from-scratch manual entry
 *    the user is now going back to adjust): a basis is synthesized from
 *    those prior numbers via `synthesizeIngredientBasis`, then used to
 *    rescale — and retained on the row so a second grams edit doesn't
 *    re-synthesize from an already-rescaled (and therefore fine, but
 *    needlessly re-derived) number.
 *  - Neither a basis nor a complete prior row exists (the ordinary case
 *    of filling in a brand new row field-by-field, or a genuinely
 *    incomplete row): there's nothing to rescale FROM. The grams text
 *    updates and the macro fields are left exactly as they are — still
 *    blank/incomplete, which `hasIncompleteIngredient` already blocks
 *    from being saved regardless. This is the "leave it manually
 *    editable" half of the legacy-degradation requirement: no auto-scale
 *    is attempted, and no stale number is silently left behind, because
 *    there was never a resolved number here to begin with.
 */
export function applyIngredientGramsEdit(row: PotIngredientDraftParam, newGramsRaw: string): PotIngredientDraftParam {
  const parsedNew = parseRequiredNumber(newGramsRaw);
  if (!parsedNew.valid || parsedNew.value === null || parsedNew.value <= 0) {
    return { ...row, gramsRaw: newGramsRaw };
  }
  const newGrams = parsedNew.value;

  if (row.per100g) {
    const macros = scaleFromPer100g(row.per100g, newGrams);
    return { ...row, gramsRaw: newGramsRaw, ...macrosToDraftStrings(macros) };
  }

  const prior = draftMacroFields(row);
  const priorComplete =
    prior.grams.valid && prior.grams.value !== null && prior.grams.value > 0 &&
    prior.kcal.valid && prior.protein_g.valid && prior.carbs_g.valid && prior.fat_g.valid;
  if (!priorComplete) {
    return { ...row, gramsRaw: newGramsRaw };
  }

  const basis = synthesizeIngredientBasis(prior.grams.value as number, {
    kcal: prior.kcal.value as number,
    protein_g: prior.protein_g.value as number,
    carbs_g: prior.carbs_g.value as number,
    fat_g: prior.fat_g.value as number,
  });
  if (!basis) {
    return { ...row, gramsRaw: newGramsRaw };
  }

  const macros = scaleFromPer100g(basis, newGrams);
  return { ...row, gramsRaw: newGramsRaw, ...macrosToDraftStrings(macros), per100g: basis };
}

/**
 * Applies a hand-edit to one of a row's four macro fields. Task brief:
 * "Hand-editing a macro must still work, and should update that row's
 * basis so later gram edits stay consistent." The interaction chosen: the
 * moment the row's grams + all four macro fields are simultaneously valid
 * (which includes the field just edited), the row's `per100g` basis is
 * re-synthesized from those current, on-screen numbers — so a user
 * correcting a scanned figure by hand ("actually the tin says 92 kcal,
 * not 90") makes THEIR number the new ground truth a subsequent grams
 * edit scales from, rather than silently keeping the old scanned basis
 * underneath an edited display value. While the row is still incomplete
 * (an earlier field left blank), the edit is recorded but no basis is
 * derived yet — and any EXISTING basis is left untouched rather than
 * cleared, so an in-progress multi-keystroke edit doesn't destroy a
 * perfectly good basis over one interim character.
 */
export function applyIngredientMacroEdit(
  row: PotIngredientDraftParam,
  field: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g',
  newValue: string
): PotIngredientDraftParam {
  const updated: PotIngredientDraftParam = { ...row, [field]: newValue };
  const fields = draftMacroFields(updated);
  const complete =
    fields.grams.valid && fields.grams.value !== null && fields.grams.value > 0 &&
    fields.kcal.valid && fields.protein_g.valid && fields.carbs_g.valid && fields.fat_g.valid;
  if (!complete) {
    return updated;
  }
  const basis = synthesizeIngredientBasis(fields.grams.value as number, {
    kcal: fields.kcal.value as number,
    protein_g: fields.protein_g.value as number,
    carbs_g: fields.carbs_g.value as number,
    fat_g: fields.fat_g.value as number,
  });
  return basis ? { ...updated, per100g: basis } : updated;
}

/** The bit of an existing draft row a scan needs in order to upgrade it: its current raw grams (preserved) and current confidence (never downgraded). */
export type CurrentIngredientRow = { grams: number; confidence: EntryConfidence };

/**
 * Applies a scanned/panel-read `PendingEntry` (barcode via
 * `lookupByBarcode`, or a label-OCR read via `runLabelOcr` — anything with
 * a per-100g basis) to an EXISTING ingredient row: the row's name and
 * macros are replaced from the panel's per-100g basis scaled to the row's
 * CURRENT grams (never the panel's own serving size — grams is always
 * `current.grams`, unchanged), and confidence becomes the better of the
 * row's existing confidence and the panel's own (see `maxConfidence`).
 *
 * Pure — takes already-resolved values, no DB/network access — so the
 * "grams preserved, macros replaced, confidence raised" property is
 * directly unit-testable (src/lib/__tests__/potActions.test.ts).
 */
export function applyPanelToRow(current: CurrentIngredientRow, scanned: PendingEntry): potRepo.PotIngredient {
  const per100g = per100gOf(scanned);
  const macros = scaleFromPer100g(per100g, current.grams);
  return {
    name: scanned.name,
    grams: current.grams,
    ...macros,
    confidence: maxConfidence(current.confidence, scanned.confidence),
    // Retained (not just applied once) so an UPGRADED row can itself be
    // rescaled correctly if the user then edits its grams again — without
    // this the upgrade would fix Bug 1 for every other entry path but
    // reintroduce it for the one row a barcode scan just touched.
    per100g,
  };
}

export type BarcodeUpgradeOutcome =
  | { ok: true; upgraded: potRepo.PotIngredient }
  | { ok: false; reason: CascadeMissReason };

/**
 * The full "scan a barcode to upgrade one ingredient row" decision,
 * built directly on `lookupByBarcode`'s own result shape
 * (`CascadeResult`/`CascadeMissReason` from lookupCascade.ts) so this
 * reuses the exact same saved_food -> Open Food Facts cascade — and its
 * kJ-conversion/0-900 plausibility rail — every other barcode path in
 * this app uses, never a second lookup or a second energy-unit check.
 *
 * A hit (`outcome.ok === true`) returns the upgraded row via
 * `applyPanelToRow`. A miss (`outcome.ok === false`) returns the typed
 * miss reason and nothing else — the caller's contract is to NOT touch
 * the row in that case, which is exactly what not calling `applyPanelToRow`
 * guarantees: the row a caller already has in state is left byte-for-byte
 * as it was.
 */
export function resolveBarcodeUpgrade(current: CurrentIngredientRow, outcome: CascadeResult): BarcodeUpgradeOutcome {
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  return { ok: true, upgraded: applyPanelToRow(current, outcome.entry) };
}

// ─────────────────────────────────────────────────────────────────────────
// POT-LEVEL MIXED-CONFIDENCE MEASURE (task brief "the pot's own honesty"):
// a pot's kcal_per_g is now derived from a MIXTURE of per-ingredient
// confidences (a scanned rice barcode next to a guessed pinch of
// coriander). Reporting the pot as if uniformly reliable would be
// dishonest; collapsing it to its single worst ingredient would be just
// as dishonest in the other direction — a pot that's 90% barcode-exact
// rice and 10% guessed spice is genuinely more trustworthy than one
// that's all guesswork, and a worst-of measure would score both pots
// identically ("contains a low-confidence ingredient").
//
// Measure chosen: the ENERGY (kcal) share of the batch that came from
// 'exact'-confidence ingredients, not a mass share. Reasoning: what this
// pot actually reports to the engine is a kcal_per_g figure, so the
// question that matters is "how much of the reported CALORIES am I sure
// of", not "how much of the reported GRAMS am I sure of" — a 5g clove of
// garlic guessed at ±50% is a rounding error on the pot's calories but
// would count identically to a guessed 5g of pure oil (~44 kcal) under a
// mass-weighted measure despite being a very different amount of risk to
// the number that matters. In practice the two rarely diverge much (a
// trace ingredient is usually a trace of both mass and energy), but energy
// is the more honest choice when they do.
//
// Deliberately a single transparent percentage ("62% of this pot's
// calories came from a scanned barcode or database match"), never a
// composite score or letter grade — the task brief is explicit that a
// fabricated precision score would be worse than no measure at all.
// ─────────────────────────────────────────────────────────────────────────

export type PotConfidenceSummary = {
  /** Total kcal across all ingredients (as entered at pot-creation time) — informational, and the denominator `exactEnergyFraction` is computed over. */
  totalKcal: number;
  /**
   * Fraction (0-1) of `totalKcal` contributed by ingredients whose
   * confidence is 'exact'. 0 when `totalKcal <= 0` (nothing to measure —
   * callers should treat that as "no data", not "0% trustworthy").
   *
   * Ingredients with no `confidence` recorded (any pot created before
   * this field existed) are treated as NOT 'exact' — excluded from the
   * numerator — but their kcal still counts in the denominator via
   * `totalKcal`. A legacy pot therefore reads as less than 100% exact
   * even if every ingredient really was scanned, which undersells it
   * slightly; the alternative (silently counting unknown provenance as
   * 'exact') would oversell it, and overselling trust is the one
   * direction this measure must never err in.
   */
  exactEnergyFraction: number;
};

/** Pure core: given already-parsed ingredients, compute the energy-weighted exact-confidence fraction. */
export function computePotConfidenceSummary(ingredients: potRepo.PotIngredient[]): PotConfidenceSummary {
  const totalKcal = ingredients.reduce((sum, i) => sum + Math.max(0, i.kcal), 0);
  if (!(totalKcal > 0)) return { totalKcal: 0, exactEnergyFraction: 0 };

  const exactKcal = ingredients
    .filter((i) => i.confidence === 'exact')
    .reduce((sum, i) => sum + Math.max(0, i.kcal), 0);

  return { totalKcal, exactEnergyFraction: exactKcal / totalKcal };
}

/**
 * A `PotRow` that has been weighed — `total_weight_g`/`remaining_g`/every
 * per-gram field is a real `number`, never `null`. `createPot`/`updatePot`
 * always write these five columns together (all-null or all-number), so
 * this is a genuine invariant, not just an optimistic cast — `isWeighedPot`
 * is the one place that invariant is checked, so a screen that needs to
 * value a serving (multiply by `kcal_per_g`, round `remaining_g`, …) can
 * narrow to it once with a type guard instead of null-checking five
 * fields inline at every call site (and TypeScript enforces it: after
 * `if (!isWeighedPot(pot)) return …`, every one of these fields is a plain
 * `number` for the rest of the function).
 */
export type WeighedPotRow = PotRow & {
  total_weight_g: number;
  remaining_g: number;
  kcal_per_g: number;
  protein_per_g: number;
  carbs_per_g: number;
  fat_per_g: number;
};

export function isWeighedPot(pot: PotRow): pot is WeighedPotRow {
  return (
    pot.total_weight_g !== null &&
    pot.remaining_g !== null &&
    pot.kcal_per_g !== null &&
    pot.protein_per_g !== null &&
    pot.carbs_per_g !== null &&
    pot.fat_per_g !== null
  );
}

/** Parses a stored `PotRow.ingredients` JSON blob. Never throws on malformed/legacy JSON — falls back to an empty list rather than crashing a pot list render. Shared by every `PotRow -> derived summary` helper below so there's exactly one place that degrades a bad blob. */
function parsePotIngredients(pot: PotRow): potRepo.PotIngredient[] {
  try {
    const parsed: unknown = JSON.parse(pot.ingredients);
    return Array.isArray(parsed) ? (parsed as potRepo.PotIngredient[]) : [];
  } catch {
    return [];
  }
}

/** Convenience wrapper over a stored `PotRow`: parses its `ingredients` JSON and computes the summary. Never throws on malformed/legacy JSON — falls back to "no data" rather than crashing a pot list render. */
export function potConfidenceSummary(pot: PotRow): PotConfidenceSummary {
  return computePotConfidenceSummary(parsePotIngredients(pot));
}

/** Formats `exactEnergyFraction` as the one honest sentence surfaced in the UI — a real, computed proportion, never an invented score or grade. */
export function formatPotConfidence(summary: PotConfidenceSummary): string {
  const pct = Math.round(summary.exactEnergyFraction * 100);
  return `${pct}% of this pot's calories came from a scanned barcode or database match`;
}

// ─────────────────────────────────────────────────────────────────────────
// INGREDIENT TOTALS — task brief #1: "A pot with no cooked weight yet
// should display its total kcal and macros honestly, and say servings
// can't be valued until it's weighed. Never show a fabricated or zero
// kcal/g." Cooking only moves water around (zero calories) — the batch's
// total kcal/protein/carbs/fat is fully known the moment every ingredient
// is entered, independent of whether the finished weight has been
// measured yet. This is that total, exposed the same way
// `computePotConfidenceSummary` exposes its own ingredient-derived figure,
// for a screen to show in place of a `kcal_per_g` it doesn't have yet.
// ─────────────────────────────────────────────────────────────────────────

export type PotIngredientTotals = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };

/** Pure core: sums every ingredient's absolute macros — the batch total, unaffected by whether a cooked weight has ever been entered. */
export function sumPotIngredientTotals(ingredients: potRepo.PotIngredient[]): PotIngredientTotals {
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

/** Convenience wrapper over a stored `PotRow` — same parse-defensively pattern as `potConfidenceSummary`. */
export function potIngredientTotals(pot: PotRow): PotIngredientTotals {
  return sumPotIngredientTotals(parsePotIngredients(pot));
}

// ─────────────────────────────────────────────────────────────────────────
// FAT PLAUSIBILITY NOTE ("Also" section of the task brief): a real logged
// serving read 307g at 377 kcal (1.23 kcal/g) for a chicken curry —
// internally consistent, but low for a curry with coconut milk and oil,
// which strongly suggests the cooking fat never got entered. This is a
// neutral, factual, DISMISSIBLE question, never a warning — PRD §10
// forbids the red/guilt treatment, and a pot that's genuinely just
// simmered vegetables in water is a legitimate low-fat batch, not a
// mistake.
//
// Heuristic, deliberately simple and purely numeric (no dish-name/
// "is this a curry" guessing — unreliable and a much better way to be
// annoying than accurate): flag when fat contributes only a sliver of
// this pot's own calories (fat is 9 kcal/g, so a real cooking-fat
// ingredient shows up unmistakably in this share) AND the resulting
// kcal/g is low enough that "oil could easily have been forgotten" is a
// live possibility. Both conditions together keep the false-positive rate
// low: a dense, high-protein/carb but genuinely oil-free dish (e.g. plain
// dal cooked in water) still needs a low kcal/g to trip it, and a fatty
// dish that's merely undervalued for other reasons won't have a near-zero
// fat share.
// ─────────────────────────────────────────────────────────────────────────

/** Fat contributes less than this share of the pot's total calories. */
const LOW_FAT_KCAL_SHARE = 0.08;
/** kcal/g low enough, combined with the above, to be worth a (dismissible, neutral) question. */
const LOW_KCAL_PER_G = 1.5;

export type FatPlausibilityCheck = {
  /** Whether this pot is worth a neutral "was oil used?" question. */
  flagged: boolean;
  /** Fraction (0-1) of total kcal contributed by fat (fat_g * 9 / total kcal) — 0 when there's nothing to measure. */
  fatKcalShare: number;
};

/** Pure core, given already-known totals and a (possibly not-yet-known) kcal/g. */
export function checkFatPlausibility(totals: PotIngredientTotals, kcalPerG: number | null): FatPlausibilityCheck {
  if (kcalPerG === null || !(totals.kcal > 0)) return { flagged: false, fatKcalShare: 0 };
  const fatKcalShare = (totals.fat_g * 9) / totals.kcal;
  return { flagged: fatKcalShare < LOW_FAT_KCAL_SHARE && kcalPerG < LOW_KCAL_PER_G, fatKcalShare };
}

/** Convenience wrapper over a stored `PotRow`. */
export function potFatPlausibility(pot: PotRow): FatPlausibilityCheck {
  return checkFatPlausibility(potIngredientTotals(pot), pot.kcal_per_g);
}

/** The one neutral, factual sentence surfaced for a flagged pot — a question, never an accusation. */
export const FAT_PLAUSIBILITY_NOTE = 'No cooking oil or fat was added — was any used?';

// Dismissal is PER-POT (unlike the single-flag app_pot_nudge table) and
// persists across app restarts, same "CREATE TABLE IF NOT EXISTS app_*"
// convention already used for that nudge — src/db/schema.ts is out of
// scope for this feature, so a real migration isn't warranted for one
// small preference table.
const ENSURE_POT_FAT_NOTE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_pot_fat_note_dismissed (
  pot_id TEXT PRIMARY KEY,
  dismissed_at INTEGER NOT NULL
);
`;

let potFatNoteTableEnsured = false;

async function ensurePotFatNoteTable(db: Database): Promise<void> {
  if (potFatNoteTableEnsured) return;
  await db.execAsync(ENSURE_POT_FAT_NOTE_TABLE_SQL);
  potFatNoteTableEnsured = true;
}

/** Whether this pot's fat-plausibility note has already been dismissed. */
export async function isFatPlausibilityNoteDismissed(db: Database, potId: string): Promise<boolean> {
  await ensurePotFatNoteTable(db);
  const row = await db.getFirstAsync<{ pot_id: string }>('SELECT pot_id FROM app_pot_fat_note_dismissed WHERE pot_id = ?', [potId]);
  return row !== null;
}

/** Records that this pot's fat-plausibility note was dismissed — never shown again for this pot (editing the pot to add oil doesn't need to "undo" a dismissal; a pot that keeps tripping the check after being fixed indicates the fix didn't take, which the user already told us they don't want flagged again). */
export async function dismissFatPlausibilityNote(db: Database, potId: string, dismissedAt: number = Date.now()): Promise<void> {
  await ensurePotFatNoteTable(db);
  await db.runAsync(
    `INSERT INTO app_pot_fat_note_dismissed (pot_id, dismissed_at) VALUES (?, ?)
     ON CONFLICT(pot_id) DO UPDATE SET dismissed_at = excluded.dismissed_at`,
    [potId, dismissedAt]
  );
}

/** Test-only: forget the "table ensured" cache so tests against fresh in-memory DBs re-create it. */
export function resetPotFatNoteTableForTesting(): void {
  potFatNoteTableEnsured = false;
}

// ─────────────────────────────────────────────────────────────────────────
// SPICES & AROMATICS QUICK-ADD (task brief #2): "I use a lot of spices and
// I think most of it is really small calories" — true (a teaspoon of
// turmeric/cumin/chilli is 5-10 kcal each), but silently ignoring them
// isn't honest, and typing ten of them individually fails the 10-second
// test for zero material accuracy gain. One tap adds ONE ingredient row
// standing in for a typical batch's whole spice/aromatic contribution,
// editable like any other row.
//
// Basis for the default (stated here, and to the user in the ingredient's
// own name/hint, per the task brief: "state the figure you chose and its
// basis"): ~15g of mixed ground spice — a few teaspoons each of turmeric,
// cumin, coriander, chilli powder, roughly what goes into one batch of a
// curry base — at ~320 kcal/100g, the rough order of magnitude for dry
// ground spice (turmeric ≈312, cumin ≈375, coriander ≈298, chilli powder
// ≈282 kcal/100g; 320 is a representative round midpoint, not any one
// spice). That comes to ~48 kcal for the whole batch's spice mix — small,
// as the user expected, but not zero, and now visible in the total.
//
// Built on the SAME `pendingEntryFromQuickAdd`/`QuickAddPreset` machinery
// pendingEntry.ts's oil/ghee presets use (that file is off-limits to edit
// for this feature, so this preset is defined here rather than added to
// its QUICK_ADD_PRESETS array) — no second "preset -> PendingEntry"
// formula to maintain.
//
// Deliberately does NOT include any fat: the reminder that oil/ghee is
// NOT a spice and must be added separately (PRD §7.5: "three tablespoons
// of ghee is ~360 kcal no vision model will ever see") is carried in the
// UI copy next to this chip, not folded into the preset's own numbers —
// folding it in would silently reintroduce the exact confusion this
// section exists to prevent.
// ─────────────────────────────────────────────────────────────────────────

export const SPICE_AROMATICS_PRESET: QuickAddPreset = {
  id: 'spices_aromatics',
  label: '~15g mixed spice (≈48 kcal)',
  name: 'Spices & aromatics (mixed)',
  grams: 15,
  per100g: { kcal: 320, protein_g: 12, carbs_g: 50, fat_g: 10 },
};

// ─────────────────────────────────────────────────────────────────────────
// SERVING — tare/container handling (task brief, the user's own words:
// "I usually weigh the whole thing, sometimes with the plate weight and
// sometimes without"). One pure function decides the net (food-only)
// weight from whichever mode was active; potRepo.logServing never sees
// the gross reading or the container weight separately, only the already-
// net `grams` plus `tareG` for bookkeeping (schema v6, food_entry.tare_g).
//
// This is the one thing in this whole feature that MUST be exactly right:
// a silently-unsubtracted 250g plate is roughly a 300 kcal error on a rice
// dish, invisible and repeated every serving. Keeping it as a tiny pure
// function (rather than inline arithmetic scattered across the serving
// screen) is what makes it trivial to unit-test that a tared serving and
// a container serving of the SAME true food weight produce identical
// macros — see src/lib/__tests__/potActions.test.ts.
// ─────────────────────────────────────────────────────────────────────────

/**
 * How this serving was weighed:
 *   'tared'     — the scale was zeroed with the empty container on it
 *                 first, so the reading IS the food's net weight already.
 *   'container' — the scale reads bowl+food together (gross); a known
 *                 container tare weight is subtracted to get the net.
 */
export type ServingWeighMode = 'tared' | 'container';

export type ServingWeighFailureReason = 'scale_reading_not_positive' | 'net_not_positive';

export type ServingWeighResult = { ok: true; netGrams: number } | { ok: false; reason: ServingWeighFailureReason };

/**
 * Computes the net (food-only) serving weight from a scale reading and,
 * for container mode, the container's own tare weight. Deliberately the
 * ONLY place this subtraction happens — potActions/potRepo never re-derive
 * or re-apply it.
 *
 * `scaleReadingG` is always what the scale actually showed: the net food
 * weight in 'tared' mode, or the gross bowl+food weight in 'container'
 * mode. `containerTareG` is ignored in 'tared' mode (the scale already
 * accounted for the container by being zeroed on it) and required in
 * 'container' mode.
 *
 * Returns a typed failure rather than throwing/clamping silently: a
 * mistyped container weight larger than the scale reading would otherwise
 * produce a negative or zero "net" grams, which must block logging rather
 * than quietly recording a wrong (or impossible) serving.
 */
export function computeNetServingGrams(
  mode: ServingWeighMode,
  scaleReadingG: number,
  containerTareG = 0
): ServingWeighResult {
  if (!Number.isFinite(scaleReadingG) || scaleReadingG <= 0) {
    return { ok: false, reason: 'scale_reading_not_positive' };
  }
  const netGrams = mode === 'tared' ? scaleReadingG : scaleReadingG - containerTareG;
  if (!Number.isFinite(netGrams) || netGrams <= 0) {
    return { ok: false, reason: 'net_not_positive' };
  }
  return { ok: true, netGrams };
}

export type LogServingArgs = {
  potId: string;
  date: string;
  mode: ServingWeighMode;
  /** What the scale actually showed — net weight in 'tared' mode, gross (bowl+food) in 'container' mode. */
  scaleReadingG: number;
  /** Required (and only meaningful) when `mode === 'container'`. */
  containerTareG?: number;
  /** Saved container this reading came from, if any — bumped via potRepo.touchContainer on success so the picker's frequency ranking stays live. */
  containerId?: string;
};

/**
 * Log a serving from an active pot (PRD §7.5's "2-3 taps": pick mode/
 * container, enter the scale reading, tap Log). Resolves the net grams via
 * `computeNetServingGrams`, then delegates the actual decrement/
 * auto-archive/food_entry write to potRepo.logServing — never
 * reimplemented here.
 *
 * `needs_cooked_weight` (task brief #1): checked up front, before ever
 * calling `potRepo.logServing` — a pot created from ingredients alone has
 * no `kcal_per_g` to value a scale reading against yet. This is a
 * perfectly legitimate, UI-reachable state (not a bug), so it's a typed
 * result the caller renders a "weigh this pot first" prompt for
 * (PotLogServingScreen), not a thrown error.
 */
export type LogPotServingResult =
  | { ok: true; entry: FoodEntryRow; pot: PotRow }
  | { ok: false; reason: ServingWeighFailureReason | 'needs_cooked_weight' };

export async function logPotServing(
  db: Database,
  args: LogServingArgs,
  loggedAt: number = Date.now()
): Promise<LogPotServingResult> {
  const weighed = computeNetServingGrams(args.mode, args.scaleReadingG, args.containerTareG ?? 0);
  if (!weighed.ok) return weighed;

  const pot = await potRepo.getPot(db, args.potId);
  if (!pot) throw new Error(`logPotServing: no pot with id ${args.potId}`);
  if (pot.total_weight_g === null || pot.kcal_per_g === null) {
    return { ok: false, reason: 'needs_cooked_weight' };
  }

  const tareG = args.mode === 'tared' ? 0 : (args.containerTareG ?? 0);

  const result = await potRepo.logServing(db, {
    potId: args.potId,
    grams: weighed.netGrams,
    entryId: generateId('entry'),
    date: args.date,
    loggedAt,
    tareG,
  });

  if (args.mode === 'container' && args.containerId) {
    await potRepo.touchContainer(db, args.containerId, loggedAt);
  }

  return { ok: true, entry: result.entry, pot: result.pot };
}

// ─────────────────────────────────────────────────────────────────────────
// SAVED CONTAINERS — thin id-generation wrapper over potRepo, same
// pattern as createPot/logPotServing above.
// ─────────────────────────────────────────────────────────────────────────

export async function saveContainer(db: Database, name: string, tareG: number): Promise<PotContainerRow> {
  return potRepo.saveContainer(db, { id: generateId('container'), name, tareG });
}

export async function getContainers(db: Database): Promise<PotContainerRow[]> {
  return potRepo.getContainers(db);
}

export async function deleteContainer(db: Database, id: string): Promise<void> {
  return potRepo.deleteContainer(db, id);
}

/** Renames a saved container (task brief "Container rename/delete UI"). Thin passthrough, same pattern as the rest of this section. */
export async function renameContainer(db: Database, id: string, name: string): Promise<void> {
  return potRepo.renameContainer(db, id, name);
}

// ─────────────────────────────────────────────────────────────────────────
// MEAL-PHOTO -> POT NUDGE (task brief): "when a meal photo is taken and an
// active pot exists, offer 'log from your pot instead' once, non-modally,
// dismissible." "Once" is persisted (not just per-app-session) so a user
// who dismisses it isn't nagged again on their next cook. src/db/schema.ts
// is out of scope for this feature, so this follows the same additive
// `CREATE TABLE IF NOT EXISTS app_*` pattern already established by
// src/lib/notifications/settingsStore.ts for exactly this situation (a
// feature-owned preference flag that doesn't warrant a schema migration).
// ─────────────────────────────────────────────────────────────────────────

const ENSURE_POT_NUDGE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_pot_nudge (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dismissed_at INTEGER
);
`;

let potNudgeTableEnsured = false;

async function ensurePotNudgeTable(db: Database): Promise<void> {
  if (potNudgeTableEnsured) return;
  await db.execAsync(ENSURE_POT_NUDGE_TABLE_SQL);
  potNudgeTableEnsured = true;
}

/** Whether the user has already dismissed (or acted on) the "log from your pot instead" nudge — MealPhotoScreen checks this before showing it. */
export async function hasPotNudgeBeenDismissed(db: Database): Promise<boolean> {
  await ensurePotNudgeTable(db);
  const row = await db.getFirstAsync<{ dismissed_at: number | null }>('SELECT dismissed_at FROM app_pot_nudge WHERE id = 1');
  return row?.dismissed_at !== null && row?.dismissed_at !== undefined;
}

/** Records that the nudge was dismissed (or acted on) — never shown again after this. */
export async function dismissPotNudge(db: Database, dismissedAt: number = Date.now()): Promise<void> {
  await ensurePotNudgeTable(db);
  await db.runAsync(
    `INSERT INTO app_pot_nudge (id, dismissed_at) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET dismissed_at = excluded.dismissed_at`,
    [dismissedAt]
  );
}

/** Test-only: forget the "table ensured" cache so tests against fresh in-memory DBs re-create it. */
export function resetPotNudgeForTesting(): void {
  potNudgeTableEnsured = false;
}
