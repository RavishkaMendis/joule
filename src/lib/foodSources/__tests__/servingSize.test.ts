// ═══════════════════════════════════════════════════════════════════════
// SERVING SIZE — parsing + serving⇄gram conversion tests.
//
// Real-use complaint (task brief): "It logs grams, not serving size."
// OFF's serving fields are inconsistently populated free text — these
// tests are deliberately exhaustive on the parse side (including garbled/
// absent input) and on the kJ-trap-per-serving side, since that's the
// specific correctness risk the brief calls out by name.
// ═══════════════════════════════════════════════════════════════════════

import {
  parseServingLabel,
  parseServingSizeGrams,
  per100gFromPerServing,
  perServingFromPer100g,
  resolveServingBasis,
  resolveServingKcal,
  resolveServingMacros,
} from '../servingSize';

describe('parseServingSizeGrams', () => {
  it('parses a plain gram figure', () => {
    expect(parseServingSizeGrams('30 g')).toBe(30);
    expect(parseServingSizeGrams('30g')).toBe(30);
    expect(parseServingSizeGrams('30 grams')).toBe(30);
  });

  it('prefers the parenthesised gram figure over a leading count', () => {
    expect(parseServingSizeGrams('2 slices (60g)')).toBe(60);
    expect(parseServingSizeGrams('1 bar (45 g)')).toBe(45);
  });

  it('parses a decimal gram figure', () => {
    expect(parseServingSizeGrams('27.5g')).toBeCloseTo(27.5, 5);
  });

  it('handles a comma decimal separator (some EU-sourced OFF entries)', () => {
    expect(parseServingSizeGrams('27,5 g')).toBeCloseTo(27.5, 5);
  });

  it('converts ounces to grams when no gram figure is present', () => {
    expect(parseServingSizeGrams('1 oz')).toBeCloseTo(28.3495, 3);
  });

  it('returns null for garbled/unusual text with no extractable gram figure', () => {
    expect(parseServingSizeGrams('1 tub')).toBeNull();
    expect(parseServingSizeGrams('a handful')).toBeNull();
    expect(parseServingSizeGrams('serving')).toBeNull();
  });

  it('returns null for absent/empty input, never throwing', () => {
    expect(parseServingSizeGrams(null)).toBeNull();
    expect(parseServingSizeGrams(undefined)).toBeNull();
    expect(parseServingSizeGrams('')).toBeNull();
    expect(parseServingSizeGrams('   ')).toBeNull();
  });

  it('ignores a zero or negative figure (not a usable serving weight)', () => {
    expect(parseServingSizeGrams('0 g')).toBeNull();
  });
});

describe('parseServingLabel', () => {
  it('extracts the descriptive text ahead of a parenthesised gram clause', () => {
    expect(parseServingLabel('2 slices (60g)')).toBe('2 slices');
    expect(parseServingLabel('1 bar (45 g)')).toBe('1 bar');
  });

  it('returns undefined for a bare gram figure with no descriptive text', () => {
    expect(parseServingLabel('30 g')).toBeUndefined();
    expect(parseServingLabel('30g')).toBeUndefined();
  });

  it('returns a descriptive label even with no parenthesised grams at all', () => {
    expect(parseServingLabel('1 tub')).toBe('1 tub');
    expect(parseServingLabel('1 slice')).toBe('1 slice');
  });

  it('returns undefined for absent/empty input', () => {
    expect(parseServingLabel(null)).toBeUndefined();
    expect(parseServingLabel(undefined)).toBeUndefined();
    expect(parseServingLabel('')).toBeUndefined();
  });
});

