// ═══════════════════════════════════════════════════════════════════════
// workoutExerciseRepo — CRUD on `exercise` (schema v4).
//
// The seeded library (22 compound + accessory movements, is_custom = 0)
// ships via the migration itself (src/db/schema.ts's SCHEMA_V4_SQL), not
// here — this repo only reads it back and lets the user add their own
// (is_custom = 1). There is no delete/update for seeded rows: the library
// is a fixed reference set, not user data.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { ExerciseRow, ExerciseCategory, ExerciseEquipment } from '../types';

export type NewExercise = {
  id: string;
  name: string;
  category?: ExerciseCategory | null;
  equipment?: ExerciseEquipment | null;
};

/** Every exercise (seeded + custom), grouped for display by category then name. */
export async function listExercises(db: Database): Promise<ExerciseRow[]> {
  return db.getAllAsync<ExerciseRow>(
    'SELECT * FROM exercise ORDER BY category IS NULL, category ASC, name ASC'
  );
}

export async function getExercise(db: Database, id: string): Promise<ExerciseRow | null> {
  return db.getFirstAsync<ExerciseRow>('SELECT * FROM exercise WHERE id = ?', [id]);
}

/** Case-insensitive substring search over exercise name, for the exercise picker's search box. */
export async function searchExercises(db: Database, query: string): Promise<ExerciseRow[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return listExercises(db);
  return db.getAllAsync<ExerciseRow>(
    'SELECT * FROM exercise WHERE name LIKE ? ORDER BY is_custom ASC, name ASC',
    [`%${trimmed}%`]
  );
}

/**
 * Add a user-defined exercise (is_custom = 1) — the picker offers this
 * when a search comes up empty, per the "science-based lifting" ask that
 * the library not be a hard wall around what the user can log.
 */
export async function addCustomExercise(db: Database, exercise: NewExercise): Promise<ExerciseRow> {
  await db.runAsync(
    `INSERT INTO exercise (id, name, category, equipment, is_custom) VALUES (?, ?, ?, ?, 1)`,
    [exercise.id, exercise.name, exercise.category ?? null, exercise.equipment ?? null]
  );
  const row = await getExercise(db, exercise.id);
  if (!row) throw new Error(`addCustomExercise: failed to read back exercise ${exercise.id}`);
  return row;
}
