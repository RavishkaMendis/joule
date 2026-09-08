// ═══════════════════════════════════════════════════════════════════════
// Atwater cross-check tests — the systemic fix for the coconut-water bug
// class (see atwaterCheck.ts's header for the full diagnosis). Covers
// true positives, true negatives, zero-macro foods, unknown-macro
// entries, and the exact coconut-water numbers from the task brief.
// ═══════════════════════════════════════════════════════════════════════

import {
  ATWATER_TOLERANCE_FLOOR_KCAL,
  ATWATER_TOLERANCE_FRACTION,
  atwaterToleranceKcal,
  checkAtwaterConsistency,
  expectedKcalFromMacros,
  formatAtwaterNote,
  type AtwaterCheckResult,
} from '../atwaterCheck';

describe('expectedKcalFromMacros', () => {
  it('applies the standard Atwater general factors: 4/4/9', () => {
    expect(expectedKcalFromMacros(10, 20, 5)).toBe(4 * 10 + 4 * 20 + 9 * 5);
  });

  it('is 0 for an all-zero macro panel', () => {
    expect(expectedKcalFromMacros(0, 0, 0)).toBe(0);
  });
});

describe('atwaterToleranceKcal', () => {
  it('uses the percentage floor for small expected values', () => {
    // 20% of 100 is 20, which is below the 50 kcal floor.
    expect(atwaterToleranceKcal(100)).toBe(ATWATER_TOLERANCE_FLOOR_KCAL);
  });

  it('uses the percentage once it exceeds the floor', () => {
    // 20% of 1000 = 200, well above the 50 kcal floor.
    expect(atwaterToleranceKcal(1000)).toBeCloseTo(1000 * ATWATER_TOLERANCE_FRACTION, 5);
  });

  it('is exactly the floor at expectedKcal = 0', () => {
    expect(atwaterToleranceKcal(0)).toBe(ATWATER_TOLERANCE_FLOOR_KCAL);
  });
});

