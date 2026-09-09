// ═══════════════════════════════════════════════════════════════════════
// dataHealth — scans logged food_entry rows for the specific shape of
// unit-conversion damage the app has already shipped (and fixed) once:
// Open Food Facts energy values with no declared unit were assumed to be
// kJ and divided by 4.184, producing entries roughly 4x too low. Those
// wrong rows are still sitting in the user's database — `recomputeDay`
// faithfully sums whatever food_entry.kcal already says, so nothing
// downstream ever re-examines them on its own. This module is how the
// user finds and fixes them (surfaced by DataHealthScreen.tsx).
//
// Pure module, deliberately: no DB imports, no `Database` parameter —
// takes `FoodEntryRow[]` as a plain argument so it can be unit tested
// with plain object literals and reused verbatim from a screen, a repair
// script, or a future test fixture.
//
// Reuses checkAtwaterConsistency (src/lib/atwaterCheck.ts) for the
// macro-vs-energy tolerance rather than reimplementing it — that module's
// 20%-of-expected/50kcal-floor tolerance is anchored to FDA 21 CFR 101.9
// and deliberately calibrated to not cry wolf on honest panels (fibre,
// sugar alcohols, rounding). Read that file's header before touching the
// tolerance here.
//
// ── CATEGORIES (checked in this priority order per entry — worst-first,
//    each entry gets exactly one finding, not one per category) ────────
//
//   1. Implausible values — kcal, any macro, or grams is negative. This
//      is corrupted/impossible data, not a unit-conversion artifact, so
//      the macros themselves cannot be trusted to derive a suggestion.
//   2. Implausible energy density — kcal per gram of food exceeds ~9.1
//      (pure fat is 9 kcal/g; nothing edible legitimately exceeds that
//      by more than rounding noise) once grams > 0, or any positive kcal
//      on a zero/negative-gram entry (energy from nothing).
//   3. Zero energy with real macros — kcal is exactly 0 while at least
//      one macro is > 0. This is the OFF bug's worst-case shape verbatim
//      (a divide-by-4.184 applied to an already-near-zero source value
//      rounds to 0) and the one CLAUDE.md calls out by name ("one
//      phantom zero-calorie day corrupts an entire window") when it
//      reaches day_intake.
//   4. Atwater mismatch — stated kcal disagrees with 4P+4C+9F beyond
//      checkAtwaterConsistency's tolerance, and none of the above,
//      sharper conditions already explain why.
//
// A suggested corrected kcal is derived from the macros (4P+4C+9F,
// rounded) wherever the macros themselves look trustworthy enough to
// derive a number from — finite and non-negative. When they don't (any
// macro is negative or non-finite), the suggestion is `null`: CLAUDE.md's
// "the model never writes directly to the log" applies here as much as
// anywhere — this module never invents a number it can't stand behind,
// and the UI must never auto-apply a null suggestion.
// ═══════════════════════════════════════════════════════════════════════

import { checkAtwaterConsistency, expectedKcalFromMacros, formatAtwaterNote } from './atwaterCheck';
import type { FoodEntryRow } from '../db/types';

/** Above pure fat's 9 kcal/g, with a small margin for rounding — see module header. */
export const IMPLAUSIBLE_KCAL_PER_GRAM = 9.1;

export type DataHealthCategory =
  | 'implausible_values'
  | 'implausible_density'
  | 'zero_energy_with_macros'
  | 'atwater_mismatch';

export type DataHealthFinding = {
  entry: FoodEntryRow;
  category: DataHealthCategory;
  /** One neutral, factual sentence — no "wrong"/"error"/"bad" (CLAUDE.md: no guilt). */
  message: string;
  statedKcal: number;
  /** Macro-derived (4P+4C+9F), rounded to the nearest kcal — or null if the entry's macros themselves cannot be trusted to derive a number. Never invented. */
  suggestedKcal: number | null;
};

