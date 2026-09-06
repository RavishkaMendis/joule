// ═══════════════════════════════════════════════════════════════════════
// MEAL SECTIONS — buckets a day's (already meal-grouped) rows into
// Breakfast / Lunch / Dinner / Snack / Unsorted sections for Today
// (task: "section the entry list by meal type, in day order").
//
// Pure function of FoodEntryRow[] — built on top of groupEntriesByMeal
// (mealGrouping.ts), not a replacement for it: a meal-photo capture
// still collapses to ONE row, and that row must therefore live in
// exactly ONE section. The anchor for a group's section is its
// EARLIEST-logged member's meal_type (members[] is already log-order —
// see mealGrouping.ts's own contract) — deterministic even for the
// pathological case of a group whose members disagree on meal_type
// (shouldn't normally happen since reassignment moves every member
// together, but old data or a future bug could produce it, and this
// function must still assign the row to exactly one section rather than
// splitting its kcal across two, which would break the "section
// subtotals sum to the day total" invariant the task's quality bar
// requires).
//
// NULL meal_type (pre-schema-v2 rows, or any path that never set one)
// buckets into "Unsorted" rather than being guessed from its timestamp.
// Guessing would silently misfile an entry the user never actually
// categorised — CLAUDE.md's "missing data is never imputed" applies to
// meal_type exactly as it does to a missing weight reading. Unsorted is
// deliberately the LAST section (after Snack): these are edge cases, not
// a fifth meal, and must not visually queue-jump ahead of Dinner.
//
// A section with zero groups is omitted entirely, not rendered empty.
// See EntryList.tsx's header comment for the reasoning (PRD §10: no
// guilt) — that choice lives here, in the pure function, so the "does an
// empty section render" answer has exactly one source of truth instead
// of being re-decided at the UI layer.
// ═══════════════════════════════════════════════════════════════════════

import type { FoodEntryRow, MealType } from '../db/types';
import { groupEntriesByMeal, type MealGroup } from './mealGrouping';
import { MEAL_TYPES, MEAL_TYPE_LABEL } from './mealType';

/** A section's key: a real MealType, or null for the "Unsorted" bucket. */
export type MealSectionKey = MealType | null;

export const UNSORTED_LABEL = 'Unsorted';

export type MealSection = {
  mealType: MealSectionKey;
  label: string;
  /** Meal-grouped rows belonging to this section, in original log order. */
  groups: MealGroup[];
  totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
};

const ZERO_TOTALS = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

function addTotals(a: MealSection['totals'], b: MealSection['totals']): MealSection['totals'] {
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carbs_g: a.carbs_g + b.carbs_g,
    fat_g: a.fat_g + b.fat_g,
  };
}

/** Display label for a section key — exported so EntryList/MealTypeSheet don't hardcode "Unsorted" separately. */
export function sectionLabel(key: MealSectionKey): string {
  return key === null ? UNSORTED_LABEL : MEAL_TYPE_LABEL[key];
}

/**
 * Buckets a day's entries into meal-type sections, in day order:
 * Breakfast, Lunch, Dinner, Snack, Unsorted. Omits any section with no
 * groups in it (see file header). Section totals are a straight sum of
 * their groups' totals, which are themselves exact sums of member
 * entries — so summing every returned section's totals always equals
 * summing `entries` directly; no entry is double-counted or dropped.
 */
export function groupEntriesBySection(entries: FoodEntryRow[]): MealSection[] {
  const groups = groupEntriesByMeal(entries);

  const bucketed = new Map<MealSectionKey, MealGroup[]>();
  for (const group of groups) {
    // members[0] is the group's earliest-logged entry (mealGrouping.ts
    // preserves input order, and callers pass entries pre-sorted by
    // logged_at ascending) — that member's meal_type decides the whole
    // row's section.
    const anchor: MealSectionKey = group.members[0].meal_type;
    const bucket = bucketed.get(anchor);
    if (bucket) {
      bucket.push(group);
    } else {
      bucketed.set(anchor, [group]);
    }
  }

  const order: MealSectionKey[] = [...MEAL_TYPES, null];
  const sections: MealSection[] = [];
  for (const key of order) {
    const groupsForKey = bucketed.get(key);
    if (!groupsForKey || groupsForKey.length === 0) continue;
    sections.push({
      mealType: key,
      label: sectionLabel(key),
      groups: groupsForKey,
      totals: groupsForKey.reduce((acc, g) => addTotals(acc, g.totals), ZERO_TOTALS),
    });
  }
  return sections;
}