describe('checkAtwaterConsistency', () => {
  // ═══════════════════════════════════════════════════════════════════
  // THE EXACT COCONUT-WATER CASE — task brief's confirmed bug, checked at
  // the quantity that was actually logged (1000g), which is what a real
  // ConfirmSheet/FoodEntryScreen check runs against.
  // ═══════════════════════════════════════════════════════════════════
  it('flags the exact coconut water entry (1000g, 64 kcal, 0P/67C/0F) as a mismatch', () => {
    const result = checkAtwaterConsistency({ kcal: 64, protein_g: 0, carbs_g: 67, fat_g: 0 });
    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') return;
    expect(result.expectedKcal).toBe(268); // 4 * 67
    expect(result.statedKcal).toBe(64);
    expect(result.diffKcal).toBe(64 - 268);
    // Sanity: the disagreement (204 kcal) is nowhere near the tolerance
    // (max(20% of 268, 50) = 53.6) — this is not a borderline call.
    expect(Math.abs(result.diffKcal)).toBeGreaterThan(result.toleranceKcal * 3);
  });

  it('does NOT flag the same food at its correct energy (268 kcal for 67g carb)', () => {
    const result = checkAtwaterConsistency({ kcal: 268, protein_g: 0, carbs_g: 67, fat_g: 0 });
    expect(result.status).toBe('ok');
  });

  // ═══════════════════════════════════════════════════════════════════
  // TRUE POSITIVES — real disagreements, including the inverse (~4x too
  // HIGH) direction the existing 0-900 rail already partially covers, to
  // confirm this check catches it independently too.
  // ═══════════════════════════════════════════════════════════════════
  describe('true positives', () => {
    it('flags a kJ-read-as-kcal style error (~4x too high)', () => {
      // Real macros imply ~300 kcal, but a kJ figure was used unconverted.
      const result = checkAtwaterConsistency({ kcal: 1255, protein_g: 20, carbs_g: 30, fat_g: 10 });
      expect(result.status).toBe('mismatch');
    });

    it('flags a plausible-looking but wrong barcode misread', () => {
      // Chicken breast: ~165 kcal/100g typical, but macros imply ~120.
      const result = checkAtwaterConsistency({ kcal: 400, protein_g: 25, carbs_g: 0, fat_g: 3 });
      expect(result.status).toBe('mismatch');
    });

    it('flags a large absolute-scale entry even when the per-100g basis would look small', () => {
      // 1kg of a food whose macros imply ~180 kcal/100g but which is
      // stated as only 40 kcal/100g scaled up — the kind of error that
      // only becomes obviously large once checked at the logged quantity.
      const result = checkAtwaterConsistency({ kcal: 400, protein_g: 100, carbs_g: 300, fat_g: 100 });
      expect(result.status).toBe('mismatch');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // TRUE NEGATIVES — honest panels that legitimately deviate from pure
  // Atwater (fibre, sugar alcohols, rounding) and must NOT be flagged.
  // ═══════════════════════════════════════════════════════════════════
  describe('true negatives', () => {
    it('accepts a typical rounded nutrition panel (small multi-source rounding)', () => {
      // Chicken breast, baked: protein 29, fat 3.9 -> Atwater ~151.1,
      // panel commonly rounds to 152.
      const result = checkAtwaterConsistency({ kcal: 152, protein_g: 29, carbs_g: 0, fat_g: 3.9 });
      expect(result.status).toBe('ok');
    });

    it('accepts a high-fibre food where Atwater over-predicts (fibre counted at less than 4 kcal/g on the panel)', () => {
      // Lentils, cooked: ~9g protein, ~20g carb (incl. ~8g fibre), ~0.4g fat
      // per 100g. Pure Atwater on total carbohydrate: 4*9+4*20+9*0.4 = 119.6.
      // Real panels commonly print ~116 (fibre credited less than 4 kcal/g) —
      // well within the 20%/50kcal tolerance, not a bug.
      const result = checkAtwaterConsistency({ kcal: 116, protein_g: 9, carbs_g: 20, fat_g: 0.4 });
      expect(result.status).toBe('ok');
    });

    it('accepts a sugar-alcohol product where Atwater over-predicts (2.4 kcal/g actual vs 4 assumed)', () => {
      // A "low carb" bar: 15g protein, 25g "carbohydrate" of which most is
      // sugar alcohol (~2.4 kcal/g), 8g fat. Pure Atwater: 4*15+4*25+9*8=232.
      // Real printed energy for this composition is often notably lower
      // (labels increasingly net out the alcohol) but must still land
      // inside the tolerance for genuinely honest labelling variance.
      const result = checkAtwaterConsistency({ kcal: 190, protein_g: 15, carbs_g: 25, fat_g: 8 });
      expect(result.status).toBe('ok');
    });

    it('accepts a small entry with a few kcal of rounding noise (must not cry wolf)', () => {
      // Splash of milk in coffee: 1g carb (~4 kcal expected) stated as 6.
      const result = checkAtwaterConsistency({ kcal: 6, protein_g: 0, carbs_g: 1, fat_g: 0 });
      expect(result.status).toBe('ok');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ZERO-MACRO FOODS — genuinely 0 kcal (water, black coffee, tea) must
  // never be flagged; a real error on a "zero" item still must be caught.
  // ═══════════════════════════════════════════════════════════════════
  describe('zero-macro foods', () => {
    it('accepts water (0 kcal, 0/0/0 macros)', () => {
      const result = checkAtwaterConsistency({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
      expect(result.status).toBe('ok');
    });

    it('accepts black coffee (2 kcal, 0/0/0 macros — within the rounding floor)', () => {
      const result = checkAtwaterConsistency({ kcal: 2, protein_g: 0, carbs_g: 0, fat_g: 0 });
      expect(result.status).toBe('ok');
    });

    it('still flags a genuinely wrong energy figure on an otherwise zero-macro item', () => {
      const result = checkAtwaterConsistency({ kcal: 400, protein_g: 0, carbs_g: 0, fat_g: 0 });
      expect(result.status).toBe('mismatch');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // UNKNOWN-MACRO ENTRIES — cannot be cross-checked; must be neither
  // "ok" nor "mismatch".
  // ═══════════════════════════════════════════════════════════════════
  describe('unknown-macro entries', () => {
    it('is unknown when kcal is missing', () => {
      const result = checkAtwaterConsistency({ kcal: null, protein_g: 5, carbs_g: 10, fat_g: 2 });
      expect(result.status).toBe('unknown');
    });

    it('is unknown when a single macro is missing (partial panel)', () => {
      const result = checkAtwaterConsistency({ kcal: 200, protein_g: 5, carbs_g: undefined, fat_g: 2 });
      expect(result.status).toBe('unknown');
    });

    it('is unknown when every field is missing', () => {
      const result = checkAtwaterConsistency({ kcal: null, protein_g: null, carbs_g: null, fat_g: null });
      expect(result.status).toBe('unknown');
    });

    it('is unknown (never a crash or NaN mismatch) when a value is NaN', () => {
      const result = checkAtwaterConsistency({ kcal: NaN, protein_g: 5, carbs_g: 10, fat_g: 2 });
      expect(result.status).toBe('unknown');
    });

    it('is unknown when a value is +/-Infinity', () => {
      const result = checkAtwaterConsistency({ kcal: Infinity, protein_g: 5, carbs_g: 10, fat_g: 2 });
      expect(result.status).toBe('unknown');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // DOUBLE-CONVERSION REGRESSION GUARD — a kJ value converted TWICE
  // (kcal = kJ / 4.184 / 4.184) produces a number so small the Atwater
  // check must catch it just as reliably as a value converted zero times.
  // ═══════════════════════════════════════════════════════════════════
  it('catches a double kJ->kcal conversion (energy divided by 4.184 twice)', () => {
    // True value: 1500 kJ -> 358.5 kcal for a panel implying ~360 kcal
    // from macros. A double conversion yields 358.5 / 4.184 ≈ 85.7.
    const trueKcal = 1500 / 4.184;
    const doubleConverted = trueKcal / 4.184;
    const result = checkAtwaterConsistency({ kcal: doubleConverted, protein_g: 20, carbs_g: 40, fat_g: 12 });
    expect(result.status).toBe('mismatch');
  });

  it('accepts the correctly single-converted figure for the same panel', () => {
    const singleConverted = 1500 / 4.184;
    // protein 20 + carbs 40 + fat 12 -> expected 4*20+4*40+9*12 = 348,
    // close enough to 358.5 to land inside tolerance (honest rounding).
    const result = checkAtwaterConsistency({ kcal: singleConverted, protein_g: 20, carbs_g: 40, fat_g: 12 });
    expect(result.status).toBe('ok');
  });
});

describe('formatAtwaterNote', () => {
  it('is a neutral, factual sentence stating both figures without accusing either', () => {
    const result = checkAtwaterConsistency({ kcal: 64, protein_g: 0, carbs_g: 67, fat_g: 0 });
    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') return;
    const note = formatAtwaterNote(result);
    expect(note).toContain('64 kcal');
    expect(note).toContain('268 kcal');
    // PRD §10: no guilt language.
    expect(note.toLowerCase()).not.toMatch(/wrong|error|bad|warning|incorrect|mistake/);
  });

  it('rounds both figures to whole kcal for display', () => {
    const fake: Extract<AtwaterCheckResult, { status: 'mismatch' }> = {
      status: 'mismatch',
      statedKcal: 63.6,
      expectedKcal: 267.8,
      diffKcal: 63.6 - 267.8,
      toleranceKcal: 53.6,
    };
    const note = formatAtwaterNote(fake);
    expect(note).toContain('64 kcal');
    expect(note).toContain('268 kcal');
  });
});
