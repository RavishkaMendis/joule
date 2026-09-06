// ═══════════════════════════════════════════════════════════════════════
// MEAL GROUPING — collapses food_entry rows sharing a meal_group_id into
// one displayable row (PRD: a 5-item meal photo becomes one "Chicken
// Sushi, 1,066 kcal" row on Today, expandable to its components).
//
// Pure function of FoodEntryRow[] — no DB access, no React — so Today's
// rendering logic and this grouping logic are independently testable.
// Ungrouped entries (meal_group_id === null) pass through as their own
// single-member "group" so EntryList/TodayScreen has exactly one shape to
// render (a list of groups, some with 1 member, some with several)
// instead of two parallel code paths for "grouped" vs "standalone".
// ═══════════════════════════════════════════════════════════════════════

import type { FoodEntryRow } from '../db/types';

export type MealGroup = {
  /** meal_group_id for a real group, or the entry's own id for a standalone entry (stable React key). */
  key: string;
  /** Null for a standalone (ungrouped) entry — exactly one member. */
  mealGroupId: string | null;
  /** Display name: meal_name if the group has one, else the sole member's own name for a standalone entry, else a derived fallback. */
  displayName: string;
  members: FoodEntryRow[];
  totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
};

/** Internal working type: tracks whether displayName came from a real meal_name (locked) or is a derived fallback (recomputed as members arrive). */
type WorkingGroup = MealGroup & { hasRealName: boolean };

function sumTotals(members: FoodEntryRow[]): MealGroup['totals'] {
  return members.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      protein_g: acc.protein_g + m.protein_g,
      carbs_g: acc.carbs_g + m.carbs_g,
      fat_g: acc.fat_g + m.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

/**
 * Groups a day's entries by meal_group_id, preserving log order: a
 * group's position in the returned array is where its FIRST (earliest
 * logged_at) member appears among `entries` — so the Today list doesn't
 * reorder entries relative to how they were logged just because grouping
 * was introduced. `entries` is expected pre-sorted by logged_at ascending
 * (foodRepo.getEntriesForDate's existing contract) but this function does
 * not re-sort — it trusts the caller's order for stability.
 */
export function groupEntriesByMeal(entries: FoodEntryRow[]): MealGroup[] {
  const groups: WorkingGroup[] = [];
  const groupIndexById = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.meal_group_id) {
      // Standalone entry: its own one-member "group", keyed by its own id.
      groups.push({
        key: entry.id,
        mealGroupId: null,
        displayName: entry.name,
        members: [entry],
        totals: sumTotals([entry]),
        hasRealName: true, // an entry's own name is never a "derived" placeholder
      });
      continue;
    }

    const existingIndex = groupIndexById.get(entry.meal_group_id);
    if (existingIndex === undefined) {
      groupIndexById.set(entry.meal_group_id, groups.length);
      groups.push({
        key: entry.meal_group_id,
        mealGroupId: entry.meal_group_id,
        displayName: entry.meal_name || fallbackGroupName([entry]),
        members: [entry],
        totals: sumTotals([entry]),
        hasRealName: Boolean(entry.meal_name),
      });
    } else {
      const group = groups[existingIndex];
      group.members.push(entry);
      group.totals = sumTotals(group.members);
      // A real meal_name (from any member — should be consistent across
      // the group, but this tolerates a mismatch defensively) always
      // wins and locks in place. Absent that, the fallback label is
      // recomputed from ALL members every time one arrives — not just
      // compared against the previous fallback string, which is what let
      // a 3rd/4th member silently stop updating the "+N more" count
      // before this fix (the group's displayName no longer matched the
      // single-member fallback it started as, so the recompute guard
      // never fired again).
      if (entry.meal_name && !group.hasRealName) {
        group.displayName = entry.meal_name;
        group.hasRealName = true;
      } else if (!group.hasRealName) {
        group.displayName = fallbackGroupName(group.members);
      }
    }
  }

  return groups.map((group) => stripInternalFlag(group));
}

/** Drops the internal `hasRealName` bookkeeping flag before returning a group to callers — MealGroup has no such field, this is WorkingGroup-only. */
function stripInternalFlag(group: WorkingGroup): MealGroup {
  const { key, mealGroupId, displayName, members, totals } = group;
  return { key, mealGroupId, displayName, members, totals };
}

/** Derives a readable label when a grouped capture was never given a meal_name — joins up to 2 component names plus a "+N more" tail. */
function fallbackGroupName(members: FoodEntryRow[]): string {
  if (members.length === 1) return members[0].name;
  const names = members.map((m) => m.name);
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}
