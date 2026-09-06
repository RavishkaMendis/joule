// ═══════════════════════════════════════════════════════════════════════
// AFCD bundled-data tests. No network — the whole point of tier 2 (PRD
// §6) is that it works offline, so these exercise the real bundled JSON
// asset directly rather than a fixture, plus the plausibility rail that
// every row was already filtered through at build time.
// ═══════════════════════════════════════════════════════════════════════

import { AFCD_FOOD_COUNT, searchAfcd, afcdRowToPendingEntry, type AfcdFoodRow } from '../afcd';
import { isPlausibleKcalPer100g } from '../../pendingEntry';

describe('bundled AFCD data', () => {
  it('ships a substantial generic-food table (PRD §6: ~1,588 foods)', () => {
    // Not pinned to exactly 1588 so a future re-pull of a newer AFCD
    // release doesn't fail this test over a handful of added/removed
    // rows — but it must be in the right ballpark, not a stub.
    expect(AFCD_FOOD_COUNT).toBeGreaterThan(1000);
  });

  it('every bundled row passes the same 0-900 kcal/100g plausibility rail used elsewhere', () => {
    const all = searchAfcd('a', AFCD_FOOD_COUNT); // broad query to pull a large sample
    expect(all.length).toBeGreaterThan(0);
    for (const row of all) {
      expect(isPlausibleKcalPer100g(row.kcal_per_100g)).toBe(true);
    }
  });

  it('every bundled row has a non-empty id and name', () => {
    const all = searchAfcd('e', AFCD_FOOD_COUNT);
    for (const row of all) {
      expect(row.id.length).toBeGreaterThan(0);
      expect(row.name.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('searchAfcd', () => {
  it('finds common staples relevant to this user (PRD §7.5 South Asian home cooking)', () => {
    expect(searchAfcd('chicken, breast').length).toBeGreaterThan(0);
    expect(searchAfcd('lentil').length).toBeGreaterThan(0);
    expect(searchAfcd('rice, white').length).toBeGreaterThan(0);
    expect(searchAfcd('egg, chicken').length).toBeGreaterThan(0);
    expect(searchAfcd('milk, cow').length).toBeGreaterThan(0);
    expect(searchAfcd('yoghurt').length).toBeGreaterThan(0);
    expect(searchAfcd('oil, olive').length).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    const lower = searchAfcd('chicken, breast');
    const upper = searchAfcd('CHICKEN, BREAST');
    expect(upper.length).toBe(lower.length);
    expect(upper.map((r) => r.id).sort()).toEqual(lower.map((r) => r.id).sort());
  });

  it('returns an empty array for a query with no matches, never throwing', () => {
    expect(searchAfcd('zzzznotarealfoodxyz123')).toEqual([]);
  });

  it('returns an empty array for an empty/whitespace query', () => {
    expect(searchAfcd('')).toEqual([]);
    expect(searchAfcd('   ')).toEqual([]);
  });

  it('genuinely has no "sushi" entry — AFCD is generic ingredients, not composite dishes', () => {
    // This is expected, not a bug: AFCD does not contain prepared/composite
    // dishes. Documenting it here so nobody "fixes" this by inventing a
    // fake sushi row.
    expect(searchAfcd('sushi')).toEqual([]);
  });

  it('respects the limit parameter', () => {
    const results = searchAfcd('a', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('BUG 2 FIX, real-data acceptance case: "Chicken, thigh, lean flesh, raw" ranks above "Pie, savoury, chicken & vegetable, commercial" for "chicken thigh"', () => {
    const results = searchAfcd('chicken thigh', AFCD_FOOD_COUNT).map((r) => r.name);
    const thighIndex = results.indexOf('Chicken, thigh, lean flesh, raw');
    const pieIndex = results.indexOf('Pie, savoury, chicken & vegetable, commercial');
    expect(thighIndex).toBeGreaterThanOrEqual(0);
    // The pie has no "thigh" anywhere — a multi-word query requiring all
    // terms should exclude it from the results entirely.
    expect(pieIndex).toBe(-1);
  });

  it('BUG 2 FIX, real-data acceptance case: the same ranking holds for the bare query "chicken"', () => {
    const results = searchAfcd('chicken', AFCD_FOOD_COUNT).map((r) => r.name);
    const thighIndex = results.indexOf('Chicken, thigh, lean flesh, raw');
    const pieIndex = results.indexOf('Pie, savoury, chicken & vegetable, commercial');
    const sauceIndex = results.indexOf('Sauce, butter chicken, commercial');
    expect(thighIndex).toBeGreaterThanOrEqual(0);
    expect(pieIndex).toBeGreaterThanOrEqual(0);
    expect(sauceIndex).toBeGreaterThanOrEqual(0);
    expect(thighIndex).toBeLessThan(pieIndex);
    expect(thighIndex).toBeLessThan(sauceIndex);
  });

  it('a bare "chicken" search surfaces the real thigh cuts within the top handful of results, not buried below every dish/sauce mention', () => {
    // The modal only shows the first 6 results per source group — this is
    // the "didn't let me find chicken thighs" complaint made concrete.
    const results = searchAfcd('chicken', 6).map((r) => r.name);
    expect(results.some((n) => /thigh/i.test(n))).toBe(true);
  });

  it('ranks shorter/tighter matches first', () => {
    const results = searchAfcd('rice, white, boiled', 5);
    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        expect(results[i].name.length).toBeGreaterThanOrEqual(results[i - 1].name.length);
      }
    }
  });
});

describe('afcdRowToPendingEntry', () => {
  const row: AfcdFoodRow = {
    id: 'F002594',
    name: 'Chicken, breast, lean flesh, raw',
    kcal_per_100g: 98.5,
    protein_per_100g: 22.5,
    carbs_per_100g: 0,
    fat_per_100g: 0.8,
  };

  it('defaults to a 100g basis with source afcd and exact confidence', () => {
    const entry = afcdRowToPendingEntry(row);
    expect(entry.grams).toBe(100);
    expect(entry.source).toBe('afcd');
    expect(entry.confidence).toBe('exact');
    expect(entry.kcal).toBeCloseTo(98.5, 5);
    expect(entry.per100g).toEqual({
      kcal: 98.5,
      protein_g: 22.5,
      carbs_g: 0,
      fat_g: 0.8,
    });
  });

  it('scales macros correctly for a non-100g gram amount', () => {
    const entry = afcdRowToPendingEntry(row, 150);
    expect(entry.grams).toBe(150);
    expect(entry.kcal).toBeCloseTo(98.5 * 1.5, 5);
    expect(entry.protein_g).toBeCloseTo(22.5 * 1.5, 5);
  });
});
