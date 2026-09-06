// ═══════════════════════════════════════════════════════════════════════
// volume — Σ weight × reps, the standard "how much work got done" number
// for a session or an exercise.
//
// Warm-up sets are excluded by default. A warm-up's job is to prepare the
// joint/nervous system, not to contribute progressive-overload signal —
// counting a handful of empty-bar reps toward "today's volume" inflates
// the number without meaning anything, and would make two sessions with
// identical working volume look different depending on how many warm-up
// sets someone happened to log. `includeWarmups: true` is available for a
// caller that explicitly wants total bar-time instead.
//
// DROP SETS / MYO-REPS / PARTIALS (schema v7 extension for high-intensity
// training styles): one `workout_set` row can carry additional
// `workout_set_segment` rows (schema.ts's v7 header has the full
// modelling rationale — a dedicated child table, not a JSON column or a
// self-referencing parent/child link on workout_set itself). The
// contract: the parent `workout_set.weight_kg`/`reps` IS the set's first
///top segment (unchanged meaning — this is what bestSetInSession/e1RM/
// "last time" comparisons keep reading, since the TOP weight is what
// matters for progressive-overload tracking), and each
// `workout_set_segment` is an ADDITIONAL segment logged after it (a drop,
// a myo-rep cluster, a partials-reps tail). `computeVolume` sums BOTH —
// the parent set's own contribution plus every segment's — or a drop set
// silently under-reports volume for exactly the training style this
// extension exists for. `segments` is optional and defaults to none, so
// every existing straight-set caller (the overwhelming majority) is
// completely unaffected.
// ═══════════════════════════════════════════════════════════════════════

export type SetSegmentForVolume = {
  weight_kg: number;
  reps: number;
};

export type SetForVolume = {
  weight_kg: number;
  reps: number;
  is_warmup?: boolean | number;
  /** Additional drop/myo-rep/partials segments logged after this set's own top weight/reps — see file header. Absent/empty for an ordinary straight set. */
  segments?: SetSegmentForVolume[];
};

export type VolumeOptions = {
  /** Default false — see file header. */
  includeWarmups?: boolean;
};

function isWarmupSet(set: SetForVolume): boolean {
  return typeof set.is_warmup === 'number' ? set.is_warmup === 1 : !!set.is_warmup;
}

/** weight * reps, clamped/guarded the same way for both a parent set and a segment: non-finite -> 0, negative -> 0 (never subtracts). */
function safeContribution(weight_kg: number, reps: number): number {
  const weight = Number.isFinite(weight_kg) ? Math.max(0, weight_kg) : 0;
  const repCount = Number.isFinite(reps) ? Math.max(0, reps) : 0;
  return weight * repCount;
}

/**
 * Total volume across a list of sets, INCLUDING every drop/myo-rep/
 * partials segment attached to each set (see file header — a drop set's
 * later, lighter segments count too, not just its top weight). Never
 * throws on malformed input: non-finite weight/reps are treated as 0
 * contribution, and negative weight/reps (data errors — neither should
 * ever occur through the repo layer) are clamped to 0 rather than
 * allowed to subtract from the total.
 */
export function computeVolume(sets: SetForVolume[], options: VolumeOptions = {}): number {
  const includeWarmups = options.includeWarmups ?? false;
  let total = 0;
  for (const set of sets) {
    if (isWarmupSet(set) && !includeWarmups) continue;
    total += safeContribution(set.weight_kg, set.reps);
    for (const segment of set.segments ?? []) {
      total += safeContribution(segment.weight_kg, segment.reps);
    }
  }
  return total;
}

export type SetForVolumeByExercise = SetForVolume & { exercise_id: string };

/** Volume broken down per exercise — for a session summary that lists each movement's contribution. */
export function computeVolumeByExercise(
  sets: SetForVolumeByExercise[],
  options: VolumeOptions = {}
): Record<string, number> {
  const byExercise = new Map<string, SetForVolumeByExercise[]>();
  for (const set of sets) {
    const bucket = byExercise.get(set.exercise_id);
    if (bucket) bucket.push(set);
    else byExercise.set(set.exercise_id, [set]);
  }
  const result: Record<string, number> = {};
  for (const [exerciseId, exerciseSets] of byExercise) {
    result[exerciseId] = computeVolume(exerciseSets, options);
  }
  return result;
}

export type SessionSummary = {
  /** Working volume only (warm-ups excluded) — see file header. */
  totalVolume: number;
  workingSetCount: number;
  warmupSetCount: number;
  /** Number of distinct exercises touched in the session. */
  exerciseCount: number;
};

/** Session summary stats: total volume, set counts, exercise count. Empty input is a valid, zero-everything session (e.g. a session started but nothing logged yet). */
export function computeSessionSummary(sets: SetForVolumeByExercise[]): SessionSummary {
  const workingSets = sets.filter((s) => !isWarmupSet(s));
  const warmupSets = sets.filter((s) => isWarmupSet(s));
  const exerciseIds = new Set(sets.map((s) => s.exercise_id));

  return {
    totalVolume: computeVolume(workingSets),
    workingSetCount: workingSets.length,
    warmupSetCount: warmupSets.length,
    exerciseCount: exerciseIds.size,
  };
}
