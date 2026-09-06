// ═══════════════════════════════════════════════════════════════════════
// workoutRepo — CRUD on `workout_session` and `workout_set` (schema v4).
//
// Every mutation here stays inside the training tables only: nothing in
// this file ever reads or writes `day_intake`/`weight_log`, and nothing
// here is imported by src/engine (PRD §1 non-goal — see schema.ts's v4
// header). "Everything editable forever" (PRD §10) applies the same way
// it does to food_entry: updateSet/deleteSet/updateSession work on a
// session from any date, not just today's.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { WorkoutSessionRow, WorkoutSetRow, WorkoutSetSegmentRow, SetType } from '../types';

// ─── workout_session ────────────────────────────────────────────────────

export type NewSession = {
  id: string;
  date: string;
  /** Epoch ms. */
  started_at: number;
  name?: string | null;
  notes?: string | null;
  /**
   * Schema v7. Set when this session was started from a program day
   * ("start the next one" — task brief); omitted/null for every ad-hoc
   * session, which must keep working exactly as it did before this field
   * existed (see schema.ts's v7 header — nullable is essential here).
   */
  program_day_id?: string | null;
};

export async function startSession(db: Database, session: NewSession): Promise<WorkoutSessionRow> {
  await db.runAsync(
    `INSERT INTO workout_session (id, date, name, started_at, notes, program_day_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.date,
      session.name ?? null,
      session.started_at,
      session.notes ?? null,
      session.program_day_id ?? null,
    ]
  );
  const row = await getSession(db, session.id);
  if (!row) throw new Error(`startSession: failed to read back workout_session ${session.id}`);
  return row;
}

export async function getSession(db: Database, id: string): Promise<WorkoutSessionRow | null> {
  return db.getFirstAsync<WorkoutSessionRow>('SELECT * FROM workout_session WHERE id = ?', [id]);
}

/** Every session, most recent first — the Train tab's history list. */
export async function listSessions(db: Database, limit?: number): Promise<WorkoutSessionRow[]> {
  if (limit !== undefined) {
    return db.getAllAsync<WorkoutSessionRow>(
      'SELECT * FROM workout_session ORDER BY date DESC, started_at DESC LIMIT ?',
      [limit]
    );
  }
  return db.getAllAsync<WorkoutSessionRow>('SELECT * FROM workout_session ORDER BY date DESC, started_at DESC');
}

export async function updateSession(
  db: Database,
  id: string,
  patch: Partial<Pick<WorkoutSessionRow, 'date' | 'name' | 'notes'>>
): Promise<WorkoutSessionRow> {
  const existing = await getSession(db, id);
  if (!existing) throw new Error(`updateSession: no workout_session with id ${id}`);

  const merged: WorkoutSessionRow = {
    ...existing,
    ...patch,
    name: patch.name !== undefined ? patch.name : existing.name,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
  };

  await db.runAsync('UPDATE workout_session SET date = ?, name = ?, notes = ? WHERE id = ?', [
    merged.date,
    merged.name,
    merged.notes,
    id,
  ]);

  const row = await getSession(db, id);
  if (!row) throw new Error(`updateSession: failed to read back workout_session ${id}`);
  return row;
}

/** Deletes a session and every set in it (workout_set.session_id is ON DELETE CASCADE). */
export async function deleteSession(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM workout_session WHERE id = ?', [id]);
}

// ─── workout_set ────────────────────────────────────────────────────────

export type NewSet = {
  id: string;
  session_id: string;
  exercise_id: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  rpe?: number | null;
  is_warmup?: boolean;
  /** Schema v7. Defaults to 'straight' — see SetType (src/db/types.ts) and schema.ts's v7 header for why this is orthogonal to `is_warmup`, not a replacement for it. */
  set_type?: SetType;
  /** Epoch ms. */
  logged_at: number;
};

export async function addSet(db: Database, set: NewSet): Promise<WorkoutSetRow> {
  await db.runAsync(
    `INSERT INTO workout_set (id, session_id, exercise_id, set_index, weight_kg, reps, rpe, is_warmup, logged_at, set_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      set.id,
      set.session_id,
      set.exercise_id,
      set.set_index,
      set.weight_kg,
      set.reps,
      set.rpe ?? null,
      set.is_warmup ? 1 : 0,
      set.logged_at,
      set.set_type ?? 'straight',
    ]
  );
  const row = await getSet(db, set.id);
  if (!row) throw new Error(`addSet: failed to read back workout_set ${set.id}`);
  return row;
}

