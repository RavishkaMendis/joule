// ═══════════════════════════════════════════════════════════════════════
// Food SEARCH cascade — the text-search sibling of lookupCascade.ts.
//
// PRD §6 priority cascade, applied to typed search instead of a barcode:
//   1. Local saved_food   — instant, offline, personal. Always first.
//   2. Bundled AFCD       — instant, offline, ~1,588 generic foods.
//   3. Open Food Facts    — network, debounced/cancellable, typed miss.
//
// Unlike the barcode cascade, search doesn't stop at the first hit — all
// three tiers can have genuinely different, simultaneously useful matches
// for the same query (e.g. "chicken breast" might match a personal saved
// food AND a generic AFCD entry AND several OFF products), so this module
// returns a *grouped* result rather than a single winner. The UI (PRD
// §10: "Confidence always visible") is expected to show all three groups
// so the user can see where each number came from, not just merge them
// into one undifferentiated list.
//
// This module owns steps 1-2 (synchronous, local) and step 3's shape (an
// async, cancellable, non-throwing network call) but leaves debouncing
// timing to the caller (FoodEntryScreen) since that's a UI/timer concern,
// not a data-source concern.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import type { SavedFoodRow } from '../../db/types';
import * as foodRepo from '../../db/repositories/foodRepo';
import { searchAfcd, afcdRowToPendingEntry, type AfcdFoodRow } from './afcd';
import { searchOpenFoodFacts, type OffSearchResult } from './openFoodFacts';
import type { PendingEntry } from '../pendingEntry';

/** Local results (saved_food + AFCD) resolve instantly and never fail. */
export type LocalSearchResults = {
  savedFood: SavedFoodRow[];
  afcd: AfcdFoodRow[];
};

/**
 * Tiers 1-2 of the cascade: local `saved_food` and the bundled AFCD table.
 * Both are offline and synchronous-fast, so they're bundled into one call
 * that the screen can await immediately on every keystroke without a
 * debounce (PRD §9.1's 10-second test doesn't even come into play here —
 * this is sub-millisecond).
 */
export async function searchLocal(db: Database, query: string, limit = 8): Promise<LocalSearchResults> {
  const q = query.trim();
  if (q.length === 0) return { savedFood: [], afcd: [] };

  const savedFood = await foodRepo.searchSavedFood(db, q);
  const afcd = searchAfcd(q, limit);

  return { savedFood: savedFood.slice(0, limit), afcd };
}

/**
 * Tier 3: Open Food Facts text search. Thin re-export of
 * `searchOpenFoodFacts` under the cascade's naming so callers only need
 * to import from one module for the full cascade — kept as a pass-through
 * (not reimplemented) so the kJ/kcal handling stays defined in exactly
 * one place (openFoodFacts.ts).
 */
export async function searchRemote(query: string, fetchImpl: typeof fetch = fetch): Promise<OffSearchResult> {
  return searchOpenFoodFacts(query, fetchImpl);
}

export function afcdToEntry(row: AfcdFoodRow): PendingEntry {
  return afcdRowToPendingEntry(row);
}
