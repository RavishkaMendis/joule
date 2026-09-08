// ═══════════════════════════════════════════════════════════════════════
// Open Food Facts lookup — PRD §6, §7.2.
//
// Priority cascade (PRD §6): local saved_food -> bundled AFCD -> Open Food
// Facts -> label OCR. This module is step 3. It is a pure network+mapping
// layer: it does not know about saved_food or AFCD and does not write to
// the sheet — callers (e.g. BarcodeScanScreen) run the earlier cascade
// steps first and fall back to this only on a local miss.
//
// ⚠️ kJ vs kcal (PRD §6): OFF's `nutriments` object often carries
// `energy-kcal_100g` AND/OR `energy-kj_100g` (sometimes only one).
// Australian products frequently only carry kJ. Getting the unit wrong
// makes every number ~4x too high — the single most likely correctness
// bug in this module. `resolveKcalPer100g` below is the one place that
// decides which field wins and applies `kjToKcal` + the sanity rail
// (`isPlausibleKcalPer100g`) from src/lib/pendingEntry.ts.
//
// Free, no API key — but OFF's usage policy requires a real User-Agent
// identifying the app; omitting it risks throttling/blocking.
// ═══════════════════════════════════════════════════════════════════════

import type { EntryConfidence, PendingEntry } from '../pendingEntry';
import { isPlausibleKcalPer100g, kjToKcal } from '../pendingEntry';
import { resolveServingBasis, type OffServingNutriments } from './servingSize';

const USER_AGENT = 'Joule/1.0 (github.com/rav/joule)';
const BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';

/** Typed outcome so a network failure or 404 never throws into the UI — the sheet can offer the label-OCR fallback instead. */
export type OffLookupResult =
  | { ok: true; entry: PendingEntry }
  | { ok: false; reason: 'not_found' | 'network_error' | 'invalid_response' };

/**
 * Typed outcome for text search (PRD §7.2 principle applied to search:
 * never dead-end, never throw). `results` is empty (not an error) when OFF
 * genuinely has no matches — that's a real, valid "miss" the UI must
 * render as an empty state, not silence.
 */
export type OffSearchResult =
  | { ok: true; results: PendingEntry[] }
  | { ok: false; reason: 'network_error' | 'invalid_response' };

/**
 * Raw shape of the subset of OFF's nutriments payload this module reads.
 * Every field is optional — partial panels are the common case. Extends
 * `OffServingNutriments` so the same raw payload carries both the
 * per-100g fields this module has always read AND the per-serving /
 * `serving_size` fields servingSize.ts resolves — OFF returns them on the
 * identical `nutriments`/`product` object, there is no separate request.
 */
type OffNutriments = OffServingNutriments & {
  'energy-kcal_100g'?: number | string | null;
  'energy-kj_100g'?: number | string | null;
  energy_100g?: number | string | null;
  energy_unit?: string | null;
  proteins_100g?: number | string | null;
  carbohydrates_100g?: number | string | null;
  fat_100g?: number | string | null;
};

type OffProduct = {
  product_name?: string | null;
  generic_name?: string | null;
  nutriments?: OffNutriments | null;
};

