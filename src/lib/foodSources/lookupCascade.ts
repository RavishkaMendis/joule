// ═══════════════════════════════════════════════════════════════════════
// Food lookup priority cascade — PRD §6:
//
//   "Priority cascade on any lookup:
//     1. Local saved_food — instant, offline, personal. Always checked first.
//     2. Bundled AFCD SQLite — Australian Food Composition Database.
//     3. Open Food Facts — barcode lookup, free, no API key.
//     4. Label OCR — the reliable fallback. Always available."
//
// This module implements the cascade for BARCODE lookups: saved_food (by
// barcode) -> Open Food Facts. AFCD is bundled (src/lib/foodSources/afcd.ts)
// but deliberately does not appear here — the published AFCD dataset has
// no barcode field (it's generic ingredients, not retail products with
// barcodes), so tier 2 has nothing to match a scanned barcode against.
// AFCD's real slot in the cascade is *text search*
// (src/lib/foodSources/searchCascade.ts: saved_food -> AFCD -> Open Food
// Facts), which is where "sushi"/"rice"/"chicken breast" actually resolve.
// Step 4 (label OCR) is owned by a different agent; this module's job is
// simply to report a typed miss so the caller (BarcodeScanScreen) can
// route to it, never to invoke it directly.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import type { SavedFoodRow } from '../../db/types';
import type { PendingEntry } from '../pendingEntry';
import { lookupBarcode, type OffLookupResult } from './openFoodFacts';

export type CascadeMissReason = 'not_found' | 'network_error' | 'invalid_response';

export type CascadeResult =
  | { ok: true; entry: PendingEntry; hitSource: 'saved_food' | 'afcd' | 'open_food_facts' }
  | { ok: false; reason: CascadeMissReason };

function savedFoodToPendingEntry(row: SavedFoodRow): PendingEntry {
  const per100g = {
    kcal: row.kcal_per_100g,
    protein_g: row.protein_per_100g,
    carbs_g: row.carbs_per_100g,
    fat_g: row.fat_per_100g,
  };
  const grams = row.default_grams > 0 ? row.default_grams : 100;
  const scale = grams / 100;
  return {
    name: row.name,
    grams,
    kcal: per100g.kcal * scale,
    protein_g: per100g.protein_g * scale,
    carbs_g: per100g.carbs_g * scale,
    fat_g: per100g.fat_g * scale,
    confidence: 'exact',
    source: 'barcode',
    per100g,
    barcode: row.barcode ?? undefined,
  };
}

/**
 * Look up a barcode via saved_food, then Open Food Facts (AFCD has no
 * barcode data — see the note in step 2 below for why it's not part of
 * this cascade). Returns a typed miss — never throws — when both come up
 * empty, so the caller can offer label OCR without dead-ending the user
 * (PRD §7.2).
 */
export async function lookupByBarcode(db: Database, barcode: string): Promise<CascadeResult> {
  // ── 1. Local saved_food — instant, offline, personal. Always first. ──
  const saved = await db.getFirstAsync<SavedFoodRow>('SELECT * FROM saved_food WHERE barcode = ?', [barcode]);
  if (saved) {
    return { ok: true, entry: savedFoodToPendingEntry(saved), hitSource: 'saved_food' };
  }

  // ── 2. Bundled AFCD — deliberately NOT part of barcode lookup. ──
  // AFCD (Australian Food Composition Database, Release 3.0, 1,588
  // generic foods; see src/lib/foodSources/afcd.ts) now ships in the app
  // bundle and is wired into the *search* cascade
  // (src/lib/foodSources/searchCascade.ts), which is where it belongs:
  // AFCD is a generic-ingredient composition database, and its published
  // data has no barcode field at all (it's not a retail-product database
  // like Open Food Facts). There is no `afcdRepo.lookupByBarcode` to add
  // here — a barcode scan has nothing for tier 2 to match against, so it
  // always falls through to Open Food Facts, correctly.

  // ── 3. Open Food Facts — free, no API key, needs a User-Agent. ──
  const off: OffLookupResult = await lookupBarcode(barcode);
  if (off.ok) {
    return { ok: true, entry: off.entry, hitSource: 'open_food_facts' };
  }

  return { ok: false, reason: off.reason };
}
