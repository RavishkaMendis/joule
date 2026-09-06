// ═══════════════════════════════════════════════════════════════════════
// AFCD — bundled generic food database. PRD §6 tier 2:
//
//   "Bundled AFCD SQLite — Australian Food Composition Database, Release
//    3.0, ~1,588 generic foods. Ships in the app bundle. Zero network,
//    zero cost, and Australian-accurate."
//
// ⚠️ PROVENANCE — read before touching this file or its data asset.
//
// `./data/afcd.json` IS genuine AFCD Release 3 data, not a fabricated
// table. It was derived from the two official FSANZ publication files:
//
//   - "AFCD Release 3 - Nutrient profiles.xlsx"
//       sheet "All solids & liquids per 100 g" — the per-100g energy/
//       protein/fat/carbohydrate figures used here.
//   - Source: https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/data-files
//
// The sheet contains exactly 1,588 rows of food data — matching the PRD's
// stated count precisely, which is itself a strong provenance signal.
// Every row kept has non-null energy/protein/fat/carb figures and passes
// the same 0-900 kcal/100g plausibility rail used elsewhere in this app;
// zero rows were skipped or invented to hit the 1,588 figure.
//
// Extraction script (not part of the app; kept for reproducibility if the
// data ever needs re-pulling from a newer AFCD release):
//
//   column 0  Public Food Key        -> id
//   column 3  Food Name              -> name
//   column 4  Energy w/ fibre (kJ)   -> kcal_per_100g (kJ / 4.184)
//   column 7  Protein (g)            -> protein_per_100g
//   column 9  Fat, total (g)         -> fat_per_100g
//   column 38 Available carbohydrate, without sugar alcohols (g) -> carbs_per_100g
//
// AFCD is a database of *generic foods and ingredients* (rice, chicken
// breast, lentils, ghee, milk...), not prepared dishes — "sushi" as a
// composite dish is genuinely absent from it, same as it would be absent
// from any composition database. That is expected, not a bug: the search
// module's job is to surface the closest generic matches ("rice, white,
// cooked"; "salmon, raw") and let the user pick or fall through to manual
// entry, never to fabricate a "sushi" row that doesn't exist upstream.
//
// Bundled asset size: ~236 KB JSON (1,588 rows). No SQLite file — plain
// JSON keeps this a zero-native-dependency addition (no expo-asset/
// expo-file-system asset-copy step required) and is trivially searchable
// in memory; 1,588 rows is small enough that a linear scan per keystroke
// is imperceptible.
// ═══════════════════════════════════════════════════════════════════════

import type { PendingEntry } from '../pendingEntry';
import afcdData from './data/afcd.json';
import { rankFoodMatches } from './foodMatchRank';

export type AfcdFoodRow = {
  id: string;
  name: string;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

const AFCD_FOODS = afcdData as AfcdFoodRow[];

/** Total number of bundled generic foods — exposed for diagnostics/tests. */
export const AFCD_FOOD_COUNT = AFCD_FOODS.length;

/**
 * Relevance-ranked search over the bundled AFCD table (BUG 2 fix — see
 * foodMatchRank.ts's header for the full diagnosis and rule). Exact match
 * > starts-with > word-boundary > substring anywhere, with early-segment
 * position weighted heavily (AFCD's own "Food, cut, prep..." comma
 * convention), and multi-word queries requiring every term to be present
 * SOMEWHERE in the name. Zero network, always available.
 *
 * This used to sort by name length alone, which is why "Sauce, butter
 * chicken, commercial" and "Pie, savoury, chicken & vegetable,
 * commercial" (both short, both containing "chicken" as a late/incidental
 * word) out-ranked "Chicken, thigh, lean flesh, raw" for the query
 * "chicken" — a real dead-end this fixes.
 */
export function searchAfcd(query: string, limit = 20): AfcdFoodRow[] {
  const q = query.trim();
  if (q.length === 0) return [];

  return rankFoodMatches(AFCD_FOODS, q, (f) => f.name).slice(0, limit);
}

export function afcdRowToPendingEntry(row: AfcdFoodRow, grams = 100): PendingEntry {
  const scale = grams / 100;
  const per100g = {
    kcal: row.kcal_per_100g,
    protein_g: row.protein_per_100g,
    carbs_g: row.carbs_per_100g,
    fat_g: row.fat_per_100g,
  };
  return {
    name: row.name,
    grams,
    kcal: per100g.kcal * scale,
    protein_g: per100g.protein_g * scale,
    carbs_g: per100g.carbs_g * scale,
    fat_g: per100g.fat_g * scale,
    confidence: 'exact',
    source: 'afcd',
    per100g,
  };
}
