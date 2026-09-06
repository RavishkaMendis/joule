// ═══════════════════════════════════════════════════════════════════════
// exerciseSelection — which exercises earn a spot on the dashboard's
// per-exercise progression / estimated-1RM panels.
//
// There is no "main lift" flag in the schema (exercise.category/equipment
// are loose tags, not a compound/accessory marker), so picking exercises
// by hardcoded name ("Back Squat", "Bench Press", ...) would silently
// break for anyone whose actual main lifts differ, or who trains a custom
// exercise most. Instead this ranks by DATA: the exercise trained across
// the most distinct sessions wins — "what you've actually trained most
// consistently," not an assumption about what a "real" lift is. Warm-up
// sets don't count toward this ranking (a warm-up-only exercise carries no
// working signal, same reasoning as everywhere else in this module).
// ═══════════════════════════════════════════════════════════════════════

export type ExerciseSetForSelection = {
  exerciseId: string;
  sessionId: string;
  is_warmup?: boolean | number;
};

function isWarmupSet(set: ExerciseSetForSelection): boolean {
  return typeof set.is_warmup === 'number' ? set.is_warmup === 1 : !!set.is_warmup;
}

/**
 * Exercise ids ranked by distinct working sessions (desc), tie-broken by
 * total working set count (desc), then by exerciseId (asc, for a stable
 * result when two exercises are equally represented). Capped to `limit`.
 */
export function selectTopExercises(sets: ExerciseSetForSelection[], limit = 6): string[] {
  const working = sets.filter((s) => !isWarmupSet(s));

  const sessionsByExercise = new Map<string, Set<string>>();
  const setCountByExercise = new Map<string, number>();
  for (const s of working) {
    if (!sessionsByExercise.has(s.exerciseId)) sessionsByExercise.set(s.exerciseId, new Set());
    sessionsByExercise.get(s.exerciseId)!.add(s.sessionId);
    setCountByExercise.set(s.exerciseId, (setCountByExercise.get(s.exerciseId) ?? 0) + 1);
  }

  return Array.from(sessionsByExercise.keys())
    .sort((a, b) => {
      const sessionDiff = sessionsByExercise.get(b)!.size - sessionsByExercise.get(a)!.size;
      if (sessionDiff !== 0) return sessionDiff;
      const setDiff = (setCountByExercise.get(b) ?? 0) - (setCountByExercise.get(a) ?? 0);
      if (setDiff !== 0) return setDiff;
      return a.localeCompare(b);
    })
    .slice(0, limit);
}
