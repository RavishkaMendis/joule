// ═══════════════════════════════════════════════════════════════════════
// PROGRAM ACTIONS — thin, testable orchestration over programRepo/
// workoutRepo (mirrors src/lib/training/workoutActions.ts's own pattern:
// keep ID generation and "what does tapping this button actually do" out
// of screen components).
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import type { ProgramRow, ProgramDayRow, ProgramExerciseRow, WorkoutSessionRow, PrescriptionType } from '../../db/types';
import * as programRepo from '../../db/repositories/programRepo';
import * as workoutRepo from '../../db/repositories/workoutRepo';
import { generateId } from '../ids';

// ─── program ─────────────────────────────────────────────────────────────

export async function createProgram(db: Database, name: string, description?: string | null): Promise<ProgramRow> {
  return programRepo.createProgram(db, {
    id: generateId('program'),
    name,
    description: description ?? null,
    created_at: Date.now(),
  });
}

/**
 * Deep-copies a program (every day, exercise, and substitution) under a
 * new name, with fresh ids throughout and `is_active` always false on the
 * copy — duplicating a program must never silently start following it
 * (task brief: "Create/edit/duplicate/delete programs and days in-app").
 */
export async function duplicateProgram(db: Database, programId: string, newName?: string): Promise<ProgramRow> {
  const source = await programRepo.getProgram(db, programId);
  if (!source) throw new Error(`duplicateProgram: no program with id ${programId}`);

  const copy = await programRepo.createProgram(db, {
    id: generateId('program'),
    name: newName ?? `${source.name} (copy)`,
    description: source.description,
    is_active: false,
    created_at: Date.now(),
  });

  const days = await programRepo.listDaysForProgram(db, programId);
  for (const day of days) {
    const dayCopy = await programRepo.createProgramDay(db, {
      id: generateId('program_day'),
      program_id: copy.id,
      order_index: day.order_index,
      label: day.label,
    });

    const exercises = await programRepo.listExercisesForDay(db, day.id);
    for (const pe of exercises) {
      const peCopy = await programRepo.createProgramExercise(db, {
        id: generateId('program_exercise'),
        program_day_id: dayCopy.id,
        exercise_id: pe.exercise_id,
        order_index: pe.order_index,
        target_sets: pe.target_sets,
        prescription_type: pe.prescription_type,
        rep_low: pe.rep_low,
        rep_high: pe.rep_high,
        target_rir: pe.target_rir,
        rest_seconds: pe.rest_seconds,
        cues: pe.cues,
        demo_url: pe.demo_url,
      });

      const subs = await programRepo.listSubstitutionsForExercise(db, pe.id);
      for (const sub of subs) {
        await programRepo.addSubstitution(db, {
          id: generateId('program_sub'),
          program_exercise_id: peCopy.id,
          exercise_id: sub.exercise_id,
          note: sub.note,
        });
      }
    }
  }

  return copy;
}

// ─── program_day ─────────────────────────────────────────────────────────

/** Adds a new day at the end of the program's existing day list. */
export async function addDay(db: Database, programId: string, label: string): Promise<ProgramDayRow> {
  const existing = await programRepo.listDaysForProgram(db, programId);
  return programRepo.createProgramDay(db, {
    id: generateId('program_day'),
    program_id: programId,
    order_index: existing.length,
    label,
  });
}

// ─── program_exercise ────────────────────────────────────────────────────

export type NewProgramExerciseInput = {
  exerciseId: string;
  targetSets: number;
  /** Defaults to 'rep_range' — see PrescriptionType (src/db/types.ts). */
  prescriptionType?: PrescriptionType;
  /** Required for 'rep_range', must be null for 'amrap' (reps are an outcome, not a target) — the DB CHECK constraint enforces this pairing regardless of what's passed. */
  repLow: number | null;
  repHigh: number | null;
  targetRir?: number | null;
  restSeconds?: number | null;
  cues?: string | null;
  demoUrl?: string | null;
};

/** Adds an exercise at the end of a day's existing exercise list. */
export async function addExerciseToDay(
  db: Database,
  programDayId: string,
  input: NewProgramExerciseInput
): Promise<ProgramExerciseRow> {
  const existing = await programRepo.listExercisesForDay(db, programDayId);
  return programRepo.createProgramExercise(db, {
    id: generateId('program_exercise'),
    program_day_id: programDayId,
    exercise_id: input.exerciseId,
    order_index: existing.length,
    target_sets: input.targetSets,
    prescription_type: input.prescriptionType ?? 'rep_range',
    rep_low: input.repLow,
    rep_high: input.repHigh,
    target_rir: input.targetRir ?? null,
    rest_seconds: input.restSeconds ?? null,
    cues: input.cues ?? null,
    demo_url: input.demoUrl ?? null,
  });
}

/** Adds a substitution catalog entry for a program exercise ("no squat rack? use leg press"). Does NOT affect any in-progress session — see programSession.ts's header. */
export async function addSubstitutionOption(
  db: Database,
  programExerciseId: string,
  exerciseId: string,
  note?: string | null
): Promise<void> {
  await programRepo.addSubstitution(db, {
    id: generateId('program_sub'),
    program_exercise_id: programExerciseId,
    exercise_id: exerciseId,
    note: note ?? null,
  });
}

// ─── starting a session from a program day ──────────────────────────────

/**
 * Starts a new workout_session tagged with `program_day_id` (task brief:
 * "Pick a program -> see its days -> start the next one"). This does NOT
 * write any workout_set rows — the session screen pre-populates its
 * exercise list by reading `program_exercise` for this day directly (see
 * src/lib/training/programSession.ts's `planSessionFromProgramDay`), the
 * same way an ad-hoc session's screen already builds its list from
 * whatever has been logged/picked so far. Nothing here is any different
 * from `workoutActions.startNewSession` except which column gets set.
 */
export async function startSessionFromProgramDay(
  db: Database,
  programDayId: string,
  date: string,
  startedAt: number = Date.now()
): Promise<WorkoutSessionRow> {
  return workoutRepo.startSession(db, {
    id: generateId('session'),
    date,
    started_at: startedAt,
    program_day_id: programDayId,
  });
}
