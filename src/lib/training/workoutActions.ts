// ═══════════════════════════════════════════════════════════════════════
// WORKOUT ACTIONS — thin, testable orchestration over workoutRepo/
// workoutExerciseRepo (mirrors src/lib/potActions.ts / foodEntryActions.ts's
// pattern: keep ID generation, set-index bookkeeping, and "what does
// tapping this button actually do" out of screen components).
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import type { WorkoutSessionRow, WorkoutSetRow, ExerciseRow, ExerciseCategory, ExerciseEquipment, SetType } from '../../db/types';
import * as workoutRepo from '../../db/repositories/workoutRepo';
import * as workoutExerciseRepo from '../../db/repositories/workoutExerciseRepo';
import { generateId } from '../ids';

export async function startNewSession(
  db: Database,
  date: string,
  startedAt: number = Date.now()
): Promise<WorkoutSessionRow> {
  return workoutRepo.startSession(db, { id: generateId('session'), date, started_at: startedAt });
}

export type SetDraft = {
  weightKg: number;
  reps: number;
};

/**
 * What to pre-fill a brand-new set's inputs with. Deliberately the SAME
 * query as "last time" below with no session excluded: if this exercise
 * already has a set logged earlier in the CURRENT session, that most
 * recent set wins (in-session progressive pre-fill — set 3 pre-fills from
 * set 2). If not, it falls back to the most recent set from any past
 * session. `null` means this exercise has never been logged at all —
 * the input starts blank, never a fabricated default.
 */
export async function getPrefillForExercise(db: Database, exerciseId: string): Promise<SetDraft | null> {
  const last = await workoutRepo.getLastSetForExercise(db, exerciseId);
  if (!last) return null;
  return { weightKg: last.weight_kg, reps: last.reps };
}

/**
 * "Last time's numbers" for the reference line shown while logging —
 * always the most recent set from a DIFFERENT (earlier) session, even if
 * the current session already has sets logged for this exercise. This is
 * intentionally distinct from getPrefillForExercise: pre-fill wants
 * same-session continuity, this wants a fixed comparison point so
 * progressive overload within today's session stays visible against a
 * stable baseline rather than a baseline that shifts every time you log
 * another set today.
 */
export async function getLastTimeForExercise(
  db: Database,
  exerciseId: string,
  currentSessionId: string
): Promise<WorkoutSetRow | null> {
  return workoutRepo.getLastSetForExercise(db, exerciseId, currentSessionId);
}

export type LogSetInput = {
  sessionId: string;
  exerciseId: string;
  weightKg: number;
  reps: number;
  rpe?: number | null;
  isWarmup?: boolean;
  /** Schema v7. Defaults to 'straight' — see SetType (src/db/types.ts). */
  setType?: SetType;
  loggedAt?: number;
};

/**
 * Logs one set, computing `set_index` as "how many sets of this exercise
 * already exist in this session" — the caller never has to track a
 * counter itself.
 */
export async function logSet(db: Database, input: LogSetInput): Promise<WorkoutSetRow> {
  if (input.reps <= 0) throw new Error('logSet: reps must be > 0 — a set with no reps was never performed');
  if (input.weightKg < 0) throw new Error('logSet: weightKg must be >= 0');

  const existing = await workoutRepo.getSetsForSession(db, input.sessionId);
  const setIndex = existing.filter((s) => s.exercise_id === input.exerciseId).length;

  return workoutRepo.addSet(db, {
    id: generateId('set'),
    session_id: input.sessionId,
    exercise_id: input.exerciseId,
    set_index: setIndex,
    weight_kg: input.weightKg,
    reps: input.reps,
    rpe: input.rpe ?? null,
    is_warmup: input.isWarmup ?? false,
    set_type: input.setType ?? 'straight',
    logged_at: input.loggedAt ?? Date.now(),
  });
}

export async function addCustomExercise(
  db: Database,
  name: string,
  category?: ExerciseCategory | null,
  equipment?: ExerciseEquipment | null
): Promise<ExerciseRow> {
  return workoutExerciseRepo.addCustomExercise(db, { id: generateId('exercise'), name, category, equipment });
}