export async function getSet(db: Database, id: string): Promise<WorkoutSetRow | null> {
  return db.getFirstAsync<WorkoutSetRow>('SELECT * FROM workout_set WHERE id = ?', [id]);
}

export async function updateSet(
  db: Database,
  id: string,
  patch: Partial<Pick<WorkoutSetRow, 'weight_kg' | 'reps' | 'rpe' | 'is_warmup' | 'set_index' | 'set_type'>>
): Promise<WorkoutSetRow> {
  const existing = await getSet(db, id);
  if (!existing) throw new Error(`updateSet: no workout_set with id ${id}`);

  const merged: WorkoutSetRow = {
    ...existing,
    ...patch,
    rpe: patch.rpe !== undefined ? patch.rpe : existing.rpe,
    set_type: patch.set_type !== undefined ? patch.set_type : existing.set_type,
  };

  await db.runAsync(
    `UPDATE workout_set SET weight_kg = ?, reps = ?, rpe = ?, is_warmup = ?, set_index = ?, set_type = ? WHERE id = ?`,
    [merged.weight_kg, merged.reps, merged.rpe, merged.is_warmup, merged.set_index, merged.set_type, id]
  );

  const row = await getSet(db, id);
  if (!row) throw new Error(`updateSet: failed to read back workout_set ${id}`);
  return row;
}

// ─── workout_set_segment ────────────────────────────────────────────────
//
// Additional drop/myo-rep/partials segments logged AFTER a set's own top
// weight/reps — see schema.ts's v7 header for the full modelling
// rationale and volume.ts's `computeVolume` for how these are summed.

export type NewSetSegment = {
  id: string;
  workout_set_id: string;
  segment_index: number;
  weight_kg: number;
  reps: number;
};

export async function addSetSegment(db: Database, segment: NewSetSegment): Promise<WorkoutSetSegmentRow> {
  await db.runAsync(
    `INSERT INTO workout_set_segment (id, workout_set_id, segment_index, weight_kg, reps) VALUES (?, ?, ?, ?, ?)`,
    [segment.id, segment.workout_set_id, segment.segment_index, segment.weight_kg, segment.reps]
  );
  const row = await db.getFirstAsync<WorkoutSetSegmentRow>('SELECT * FROM workout_set_segment WHERE id = ?', [
    segment.id,
  ]);
  if (!row) throw new Error(`addSetSegment: failed to read back workout_set_segment ${segment.id}`);
  return row;
}

/** Every segment of one set, in order (segment_index ascending) — the drop-set/myo-rep/partials detail shown under its parent SetRow. */
export async function getSegmentsForSet(db: Database, workoutSetId: string): Promise<WorkoutSetSegmentRow[]> {
  return db.getAllAsync<WorkoutSetSegmentRow>(
    'SELECT * FROM workout_set_segment WHERE workout_set_id = ? ORDER BY segment_index ASC',
    [workoutSetId]
  );
}

export async function updateSetSegment(
  db: Database,
  id: string,
  patch: Partial<Pick<WorkoutSetSegmentRow, 'weight_kg' | 'reps'>>
): Promise<WorkoutSetSegmentRow> {
  const existing = await db.getFirstAsync<WorkoutSetSegmentRow>('SELECT * FROM workout_set_segment WHERE id = ?', [id]);
  if (!existing) throw new Error(`updateSetSegment: no workout_set_segment with id ${id}`);
  // Explicit undefined-checks, not a blind `{...existing, ...patch}` spread:
  // a caller adjusting only weight (e.g. SetRow's per-field +/-) passes an
  // object whose `reps` key is simply absent, but a spread still needs
  // "key absent" to mean "leave unchanged," not "reps: undefined" — same
  // pattern as updateSet's rpe handling just above.
  const merged = {
    ...existing,
    weight_kg: patch.weight_kg !== undefined ? patch.weight_kg : existing.weight_kg,
    reps: patch.reps !== undefined ? patch.reps : existing.reps,
  };
  await db.runAsync('UPDATE workout_set_segment SET weight_kg = ?, reps = ? WHERE id = ?', [
    merged.weight_kg,
    merged.reps,
    id,
  ]);
  const row = await db.getFirstAsync<WorkoutSetSegmentRow>('SELECT * FROM workout_set_segment WHERE id = ?', [id]);
  if (!row) throw new Error(`updateSetSegment: failed to read back workout_set_segment ${id}`);
  return row;
}