function macrosAreTrustworthy(entry: FoodEntryRow): boolean {
  return (
    Number.isFinite(entry.protein_g) &&
    Number.isFinite(entry.carbs_g) &&
    Number.isFinite(entry.fat_g) &&
    entry.protein_g >= 0 &&
    entry.carbs_g >= 0 &&
    entry.fat_g >= 0
  );
}

function macroSuggestion(entry: FoodEntryRow): number | null {
  if (!macrosAreTrustworthy(entry)) return null;
  return Math.round(expectedKcalFromMacros(entry.protein_g, entry.carbs_g, entry.fat_g));
}

function hasAnyNegativeValue(entry: FoodEntryRow): boolean {
  return (
    !Number.isFinite(entry.kcal) ||
    entry.kcal < 0 ||
    !Number.isFinite(entry.protein_g) ||
    entry.protein_g < 0 ||
    !Number.isFinite(entry.carbs_g) ||
    entry.carbs_g < 0 ||
    !Number.isFinite(entry.fat_g) ||
    entry.fat_g < 0 ||
    !Number.isFinite(entry.grams) ||
    entry.grams < 0
  );
}

/** kcal-per-gram of logged food, or null when it isn't a meaningful ratio (zero/negative grams with zero kcal). */
function kcalPerGram(entry: FoodEntryRow): number | null {
  if (entry.grams > 0) return entry.kcal / entry.grams;
  if (entry.kcal > 0) return Infinity; // positive energy from nothing
  return null;
}

function classifyEntry(entry: FoodEntryRow): DataHealthFinding | null {
  // 1. Implausible / impossible values — checked first because it makes
  // every other category's macro-derived suggestion untrustworthy too.
  if (hasAnyNegativeValue(entry)) {
    return {
      entry,
      category: 'implausible_values',
      message: 'This entry has a negative or non-numeric value in its energy or macros — a data entry or import error, not a rounding difference.',
      statedKcal: entry.kcal,
      suggestedKcal: null,
    };
  }

  // 2. Implausible energy density.
  const density = kcalPerGram(entry);
  if (density !== null && (density > IMPLAUSIBLE_KCAL_PER_GRAM || !Number.isFinite(density))) {
    const densityLabel = Number.isFinite(density) ? `${density.toFixed(1)} kcal per gram` : 'energy with no recorded weight to divide it by';
    return {
      entry,
      category: 'implausible_density',
      message: `Stated energy works out to ${densityLabel} of food — above pure fat's ~9 kcal/g, which nothing edible legitimately exceeds.`,
      statedKcal: entry.kcal,
      suggestedKcal: macroSuggestion(entry),
    };
  }

  // 3. Zero energy with real macros — the OFF bug's worst-case shape.
  const hasRealMacros = entry.protein_g > 0 || entry.carbs_g > 0 || entry.fat_g > 0;
  if (entry.kcal === 0 && hasRealMacros) {
    return {
      entry,
      category: 'zero_energy_with_macros',
      message: 'Stated energy is 0 kcal despite protein, carbs, or fat being logged for this entry — the energy figure was likely lost or misconverted.',
      statedKcal: entry.kcal,
      suggestedKcal: macroSuggestion(entry),
    };
  }

  // 4. General Atwater mismatch.
  const atwater = checkAtwaterConsistency({
    kcal: entry.kcal,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    fat_g: entry.fat_g,
  });
  if (atwater.status === 'mismatch') {
    return {
      entry,
      category: 'atwater_mismatch',
      message: formatAtwaterNote(atwater),
      statedKcal: entry.kcal,
      suggestedKcal: macroSuggestion(entry),
    };
  }

  return null;
}

/**
 * Scans logged food_entry rows and returns one finding per suspect entry,
 * in the same order the rows were given. Entries with no issue are
 * simply omitted — an empty result means "nothing looks wrong", not "no
 * entries were scanned".
 */
export function scanFoodEntriesForDataHealth(entries: FoodEntryRow[]): DataHealthFinding[] {
  const findings: DataHealthFinding[] = [];
  for (const entry of entries) {
    const finding = classifyEntry(entry);
    if (finding) findings.push(finding);
  }
  return findings;
}