describe('resolveServingBasis', () => {
  it('prefers numeric serving_quantity over re-parsing serving_size text', () => {
    const basis = resolveServingBasis({ serving_size: '2 slices (60g)', serving_quantity: 58 });
    expect(basis).toEqual({ gramsPerServing: 58, label: '2 slices' });
  });

  it('falls back to parsing serving_size text when serving_quantity is absent', () => {
    const basis = resolveServingBasis({ serving_size: '2 slices (60g)' });
    expect(basis).toEqual({ gramsPerServing: 60, label: '2 slices' });
  });

  it('falls back to parsing serving_size text when serving_quantity is not a positive number', () => {
    expect(resolveServingBasis({ serving_size: '30 g', serving_quantity: 0 })).toEqual({ gramsPerServing: 30 });
    expect(resolveServingBasis({ serving_size: '30 g', serving_quantity: NaN as unknown as number })).toEqual({
      gramsPerServing: 30,
    });
  });

  it('omits the label when serving_size has no descriptive text, using only the quantity', () => {
    const basis = resolveServingBasis({ serving_size: '30 g', serving_quantity: 30 });
    expect(basis).toEqual({ gramsPerServing: 30 });
  });

  it('returns undefined when neither field yields a usable gram figure (garbled/absent)', () => {
    expect(resolveServingBasis({})).toBeUndefined();
    expect(resolveServingBasis({ serving_size: '1 tub' })).toBeUndefined();
    expect(resolveServingBasis({ serving_size: 'a handful', serving_quantity: null })).toBeUndefined();
  });

  it('handles numeric-looking strings for serving_quantity (OFF sometimes returns numbers as strings)', () => {
    const basis = resolveServingBasis({ serving_quantity: '45' as unknown as number });
    expect(basis).toEqual({ gramsPerServing: 45 });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// THE kJ TRAP, PER SERVING — task brief: "The kJ trap still applies to
// per-serving nutriments exactly as it does per-100g." These tests mirror
// the per-100g kJ tests in openFoodFacts.test.ts but through the
// per-serving path, and assert both paths agree once normalised.
// ═══════════════════════════════════════════════════════════════════════

describe('resolveServingKcal — the kJ trap, per serving', () => {
  it('uses the per-serving kJ field when only kJ is present (the common AU case)', () => {
    // A 30g serving at ~450 kJ/serving -> ~107.5 kcal/serving.
    const kcal = resolveServingKcal({ 'energy-kj_serving': 450 }, 30);
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeCloseTo(450 / 4.184, 5);
  });

  it('uses the per-serving kcal field directly when only kcal is present', () => {
    const kcal = resolveServingKcal({ 'energy-kcal_serving': 120 }, 30);
    expect(kcal).toBe(120);
  });

  it('rejects an implausible per-serving kcal figure after normalising to a per-100g basis, falling back to kJ', () => {
    // A 30g serving claiming 3000 kcal/serving normalises to 10,000
    // kcal/100g — obviously implausible (a kJ figure miswritten under the
    // kcal key). The kJ field (450 -> ~107.5 kcal) must win instead.
    const kcal = resolveServingKcal({ 'energy-kcal_serving': 3000, 'energy-kj_serving': 450 }, 30);
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeCloseTo(450 / 4.184, 5);
  });

  it('a per-serving kcal figure that would be implausible per-100g but is plausible for a LARGE serving is accepted', () => {
    // A 500g serving (a whole ready-meal) at 600 kcal/serving is 120
    // kcal/100g — perfectly plausible — even though 600 alone looks large
    // for "a serving". The normalisation must use the actual serving
        // weight, not treat 900 as a flat per-serving ceiling.
    const kcal = resolveServingKcal({ 'energy-kcal_serving': 600 }, 500);
    expect(kcal).toBe(600);
  });

  it('returns null when neither per-serving energy field is present', () => {
    expect(resolveServingKcal({}, 30)).toBeNull();
  });

  it('returns null when gramsPerServing is not a usable positive number', () => {
    expect(resolveServingKcal({ 'energy-kcal_serving': 100 }, 0)).toBeNull();
    expect(resolveServingKcal({ 'energy-kcal_serving': 100 }, -5)).toBeNull();
    expect(resolveServingKcal({ 'energy-kcal_serving': 100 }, NaN)).toBeNull();
  });

  it('falls back to the generic energy_serving field with its declared unit', () => {
    expect(resolveServingKcal({ energy_serving: 450, energy_unit: 'kJ' }, 30)).toBeCloseTo(450 / 4.184, 5);
    expect(resolveServingKcal({ energy_serving: 120, energy_unit: 'kcal' }, 30)).toBe(120);
  });

  it('agrees with the per-100g path once normalised (single source of truth)', () => {
    // 250 kcal/100g on a 60g serving = 150 kcal/serving.
    const perServing = resolveServingKcal({ 'energy-kcal_serving': 150 }, 60);
    expect(perServing).toBeCloseTo(250 * 0.6, 5);
  });
});

describe('resolveServingMacros', () => {
  it('resolves kcal via resolveServingKcal and reads the other macros directly', () => {
    const macros = resolveServingMacros(
      { 'energy-kcal_serving': 150, proteins_serving: 5, carbohydrates_serving: 20, fat_serving: 3 },
      60
    );
    expect(macros).toEqual({ kcal: 150, protein_g: 5, carbs_g: 20, fat_g: 3 });
  });

  it('returns null (never 0) for macros OFF did not supply', () => {
    const macros = resolveServingMacros({ 'energy-kcal_serving': 150 }, 60);
    expect(macros.protein_g).toBeNull();
    expect(macros.carbs_g).toBeNull();
    expect(macros.fat_g).toBeNull();
  });

  it('returns null kcal for a garbled/implausible-after-normalisation figure', () => {
    const macros = resolveServingMacros({ 'energy-kcal_serving': 50000 }, 30);
    expect(macros.kcal).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SERVING ⇄ GRAM CONVERSION — the single code path per100gFromPerServing/
// perServingFromPer100g must go through, so the unit toggle and the
// barcode mapper can never numerically disagree.
// ═══════════════════════════════════════════════════════════════════════

describe('per100gFromPerServing / perServingFromPer100g', () => {
  const perServing = { kcal: 150, protein_g: 5, carbs_g: 20, fat_g: 3 };

  it('derives per-100g from per-serving using the serving weight', () => {
    const per100g = per100gFromPerServing(perServing, 60);
    expect(per100g.kcal).toBeCloseTo(250, 6);
    expect(per100g.protein_g).toBeCloseTo(5 / 0.6, 6);
    expect(per100g.carbs_g).toBeCloseTo(20 / 0.6, 6);
    expect(per100g.fat_g).toBeCloseTo(3 / 0.6, 6);
  });

  it('round-trips exactly: per-serving -> per-100g -> per-serving', () => {
    const per100g = per100gFromPerServing(perServing, 60);
    const roundTripped = perServingFromPer100g(per100g, 60);
    expect(roundTripped.kcal).toBeCloseTo(perServing.kcal, 9);
    expect(roundTripped.protein_g).toBeCloseTo(perServing.protein_g, 9);
    expect(roundTripped.carbs_g).toBeCloseTo(perServing.carbs_g, 9);
    expect(roundTripped.fat_g).toBeCloseTo(perServing.fat_g, 9);
  });

  it('round-trips the other direction: per-100g -> per-serving -> per-100g', () => {
    const per100g = { kcal: 250, protein_g: 8.3, carbs_g: 33.3, fat_g: 5 };
    const perServingBasis = perServingFromPer100g(per100g, 45);
    const roundTripped = per100gFromPerServing(perServingBasis, 45);
    expect(roundTripped.kcal).toBeCloseTo(per100g.kcal, 9);
    expect(roundTripped.protein_g).toBeCloseTo(per100g.protein_g, 9);
  });

  it('returns the input unchanged when gramsPerServing is not a usable positive number', () => {
    expect(per100gFromPerServing(perServing, 0)).toEqual(perServing);
    expect(per100gFromPerServing(perServing, NaN)).toEqual(perServing);
    expect(perServingFromPer100g(perServing, -1)).toEqual(perServing);
  });
});
