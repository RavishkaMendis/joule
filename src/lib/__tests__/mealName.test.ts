import { suggestMealName } from '../mealName';
import type { PendingEntry } from '../pendingEntry';

function item(name: string, kcal: number): PendingEntry {
  return { name, grams: 100, kcal, protein_g: 1, carbs_g: 1, fat_g: 1, confidence: 'low', source: 'meal_photo' };
}

describe('suggestMealName', () => {
  it('returns empty string for an empty list', () => {
    expect(suggestMealName([])).toBe('');
  });

  it('title-cases a single item (though ConfirmSheet never offers naming for 1 item)', () => {
    expect(suggestMealName([item('chicken breast', 250)])).toBe('Chicken Breast');
  });

  it('names a multi-item capture after the highest-kcal component', () => {
    const entries = [
      item('sushi rice', 234),
      item('chicken filling', 149),
      item('avocado', 80),
      item('nori', 15),
      item('spicy mayo', 90),
    ];
    // 'sushi rice' has the highest kcal (234) of the five.
    expect(suggestMealName(entries)).toBe('Sushi Rice');
  });

  it('picks the first-listed item on a kcal tie', () => {
    const entries = [item('wrap', 200), item('salad', 200)];
    expect(suggestMealName(entries)).toBe('Wrap');
  });

  it('title-cases multi-word names', () => {
    expect(suggestMealName([item('bbq chicken', 300), item('rice', 50)])).toBe('Bbq Chicken');
  });

  it('preserves an already-uppercase short word rather than lowercasing it (e.g. a model-returned acronym)', () => {
    expect(suggestMealName([item('BBQ chicken', 300), item('rice', 50)])).toBe('BBQ Chicken');
  });
});
