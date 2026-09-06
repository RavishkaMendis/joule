// ═══════════════════════════════════════════════════════════════════════
// SERVING SIZE — parsing Open Food Facts' serving fields into a
// grams-per-serving basis, plus the serving⇄gram conversion that backs
// ConfirmSheet's unit toggle.
//
// Real-use complaint (see task brief): "It logs grams, not serving size,
// and there's no way to change it." People eat servings — two slices of
// bread, one tub of yoghurt — not "37 grams of bread." OFF usually knows
// the serving size; this module is the one place that extracts it.
//
// OFF exposes three (inconsistently populated) fields for this:
//   - `serving_size`      free text, e.g. "30 g", "2 slices (60g)", "1 tub"
//   - `serving_quantity`  numeric grams, when OFF has parsed it already
//   - `energy-kcal_serving` / `proteins_serving` / etc — nutriment values
//     already expressed per-serving rather than per-100g
//
// None of these are guaranteed to exist or agree with each other. This
// module treats all of it as "best-effort, parse defensively, never
// throw, never invent a serving that isn't there."
//
// ⚠️ The kJ trap applies per-serving exactly as it does per-100g (task
// brief). `resolveServingKcal` below is a thin wrapper that re-labels the
// per-serving nutriment keys as if they were per-100g keys and hands them
// to the EXISTING `resolveKcalPer100g` — this is deliberate: there must be
// exactly one place that decides "which energy field wins, kJ or kcal,
// and is the number plausible", not a second parallel implementation that
// could drift or repeat the same class of bug for the per-serving case.
// ═══════════════════════════════════════════════════════════════════════

import { resolveKcalPer100g } from './openFoodFacts';

/** Grams-per-serving basis, plus the label to show the user ("1 tub", "2 slices"). Everything optional/absent-safe. */
export type ServingBasis = {
  /** Grams in one serving. Always present and finite when a ServingBasis exists at all. */
  gramsPerServing: number;
  /** Human label for the serving, when OFF's text gave us one worth showing ("2 slices", "1 tub"). Absent when all we have is a bare gram figure. */
  label?: string;
};

/** Raw shape of the per-serving nutriment keys this module reads, alongside the existing per-100g ones. */
export type OffServingNutriments = {
  serving_size?: string | null;
  serving_quantity?: number | string | null;
  'energy-kcal_serving'?: number | string | null;
  'energy-kj_serving'?: number | string | null;
  energy_serving?: number | string | null;
  energy_unit?: string | null;
  proteins_serving?: number | string | null;
  carbohydrates_serving?: number | string | null;
  fat_serving?: number | string | null;
};

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Extracts a gram figure from OFF's free-text `serving_size` field, e.g.
 * `"30 g"`, `"2 slices (60g)"`, `"60g"`, `"1.5 oz"`. Returns null when no
 * gram-convertible number can be found — garbled/unusual text ("1 tub",
 * "a handful") is common and must not throw or fabricate a number.
 *
 * Strategy: prefer a parenthesised gram figure ("2 slices (60g)") since
 * that's the precise weight when a descriptive count is also present;
 * otherwise take the first plain "<number> g" in the string; otherwise
 * convert a plain ounce figure. Anything else (a bare count with no unit,
 * "1 tub", "a bowl") is left for the numeric `serving_quantity` field to
 * supply instead — this function only ever reads text.
 */
