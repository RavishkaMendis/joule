// ═══════════════════════════════════════════════════════════════════════
// MEAL TYPE — breakfast / lunch / dinner / snack, chosen at log time.
//
// This is a pure, testable module: `defaultMealTypeForTime` only ever
// SUGGESTS a value from the clock — it is never written to food_entry
// automatically. The one-tap selector in ConfirmSheet pre-fills from this
// suggestion but the user can change it before confirming, and a v1 row
// (or a v2 row nobody ever touched) simply has `meal_type = NULL`, which
// is not an error state — see src/db/types.ts's FoodEntryRow doc comment.
//
// Time thresholds (24h local clock, PRD gives no explicit numbers here so
// these follow ordinary AU meal-time convention):
//   00:00–10:59  breakfast
//   11:00–14:59  lunch
//   15:00–20:59  dinner
//   21:00–23:59  snack
// Late-night eating (after 9pm) defaults to 'snack' rather than 'dinner'
// — a post-dinner bite at 11pm is far more often a snack than a second
// dinner, and defaulting it to dinner would silently misclassify the
// single most common late entry. Pre-dawn hours (00:00–05:59) fold into
// 'breakfast' rather than getting their own bucket — the PRD only names
// four meal types, and an early riser's first meal of the day is still
// "breakfast" whatever the exact hour.
// ═══════════════════════════════════════════════════════════════════════

import type { MealType } from '../db/types';

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/**
 * Suggests a meal type from a 24h local hour (0-23). Pure function of the
 * hour only — callers pass `new Date().getHours()` or an injected value
 * for testability, never a Date object directly, so this has zero
 * dependency on the host clock/timezone beyond what the caller already
 * resolved via localDate.ts.
 */
export function defaultMealTypeForHour(hour: number): MealType {
  if (hour < 0 || hour > 23 || !Number.isInteger(hour)) {
    throw new Error(`defaultMealTypeForHour: hour must be an integer 0-23, got ${hour}`);
  }
  if (hour < 11) return 'breakfast'; // 00:00–10:59
  if (hour < 15) return 'lunch'; // 11:00–14:59
  if (hour < 21) return 'dinner'; // 15:00–20:59
  return 'snack'; // 21:00–23:59
}

/** Convenience wrapper reading the current local hour — the one non-pure entry point, kept to a single line so screens don't reach for `new Date()` directly. */
export function defaultMealTypeForNow(now: Date = new Date()): MealType {
  return defaultMealTypeForHour(now.getHours());
}
