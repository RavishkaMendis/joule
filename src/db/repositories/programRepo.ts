// ═══════════════════════════════════════════════════════════════════════
// programRepo — CRUD on `program` / `program_day` / `program_exercise` /
// `program_substitution` (schema v7).
//
// Every mutation here stays inside the four program tables plus reads of
// `exercise` (to read back a name) — nothing here ever touches
// `day_intake`/`weight_log`, and nothing here is imported by src/engine
// (PRD §1 non-goal — see schema.ts's v7 header). "Everything editable
// forever" (PRD §10) applies here too: update*/delete* work on a program
// defined five minutes ago or five months ago identically.
//
// `program_substitution` is a CATALOG of allowed equipment-alternative
// swaps for one program_exercise, defined here at program-EDIT time. It
// is never written to when a user swaps an exercise mid-SESSION — that
// swap is recorded entirely by which exercise_id the session's own
// workout_set rows carry (src/lib/training/programSession.ts's
// `resolveSlotExerciseId`), so there is no "sessionSubstitutionRepo" and
// there should not be one.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { ProgramRow, ProgramDayRow, ProgramExerciseRow, ProgramSubstitutionRow, PrescriptionType } from '../types';

// ─── program ─────────────────────────────────────────────────────────────

export type NewProgram = {
  id: string;
  name: string;
  description?: string | null;
  /** Defaults to 0 (not active) — callers that want a freshly-created program to become the followed one call `setActiveProgram` explicitly rather than relying on a default here. */
  is_active?: boolean;
  /** Epoch ms. */
  created_at: number;
};

export async function createProgram(db: Database, program: NewProgram): Promise<ProgramRow> {
  await db.runAsync(`INSERT INTO program (id, name, description, is_active, created_at) VALUES (?, ?, ?, ?, ?)`, [
    program.id,
    program.name,
    program.description ?? null,
    program.is_active ? 1 : 0,
    program.created_at,
  ]);
  const row = await getProgram(db, program.id);
  if (!row) throw new Error(`createProgram: failed to read back program ${program.id}`);
  return row;
}

export async function getProgram(db: Database, id: string): Promise<ProgramRow | null> {
  return db.getFirstAsync<ProgramRow>('SELECT * FROM program WHERE id = ?', [id]);
}

/** Every program, active one(s) first, most-recently-created first within that. */
export async function listPrograms(db: Database): Promise<ProgramRow[]> {
  return db.getAllAsync<ProgramRow>('SELECT * FROM program ORDER BY is_active DESC, created_at DESC');
}

export async function updateProgram(
  db: Database,
  id: string,
  patch: Partial<Pick<ProgramRow, 'name' | 'description'>>
): Promise<ProgramRow> {
  const existing = await getProgram(db, id);
  if (!existing) throw new Error(`updateProgram: no program with id ${id}`);

  const merged: ProgramRow = {
    ...existing,
    ...patch,
    description: patch.description !== undefined ? patch.description : existing.description,
  };

  await db.runAsync('UPDATE program SET name = ?, description = ? WHERE id = ?', [merged.name, merged.description, id]);

  const row = await getProgram(db, id);
  if (!row) throw new Error(`updateProgram: failed to read back program ${id}`);
  return row;
}

/**
 * Marks `id` as the currently-followed program and clears the flag on
 * every other program. `is_active` is a soft app-managed flag (schema.ts's
 * v7 header) — SQLite does not enforce a single active row, this function
 * is what keeps that true in practice. Passing `null` clears every
 * program's flag ("not currently following anything").
 */
export async function setActiveProgram(db: Database, id: string | null): Promise<void> {
  await db.runAsync('UPDATE program SET is_active = 0');
  if (id !== null) {
    await db.runAsync('UPDATE program SET is_active = 1 WHERE id = ?', [id]);
  }
}

/** Deletes a program and everything under it (program_day -> program_exercise -> program_substitution all cascade). Sessions that followed one of its days keep their program_day_id as a harmless orphaned reference (schema.ts's v7 header) — their sets are completely unaffected. */
export async function deleteProgram(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM program WHERE id = ?', [id]);
}

// ─── program_day ─────────────────────────────────────────────────────────

export type NewProgramDay = {
  id: string;
  program_id: string;
  order_index: number;
  label: string;
};