export function parseServingSizeGrams(servingSize: string | null | undefined): number | null {
  if (!servingSize) return null;
  const text = servingSize.trim();
  if (text.length === 0) return null;

  // "2 slices (60g)" / "1 bar (45 g)" — parenthesised gram weight wins,
  // it's the precise figure alongside a descriptive count.
  const parenGrams = text.match(/\(\s*([\d.,]+)\s*g\w*\s*\)/i);
  if (parenGrams) {
    const n = Number(parenGrams[1].replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Plain "30 g" / "30g" / "30 grams".
  const plainGrams = text.match(/([\d.,]+)\s*g(?:ram)?s?\b/i);
  if (plainGrams) {
    const n = Number(plainGrams[1].replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Ounces, occasionally used on imported/US-labelled products.
  const ounces = text.match(/([\d.,]+)\s*oz\b/i);
  if (ounces) {
    const n = Number(ounces[1].replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n * 28.3495;
  }

  return null;
}

/**
 * Extracts a human-readable label from OFF's `serving_size` text, when the
 * text carries a descriptive count worth showing alongside the resolved
 * grams ("2 slices" from "2 slices (60g)"). Returns null when the text is
 * just a bare gram figure ("30 g") — showing "30 g" as if it were a
 * distinct "label" would be redundant with the gram readout the caller
 * already displays.
 */
export function parseServingLabel(servingSize: string | null | undefined): string | undefined {
  if (!servingSize) return undefined;
  const text = servingSize.trim();
  if (text.length === 0) return undefined;

  // Strip a trailing parenthesised gram clause, if present, and use
  // whatever descriptive text remains as the label.
  const withoutParens = text.replace(/\(\s*[\d.,]+\s*g\w*\s*\)/i, '').trim();

  // If the whole string (after removing a parenthesised gram clause) is
  // itself just a bare number+unit ("30 g", "60g"), there's no separate
  // descriptive label to show.
  if (/^[\d.,]+\s*(g|gram|grams|oz)?\.?$/i.test(withoutParens) || withoutParens.length === 0) {
    return undefined;
  }

  return withoutParens;
}

/**
 * Resolves a ServingBasis from OFF's serving fields, preferring the
 * numeric `serving_quantity` (already-parsed grams, when OFF supplies it)
 * over re-parsing the free-text `serving_size`, but always attempting a
 * text-derived label for display even when the quantity came from the
 * numeric field.
 *
 * Returns undefined when no usable gram figure can be resolved from
 * either field — the "absent or unparseable" case the task brief calls
 * out. Never guesses a serving size from thin air.
 */
export function resolveServingBasis(n: OffServingNutriments): ServingBasis | undefined {
  const label = parseServingLabel(n.serving_size);

  const fromQuantity = toNumber(n.serving_quantity);
  if (fromQuantity !== null && fromQuantity > 0) {
    return label ? { gramsPerServing: fromQuantity, label } : { gramsPerServing: fromQuantity };
  }

  const fromText = parseServingSizeGrams(n.serving_size);
  if (fromText !== null) {
    return label ? { gramsPerServing: fromText, label } : { gramsPerServing: fromText };
  }

  return undefined;
}

/**
 * ⚠️ The kJ trap, applied to per-serving nutriments (task brief's explicit
 * warning). Rather than re-implementing "which energy field wins, and is
 * it plausible", this re-labels the per-serving keys onto the per-100g
 * shape `resolveKcalPer100g` already expects and calls that single
 * existing function. The "plausibility" rail
 * (`isPlausibleKcalPer100g`, 0-900) is a per-100g-shaped sanity check, so
 * the per-serving kcal figure is normalised to a per-100g-equivalent
 * (scaled by 100/gramsPerServing) before the plausibility check, then
 * scaled back — a 900kcal ceiling makes no sense applied directly to a
 * 30g serving (candy bars alone can exceed that per serving) but is
 * exactly the right ceiling once normalised back to a 100g basis.
 *
 * Returns null when no usable/plausible per-serving energy figure exists
 * — callers must treat that as "unknown", never silently 0.
 */
export function resolveServingKcal(n: OffServingNutriments, gramsPerServing: number): number | null {
  if (!Number.isFinite(gramsPerServing) || gramsPerServing <= 0) return null;
  const scaleTo100 = 100 / gramsPerServing;

  const kcalPer100gEquivalent = resolveKcalPer100g({
    'energy-kcal_100g': scaleOrNull(toNumber(n['energy-kcal_serving']), scaleTo100),
    'energy-kj_100g': scaleOrNull(toNumber(n['energy-kj_serving']), scaleTo100),
    energy_100g: scaleOrNull(toNumber(n.energy_serving), scaleTo100),
    energy_unit: n.energy_unit,
  });

  if (kcalPer100gEquivalent === null) return null;
  return kcalPer100gEquivalent / scaleTo100;
}

function scaleOrNull(n: number | null, scale: number): number | undefined {
  return n === null ? undefined : n * scale;
}

/** A macro (protein/carbs/fat) per serving, when OFF supplied it. Returns null rather than 0 when absent — never coerce "unknown" into "measured zero". */
function servingMacroOrNull(v: number | string | null | undefined): number | null {
  const n = toNumber(v);
  return n !== null && n >= 0 ? n : null;
}

/** Per-serving macro basis this module can resolve from OFF's `*_serving` nutriment keys, alongside the kcal figure `resolveServingKcal` already handles. */
export type ServingMacros = {
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
};

/** Resolves every per-serving macro OFF may have supplied, routing energy through `resolveServingKcal` (the one kJ-aware path) and reading the rest directly. */
export function resolveServingMacros(n: OffServingNutriments, gramsPerServing: number): ServingMacros {
  return {
    kcal: resolveServingKcal(n, gramsPerServing),
    protein_g: servingMacroOrNull(n.proteins_serving),
    carbs_g: servingMacroOrNull(n.carbohydrates_serving),
    fat_g: servingMacroOrNull(n.fat_serving),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SERVING ⇄ GRAM CONVERSION
//
// One code path for deriving per-100g from per-serving (or the reverse),
// so ConfirmSheet's unit toggle and the barcode mapper agree exactly —
// per the task brief: "Derive per-100g from per-serving values (or vice
// versa) through one code path, and unit-test it."
// ─────────────────────────────────────────────────────────────────────────

export type Per100gBasis = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };

/** Derives a per-100g basis from a per-serving one, given the serving's gram weight. The single conversion point macro/serving math should ever go through. */
export function per100gFromPerServing(perServing: Per100gBasis, gramsPerServing: number): Per100gBasis {
  if (!Number.isFinite(gramsPerServing) || gramsPerServing <= 0) {
    return perServing;
  }
  const scale = 100 / gramsPerServing;
  return {
    kcal: perServing.kcal * scale,
    protein_g: perServing.protein_g * scale,
    carbs_g: perServing.carbs_g * scale,
    fat_g: perServing.fat_g * scale,
  };
}

/** Derives a per-serving basis from a per-100g one — the inverse of `per100gFromPerServing`, going through the identical scale factor so the two never drift apart. */
export function perServingFromPer100g(per100g: Per100gBasis, gramsPerServing: number): Per100gBasis {
  if (!Number.isFinite(gramsPerServing) || gramsPerServing <= 0) {
    return per100g;
  }
  const scale = gramsPerServing / 100;
  return {
    kcal: per100g.kcal * scale,
    protein_g: per100g.protein_g * scale,
    carbs_g: per100g.carbs_g * scale,
    fat_g: per100g.fat_g * scale,
  };
}
