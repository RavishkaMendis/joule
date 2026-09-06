import { groupEntriesBySection, sectionLabel } from '../mealSections';
import type { FoodEntryRow } from '../../db/types';

function entry(overrides: Partial<FoodEntryRow> & { id: string }): FoodEntryRow {
  return {
    date: '2026-08-20',
    logged_at: 1000,
    name: 'item',
    grams: 100,
    kcal: 100,
    protein_g: 10,
    carbs_g: 10,
    fat_g: 5,
    source: 'manual',
    confidence: 'exact',
    pot_id: null,
    raw_input: null,
    meal_type: null,
    meal_group_id: null,
    meal_name: null,
    tare_g: null,
    ...overrides,
  };
}

/** Sums kcal/macros directly across raw entries — the ground truth a day total is compared against. */
function sumEntries(entries: FoodEntryRow[]) {
  return entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein_g: acc.protein_g + e.protein_g,
      carbs_g: acc.carbs_g + e.carbs_g,
      fat_g: acc.fat_g + e.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

describe('groupEntriesBySection', () => {
  it('empty day: no sections at all', () => {
    expect(groupEntriesBySection([])).toEqual([]);
  });

  it('null meal_type entries are never dropped — they land in an "Unsorted" section', () => {
    const entries = [
      entry({ id: 'a', name: 'Mystery snack', kcal: 120, meal_type: null }),
      entry({ id: 'b', name: 'Legacy entry', kcal: 80, meal_type: null }),
    ];
    const sections = groupEntriesBySection(entries);
    expect(sections).toHaveLength(1);
    expect(sections[0].mealType).toBeNull();
    expect(sections[0].label).toBe('Unsorted');
    expect(sections[0].groups.flatMap((g) => g.members.map((m) => m.id)).sort()).toEqual(['a', 'b']);
  });

  it('all-one-section day: only that section is returned', () => {
    const entries = [
      entry({ id: 'a', kcal: 300, meal_type: 'breakfast' }),
      entry({ id: 'b', kcal: 200, meal_type: 'breakfast' }),
    ];
    const sections = groupEntriesBySection(entries);
    expect(sections).toHaveLength(1);
    expect(sections[0].mealType).toBe('breakfast');
    expect(sections[0].totals.kcal).toBe(500);
  });

  it('sections render in day order (Breakfast, Lunch, Dinner, Snack, Unsorted) regardless of input order', () => {
    const entries = [
      entry({ id: 'snack1', kcal: 50, meal_type: 'snack' }),
      entry({ id: 'unsorted1', kcal: 10, meal_type: null }),
      entry({ id: 'dinner1', kcal: 400, meal_type: 'dinner' }),
      entry({ id: 'breakfast1', kcal: 250, meal_type: 'breakfast' }),
      entry({ id: 'lunch1', kcal: 300, meal_type: 'lunch' }),
    ];
    const sections = groupEntriesBySection(entries);
    expect(sections.map((s) => s.mealType)).toEqual(['breakfast', 'lunch', 'dinner', 'snack', null]);
  });

  it('an empty section (e.g. no lunch logged) is simply absent, not present with zero groups', () => {
    const entries = [entry({ id: 'a', kcal: 300, meal_type: 'breakfast' })];
    const sections = groupEntriesBySection(entries);
    expect(sections.map((s) => s.mealType)).toEqual(['breakfast']);
    expect(sections.find((s) => s.mealType === 'lunch')).toBeUndefined();
  });

  it('a meal group spanning the meal-type boundary stays ONE row in ONE section, anchored on its earliest member', () => {
    const entries = [
      // A meal-photo capture whose members disagree on meal_type (shouldn't
      // happen via normal reassignment, but must still resolve
      // deterministically rather than splitting the group's kcal).
      entry({ id: 'g1', logged_at: 1, kcal: 200, meal_type: 'lunch', meal_group_id: 'grp', meal_name: 'Group meal' }),
      entry({ id: 'g2', logged_at: 2, kcal: 300, meal_type: 'dinner', meal_group_id: 'grp', meal_name: 'Group meal' }),
      entry({ id: 'g3', logged_at: 3, kcal: 100, meal_type: null, meal_group_id: 'grp', meal_name: 'Group meal' }),
    ];
    const sections = groupEntriesBySection(entries);
    // The whole group (600 kcal) lands in Lunch, since g1 (logged_at 1) is
    // the earliest member and its meal_type is 'lunch'.
    expect(sections).toHaveLength(1);
    expect(sections[0].mealType).toBe('lunch');
    expect(sections[0].groups).toHaveLength(1);
    expect(sections[0].groups[0].members).toHaveLength(3);
    expect(sections[0].totals.kcal).toBe(600);
  });

  it('section subtotals sum to the day total across a mixed day (meal groups + standalone + null)', () => {
    const entries = [
      entry({ id: 'b1', logged_at: 1, kcal: 350, protein_g: 20, carbs_g: 40, fat_g: 10, meal_type: 'breakfast' }),
      entry({ id: 'l1', logged_at: 2, kcal: 210, protein_g: 15, carbs_g: 20, fat_g: 5, meal_type: 'lunch', meal_group_id: 'grpL', meal_name: 'Lunch bowl' }),
      entry({ id: 'l2', logged_at: 3, kcal: 190, protein_g: 12, carbs_g: 18, fat_g: 6, meal_type: 'lunch', meal_group_id: 'grpL', meal_name: 'Lunch bowl' }),
      entry({ id: 'd1', logged_at: 4, kcal: 500, protein_g: 35, carbs_g: 45, fat_g: 15, meal_type: 'dinner' }),
      entry({ id: 's1', logged_at: 5, kcal: 90, protein_g: 2, carbs_g: 10, fat_g: 4, meal_type: 'snack' }),
      entry({ id: 'u1', logged_at: 6, kcal: 60, protein_g: 1, carbs_g: 5, fat_g: 2, meal_type: null }),
    ];

    const sections = groupEntriesBySection(entries);
    const dayTotal = sumEntries(entries);
    const reconciled = sections.reduce(
      (acc, s) => ({
        kcal: acc.kcal + s.totals.kcal,
        protein_g: acc.protein_g + s.totals.protein_g,
        carbs_g: acc.carbs_g + s.totals.carbs_g,
        fat_g: acc.fat_g + s.totals.fat_g,
      }),
      { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
    );

    expect(reconciled).toEqual(dayTotal);
    // And every section individually matches the entries that fed it.
    expect(sections.map((s) => s.mealType)).toEqual(['breakfast', 'lunch', 'dinner', 'snack', null]);
  });

  it('sectionLabel maps null to Unsorted and each MealType to its display label', () => {
    expect(sectionLabel(null)).toBe('Unsorted');
    expect(sectionLabel('breakfast')).toBe('Breakfast');
    expect(sectionLabel('lunch')).toBe('Lunch');
    expect(sectionLabel('dinner')).toBe('Dinner');
    expect(sectionLabel('snack')).toBe('Snack');
  });
});
