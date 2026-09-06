import { runMigrations } from '../../../db/migrations';
import { createTestDatabase } from '../../../db/__tests__/testDb';
import * as programActions from '../programActions';
import * as programRepo from '../../../db/repositories/programRepo';
import * as workoutRepo from '../../../db/repositories/workoutRepo';
import type { Database } from '../../../db/database';

async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}

describe('createProgram', () => {
  it('creates an inactive program with a generated id', async () => {
    const db = await freshDb();
    const program = await programActions.createProgram(db, 'My Plan', 'a plan');
    expect(program.name).toBe('My Plan');
    expect(program.description).toBe('a plan');
    expect(program.is_active).toBe(0);
  });
});

describe('addDay / addExerciseToDay', () => {
  it('appends days and exercises at the end of their existing lists', async () => {
    const db = await freshDb();
    const program = await programActions.createProgram(db, 'My Plan');

    const day1 = await programActions.addDay(db, program.id, 'Day 1');
    const day2 = await programActions.addDay(db, program.id, 'Day 2');
    expect(day1.order_index).toBe(0);
    expect(day2.order_index).toBe(1);

    const pe1 = await programActions.addExerciseToDay(db, day1.id, {
      exerciseId: 'seed_bench_press',
      targetSets: 3,
      repLow: 8,
      repHigh: 10,
      targetRir: 2,
    });
    const pe2 = await programActions.addExerciseToDay(db, day1.id, {
      exerciseId: 'seed_barbell_row',
      targetSets: 3,
      repLow: 8,
      repHigh: 10,
    });
    expect(pe1.order_index).toBe(0);
    expect(pe2.order_index).toBe(1);
    expect(pe2.target_rir).toBeNull();
  });
});

describe('addSubstitutionOption', () => {
  it('records a substitution catalog entry', async () => {
    const db = await freshDb();
    const program = await programActions.createProgram(db, 'My Plan');
    const day = await programActions.addDay(db, program.id, 'Day 1');
    const pe = await programActions.addExerciseToDay(db, day.id, {
      exerciseId: 'seed_bench_press',
      targetSets: 3,
      repLow: 8,
      repHigh: 10,
    });

    await programActions.addSubstitutionOption(db, pe.id, 'seed_incline_db_press', 'no bench');

    const subs = await programRepo.listSubstitutionsForExercise(db, pe.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ exercise_id: 'seed_incline_db_press', note: 'no bench' });
  });
});

describe('duplicateProgram', () => {
  it('deep-copies days, exercises, and substitutions with fresh ids, always inactive', async () => {
    const db = await freshDb();
    const program = await programActions.createProgram(db, 'Original');
    await programRepo.setActiveProgram(db, program.id);

    const day = await programActions.addDay(db, program.id, 'Day 1');
    const pe = await programActions.addExerciseToDay(db, day.id, {
      exerciseId: 'seed_bench_press',
      targetSets: 3,
      repLow: 8,
      repHigh: 10,
      targetRir: 2,
      cues: 'brace',
    });
    await programActions.addSubstitutionOption(db, pe.id, 'seed_incline_db_press', 'no bench');

    const copy = await programActions.duplicateProgram(db, program.id);

    expect(copy.id).not.toBe(program.id);
    expect(copy.name).toBe('Original (copy)');
    expect(copy.is_active).toBe(0); // never silently promoted, even though the original is active

    const copiedDays = await programRepo.listDaysForProgram(db, copy.id);
    expect(copiedDays).toHaveLength(1);
    expect(copiedDays[0].id).not.toBe(day.id);
    expect(copiedDays[0].label).toBe('Day 1');

    const copiedExercises = await programRepo.listExercisesForDay(db, copiedDays[0].id);
    expect(copiedExercises).toHaveLength(1);
    expect(copiedExercises[0].id).not.toBe(pe.id);
    expect(copiedExercises[0].cues).toBe('brace');
    expect(copiedExercises[0].target_rir).toBe(2);

    const copiedSubs = await programRepo.listSubstitutionsForExercise(db, copiedExercises[0].id);
    expect(copiedSubs).toHaveLength(1);
    expect(copiedSubs[0].exercise_id).toBe('seed_incline_db_press');

    // The original is untouched.
    expect(await programRepo.listSubstitutionsForExercise(db, pe.id)).toHaveLength(1);
  });

  it('uses a custom name when given one', async () => {
    const db = await freshDb();
    const program = await programActions.createProgram(db, 'Original');
    const copy = await programActions.duplicateProgram(db, program.id, 'My Custom Copy');
    expect(copy.name).toBe('My Custom Copy');
  });
});

describe('startSessionFromProgramDay', () => {
  it('creates a workout_session tagged with the given program_day_id, writing no sets', async () => {
    const db = await freshDb();
    const program = await programActions.createProgram(db, 'My Plan');
    const day = await programActions.addDay(db, program.id, 'Day 1');

    const session = await programActions.startSessionFromProgramDay(db, day.id, '2026-09-05', 1000);

    expect(session.program_day_id).toBe(day.id);
    expect(session.date).toBe('2026-09-05');
    expect(await workoutRepo.getSetsForSession(db, session.id)).toEqual([]);
  });
});