export async function deleteSetSegment(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM workout_set_segment WHERE id = ?', [id]);
}

/** Every segment for every set in one session, in one query (avoids an N+1 per-set fetch) — for a session summary/volume calculation that must include drop-set segments (volume.ts's `computeVolume`). */
export async function getSegmentsForSession(db: Database, sessionId: string): Promise<WorkoutSetSegmentRow[]> {
  return db.getAllAsync<WorkoutSetSegmentRow>(
    `SELECT wss.* FROM workout_set_segment wss
     JOIN workout_set ws ON ws.id = wss.workout_set_id
     WHERE ws.session_id = ?
     ORDER BY wss.workout_set_id ASC, wss.segment_index ASC`,
    [sessionId]
  );
}

/**
 * Every segment for every set belonging to one exercise, across every
 * session — the exercise-scoped counterpart to `getSegmentsForSession`,
 * for a dashboard that queries sets by exercise (WorkoutDashboardScreen)
 * rather than by session. Keeping this bounded by exercise id (like
 * `getSetsForExercise`) rather than looping per-session is what keeps the
 * dashboard's query cost O(distinct exercises), not O(sessions logged).
 */
export async function getSegmentsForExercise(db: Database, exerciseId: string): Promise<WorkoutSetSegmentRow[]> {
  return db.getAllAsync<WorkoutSetSegmentRow>(
    `SELECT wss.* FROM workout_set_segment wss
     JOIN workout_set ws ON ws.id = wss.workout_set_id
     WHERE ws.exercise_id = ?
     ORDER BY wss.workout_set_id ASC, wss.segment_index ASC`,
    [exerciseId]
  );
}

export async function deleteSet(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM workout_set WHERE id = ?', [id]);
}

/** Every set in a session, in logging order — the components of the active/edit session screen. */
export async function getSetsForSession(db: Database, sessionId: string): Promise<WorkoutSetRow[]> {
  return db.getAllAsync<WorkoutSetRow>(
    'SELECT * FROM workout_set WHERE session_id = ? ORDER BY logged_at ASC, set_index ASC',
    [sessionId]
  );
}

/** Row shape for a set joined with its session's date — the input shape src/lib/training's progression functions expect. */
export type WorkoutSetWithDate = WorkoutSetRow & { date: string };

/**
 * Every set ever logged for one exercise, across every session, oldest
 * first — the full history src/lib/training/progression.ts walks to
 * compute best-set-per-session and the cross-session trend.
 */
export async function getSetsForExercise(db: Database, exerciseId: string): Promise<WorkoutSetWithDate[]> {
  return db.getAllAsync<WorkoutSetWithDate>(
    `SELECT ws.*, s.date as date
     FROM workout_set ws
     JOIN workout_session s ON s.id = ws.session_id
     WHERE ws.exercise_id = ?
     ORDER BY s.date ASC, ws.logged_at ASC, ws.set_index ASC`,
    [exerciseId]
  );
}

/**
 * The most recently logged set for an exercise — the single query behind
 * both "pre-fill this new set" (called with no exclusion, so an
 * already-logged set from earlier THIS session wins, giving in-session
 * progression) and "show last time's numbers" (called with
 * `excludeSessionId` set to the session currently being logged, so it
 * reaches back to the most recent OTHER session instead).
 */
export async function getLastSetForExercise(
  db: Database,
  exerciseId: string,
  excludeSessionId?: string
): Promise<WorkoutSetRow | null> {
  if (excludeSessionId !== undefined) {
    return db.getFirstAsync<WorkoutSetRow>(
      `SELECT * FROM workout_set WHERE exercise_id = ? AND session_id != ? ORDER BY logged_at DESC, set_index DESC LIMIT 1`,
      [exerciseId, excludeSessionId]
    );
  }
  return db.getFirstAsync<WorkoutSetRow>(
    `SELECT * FROM workout_set WHERE exercise_id = ? ORDER BY logged_at DESC, set_index DESC LIMIT 1`,
    [exerciseId]
  );
}

/** Distinct exercise ids that have at least one set logged, most recently used first — for a lightweight "recent exercises" shortlist in the picker. */
export async function getRecentlyUsedExerciseIds(db: Database, limit: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ exercise_id: string }>(
    `SELECT exercise_id, MAX(logged_at) as last_logged
     FROM workout_set
     GROUP BY exercise_id
     ORDER BY last_logged DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map((r) => r.exercise_id);
}
