// ═══════════════════════════════════════════════════════════════════════
// MAPPING LAYER TESTS — fixture JSON only, never the live API.
//
// Covers the three things the task brief calls out as most likely to be
// wrong: the kJ conversion path, the kcal (no-conversion) path, and the
// 0-900 plausibility rail rejecting an out-of-range/misdetected result.
// Also covers the PRD §7.4 "user's stated quantities always win" rule.
// ═══════════════════════════════════════════════════════════════════════

import { kjToKcal } from '../../pendingEntry';
import {
  applyUserQuantityOverrides,
  mapGeminiItemToPendingEntry,
  mapGeminiResponseToPendingEntries,
  normalizeKcalPer100g,
} from '../mapToPendingEntry';
import type { GeminiFoodItem, GeminiStructuredResponse } from '../schema';

function fixtureItem(overrides: Partial<GeminiFoodItem> = {}): GeminiFoodItem {
  return {
    name: 'Weet-Bix',
    grams: 100,
    kcal_per_100g: 1500,
    energy_unit_detected: 'kJ',
    protein_per_100g: 12,
    carbs_per_100g: 70,
    fat_per_100g: 2,
    confidence: 'exact',
    assumptions: '',
    ...overrides,
  };
}

describe('normalizeKcalPer100g — the kJ trap', () => {
  it('converts kJ to kcal using kjToKcal', () => {
    const item = fixtureItem({ kcal_per_100g: 1500, energy_unit_detected: 'kJ' });
    expect(normalizeKcalPer100g(item)).toBeCloseTo(kjToKcal(1500), 5);
    // Sanity: 1500 kJ Weet-Bix-like panel should land ~358.5 kcal/100g, not ~1500.
    expect(normalizeKcalPer100g(item)).toBeCloseTo(358.5, 0);
  });

  it('passes kcal through unchanged when unit is already kcal', () => {
    const item = fixtureItem({ kcal_per_100g: 250, energy_unit_detected: 'kcal' });
    expect(normalizeKcalPer100g(item)).toBe(250);
  });
});

describe('mapGeminiItemToPendingEntry — kJ path', () => {
  it('produces a plausible PendingEntry from a kJ-labelled panel', () => {
    const item = fixtureItem({ kcal_per_100g: 1500, energy_unit_detected: 'kJ', grams: 100 });
    const result = mapGeminiItemToPendingEntry(item, 'label_ocr', 'raw');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.kcal).toBeCloseTo(kjToKcal(1500), 5);
    expect(result.entry.per100g?.kcal).toBeCloseTo(358.5, 0);
    expect(result.entry.source).toBe('label_ocr');
    expect(result.entry.rawInput).toBe('raw');
  });

  it('scales kJ-derived per-100g kcal correctly for non-100g gram amounts', () => {
    // 200g of a 1500 kJ/100g food should be 2x the per-100g kcal, in kcal terms.
    const item = fixtureItem({ kcal_per_100g: 1500, energy_unit_detected: 'kJ', grams: 200 });
    const result = mapGeminiItemToPendingEntry(item, 'label_ocr');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.kcal).toBeCloseTo(kjToKcal(1500) * 2, 4);
  });
});

describe('mapGeminiItemToPendingEntry — kcal path', () => {
  it('produces a plausible PendingEntry when the panel is already in kcal', () => {
    const item = fixtureItem({ kcal_per_100g: 250, energy_unit_detected: 'kcal', grams: 150 });
    const result = mapGeminiItemToPendingEntry(item, 'label_ocr');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.per100g?.kcal).toBe(250);
    expect(result.entry.kcal).toBeCloseTo(375, 5); // 250 * 1.5
  });
});

describe('mapGeminiItemToPendingEntry — 0-900 plausibility rail', () => {
  it('rejects a kcal_per_100g that is implausibly high after conversion (unit misdetection symptom)', () => {
    // If the model mislabels a kJ reading as kcal, kcal_per_100g would be
    // reported as the raw kJ number (e.g. 1500) with energy_unit_detected
    // wrongly set to 'kcal' — the rail must still catch this even though
    // no conversion happens, because 1500 "kcal"/100g is nonsense.
    const item = fixtureItem({ kcal_per_100g: 1500, energy_unit_detected: 'kcal' });
    const result = mapGeminiItemToPendingEntry(item, 'label_ocr');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/outside the plausible 0-900 range/);
  });

  it('rejects a negative kcal_per_100g', () => {
    const item = fixtureItem({ kcal_per_100g: -10, energy_unit_detected: 'kcal' });
    const result = mapGeminiItemToPendingEntry(item, 'label_ocr');
    expect(result.ok).toBe(false);
  });

  it('accepts a value right at the top of the plausible range', () => {
    // 900 kcal/100g is pure fat/oil territory — plausible, must not be rejected.
    const item = fixtureItem({ kcal_per_100g: 900, energy_unit_detected: 'kcal' });
    const result = mapGeminiItemToPendingEntry(item, 'label_ocr');
    expect(result.ok).toBe(true);
  });

  it('rejects just above the top of the plausible range', () => {
    const item = fixtureItem({ kcal_per_100g: 901, energy_unit_detected: 'kcal' });
    const result = mapGeminiItemToPendingEntry(item, 'label_ocr');
    expect(result.ok).toBe(false);
  });
});

