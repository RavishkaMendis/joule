import { runMigrations } from '../../migrations';
import { createTestDatabase } from '../../__tests__/testDb';
import * as workoutRepo from '../workoutRepo';
import * as workoutExerciseRepo from '../workoutExerciseRepo';
import type { Database } from '../../database';

async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}

describe('workoutExerciseRepo', () => {
  it('lists the seeded library', async () => {
    const db = await freshDb();
    const exercises = await workoutExerciseRepo.listExercises(db);
    expect(exercises.length).toBeGreaterThan(0);
  });

  it('searchExercises matches by substring, case-insensitively via LIKE', async () => {
    const db = await freshDb();
    const results = await workoutExerciseRepo.searchExercises(db, 'squat');
    expect(results.some((e) => e.name === 'Back Squat')).toBe(true);
  });

  it('searchExercises with a blank query returns the full library', async () => {
    const db = await freshDb();
    const all = await workoutExerciseRepo.listExercises(db);
    const searched = await workoutExerciseRepo.searchExercises(db, '   ');
    expect(searched).toHaveLength(all.length);
  });

  it('addCustomExercise inserts with is_custom = 1 and is readable back', async () => {
    const db = await freshDb();
    const custom = await workoutExerciseRepo.addCustomExercise(db, {
      id: 'my-ex-1',
      name: 'Sled Push',
      category: 'legs',
      equipment: 'machine',
    });
    expect(custom.is_custom).toBe(1);
    const fetched = await workoutExerciseRepo.getExercise(db, 'my-ex-1');
    expect(fetched?.name).toBe('Sled Push');
  });

  it('addCustomExercise tolerates omitted category/equipment', async () => {
    const db = await freshDb();
    const custom = await workoutExerciseRepo.addCustomExercise(db, { id: 'my-ex-2', name: 'Mystery Machine' });
    expect(custom.category).toBeNull();
    expect(custom.equipment).toBeNull();
  });
});

describe('workoutRepo — sessions', () => {
  it('startSession creates a row and getSession reads it back', async () => {
    const db = await freshDb();
    const session = await workoutRepo.startSession(db, { id: 's1', date: '2026-09-05', started_at: 1000, name: 'Push day' });
    expect(session.name).toBe('Push day');
    const fetched = await workoutRepo.getSession(db, 's1');
    expect(fetched).toEqual(session);
  });

  it('startSession without a name/notes defaults both to null', async () => {
    const db = await freshDb();
    const session = await workoutRepo.startSession(db, { id: 's1', date: '2026-09-05', started_at: 1000 });
    expect(session.name).toBeNull();
    expect(session.notes).toBeNull();
  });

  it('listSessions orders most-recent-first by date then started_at', async () => {
    const db = await freshDb();
    await workoutRepo.startSession(db, { id: 's1', date: '2026-09-01', started_at: 1000 });
    await workoutRepo.startSession(db, { id: 's2', date: '2026-09-05', started_at: 2000 });
    await workoutRepo.startSession(db, { id: 's3', date: '2026-09-05', started_at: 3000 });

    const sessions = await workoutRepo.listSessions(db);
    expect(sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
  });

  it('listSessions respects an optional limit', async () => {
    const db = await freshDb();
    await workoutRepo.startSession(db, { id: 's1', date: '2026-09-01', started_at: 1000 });
    await workoutRepo.startSession(db, { id: 's2', date: '2026-09-02', started_at: 1000 });
    const sessions = await workoutRepo.listSessions(db, 1);
    expect(sessions).toHaveLength(1);
  });

  it('updateSession edits a PAST session — everything editable forever', async () => {
    const db = await freshDb();
    await workoutRepo.startSession(db, { id: 's1', date: '2020-01-01', started_at: 1000, name: 'Old name' });
    const updated = await workoutRepo.updateSession(db, 's1', { name: 'New name', notes: 'felt strong' });
    expect(updated.name).toBe('New name');
    expect(updated.notes).toBe('felt strong');
    expect(updated.date).toBe('2020-01-01');
  });

  it('deleteSession removes the session and cascades to its sets', async () => {
    const db = await freshDb();
    await workoutRepo.startSession(db, { id: 's1', date: '2026-09-05', started_at: 1000 });
    await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 60,
      reps: 8,
      logged_at: 1000,
    });
    await workoutRepo.deleteSession(db, 's1');
    expect(await workoutRepo.getSession(db, 's1')).toBeNull();
    expect(await workoutRepo.getSetsForSession(db, 's1')).toHaveLength(0);
  });
});

