import { groupEntriesByMeal } from '../mealGrouping';
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

describe('groupEntriesByMeal', () => {
  it('the sushi-photo scenario: 5 grouped items collapse into ONE row with correct totals', () => {
    const entries: FoodEntryRow[] = [
      entry({ id: 'e1', logged_at: 1, name: 'Sushi rice', kcal: 234, protein_g: 4.9, carbs_g: 50.4, fat_g: 0.5, meal_group_id: 'grp1', meal_name: 'Chicken Sushi', source: 'meal_photo' }),
      entry({ id: 'e2', logged_at: 2, name: 'Chicken filling', kcal: 149, protein_g: 27.9, carbs_g: 0, fat_g: 3.6, meal_group_id: 'grp1', meal_name: 'Chicken Sushi', source: 'meal_photo' }),
      entry({ id: 'e3', logged_at: 3, name: 'Avocado', kcal: 80, protein_g: 1, carbs_g: 4.3, fat_g: 7.4, meal_group_id: 'grp1', meal_name: 'Chicken Sushi', source: 'meal_photo' }),
      entry({ id: 'e4', logged_at: 4, name: 'Nori', kcal: 15, protein_g: 1.5, carbs_g: 2, fat_g: 0.1, meal_group_id: 'grp1', meal_name: 'Chicken Sushi', source: 'meal_photo' }),
      entry({ id: 'e5', logged_at: 5, name: 'Spicy mayo', kcal: 90, protein_g: 0.3, carbs_g: 1, fat_g: 9.8, meal_group_id: 'grp1', meal_name: 'Chicken Sushi', source: 'meal_photo' }),
    ];

    const groups = groupEntriesByMeal(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].displayName).toBe('Chicken Sushi');
    expect(groups[0].members).toHaveLength(5);
    expect(Math.round(groups[0].totals.kcal)).toBe(568); // 234+149+80+15+90
  });

  it('sums kcal/macros correctly across all members', () => {
    const entries: FoodEntryRow[] = [
      entry({ id: 'e1', kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 10, meal_group_id: 'g', meal_name: 'Meal' }),
      entry({ id: 'e2', kcal: 200, protein_g: 15, carbs_g: 20, fat_g: 5, meal_group_id: 'g', meal_name: 'Meal' }),
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].totals).toEqual({ kcal: 500, protein_g: 35, carbs_g: 50, fat_g: 15 });
  });

  it('ungrouped (standalone) entries each render as their own single-member group', () => {
    const entries: FoodEntryRow[] = [
      entry({ id: 'a', name: 'Apple', kcal: 80 }),
      entry({ id: 'b', name: 'Coffee', kcal: 5 }),
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0].displayName).toBe('Apple');
    expect(groups[0].members).toHaveLength(1);
    expect(groups[0].mealGroupId).toBeNull();
    expect(groups[1].displayName).toBe('Coffee');
  });

  it('a mix of grouped and standalone entries preserves each as distinct rows', () => {
    const entries: FoodEntryRow[] = [
      entry({ id: 'g1', logged_at: 1, name: 'Rice', kcal: 260, meal_group_id: 'grp', meal_name: 'Lunch bowl' }),
      entry({ id: 'standalone', logged_at: 2, name: 'Apple', kcal: 80 }),
      entry({ id: 'g2', logged_at: 3, name: 'Chicken', kcal: 250, meal_group_id: 'grp', meal_name: 'Lunch bowl' }),
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups).toHaveLength(2);
    // Group position reflects the FIRST member's position (g1 logged first).
    expect(groups[0].displayName).toBe('Lunch bowl');
    expect(groups[0].members.map((m) => m.id)).toEqual(['g1', 'g2']);
    expect(groups[1].displayName).toBe('Apple');
  });

  it('a grouped capture with no meal_name falls back to a derived label from its components', () => {
    const entries: FoodEntryRow[] = [
      entry({ id: 'e1', logged_at: 1, name: 'Rice', kcal: 260, meal_group_id: 'grp', meal_name: null }),
      entry({ id: 'e2', logged_at: 2, name: 'Chicken', kcal: 250, meal_group_id: 'grp', meal_name: null }),
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups[0].displayName).toBe('Rice, Chicken');
  });

  it('a grouped capture of 3+ unnamed components truncates with a "+N more" tail', () => {
    const entries: FoodEntryRow[] = [
      entry({ id: 'e1', logged_at: 1, name: 'Rice', meal_group_id: 'grp', meal_name: null }),
      entry({ id: 'e2', logged_at: 2, name: 'Chicken', meal_group_id: 'grp', meal_name: null }),
      entry({ id: 'e3', logged_at: 3, name: 'Sauce', meal_group_id: 'grp', meal_name: null }),
      entry({ id: 'e4', logged_at: 4, name: 'Salad', meal_group_id: 'grp', meal_name: null }),
    ];
    const groups = groupEntriesByMeal(entries);
    expect(groups[0].displayName).toBe('Rice, Chicken +2 more');
  });

  it('empty input returns an empty list', () => {
    expect(groupEntriesByMeal([])).toEqual([]);
  });

  it('a single standalone entry is unaffected by grouping (no regression for the common case)', () => {
    const entries: FoodEntryRow[] = [entry({ id: 'solo', name: 'Banana', kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 })];
    const groups = groupEntriesByMeal(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].totals).toEqual({ kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 });
  });
});