describe('mapGeminiResponseToPendingEntries — partial batch survival', () => {
  it('keeps good items and sets aside implausible ones rather than discarding the whole response', () => {
    const response: GeminiStructuredResponse = {
      items: [
        fixtureItem({ name: 'Good food', kcal_per_100g: 250, energy_unit_detected: 'kcal' }),
        fixtureItem({ name: 'Bad food', kcal_per_100g: 1500, energy_unit_detected: 'kcal' }),
      ],
    };

    const { entries, rejected } = mapGeminiResponseToPendingEntries(response, 'voice');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Good food');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].item.name).toBe('Bad food');
  });

  it('maps assumptions verbatim onto PendingEntry.assumptions', () => {
    const response: GeminiStructuredResponse = {
      items: [fixtureItem({ assumptions: 'Assumed 1 tbsp oil ≈ 14g' })],
    };
    const { entries } = mapGeminiResponseToPendingEntries(response, 'meal_photo');
    expect(entries[0].assumptions).toBe('Assumed 1 tbsp oil ≈ 14g');
  });

  it('omits assumptions when the model returned an empty string', () => {
    const response: GeminiStructuredResponse = { items: [fixtureItem({ assumptions: '' })] };
    const { entries } = mapGeminiResponseToPendingEntries(response, 'voice');
    expect(entries[0].assumptions).toBeUndefined();
  });
});

describe('applyUserQuantityOverrides — PRD §7.4 "user quantities always win"', () => {
  it('overrides grams and rescales macros for a matching item, promoting confidence', () => {
    const response: GeminiStructuredResponse = {
      items: [
        fixtureItem({
          name: 'Grilled chicken breast',
          kcal_per_100g: 165,
          energy_unit_detected: 'kcal',
          protein_per_100g: 31,
          carbs_per_100g: 0,
          fat_per_100g: 3.6,
          grams: 120,
          confidence: 'low',
        }),
      ],
    };
    const { entries } = mapGeminiResponseToPendingEntries(response, 'meal_photo');

    const overridden = applyUserQuantityOverrides(entries, [{ name: 'chicken', grams: 150 }]);

    expect(overridden[0].grams).toBe(150);
    expect(overridden[0].kcal).toBeCloseTo(165 * 1.5, 5);
    expect(overridden[0].protein_g).toBeCloseTo(31 * 1.5, 5);
    expect(overridden[0].confidence).toBe('high');
  });

  it('leaves non-matching items untouched, including their low confidence', () => {
    const response: GeminiStructuredResponse = {
      items: [
        fixtureItem({ name: 'Rice', grams: 200, confidence: 'low', kcal_per_100g: 130, energy_unit_detected: 'kcal' }),
        fixtureItem({ name: 'Chicken', grams: 120, confidence: 'low', kcal_per_100g: 165, energy_unit_detected: 'kcal' }),
      ],
    };
    const { entries } = mapGeminiResponseToPendingEntries(response, 'meal_photo');

    const overridden = applyUserQuantityOverrides(entries, [{ name: 'chicken', grams: 150 }]);

    const rice = overridden.find((e) => e.name === 'Rice');
    expect(rice?.grams).toBe(200);
    expect(rice?.confidence).toBe('low');
  });

  it('never demotes an already-exact confidence', () => {
    const response: GeminiStructuredResponse = {
      items: [fixtureItem({ name: 'Chicken', confidence: 'exact', kcal_per_100g: 165, energy_unit_detected: 'kcal' })],
    };
    const { entries } = mapGeminiResponseToPendingEntries(response, 'meal_photo');
    const overridden = applyUserQuantityOverrides(entries, [{ name: 'chicken', grams: 150 }]);
    expect(overridden[0].confidence).toBe('exact');
  });

  it('is a no-op when there are no overrides', () => {
    const response: GeminiStructuredResponse = {
      items: [fixtureItem({ name: 'Rice', kcal_per_100g: 130, energy_unit_detected: 'kcal' })],
    };
    const { entries } = mapGeminiResponseToPendingEntries(response, 'meal_photo');
    const overridden = applyUserQuantityOverrides(entries, []);
    expect(overridden).toEqual(entries);
  });
});