describe('workoutRepo — sets', () => {
  async function seededSession(db: Database, id = 's1'): Promise<void> {
    await workoutRepo.startSession(db, { id, date: '2026-09-05', started_at: 1000 });
  }

  it('addSet defaults rpe to null and is_warmup to 0 when omitted', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 60,
      reps: 8,
      logged_at: 1000,
    });
    expect(set.rpe).toBeNull();
    expect(set.is_warmup).toBe(0);
  });

  it('addSet stores is_warmup = 1 when true', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 20,
      reps: 10,
      is_warmup: true,
      logged_at: 1000,
    });
    expect(set.is_warmup).toBe(1);
  });

  it('addSet stores a valid zero weight (bodyweight exercise)', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_pull_up',
      set_index: 0,
      weight_kg: 0,
      reps: 10,
      logged_at: 1000,
    });
    expect(set.weight_kg).toBe(0);
  });

  it('updateSet edits weight/reps/rpe on a past set — everything editable forever', async () => {
    const db = await freshDb();
    await seededSession(db);
    await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 60,
      reps: 8,
      logged_at: 1000,
    });
    const updated = await workoutRepo.updateSet(db, 'set-1', { weight_kg: 65, reps: 6, rpe: 8.5 });
    expect(updated.weight_kg).toBe(65);
    expect(updated.reps).toBe(6);
    expect(updated.rpe).toBe(8.5);
  });

  it('deleteSet removes exactly one set', async () => {
    const db = await freshDb();
    await seededSession(db);
    await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 60,
      reps: 8,
      logged_at: 1000,
    });
    await workoutRepo.addSet(db, {
      id: 'set-2',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 1,
      weight_kg: 60,
      reps: 7,
      logged_at: 2000,
    });
    await workoutRepo.deleteSet(db, 'set-1');
    const remaining = await workoutRepo.getSetsForSession(db, 's1');
    expect(remaining.map((s) => s.id)).toEqual(['set-2']);
  });

  it('getSetsForSession orders by logged_at then set_index', async () => {
    const db = await freshDb();
    await seededSession(db);
    await workoutRepo.addSet(db, {
      id: 'set-b',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 1,
      weight_kg: 60,
      reps: 8,
      logged_at: 2000,
    });
    await workoutRepo.addSet(db, {
      id: 'set-a',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 60,
      reps: 8,
      logged_at: 1000,
    });
    const sets = await workoutRepo.getSetsForSession(db, 's1');
    expect(sets.map((s) => s.id)).toEqual(['set-a', 'set-b']);
  });

  it('getSetsForExercise joins across sessions with each session\'s date, oldest first', async () => {
    const db = await freshDb();
    await workoutRepo.startSession(db, { id: 's1', date: '2026-09-01', started_at: 1000 });
    await workoutRepo.startSession(db, { id: 's2', date: '2026-09-08', started_at: 2000 });
    await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's2',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 65,
      reps: 5,
      logged_at: 2000,
    });
    await workoutRepo.addSet(db, {
      id: 'set-2',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 60,
      reps: 5,
      logged_at: 1000,
    });
    const history = await workoutRepo.getSetsForExercise(db, 'seed_bench_press');
    expect(history.map((s) => s.date)).toEqual(['2026-09-01', '2026-09-08']);
  });

  it('getSetsForExercise for an untouched exercise returns an empty array, not an error', async () => {
    const db = await freshDb();
    const history = await workoutRepo.getSetsForExercise(db, 'seed_face_pull');
    expect(history).toEqual([]);
  });

  describe('getLastSetForExercise', () => {
    it('returns null when the exercise has never been logged', async () => {
      const db = await freshDb();
      expect(await workoutRepo.getLastSetForExercise(db, 'seed_deadlift')).toBeNull();
    });

    it('without exclusion, returns the most recent set even from the current session (in-session progression)', async () => {
      const db = await freshDb();
      await seededSession(db);
      await workoutRepo.addSet(db, {
        id: 'set-1',
        session_id: 's1',
        exercise_id: 'seed_bench_press',
        set_index: 0,
        weight_kg: 60,
        reps: 8,
        logged_at: 1000,
      });
      const last = await workoutRepo.getLastSetForExercise(db, 'seed_bench_press');
      expect(last?.id).toBe('set-1');
    });

    it('with excludeSessionId, reaches back to the most recent OTHER session ("last time")', async () => {
      const db = await freshDb();
      await workoutRepo.startSession(db, { id: 's1', date: '2026-09-01', started_at: 1000 });
      await workoutRepo.startSession(db, { id: 's2', date: '2026-09-08', started_at: 2000 });
      await workoutRepo.addSet(db, {
        id: 'last-time-set',
        session_id: 's1',
        exercise_id: 'seed_bench_press',
        set_index: 0,
        weight_kg: 60,
        reps: 8,
        logged_at: 1000,
      });
      // s2 is "today" — nothing logged for this exercise yet in it.
      const lastTime = await workoutRepo.getLastSetForExercise(db, 'seed_bench_press', 's2');
      expect(lastTime?.id).toBe('last-time-set');
    });
  });

  it('getRecentlyUsedExerciseIds orders by most-recently-logged', async () => {
    const db = await freshDb();
    await seededSession(db);
    await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 60,
      reps: 8,
      logged_at: 1000,
    });
    await workoutRepo.addSet(db, {
      id: 'set-2',
      session_id: 's1',
      exercise_id: 'seed_back_squat',
      set_index: 0,
      weight_kg: 100,
      reps: 5,
      logged_at: 2000,
    });
    const recent = await workoutRepo.getRecentlyUsedExerciseIds(db, 5);
    expect(recent[0]).toBe('seed_back_squat');
    expect(recent).toContain('seed_bench_press');
  });
});

