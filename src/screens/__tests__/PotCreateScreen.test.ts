// ═══════════════════════════════════════════════════════════════════════
// PotCreateScreen — pure ingredient-row validation tests (audit finding:
// grams/macro fields were only checked for "something was typed", never
// for a sane sign — a stray minus sign or a "0g" typo passed every
// existing check and would corrupt this pot's kcal_per_g). This repo has
// no React Native Testing Library (see OnboardingScreen.test.ts's note),
// so this exercises `ingredientRowIsValid` directly, same pattern as that
// file's `validateOnboardingStep`.
// ═══════════════════════════════════════════════════════════════════════

import { ingredientRowIsValid } from '../PotCreateScreen';

const VALID_ROW = { gramsRaw: '200', kcal: '260', protein_g: '5', carbs_g: '57', fat_g: '0.4' };

describe('ingredientRowIsValid', () => {
  it('accepts a fully and validly typed row', () => {
    expect(ingredientRowIsValid(VALID_ROW)).toBe(true);
  });

  it('accepts a macro that is exactly 0 (e.g. fat in a black coffee)', () => {
    expect(ingredientRowIsValid({ ...VALID_ROW, fat_g: '0' })).toBe(true);
  });

  it('rejects a blank field', () => {
    expect(ingredientRowIsValid({ ...VALID_ROW, gramsRaw: '' })).toBe(false);
    expect(ingredientRowIsValid({ ...VALID_ROW, kcal: '' })).toBe(false);
  });

  it('AUDIT FIX: rejects zero grams — an ingredient cannot contribute zero grams to a batch', () => {
    expect(ingredientRowIsValid({ ...VALID_ROW, gramsRaw: '0' })).toBe(false);
  });

  it('AUDIT FIX: rejects negative grams (a stray minus sign) — this used to silently pass and corrupt kcal_per_g', () => {
    expect(ingredientRowIsValid({ ...VALID_ROW, gramsRaw: '-200' })).toBe(false);
  });

  it('AUDIT FIX: rejects a negative macro value', () => {
    expect(ingredientRowIsValid({ ...VALID_ROW, kcal: '-260' })).toBe(false);
    expect(ingredientRowIsValid({ ...VALID_ROW, protein_g: '-5' })).toBe(false);
    expect(ingredientRowIsValid({ ...VALID_ROW, carbs_g: '-1' })).toBe(false);
    expect(ingredientRowIsValid({ ...VALID_ROW, fat_g: '-0.1' })).toBe(false);
  });

  it('rejects a non-numeric field', () => {
    expect(ingredientRowIsValid({ ...VALID_ROW, gramsRaw: 'abc' })).toBe(false);
  });
});