export async function createProgramDay(db: Database, day: NewProgramDay): Promise<ProgramDayRow> {
  await db.runAsync(`INSERT INTO program_day (id, program_id, order_index, label) VALUES (?, ?, ?, ?)`, [
    day.id,
    day.program_id,
    day.order_index,
    day.label,
  ]);
  const row = await getProgramDay(db, day.id);
  if (!row) throw new Error(`createProgramDay: failed to read back program_day ${day.id}`);
  return row;
}

export async function getProgramDay(db: Database, id: string): Promise<ProgramDayRow | null> {
  return db.getFirstAsync<ProgramDayRow>('SELECT * FROM program_day WHERE id = ?', [id]);
}

/** A program's days, in order — the sequence "start the next one" walks. */
export async function listDaysForProgram(db: Database, programId: string): Promise<ProgramDayRow[]> {
  return db.getAllAsync<ProgramDayRow>('SELECT * FROM program_day WHERE program_id = ? ORDER BY order_index ASC', [
    programId,
  ]);
}

export async function updateProgramDay(
  db: Database,
  id: string,
  patch: Partial<Pick<ProgramDayRow, 'label' | 'order_index'>>
): Promise<ProgramDayRow> {
  const existing = await getProgramDay(db, id);
  if (!existing) throw new Error(`updateProgramDay: no program_day with id ${id}`);

  const merged: ProgramDayRow = { ...existing, ...patch };

  await db.runAsync('UPDATE program_day SET label = ?, order_index = ? WHERE id = ?', [
    merged.label,
    merged.order_index,
    id,
  ]);

  const row = await getProgramDay(db, id);
  if (!row) throw new Error(`updateProgramDay: failed to read back program_day ${id}`);
  return row;
}

/** Deletes a day and its exercises/substitutions (cascades). Sessions that followed it keep an orphaned program_day_id (see deleteProgram). */
export async function deleteProgramDay(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM program_day WHERE id = ?', [id]);
}

/** Rewrites order_index for every day in `orderedDayIds` (its position in the array becomes its new order_index) — the reorder primitive the days-list editing UI calls after a move-up/move-down. Ids not in the array are left untouched. */
export async function reorderProgramDays(db: Database, orderedDayIds: string[]): Promise<void> {
  for (let i = 0; i < orderedDayIds.length; i++) {
    await db.runAsync('UPDATE program_day SET order_index = ? WHERE id = ?', [i, orderedDayIds[i]]);
  }
}

// ─── program_exercise ────────────────────────────────────────────────────

export type NewProgramExercise = {
  id: string;
  program_day_id: string;
  exercise_id: string;
  order_index: number;
  target_sets: number;
  /** Defaults to 'rep_range' — see PrescriptionType (src/db/types.ts). */
  prescription_type?: PrescriptionType;
  /** Required for 'rep_range', must be omitted/null for 'amrap' — the DB CHECK constraint (schema.ts's v7 header) enforces this pairing regardless of what the caller passes. */
  rep_low?: number | null;
  rep_high?: number | null;
  target_rir?: number | null;
  rest_seconds?: number | null;
  cues?: string | null;
  demo_url?: string | null;
};