type OffApiResponse = {
  status?: number;
  status_verbose?: string;
  product?: OffProduct | null;
};

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Decide kcal/100g from whatever energy fields OFF supplied, preferring an
 * explicit kcal field when present (it's already in the right unit), and
 * falling back to converting kJ. Returns null when no usable/plausible
 * energy figure exists — callers must treat that as "energy unknown", not 0.
 *
 * ⚠️ BUG HISTORY — read before touching the generic `energy_100g` branch
 * below. A real logged entry ("H2coco Lychee Coconut Water", 1000g, 0P/
 * 67C/0F) came back as 64 kcal, when 67g of carbohydrate alone is 268 kcal
 * — arithmetically impossible. Root cause: this function used to default
 * `energy_unit` to `'kJ'` whenever OFF omitted it (`n.energy_unit ??
 * 'kJ'`), on the theory that kJ is "OFF's internal unit". For THIS
 * product, whatever number OFF actually returned in `energy_100g` was the
 * KCAL figure (≈26.8), not kJ — dividing it by 4.184 silently produced
 * ≈6.4 kcal/100g, i.e. a ~4x-too-LOW error that `isPlausibleKcalPer100g`
 * (0-900) cannot catch, because it only rejects values that are too HIGH
 * (the classic "kJ misread as kcal" direction) — a value 4x too low is
 * still comfortably inside 0-900.
 *
 * Investigation: OFF's own documentation and Product Opener source do
 * describe `energy_100g`/`energy` as "kJ internally", but that "always
 * kJ" guarantee is NOT actually reliable across every product in a
 * crowd-sourced, contributor-edited database — this exact product is a
 * live counterexample. There is no way to independently verify which
 * convention a given row followed without `energy_unit` telling us. Given
 * that a wrong guess here silently produces a ~4x error in EITHER
 * direction (both of which have now been observed or are trivially
 * possible), the defensible rule is: **do not guess**. When
 * `energy_unit` is absent, the generic `energy_100g` figure is unusable —
 * return null ("energy unknown") rather than assume a unit. Every real
 * OFF product this app has actually hit either populates one of the
 * unit-specific fields (`energy-kcal_100g` / `energy-kj_100g`, handled
 * above and always preferred) or gives `energy_unit` alongside the
 * generic field; the ambiguous case this null covers is the narrow one
 * where NEITHER exists, and refusing to guess there is strictly safer
 * than a coin flip that's been observed to land wrong.
 *
 * When `energy_unit` IS present, it is honoured — including the
 * "contradictory" case where the stated unit doesn't match the value's
 * own scale (e.g. `energy_unit: 'kcal'` on a number that's clearly a kJ
 * reading, or vice versa): the declared unit is tried first, and if the
 * plausibility rail rejects it, the OTHER unit is tried before giving up.
 * This mirrors the existing kcal-vs-kJ fallback above (a garbled kJ value
 * miswritten under the kcal key) applied to the generic field.
 */
export function resolveKcalPer100g(n: OffNutriments): number | null {
  const explicitKcal = toNumber(n['energy-kcal_100g']);
  if (explicitKcal !== null && isPlausibleKcalPer100g(explicitKcal)) {
    return explicitKcal;
  }

  const kj = toNumber(n['energy-kj_100g']);
  if (kj !== null) {
    const fromKj = kjToKcal(kj);
    if (isPlausibleKcalPer100g(fromKj)) return fromKj;
  }

  // Some OFF entries only populate the generic `energy_100g` field. Its
  // unit is whatever `energy_unit` declares — and, per the bug history
  // above, that unit must be EXPLICIT. An absent `energy_unit` here means
  // "we genuinely don't know", not "assume kJ".
  const generic = toNumber(n.energy_100g);
  if (generic !== null && n.energy_unit) {
    const unit = n.energy_unit.toLowerCase();
    if (unit === 'kcal') {
      if (isPlausibleKcalPer100g(generic)) return generic;
      // Contradictory: labelled kcal but the raw number only makes sense
      // as kJ (e.g. a four-figure "kcal" value) — try the kJ reading
      // before giving up, same fallback shape as the dedicated fields.
      const asKj = kjToKcal(generic);
      if (isPlausibleKcalPer100g(asKj)) return asKj;
    } else if (unit === 'kj') {
      const asKj = kjToKcal(generic);
      if (isPlausibleKcalPer100g(asKj)) return asKj;
      // Contradictory the other way: labelled kJ but already kcal-scale.
      if (isPlausibleKcalPer100g(generic)) return generic;
    }
    // Any other/unrecognised unit string: fall through to null below
    // rather than guessing which of kcal/kJ it might mean.
  }

  // Explicit kcal field existed but failed the sanity rail (e.g. a kJ
  // value mistakenly stored under the kcal key), or the generic field had
  // no (or an unusable) declared unit — do not silently accept an
  // implausible number or guess a unit.
  return null;
}

function macroOrNull(v: number | string | null | undefined): number | null {
  const n = toNumber(v);
  return n !== null && n >= 0 ? n : null;
}

/**
 * Confidence reflects how complete the panel is (PRD §6: "Missing/partial
 * macros are common — handle nulls rather than coercing to 0, and mark
 * confidence accordingly"). `exact` only when energy + all three macros
 * are present; `medium` when energy is known but a macro is missing;
 * `low` when even energy is missing (grams-only, no calorie basis).
 */
function confidenceFor(kcal: number | null, protein: number | null, carbs: number | null, fat: number | null): EntryConfidence {
  if (kcal === null) return 'low';
  if (protein === null || carbs === null || fat === null) return 'medium';
  return 'exact';
}

/**
 * Strips barcode noise out of an Open Food Facts product name.
 *
 * OFF is crowd-sourced, and contributors — especially on AU and Asian
 * products — routinely paste the barcode into the product_name field. A
 * real scan in this app returned "15000545 Ayam Tuna Mayonnaise", which
 * then became the logged food's name and would have polluted the saved
 * foods library and every future quick-add chip.
 *
 * Conservative on purpose: only removes a leading/trailing digit run that
 * is either the scanned barcode itself or barcode-shaped (8-14 digits, the
 * EAN/UPC range). A short number is left alone — "500 Island Dressing" and
 * "7 Grain Bread" are legitimate names, and mangling real product names is
 * worse than leaving one ugly one.
 *
 * `barcode` is optional — text search results (unlike a barcode scan)
 * don't always come with a known barcode for the currently-typed query,
 * but OFF's crowd-sourced names have exactly the same barcode-paste
 * problem regardless of how the product was found, so the generic
 * 8-14-digit branch alone still does useful work. When `barcode` is
 * omitted, the pattern relies solely on that generic branch rather than
 * matching a zero-width empty alternative (which would short-circuit the
 * digit-run branch and strip nothing).
 */
export function cleanProductName(rawName: string, barcode?: string): string {
  const alternatives = barcode ? `${barcode}|\\d{8,14}` : `\\d{8,14}`;
  const barcodeLike = new RegExp(`^(?:${alternatives})[\\s\\-–—:.,]*`);
  let cleaned = rawName.replace(barcodeLike, '').trim();
  cleaned = cleaned.replace(new RegExp(`[\\s\\-–—:.,]*(?:${alternatives})$`), '').trim();
  // If stripping left nothing meaningful, the digits WERE the name — keep
  // the original so the user at least sees what was scanned.
  return cleaned.length > 0 ? cleaned : rawName;
}

/**
 * Shared mapping core: an OFF product + nutriments -> a per-100g
 * PendingEntry basis. Used by both barcode lookup (`mapOffResponse`) and
 * text search (`mapOffSearchResponse`) so the kJ/kcal resolution,
 * confidence rules, and barcode-in-name cleanup live in exactly one
 * place. `barcode` is optional here — search results often carry OFF's
 * `code` field (functions as a barcode) but the cleaning regex only needs
 * *a* barcode-shaped string to strip, not necessarily the one the sheet
 * will save against.
 */
function productToPendingEntry(
  rawName: string,
  n: OffNutriments,
  source: PendingEntry['source'],
  barcode?: string
): PendingEntry {
  const name = cleanProductName(rawName, barcode);

  const kcal = resolveKcalPer100g(n);
  const protein = macroOrNull(n.proteins_100g);
  const carbs = macroOrNull(n.carbohydrates_100g);
  const fat = macroOrNull(n.fat_100g);

  const confidence = confidenceFor(kcal, protein, carbs, fat);

  // PendingEntry requires numeric per100g macros — null becomes 0 for
  // display purposes only, with confidence downgraded above so the sheet
  // never claims 0g of a macro is a measured fact.
  const per100g = {
    kcal: kcal ?? 0,
    protein_g: protein ?? 0,
    carbs_g: carbs ?? 0,
    fat_g: fat ?? 0,
  };

  // Serving basis (task brief complaint #1: "It logs grams, not serving
  // size, and there's no way to change it"). `resolveServingBasis` is the
  // one place that parses OFF's inconsistently-populated serving_size /
  // serving_quantity fields — undefined here means genuinely absent or
  // unparseable, never a guessed default.
  const servingBasis = resolveServingBasis(n);

  return {
    name,
    grams: 100,
    kcal: per100g.kcal,
    protein_g: per100g.protein_g,
    carbs_g: per100g.carbs_g,
    fat_g: per100g.fat_g,
    confidence,
    source,
    per100g,
    barcode,
    servingBasis,
  };
}

/** Maps a raw OFF API JSON payload (already parsed) into a lookup result. Exported for fixture-based unit testing without hitting the network. */
export function mapOffResponse(barcode: string, json: OffApiResponse): OffLookupResult {
  if (!json.product || json.status === 0) {
    return { ok: false, reason: 'not_found' };
  }

  const product = json.product;
  const rawName = product.product_name?.trim() || product.generic_name?.trim();
  if (!rawName) {
    return { ok: false, reason: 'invalid_response' };
  }

  const entry = productToPendingEntry(rawName, product.nutriments ?? {}, 'barcode', barcode);
  return { ok: true, entry };
}

/**
 * Look up a barcode against Open Food Facts. Never throws — network
 * errors, non-2xx responses, and unparseable JSON all resolve to a typed
 * miss so callers (BarcodeScanScreen) can offer the label-OCR fallback in
 * the same flow rather than dead-ending (PRD §7.2).
 */
export async function lookupBarcode(barcode: string, fetchImpl: typeof fetch = fetch): Promise<OffLookupResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${BASE_URL}/${encodeURIComponent(barcode)}.json`, {
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }

  if (response.status === 404) {
    return { ok: false, reason: 'not_found' };
  }
  if (!response.ok) {
    return { ok: false, reason: 'network_error' };
  }

  let json: OffApiResponse;
  try {
    json = (await response.json()) as OffApiResponse;
  } catch {
    return { ok: false, reason: 'invalid_response' };
  }

  return mapOffResponse(barcode, json);
}

/** Raw shape of the OFF text-search endpoint response this module reads. */
type OffSearchProduct = {
  code?: string | null;
  product_name?: string | null;
  generic_name?: string | null;
  nutriments?: OffNutriments | null;
};

type OffSearchApiResponse = {
  products?: OffSearchProduct[] | null;
};

/**
 * Maps a raw OFF text-search JSON payload into a list of PendingEntry
 * results. Exported for fixture-based unit testing without hitting the
 * network. Products with no usable name are silently dropped (OFF search
 * results routinely include partially-completed entries) rather than
 * failing the whole search.
 */
export function mapOffSearchResponse(json: OffSearchApiResponse): PendingEntry[] {
  const products = json.products ?? [];
  const entries: PendingEntry[] = [];

  for (const product of products) {
    const rawName = product.product_name?.trim() || product.generic_name?.trim();
    if (!rawName) continue;

    const barcode = product.code?.trim() || undefined;
    entries.push(productToPendingEntry(rawName, product.nutriments ?? {}, 'barcode', barcode));
  }

  return entries;
}

/**
 * Free-text product search against Open Food Facts (PRD §6 tier 3, text
 * search variant of the barcode lookup). Debouncing/cancellation is the
 * caller's responsibility (FoodEntryScreen) — this function itself is a
 * single fire-and-resolve network call that never throws: a network
 * failure or unparseable response resolves to a typed miss so the UI can
 * fall through to AFCD/manual entry instead of hanging or crashing.
 *
 * Reuses the same kJ/kcal resolution, plausibility rail, and barcode-in-
 * name cleanup as `lookupBarcode` via `productToPendingEntry` — the kJ
 * trap (PRD §6) applies identically here: Australian products surfaced by
 * search are just as likely to carry only kJ as ones found by barcode.
 */
export async function searchOpenFoodFacts(
  query: string,
  fetchImpl: typeof fetch = fetch,
  pageSize = 20
): Promise<OffSearchResult> {
  const q = query.trim();
  if (q.length === 0) return { ok: true, results: [] };

  const params = new URLSearchParams({
    search_terms: q,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: String(pageSize),
    fields: 'code,product_name,generic_name,nutriments',
  });

  let response: Response;
  try {
    response = await fetchImpl(`${SEARCH_URL}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch {
    return { ok: false, reason: 'network_error' };
  }

  if (!response.ok) {
    return { ok: false, reason: 'network_error' };
  }

  let json: OffSearchApiResponse;
  try {
    json = (await response.json()) as OffSearchApiResponse;
  } catch {
    return { ok: false, reason: 'invalid_response' };
  }

  return { ok: true, results: mapOffSearchResponse(json) };
}
