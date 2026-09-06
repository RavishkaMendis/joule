// ═══════════════════════════════════════════════════════════════════════
// foodMatchRank — BUG 2 fix ("Searching 'chicken' didn't let me find
// chicken thighs — just chicken raw mince or whatever, and I couldn't
// manually add"). Pure ranking logic, no database/component involved —
// see afcd.test.ts for the integration-level check against the real
// bundled data.
// ═══════════════════════════════════════════════════════════════════════

import { scoreFoodNameMatch, rankFoodMatches } from '../foodMatchRank';

describe('scoreFoodNameMatch', () => {
  it('returns null for a blank/whitespace query', () => {
    expect(scoreFoodNameMatch('Chicken, thigh, lean flesh, raw', '')).toBeNull();
    expect(scoreFoodNameMatch('Chicken, thigh, lean flesh, raw', '   ')).toBeNull();
  });

  it('scores an exact (case-insensitive) whole-name match as the maximum possible', () => {
    const score = scoreFoodNameMatch('Chicken, thigh, lean flesh, raw', 'chicken, thigh, lean flesh, raw');
    expect(score).toBe(Number.POSITIVE_INFINITY);
  });

  it('THE ACCEPTANCE CASE — "Chicken, thigh, lean flesh, raw" ranks above "Pie, savoury, chicken & vegetable, commercial" for the query "chicken thigh"', () => {
    const thighScore = scoreFoodNameMatch('Chicken, thigh, lean flesh, raw', 'chicken thigh');
    const pieScore = scoreFoodNameMatch('Pie, savoury, chicken & vegetable, commercial', 'chicken thigh');
    expect(thighScore).not.toBeNull();
    // The pie has "chicken" but no "thigh" anywhere — multi-word queries
    // require ALL terms present, so it isn't a match at all.
    expect(pieScore).toBeNull();
  });

  it('THE ACCEPTANCE CASE — same ranking holds for the bare query "chicken" (both names contain it, but position/tier decide)', () => {
    const thighScore = scoreFoodNameMatch('Chicken, thigh, lean flesh, raw', 'chicken');
    const pieScore = scoreFoodNameMatch('Pie, savoury, chicken & vegetable, commercial', 'chicken');
    expect(thighScore).not.toBeNull();
    expect(pieScore).not.toBeNull();
    expect(thighScore as number).toBeGreaterThan(pieScore as number);
  });

  it('a short, incidental late-word match (the reported dead-end) scores below an early/starts-with match', () => {
    const thighScore = scoreFoodNameMatch('Chicken, thigh, lean flesh, raw', 'chicken');
    const sauceScore = scoreFoodNameMatch('Sauce, butter chicken, commercial', 'chicken');
    expect(sauceScore).not.toBeNull();
    expect(thighScore as number).toBeGreaterThan(sauceScore as number);
  });

  it('is case-insensitive', () => {
    expect(scoreFoodNameMatch('Chicken, breast, raw', 'CHICKEN')).toEqual(scoreFoodNameMatch('Chicken, breast, raw', 'chicken'));
  });

  it('treats a comma in the query the same as a space (AFCD-style typed queries)', () => {
    const withComma = scoreFoodNameMatch('Chicken, breast, lean flesh, raw', 'chicken, breast');
    const withSpace = scoreFoodNameMatch('Chicken, breast, lean flesh, raw', 'chicken breast');
    expect(withComma).not.toBeNull();
    expect(withComma).toBe(withSpace);
  });

  it('a query term absent from the name entirely is not a match, regardless of how well other terms match', () => {
    expect(scoreFoodNameMatch('Chicken, breast, raw', 'chicken zzzznotarealword')).toBeNull();
  });

  it('an exact-segment match ranks above a mere starts-with, which ranks above a word-boundary-only match', () => {
    const exact = scoreTierOnly('chicken, x', 'chicken');
    const startsWith = scoreTierOnly('chickenpox, x', 'chicken'); // not a real food, purely testing the tier
    const wordBoundary = scoreTierOnly('roast chicken, x', 'chicken');
    expect(exact).toBeGreaterThan(startsWith);
    expect(startsWith).toBeGreaterThan(wordBoundary);
  });

  it('rewards an early segment over the identical term appearing only in a late segment', () => {
    const early = scoreFoodNameMatch('Chicken, whole, raw', 'chicken');
    const late = scoreFoodNameMatch('Casserole, chicken, commercial', 'chicken');
    expect(early as number).toBeGreaterThan(late as number);
  });
});

/** Helper: score with a single-term query against a two-segment name, for isolating one tier at a time. */
function scoreTierOnly(name: string, term: string): number {
  return scoreFoodNameMatch(name, term) as number;
}

describe('rankFoodMatches', () => {
  type Food = { id: string; name: string };
  const foods: Food[] = [
    { id: 'pie', name: 'Pie, savoury, chicken & vegetable, commercial' },
    { id: 'sauce', name: 'Sauce, butter chicken, commercial' },
    { id: 'thigh', name: 'Chicken, thigh, lean flesh, raw' },
    { id: 'breast', name: 'Chicken, breast, lean flesh, raw' },
    { id: 'unrelated', name: 'Apple, raw, unpeeled' },
  ];

  it('drops non-matches entirely rather than ranking them low', () => {
    const results = rankFoodMatches(foods, 'chicken thigh', (f) => f.name);
    expect(results.map((f) => f.id)).toEqual(['thigh']);
  });

  it('ranks the real cut above incidental dish/sauce mentions for a bare "chicken" query', () => {
    const results = rankFoodMatches(foods, 'chicken', (f) => f.name);
    const ids = results.map((f) => f.id);
    expect(ids).toContain('thigh');
    expect(ids.indexOf('thigh')).toBeLessThan(ids.indexOf('pie'));
    expect(ids.indexOf('thigh')).toBeLessThan(ids.indexOf('sauce'));
    expect(ids).not.toContain('unrelated');
  });

  it('is a pure function — same inputs, same output, no mutation of the input array', () => {
    const before = [...foods];
    rankFoodMatches(foods, 'chicken', (f) => f.name);
    expect(foods).toEqual(before);
  });

  it('returns an empty array when nothing matches', () => {
    expect(rankFoodMatches(foods, 'zzzznotarealfood', (f) => f.name)).toEqual([]);
  });
});