export async function createProgramExercise(db: Database, pe: NewProgramExercise): Promise<ProgramExerciseRow> {
  await db.runAsync(
    `INSERT INTO program_exercise
       (id, program_day_id, exercise_id, order_index, target_sets, prescription_type, rep_low, rep_high, target_rir, rest_seconds, cues, demo_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pe.id,
      pe.program_day_id,
      pe.exercise_id,
      pe.order_index,
      pe.target_sets,
      pe.prescription_type ?? 'rep_range',
      pe.rep_low ?? null,
      pe.rep_high ?? null,
      pe.target_rir ?? null,
      pe.rest_seconds ?? null,
      pe.cues ?? null,
      pe.demo_url ?? null,
    ]
  );
  const row = await getProgramExercise(db, pe.id);
  if (!row) throw new Error(`createProgramExercise: failed to read back program_exercise ${pe.id}`);
  return row;
}

export async function getProgramExercise(db: Database, id: string): Promise<ProgramExerciseRow | null> {
  return db.getFirstAsync<ProgramExerciseRow>('SELECT * FROM program_exercise WHERE id = ?', [id]);
}

/** A day's prescribed exercises, in order — what a new session pre-populates (src/lib/training/programSession.ts's `planSessionFromProgramDay`). */
export async function listExercisesForDay(db: Database, programDayId: string): Promise<ProgramExerciseRow[]> {
  return db.getAllAsync<ProgramExerciseRow>(
    'SELECT * FROM program_exercise WHERE program_day_id = ? ORDER BY order_index ASC',
    [programDayId]
  );
}

/**
 * Patches a program exercise. Note the CHECK constraint on
 * `program_exercise` (schema.ts's v7 header) enforces rep_range/amrap's
 * rep_low/rep_high pairing at the DB layer — a caller that flips
 * `prescription_type` to 'amrap' without also clearing `rep_low`/
 * `rep_high` (or vice versa) gets a thrown SQLite error rather than a
 * silently-inconsistent row.
 */
export async function updateProgramExercise(
  db: Database,
  id: string,
  patch: Partial<
    Pick<
      ProgramExerciseRow,
      | 'exercise_id'
      | 'order_index'
      | 'target_sets'
      | 'prescription_type'
      | 'rep_low'
      | 'rep_high'
      | 'target_rir'
      | 'rest_seconds'
      | 'cues'
      | 'demo_url'
    >
  >
): Promise<ProgramExerciseRow> {
  const existing = await getProgramExercise(db, id);
  if (!existing) throw new Error(`updateProgramExercise: no program_exercise with id ${id}`);

  const merged: ProgramExerciseRow = {
    ...existing,
    ...patch,
    rep_low: patch.rep_low !== undefined ? patch.rep_low : existing.rep_low,
    rep_high: patch.rep_high !== undefined ? patch.rep_high : existing.rep_high,
    target_rir: patch.target_rir !== undefined ? patch.target_rir : existing.target_rir,
    rest_seconds: patch.rest_seconds !== undefined ? patch.rest_seconds : existing.rest_seconds,
    cues: patch.cues !== undefined ? patch.cues : existing.cues,
    demo_url: patch.demo_url !== undefined ? patch.demo_url : existing.demo_url,
  };

  await db.runAsync(
    `UPDATE program_exercise
       SET exercise_id = ?, order_index = ?, target_sets = ?, prescription_type = ?, rep_low = ?, rep_high = ?, target_rir = ?, rest_seconds = ?, cues = ?, demo_url = ?
     WHERE id = ?`,
    [
      merged.exercise_id,
      merged.order_index,
      merged.target_sets,
      merged.prescription_type,
      merged.rep_low,
      merged.rep_high,
      merged.target_rir,
      merged.rest_seconds,
      merged.cues,
      merged.demo_url,
      id,
    ]
  );

  const row = await getProgramExercise(db, id);
  if (!row) throw new Error(`updateProgramExercise: failed to read back program_exercise ${id}`);
  return row;
}

/** Deletes a program exercise and its substitution catalog entries (cascade). */
export async function deleteProgramExercise(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM program_exercise WHERE id = ?', [id]);
}

/** Rewrites order_index for every program_exercise in `orderedIds`, same shape as `reorderProgramDays`. */
export async function reorderProgramExercises(db: Database, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await db.runAsync('UPDATE program_exercise SET order_index = ? WHERE id = ?', [i, orderedIds[i]]);
  }
}

// ─── program_substitution ────────────────────────────────────────────────

export type NewProgramSubstitution = {
  id: string;
  program_exercise_id: string;
  exercise_id: string;
  note?: string | null;
};

export async function addSubstitution(db: Database, sub: NewProgramSubstitution): Promise<ProgramSubstitutionRow> {
  await db.runAsync(`INSERT INTO program_substitution (id, program_exercise_id, exercise_id, note) VALUES (?, ?, ?, ?)`, [
    sub.id,
    sub.program_exercise_id,
    sub.exercise_id,
    sub.note ?? null,
  ]);
  const row = await db.getFirstAsync<ProgramSubstitutionRow>('SELECT * FROM program_substitution WHERE id = ?', [
    sub.id,
  ]);
  if (!row) throw new Error(`addSubstitution: failed to read back program_substitution ${sub.id}`);
  return row;
}

/** Allowed equipment-alternative exercises for one program_exercise — the swap catalog shown in-session (task brief: "swap in substitutions if you don't have the equipment"). */
export async function listSubstitutionsForExercise(
  db: Database,
  programExerciseId: string
): Promise<ProgramSubstitutionRow[]> {
  return db.getAllAsync<ProgramSubstitutionRow>('SELECT * FROM program_substitution WHERE program_exercise_id = ?', [
    programExerciseId,
  ]);
}

export async function deleteSubstitution(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM program_substitution WHERE id = ?', [id]);
}
