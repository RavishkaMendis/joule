// ═══════════════════════════════════════════════════════════════════════
// GEMINI RESPONSE → PendingEntry MAPPING
//
// Pure, dependency-free functions so this layer is testable against
// fixture JSON without ever touching the network (per task brief: "test
// the parsing/mapping layer against fixture JSON — never hit the live
// API in tests").
//
// Two PRD rules enforced here, both non-negotiable:
//
//   §6 the kJ trap — Australian nutrition panels print kJ. When
//   `energy_unit_detected === 'kJ'`, every per-100g energy figure is
//   converted with `kjToKcal` BEFORE it is scaled to absolute grams, and
//   every result is gated through `isPlausibleKcalPer100g` (0-900).
//   Getting the order of operations wrong (scaling before converting, or
//   skipping the gate) reintroduces the ~4x bug this field exists to
//   prevent.
//
//   §7.4 the meal-photo annotation rule — "the model identifies
//   components; the user's stated quantities always win." Where the
//   user gave an explicit gram amount for an item, that number overrides
//   whatever Gemini estimated, and the merged entry is never marked
//   `low` confidence purely because Gemini's own guess was low — the
//   user just corrected it.
// ═══════════════════════════════════════════════════════════════════════

import type { EntryConfidence, EntrySource, PendingEntry } from '../pendingEntry';
import { isPlausibleKcalPer100g, kjToKcal } from '../pendingEntry';
import type { GeminiFoodItem, GeminiStructuredResponse } from './schema';

export type MapItemResult =
  | { ok: true; entry: PendingEntry }
  | { ok: false; reason: string; item: GeminiFoodItem };

/**
 * Converts a single Gemini item's per-100g energy figure to kcal,
 * honoring `energy_unit_detected`. This is the one place `kjToKcal` is
 * called from the AI paths — keep it that way so there is exactly one
 * seam to test and audit.
 */
export function normalizeKcalPer100g(item: Pick<GeminiFoodItem, 'kcal_per_100g' | 'energy_unit_detected'>): number {
  return item.energy_unit_detected === 'kJ' ? kjToKcal(item.kcal_per_100g) : item.kcal_per_100g;
}

/**
 * Maps one Gemini item to a PendingEntry, applying the kJ conversion and
 * the 0-900 plausibility rail. Returns a discriminated result rather than
 * throwing so a caller can drop just the bad item and keep the rest of a
 * multi-item response (PRD: never dead-end the user over one bad line).
 */
export function mapGeminiItemToPendingEntry(
  item: GeminiFoodItem,
  source: EntrySource,
  rawInput?: string
): MapItemResult {
  const kcalPer100g = normalizeKcalPer100g(item);

  if (!isPlausibleKcalPer100g(kcalPer100g)) {
    return {
      ok: false,
      reason: `kcal_per_100g ${kcalPer100g.toFixed(0)} (from ${item.kcal_per_100g} ${item.energy_unit_detected}) is outside the plausible 0-900 range`,
      item,
    };
  }

  const grams = item.grams;
  const scale = grams / 100;
  const per100g = {
    kcal: kcalPer100g,
    protein_g: item.protein_per_100g,
    carbs_g: item.carbs_per_100g,
    fat_g: item.fat_per_100g,
  };

  const entry: PendingEntry = {
    name: item.name,
    grams,
    kcal: per100g.kcal * scale,
    protein_g: per100g.protein_g * scale,
    carbs_g: per100g.carbs_g * scale,
    fat_g: per100g.fat_g * scale,
    confidence: item.confidence,
    source,
    per100g,
    assumptions: item.assumptions || undefined,
    rawInput,
  };

  return { ok: true, entry };
}

export type MapResponseResult = {
  entries: PendingEntry[];
  /** Items dropped for failing the plausibility rail, with a reason each (surfaced for debugging, not shown raw to the user). */
  rejected: { item: GeminiFoodItem; reason: string }[];
};

/**
 * Maps a full structured response to PendingEntry[], keeping good items
 * and setting aside bad ones rather than failing the whole batch — voice
 * and meal-photo responses routinely contain several items, and PRD §7.1's
 * "one wrap, 150g chicken, tbsp of oil, bit of yoghurt" example should not
 * be discarded wholesale because one line item OCR'd garbage.
 */
export function mapGeminiResponseToPendingEntries(
  response: GeminiStructuredResponse,
  source: EntrySource,
  rawInput?: string
): MapResponseResult {
  const entries: PendingEntry[] = [];
  const rejected: { item: GeminiFoodItem; reason: string }[] = [];

  for (const item of response.items) {
    const result = mapGeminiItemToPendingEntry(item, source, rawInput);
    if (result.ok) {
      entries.push(result.entry);
    } else {
      rejected.push({ item: result.item, reason: result.reason });
    }
  }

  return { entries, rejected };
}

/** A user-stated quantity for one meal-photo component, keyed by the component's name as Gemini reported it. */
export type UserQuantityOverride = {
  /** Must match a `PendingEntry.name` from the same response (case-insensitive). */
  name: string;
  grams: number;
};

/**
 * PRD §7.4: "the model identifies components; the user's stated
 * quantities always win." Applies explicit user gram overrides on top of
 * Gemini's estimates:
 *
 *   - Matching entry: grams (and derived macros, via its retained
 *     per100g basis) are replaced by the user's number. Confidence is
 *     promoted to 'high' (a stated quantity is no longer a guess) unless
 *     it was already 'exact'.
 *   - Non-matching entries: left as Gemini estimated, confidence stays
 *     whatever Gemini reported (typically 'low' per PRD §7.4 when no
 *     quantity was given for that item).
 *
 * Matching is case-insensitive substring matching in both directions so
 * "chicken" (user) matches "grilled chicken breast" (model) without
 * requiring exact strings from either side.
 */
export function applyUserQuantityOverrides(
  entries: PendingEntry[],
  overrides: UserQuantityOverride[]
): PendingEntry[] {
  if (overrides.length === 0) return entries;

  return entries.map((entry) => {
    const match = overrides.find((o) => namesMatch(o.name, entry.name));
    if (!match) return entry;

    const grams = match.grams;
    const scale = entry.per100g ? grams / 100 : grams / (entry.grams || 1);
    const promoted: EntryConfidence = entry.confidence === 'exact' ? 'exact' : 'high';

    return {
      ...entry,
      grams,
      kcal: entry.per100g ? entry.per100g.kcal * scale : entry.kcal * scale,
      protein_g: entry.per100g ? entry.per100g.protein_g * scale : entry.protein_g * scale,
      carbs_g: entry.per100g ? entry.per100g.carbs_g * scale : entry.carbs_g * scale,
      fat_g: entry.per100g ? entry.per100g.fat_g * scale : entry.fat_g * scale,
      confidence: promoted,
    };
  });
}

function namesMatch(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na.length === 0 || nb.length === 0) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
