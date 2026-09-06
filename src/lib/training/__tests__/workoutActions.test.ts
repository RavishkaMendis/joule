import { runMigrations } from '../../../db/migrations';
import { createTestDatabase } from '../../../db/__tests__/testDb';
import * as workoutActions from '../workoutActions';
import * as workoutRepo from '../../../db/repositories/workoutRepo';
import type { Database } from '../../../db/database';

async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}

describe('startNewSession', () => {
  it('creates a session with a generated id', async () => {
    const db = await freshDb();
    const session = await workoutActions.startNewSession(db, '2026-09-05', 1000);
    expect(session.date).toBe('2026-09-05');
    expect(session.id).toEqual(expect.any(String));
  });
});

describe('getPrefillForExercise', () => {
  it('returns null when the exercise has never been logged', async () => {
    const db = await freshDb();
    expect(await workoutActions.getPrefillForExercise(db, 'seed_deadlift')).toBeNull();
  });

  it('pre-fills from the most recent set, including one logged earlier in the same session', async () => {
    const db = await freshDb();
    const session = await workoutActions.startNewSession(db, '2026-09-05');
    await workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_bench_press', weightKg: 60, reps: 8 });
    await workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_bench_press', weightKg: 62.5, reps: 6 });

    const prefill = await workoutActions.getPrefillForExercise(db, 'seed_bench_press');
    expect(prefill).toEqual({ weightKg: 62.5, reps: 6 });
  });
});

describe('getLastTimeForExercise', () => {
  it('reaches back to the most recent OTHER session even if today already has sets', async () => {
    const db = await freshDb();
    const lastWeek = await workoutActions.startNewSession(db, '2026-08-29', 1000);
    await workoutActions.logSet(db, { sessionId: lastWeek.id, exerciseId: 'seed_bench_press', weightKg: 60, reps: 8, loggedAt: 1000 });

    const today = await workoutActions.startNewSession(db, '2026-09-05', 2000);
    await workoutActions.logSet(db, { sessionId: today.id, exerciseId: 'seed_bench_press', weightKg: 65, reps: 5, loggedAt: 2000 });

    const lastTime = await workoutActions.getLastTimeForExercise(db, 'seed_bench_press', today.id);
    expect(lastTime?.weight_kg).toBe(60);
    expect(lastTime?.reps).toBe(8);
  });

  it('returns null when there is no prior session for this exercise', async () => {
    const db = await freshDb();
    const today = await workoutActions.startNewSession(db, '2026-09-05');
    const lastTime = await workoutActions.getLastTimeForExercise(db, 'seed_bench_press', today.id);
    expect(lastTime).toBeNull();
  });
});

describe('logSet', () => {
  it('auto-increments set_index per exercise within a session', async () => {
    const db = await freshDb();
    const session = await workoutActions.startNewSession(db, '2026-09-05');
    const s1 = await workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_bench_press', weightKg: 60, reps: 8 });
    const s2 = await workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_bench_press', weightKg: 60, reps: 7 });
    const s3Other = await workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_back_squat', weightKg: 100, reps: 5 });

    expect(s1.set_index).toBe(0);
    expect(s2.set_index).toBe(1);
    expect(s3Other.set_index).toBe(0); // different exercise, its own counter
  });

  it('rejects zero/negative reps rather than logging a phantom set', async () => {
    const db = await freshDb();
    const session = await workoutActions.startNewSession(db, '2026-09-05');
    await expect(
      workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_bench_press', weightKg: 60, reps: 0 })
    ).rejects.toThrow();
  });

  it('rejects negative weight', async () => {
    const db = await freshDb();
    const session = await workoutActions.startNewSession(db, '2026-09-05');
    await expect(
      workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_bench_press', weightKg: -10, reps: 5 })
    ).rejects.toThrow();
  });

  it('accepts zero weight (bodyweight exercise)', async () => {
    const db = await freshDb();
    const session = await workoutActions.startNewSession(db, '2026-09-05');
    const set = await workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_pull_up', weightKg: 0, reps: 10 });
    expect(set.weight_kg).toBe(0);
  });

  it('defaults isWarmup false and rpe null', async () => {
    const db = await freshDb();
    const session = await workoutActions.startNewSession(db, '2026-09-05');
    const set = await workoutActions.logSet(db, { sessionId: session.id, exerciseId: 'seed_bench_press', weightKg: 60, reps: 8 });
    expect(set.is_warmup).toBe(0);
    expect(set.rpe).toBeNull();
  });
});

describe('addCustomExercise', () => {
  it('creates a custom exercise with a generated id', async () => {
    const db = await freshDb();
    const exercise = await workoutActions.addCustomExercise(db, 'Zercher Squat', 'legs', 'barbell');
    expect(exercise.name).toBe('Zercher Squat');
    expect(exercise.is_custom).toBe(1);
    // Usable immediately for logging a set.
    const session = await workoutActions.startNewSession(db, '2026-09-05');
    const set = await workoutRepo.addSet(db, {
      id: 'set-x',
      session_id: session.id,
      exercise_id: exercise.id,
      set_index: 0,
      weight_kg: 80,
      reps: 5,
      logged_at: 1000,
    });
    expect(set.exercise_id).toBe(exercise.id);
  });
});
