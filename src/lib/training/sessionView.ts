// ═══════════════════════════════════════════════════════════════════════
// sessionView — pure shaping of a flat workout_set[] into the grouped
// per-exercise view the session-logging screen renders.
// ═══════════════════════════════════════════════════════════════════════

export type SetLike = {
  id: string;
  exercise_id: string;
  logged_at: number;
};

export type ExerciseGroup<TSet extends SetLike> = {
  exerciseId: string;
  sets: TSet[];
};

/**
 * Groups a session's sets by exercise, preserving each exercise's FIRST
 * appearance order (i.e. the order exercises were added during logging) —
 * not alphabetical, not by set count. `sets` must already be sorted by
 * logged_at ascending (workoutRepo.getSetsForSession already returns them
 * that way); this function does not re-sort.
 */
export function groupSetsByExercise<TSet extends SetLike>(sets: TSet[]): ExerciseGroup<TSet>[] {
  const order: string[] = [];
  const byExercise = new Map<string, TSet[]>();

  for (const set of sets) {
    let bucket = byExercise.get(set.exercise_id);
    if (!bucket) {
      bucket = [];
      byExercise.set(set.exercise_id, bucket);
      order.push(set.exercise_id);
    }
    bucket.push(set);
  }

  return order.map((exerciseId) => ({ exerciseId, sets: byExercise.get(exerciseId)! }));
}