describe('workoutRepo — set_type and workout_set_segment (schema v7)', () => {
  async function seededSession(db: Database, id = 's1'): Promise<void> {
    await workoutRepo.startSession(db, { id, date: '2026-09-05', started_at: 1000 });
  }

  it('addSet defaults set_type to straight when omitted', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      logged_at: 1000,
    });
    expect(set.set_type).toBe('straight');
  });

  it('addSet accepts an explicit set_type', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      logged_at: 1000,
      set_type: 'myo_rep',
    });
    expect(set.set_type).toBe('myo_rep');
  });

  it('updateSet can change set_type without touching other fields', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      rpe: 8,
      logged_at: 1000,
    });
    const updated = await workoutRepo.updateSet(db, set.id, { set_type: 'partials' });
    expect(updated.set_type).toBe('partials');
    expect(updated.weight_kg).toBe(100);
    expect(updated.rpe).toBe(8);
  });

  it('updateSet omitting set_type leaves the existing value unchanged', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      set_type: 'drop',
      logged_at: 1000,
    });
    const updated = await workoutRepo.updateSet(db, set.id, { weight_kg: 105 });
    expect(updated.set_type).toBe('drop');
  });

  it('addSetSegment / getSegmentsForSet round-trips, ordered by segment_index', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_incline_db_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      set_type: 'drop',
      logged_at: 1000,
    });
    await workoutRepo.addSetSegment(db, { id: 'seg-2', workout_set_id: set.id, segment_index: 2, weight_kg: 60, reps: 5 });
    await workoutRepo.addSetSegment(db, { id: 'seg-1', workout_set_id: set.id, segment_index: 1, weight_kg: 80, reps: 6 });

    const segments = await workoutRepo.getSegmentsForSet(db, set.id);
    expect(segments.map((s) => s.id)).toEqual(['seg-1', 'seg-2']);
  });

  it('getSegmentsForSet returns an empty array for a straight set with no segments', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      logged_at: 1000,
    });
    expect(await workoutRepo.getSegmentsForSet(db, set.id)).toEqual([]);
  });

  it('updateSetSegment patches weight only, leaving reps unchanged', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_incline_db_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      set_type: 'drop',
      logged_at: 1000,
    });
    await workoutRepo.addSetSegment(db, { id: 'seg-1', workout_set_id: set.id, segment_index: 1, weight_kg: 80, reps: 6 });

    const updated = await workoutRepo.updateSetSegment(db, 'seg-1', { weight_kg: 70 });
    expect(updated.weight_kg).toBe(70);
    expect(updated.reps).toBe(6);
  });

  it('updateSetSegment patches reps only, leaving weight unchanged', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_incline_db_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      set_type: 'drop',
      logged_at: 1000,
    });
    await workoutRepo.addSetSegment(db, { id: 'seg-1', workout_set_id: set.id, segment_index: 1, weight_kg: 80, reps: 6 });

    const updated = await workoutRepo.updateSetSegment(db, 'seg-1', { reps: 7 });
    expect(updated.weight_kg).toBe(80);
    expect(updated.reps).toBe(7);
  });

  it('deleteSetSegment removes exactly the one segment', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_incline_db_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      set_type: 'drop',
      logged_at: 1000,
    });
    await workoutRepo.addSetSegment(db, { id: 'seg-1', workout_set_id: set.id, segment_index: 1, weight_kg: 80, reps: 6 });
    await workoutRepo.addSetSegment(db, { id: 'seg-2', workout_set_id: set.id, segment_index: 2, weight_kg: 60, reps: 5 });

    await workoutRepo.deleteSetSegment(db, 'seg-1');
    const remaining = await workoutRepo.getSegmentsForSet(db, set.id);
    expect(remaining.map((s) => s.id)).toEqual(['seg-2']);
  });

  it('deleting the parent set cascades to its segments', async () => {
    const db = await freshDb();
    await seededSession(db);
    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: 's1',
      exercise_id: 'seed_incline_db_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      set_type: 'drop',
      logged_at: 1000,
    });
    await workoutRepo.addSetSegment(db, { id: 'seg-1', workout_set_id: set.id, segment_index: 1, weight_kg: 80, reps: 6 });

    await workoutRepo.deleteSet(db, set.id);
    expect(await workoutRepo.getSegmentsForSet(db, set.id)).toEqual([]);
  });

  it('getSegmentsForSession returns every segment across every set in the session, grouped implicitly by ordering', async () => {
    const db = await freshDb();
    await seededSession(db);
    const setA = await workoutRepo.addSet(db, {
      id: 'set-a',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      set_type: 'drop',
      logged_at: 1000,
    });
    const setB = await workoutRepo.addSet(db, {
      id: 'set-b',
      session_id: 's1',
      exercise_id: 'seed_back_squat',
      set_index: 0,
      weight_kg: 120,
      reps: 6,
      set_type: 'drop',
      logged_at: 2000,
    });
    await workoutRepo.addSetSegment(db, { id: 'seg-a1', workout_set_id: setA.id, segment_index: 1, weight_kg: 80, reps: 6 });
    await workoutRepo.addSetSegment(db, { id: 'seg-b1', workout_set_id: setB.id, segment_index: 1, weight_kg: 100, reps: 5 });

    const segments = await workoutRepo.getSegmentsForSession(db, 's1');
    expect(segments.map((s) => s.id).sort()).toEqual(['seg-a1', 'seg-b1']);
  });

  it('getSegmentsForSession returns an empty array for a session with no segments', async () => {
    const db = await freshDb();
    await seededSession(db);
    await workoutRepo.addSet(db, {
      id: 'set-a',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      logged_at: 1000,
    });
    expect(await workoutRepo.getSegmentsForSession(db, 's1')).toEqual([]);
  });

  it('getSegmentsForExercise returns every segment for one exercise across every session, ignoring other exercises', async () => {
    const db = await freshDb();
    await seededSession(db, 's1');
    await seededSession(db, 's2');
    const benchSessionOne = await workoutRepo.addSet(db, {
      id: 'set-bench-1',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      set_type: 'drop',
      logged_at: 1000,
    });
    const benchSessionTwo = await workoutRepo.addSet(db, {
      id: 'set-bench-2',
      session_id: 's2',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 102,
      reps: 8,
      set_type: 'drop',
      logged_at: 2000,
    });
    const squatSet = await workoutRepo.addSet(db, {
      id: 'set-squat-1',
      session_id: 's1',
      exercise_id: 'seed_back_squat',
      set_index: 0,
      weight_kg: 120,
      reps: 6,
      set_type: 'drop',
      logged_at: 1500,
    });
    await workoutRepo.addSetSegment(db, { id: 'seg-bench-1a', workout_set_id: benchSessionOne.id, segment_index: 1, weight_kg: 80, reps: 6 });
    await workoutRepo.addSetSegment(db, { id: 'seg-bench-2a', workout_set_id: benchSessionTwo.id, segment_index: 1, weight_kg: 82, reps: 6 });
    await workoutRepo.addSetSegment(db, { id: 'seg-squat-1a', workout_set_id: squatSet.id, segment_index: 1, weight_kg: 100, reps: 5 });

    const benchSegments = await workoutRepo.getSegmentsForExercise(db, 'seed_bench_press');
    expect(benchSegments.map((s) => s.id).sort()).toEqual(['seg-bench-1a', 'seg-bench-2a']);
  });

  it('getSegmentsForExercise returns an empty array for an exercise with no segments', async () => {
    const db = await freshDb();
    await seededSession(db);
    await workoutRepo.addSet(db, {
      id: 'set-a',
      session_id: 's1',
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      logged_at: 1000,
    });
    expect(await workoutRepo.getSegmentsForExercise(db, 'seed_bench_press')).toEqual([]);
  });
});
