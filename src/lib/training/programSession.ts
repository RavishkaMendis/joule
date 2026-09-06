// ═══════════════════════════════════════════════════════════════════════
// programSession — pure construction of "what a session following a
// program day should pre-populate," and pure resolution of "which
// exercise is actually in play for one prescribed slot" once
// substitutions enter the picture.
//
// Deliberately decoupled from src/db/types.ts's row shapes (same
// convention as progression.ts's own local `TrainingSet` type): callers
// pass plain structurally-compatible objects, so this module — and its
// tests — never need a database.
// ═══════════════════════════════════════════════════════════════════════

/** Mirrors `PrescriptionType` (src/db/types.ts) — see this module's file header for why the local type is duplicated rather than imported. */
export type PrescriptionTypeLike = 'rep_range' | 'amrap';

/** Structurally compatible with `ProgramExerciseRow` (src/db/types.ts) — see file header for why this isn't imported directly. */
export type ProgramExerciseLike = {
  id: string;
  exercise_id: string;
  order_index: number;
  target_sets: number;
  prescription_type: PrescriptionTypeLike;
  /** Required for 'rep_range', NULL for 'amrap' (reps are an outcome, not a target). */
  rep_low: number | null;
  rep_high: number | null;
  target_rir: number | null;
  rest_seconds: number | null;
  cues: string | null;
  demo_url: string | null;
};

/** One resolved slot in a session's pre-populated exercise list. */
export type ProgramExerciseTarget = {
  programExerciseId: string;
  /** The program's own prescribed exercise — NOT necessarily what the session ends up logging (see `resolveSlotExerciseId`). */
  exerciseId: string;
  orderIndex: number;
  targetSets: number;
  prescriptionType: PrescriptionTypeLike;
  /** NULL when `prescriptionType === 'amrap'`. */
  repLow: number | null;
  /** NULL when `prescriptionType === 'amrap'`. */
  repHigh: number | null;
  targetRir: number | null;
  restSeconds: number | null;
  cues: string | null;
  demoUrl: string | null;
};

/**
 * Session-from-program-day construction (task brief: "Starting
 * pre-populates the session with that day's exercises in order, each
 * carrying its targets"). Pure mapping + sort — no DB, no side effects.
 * Input order is NOT trusted; output is always sorted by `order_index`.
 */
export function planSessionFromProgramDay(programExercises: ProgramExerciseLike[]): ProgramExerciseTarget[] {
  return [...programExercises]
    .sort((a, b) => a.order_index - b.order_index)
    .map((pe) => ({
      programExerciseId: pe.id,
      exerciseId: pe.exercise_id,
      orderIndex: pe.order_index,
      targetSets: pe.target_sets,
      prescriptionType: pe.prescription_type,
      repLow: pe.rep_low,
      repHigh: pe.rep_high,
      targetRir: pe.target_rir,
      restSeconds: pe.rest_seconds,
      cues: pe.cues,
      demoUrl: pe.demo_url,
    }));
}

/**
 * Substitution resolution (task brief: "Substitutions: swap an exercise
 * for a listed alternative in-session... without editing the program
 * itself. The session records what was actually done.").
 *
 * There is no "session substitution" table — a swap is entirely
 * represented by which exercise_id the session's own workout_set rows
 * end up carrying. This function is the single rule for which exercise a
 * program-day slot should currently show/log against, given:
 *
 *   1. `slot` — the program's own prescription (a specific exercise).
 *   2. `substituteExerciseIds` — the catalog of allowed alternatives for
 *      this slot (program_substitution rows), defined when the program
 *      was edited.
 *   3. `loggedExerciseIdsInSession` — which exercise ids ALREADY have at
 *      least one logged set in the current session (from any slot or
 *      ad-hoc addition).
 *   4. `pendingSwapExerciseId` — a swap the user tapped THIS session but
 *      hasn't logged a set for yet (in-memory UI state only, never
 *      persisted on its own).
 *
 * Priority: a REAL logged set always wins over a not-yet-logged pending
 * choice — once a set exists under a specific exercise id, that IS the
 * session's honest record of what was done, and this function must never
 * contradict it. Only when nothing has been logged yet for either the
 * default or any substitute does a pending (not-yet-logged) swap choice
 * apply. With neither, the slot resolves to the program's own
 * prescription.
 */
export function resolveSlotExerciseId(
  slot: { exerciseId: string },
  substituteExerciseIds: string[],
  loggedExerciseIdsInSession: string[],
  pendingSwapExerciseId: string | null
): string {
  const candidates = [slot.exerciseId, ...substituteExerciseIds];

  const loggedCandidate = candidates.find((id) => loggedExerciseIdsInSession.includes(id));
  if (loggedCandidate !== undefined) return loggedCandidate;

  if (pendingSwapExerciseId !== null && candidates.includes(pendingSwapExerciseId)) {
    return pendingSwapExerciseId;
  }

  return slot.exerciseId;
}
