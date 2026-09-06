import { defaultMealTypeForHour, defaultMealTypeForNow, MEAL_TYPES, MEAL_TYPE_LABEL } from '../mealType';

describe('defaultMealTypeForHour', () => {
  it('00:00-10:59 defaults to breakfast', () => {
    expect(defaultMealTypeForHour(0)).toBe('breakfast');
    expect(defaultMealTypeForHour(6)).toBe('breakfast');
    expect(defaultMealTypeForHour(10)).toBe('breakfast');
  });

  it('11:00-14:59 defaults to lunch', () => {
    expect(defaultMealTypeForHour(11)).toBe('lunch');
    expect(defaultMealTypeForHour(13)).toBe('lunch');
    expect(defaultMealTypeForHour(14)).toBe('lunch');
  });

  it('15:00-20:59 defaults to dinner', () => {
    expect(defaultMealTypeForHour(15)).toBe('dinner');
    expect(defaultMealTypeForHour(18)).toBe('dinner');
    expect(defaultMealTypeForHour(20)).toBe('dinner');
  });

  it('21:00-23:59 defaults to snack, not a second dinner', () => {
    expect(defaultMealTypeForHour(21)).toBe('snack');
    expect(defaultMealTypeForHour(23)).toBe('snack');
  });

  it('boundary hours land on the correct side', () => {
    expect(defaultMealTypeForHour(10)).toBe('breakfast');
    expect(defaultMealTypeForHour(11)).toBe('lunch');
    expect(defaultMealTypeForHour(14)).toBe('lunch');
    expect(defaultMealTypeForHour(15)).toBe('dinner');
    expect(defaultMealTypeForHour(20)).toBe('dinner');
    expect(defaultMealTypeForHour(21)).toBe('snack');
  });

  it('rejects out-of-range or non-integer hours', () => {
    expect(() => defaultMealTypeForHour(-1)).toThrow();
    expect(() => defaultMealTypeForHour(24)).toThrow();
    expect(() => defaultMealTypeForHour(12.5)).toThrow();
  });
});

describe('defaultMealTypeForNow', () => {
  it('derives from an injected Date, not the live clock', () => {
    expect(defaultMealTypeForNow(new Date(2026, 0, 1, 8, 0))).toBe('breakfast');
    expect(defaultMealTypeForNow(new Date(2026, 0, 1, 12, 30))).toBe('lunch');
    expect(defaultMealTypeForNow(new Date(2026, 0, 1, 19, 0))).toBe('dinner');
    expect(defaultMealTypeForNow(new Date(2026, 0, 1, 22, 0))).toBe('snack');
  });
});

describe('MEAL_TYPES / MEAL_TYPE_LABEL', () => {
  it('lists exactly the four PRD meal types', () => {
    expect(MEAL_TYPES).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });

  it('has a label for every meal type', () => {
    for (const t of MEAL_TYPES) {
      expect(typeof MEAL_TYPE_LABEL[t]).toBe('string');
      expect(MEAL_TYPE_LABEL[t].length).toBeGreaterThan(0);
    }
  });
});
