// ═══════════════════════════════════════════════════════════════════════
// muscleGroupBalance — "which regions get volume, which are neglected"
// (task brief). Working volume only, grouped by exercise.category.
//
// Every one of the six known categories (db/types.ts's ExerciseCategory)
// is ALWAYS included, even at zero — a neglected region only reads as
// "neglected" if it's visibly present with a zero, not silently absent
// from the list. A custom exercise with no category assigned buckets into
// 'uncategorized', which appears only when it actually has volume (there's
// no fixed "uncategorized" slot to keep honestly empty the way there is
// for the six real regions).
//
// A category can have setCount > 0 but volume === 0 — an all-bodyweight
// region (e.g. plank-only core work). That is real training, not neglect,
// so callers must surface setCount alongside volume rather than reading a
// 0 kg total as "nothing happened here."
// ═══════════════════════════════════════════════════════════════════════

import type { ExerciseCategory } from '../../db/types';
import { computeVolume, type SetForVolume } from './volume';

export type MuscleGroupSet = SetForVolume & { category: ExerciseCategory | null };

export type MuscleGroupVolume = {
  category: ExerciseCategory | 'uncategorized';
  volume: number;
  setCount: number;
  /** Fraction of total WORKING volume across all categories. Null only when there is zero total volume to divide by. */
  fraction: number | null;
};

const ALL_CATEGORIES: ExerciseCategory[] = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'];

function isWarmupSet(set: SetForVolume): boolean {
  return typeof set.is_warmup === 'number' ? set.is_warmup === 1 : !!set.is_warmup;
}

/**
 * Volume by muscle-group category across `sets` (any mix of exercises/
 * sessions). Returns one entry per fixed category always, plus
 * 'uncategorized' if present, sorted by descending volume (ties broken by
 * setCount, then category name) so the busiest region leads and neglected
 * ones sink to the bottom rather than disappearing.
 */
export function computeMuscleGroupBalance(sets: MuscleGroupSet[]): MuscleGroupVolume[] {
  const working = sets.filter((s) => !isWarmupSet(s));

  const byCategory = new Map<string, MuscleGroupSet[]>();
  for (const category of ALL_CATEGORIES) byCategory.set(category, []);
  for (const s of working) {
    const key = s.category ?? 'uncategorized';
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(s);
    else byCategory.set(key, [s]);
  }

  const entries: MuscleGroupVolume[] = [];
  let totalVolume = 0;
  const perCategoryVolume = new Map<string, number>();
  for (const [category, groupSets] of byCategory) {
    const volume = computeVolume(groupSets);
    perCategoryVolume.set(category, volume);
    totalVolume += volume;
  }

  for (const [category, groupSets] of byCategory) {
    const volume = perCategoryVolume.get(category) ?? 0;
    entries.push({
      category: category as ExerciseCategory | 'uncategorized',
      volume,
      setCount: groupSets.length,
      fraction: totalVolume > 0 ? volume / totalVolume : null,
    });
  }

  return entries.sort((a, b) => {
    if (b.volume !== a.volume) return b.volume - a.volume;
    if (b.setCount !== a.setCount) return b.setCount - a.setCount;
    return a.category.localeCompare(b.category);
  });
}
