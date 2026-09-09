// ═══════════════════════════════════════════════════════════════════════
// dataHealth — tests covering the four categories, priority ordering
// between overlapping conditions, the null-suggestion rule for
// untrustworthy macros, and the real OFF kJ/4.184 bug shape at realistic
// numbers.
// ═══════════════════════════════════════════════════════════════════════

import { scanFoodEntriesForDataHealth, IMPLAUSIBLE_KCAL_PER_GRAM, type DataHealthFinding } from '../dataHealth';
import type { FoodEntryRow } from '../../db/types';

function makeEntry(overrides: Partial<FoodEntryRow> & { id: string }): FoodEntryRow {
  return {
    date: '2026-08-01',
    logged_at: Date.now(),
    name: 'test food',
    grams: 100,
    kcal: 150,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 3,
    source: 'manual',
    confidence: 'exact',
    pot_id: null,
    raw_input: null,
    meal_type: null,
    meal_group_id: null,
    meal_name: null,
    ...overrides,
  } as FoodEntryRow;
}

function findingFor(findings: DataHealthFinding[], id: string): DataHealthFinding | undefined {
  return findings.find((f) => f.entry.id === id);
}

describe('scanFoodEntriesForDataHealth', () => {
  it('returns an empty array — "nothing looks wrong" — for an entirely clean log', () => {
    const entries = [
      makeEntry({ id: 'a', kcal: 152, protein_g: 29, carbs_g: 0, fat_g: 3.9 }), // chicken breast, honest rounding
      makeEntry({ id: 'b', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), // water
    ];
    expect(scanFoodEntriesForDataHealth(entries)).toEqual([]);
  });

  describe('the exact Open Food Facts kJ/4.184 bug shape', () => {
    it('flags a real OFF entry whose kJ value was divided by 4.184 without a declared unit (~4x too low)', () => {
      // A food genuinely ~400 kcal/100g logged at 250g (1000 kcal true),
      // but the OFF bug divided an already-kcal figure by 4.184 again,
      // landing near 239 kcal for the full 250g portion.
      const entry = makeEntry({ id: 'off1', source: 'barcode', grams: 250, kcal: 239, protein_g: 20, carbs_g: 40, fat_g: 65 });
      const findings = scanFoodEntriesForDataHealth([entry]);
      const finding = findingFor(findings, 'off1');
      expect(finding).toBeDefined();
      expect(finding?.category).toBe('atwater_mismatch');
      expect(finding?.statedKcal).toBe(239);
      // 4*20 + 4*40 + 9*65 = 825
      expect(finding?.suggestedKcal).toBe(825);
    });

    it("flags the OFF bug's worst case: a near-zero source value rounds all the way to 0 kcal despite real macros", () => {
      const entry = makeEntry({ id: 'off2', source: 'barcode', grams: 300, kcal: 0, protein_g: 25, carbs_g: 30, fat_g: 10 });
      const findings = scanFoodEntriesForDataHealth([entry]);
      const finding = findingFor(findings, 'off2');
      expect(finding?.category).toBe('zero_energy_with_macros');
      expect(finding?.suggestedKcal).toBe(4 * 25 + 4 * 30 + 9 * 10);
    });
  });

  describe('zero energy with real macros', () => {
    it('flags kcal === 0 with any single nonzero macro', () => {
      const entry = makeEntry({ id: 'z1', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 5 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'z1');
      expect(finding?.category).toBe('zero_energy_with_macros');
      expect(finding?.suggestedKcal).toBe(45);
    });

    it('does NOT flag a genuine zero-macro zero-kcal food (water)', () => {
      const entry = makeEntry({ id: 'water', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
      expect(findingFor(scanFoodEntriesForDataHealth([entry]), 'water')).toBeUndefined();
    });
  });

  describe('implausible energy density', () => {
    it(`flags kcal/gram above the ${IMPLAUSIBLE_KCAL_PER_GRAM} threshold`, () => {
      // 100g stated as 950 kcal -> 9.5 kcal/g, above pure fat.
      const entry = makeEntry({ id: 'dense', grams: 100, kcal: 950, protein_g: 0, carbs_g: 0, fat_g: 100 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'dense');
      expect(finding?.category).toBe('implausible_density');
    });

    it('does not flag pure fat itself at exactly 9 kcal/g', () => {
      const entry = makeEntry({ id: 'fat', grams: 100, kcal: 900, protein_g: 0, carbs_g: 0, fat_g: 100 });
      expect(findingFor(scanFoodEntriesForDataHealth([entry]), 'fat')).toBeUndefined();
    });

    it('flags positive kcal recorded against zero grams (energy from nothing) with a null suggestion (density, not macro-derivable in the usual sense, still computed if macros present)', () => {
      const entry = makeEntry({ id: 'nograms', grams: 0, kcal: 200, protein_g: 10, carbs_g: 10, fat_g: 5 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'nograms');
      expect(finding?.category).toBe('implausible_density');
      // Macros here (10/10/5) ARE non-negative/finite, so a suggestion is still derivable.
      expect(finding?.suggestedKcal).toBe(4 * 10 + 4 * 10 + 9 * 5);
    });

    it('takes priority over a plain Atwater mismatch when both technically apply', () => {
      // Macros imply ~100 kcal (well within Atwater tolerance of 200 if
      // panels differed slightly), but the RAW density itself (200
      // kcal / 10g = 20 kcal/g) is what should be surfaced first.
      const entry = makeEntry({ id: 'both', grams: 10, kcal: 200, protein_g: 5, carbs_g: 5, fat_g: 5 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'both');
      expect(finding?.category).toBe('implausible_density');
    });
  });

  describe('implausible / negative values', () => {
    it('flags negative kcal with a null suggestion (macros cannot be trusted from a corrupted row)', () => {
      const entry = makeEntry({ id: 'negkcal', kcal: -50, protein_g: 10, carbs_g: 10, fat_g: 5 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'negkcal');
      expect(finding?.category).toBe('implausible_values');
      expect(finding?.suggestedKcal).toBeNull();
    });

    it('flags a negative macro with a null suggestion even if kcal itself looks plausible', () => {
      const entry = makeEntry({ id: 'negmacro', kcal: 150, protein_g: -5, carbs_g: 20, fat_g: 3 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'negmacro');
      expect(finding?.category).toBe('implausible_values');
      expect(finding?.suggestedKcal).toBeNull();
    });

    it('flags negative grams', () => {
      const entry = makeEntry({ id: 'neggrams', grams: -100, kcal: 150, protein_g: 10, carbs_g: 10, fat_g: 5 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'neggrams');
      expect(finding?.category).toBe('implausible_values');
    });

    it('takes priority over every other category', () => {
      // Negative AND zero-energy-with-macros-shaped AND Atwater-mismatch-shaped.
      const entry = makeEntry({ id: 'worst', kcal: -1, protein_g: 50, carbs_g: 50, fat_g: 50 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'worst');
      expect(finding?.category).toBe('implausible_values');
    });
  });

  describe('general Atwater mismatch (none of the sharper conditions apply)', () => {
    it('flags a plausible-density, nonzero-energy entry whose macros disagree beyond tolerance', () => {
      const entry = makeEntry({ id: 'mismatch', grams: 100, kcal: 400, protein_g: 25, carbs_g: 0, fat_g: 3 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'mismatch');
      expect(finding?.category).toBe('atwater_mismatch');
      expect(finding?.suggestedKcal).toBe(4 * 25 + 9 * 3); // 127
    });

    it('produces a neutral, non-guilt-inducing message (CLAUDE.md: no red, no guilt)', () => {
      const entry = makeEntry({ id: 'mismatch2', grams: 100, kcal: 400, protein_g: 25, carbs_g: 0, fat_g: 3 });
      const finding = findingFor(scanFoodEntriesForDataHealth([entry]), 'mismatch2');
      expect(finding?.message.toLowerCase()).not.toMatch(/wrong|error|bad|mistake|warning/);
    });
  });

  describe('ordering and multiplicity', () => {
    it('preserves input order and returns exactly one finding per suspect entry', () => {
      const entries = [
        makeEntry({ id: 'ok1', kcal: 150, protein_g: 10, carbs_g: 20, fat_g: 3 }),
        makeEntry({ id: 'bad1', kcal: 0, protein_g: 10, carbs_g: 0, fat_g: 0 }),
        makeEntry({ id: 'ok2', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }),
        makeEntry({ id: 'bad2', kcal: -5, protein_g: 1, carbs_g: 1, fat_g: 1 }),
      ];
      const findings = scanFoodEntriesForDataHealth(entries);
      expect(findings.map((f) => f.entry.id)).toEqual(['bad1', 'bad2']);
    });

    it('is a pure function: does not mutate the entries it scans', () => {
      const entries = [makeEntry({ id: 'a', kcal: 0, protein_g: 5, carbs_g: 0, fat_g: 0 })];
      const snapshot = JSON.parse(JSON.stringify(entries));
      scanFoodEntriesForDataHealth(entries);
      expect(entries).toEqual(snapshot);
    });
  });
});
