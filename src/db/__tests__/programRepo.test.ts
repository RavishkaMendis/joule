import { runMigrations } from '../migrations';
import { createTestDatabase } from './testDb';
import * as programRepo from '../repositories/programRepo';
import type { Database } from '../database';

async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}

describe('programRepo', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('createProgram / getProgram / listPrograms round-trip', async () => {
    const created = await programRepo.createProgram(db, { id: 'p1', name: 'My Plan', created_at: 1000 });
    expect(created).toMatchObject({ id: 'p1', name: 'My Plan', is_active: 0 });

    const fetched = await programRepo.getProgram(db, 'p1');
    expect(fetched).toEqual(created);

    const all = await programRepo.listPrograms(db);
    expect(all.map((p) => p.id)).toContain('p1');
    // Plus the seeded generic template from the migration.
    expect(all.map((p) => p.id)).toContain('seed_program_generic_ul');
  });

  it('updateProgram patches name/description without touching is_active', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'Old name', created_at: 1000 });
    const updated = await programRepo.updateProgram(db, 'p1', { name: 'New name', description: 'desc' });
    expect(updated.name).toBe('New name');
    expect(updated.description).toBe('desc');
    expect(updated.is_active).toBe(0);
  });

  it('setActiveProgram clears every other program and sets exactly one active', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'A', created_at: 1000 });
    await programRepo.createProgram(db, { id: 'p2', name: 'B', created_at: 2000 });

    await programRepo.setActiveProgram(db, 'p1');
    expect((await programRepo.getProgram(db, 'p1'))?.is_active).toBe(1);
    // The seeded template is deactivated too.
    expect((await programRepo.getProgram(db, 'seed_program_generic_ul'))?.is_active).toBe(0);

    await programRepo.setActiveProgram(db, 'p2');
    expect((await programRepo.getProgram(db, 'p1'))?.is_active).toBe(0);
    expect((await programRepo.getProgram(db, 'p2'))?.is_active).toBe(1);

    await programRepo.setActiveProgram(db, null);
    expect((await programRepo.getProgram(db, 'p2'))?.is_active).toBe(0);
  });

  it('deleteProgram cascades to days, exercises, and substitutions', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'A', created_at: 1000 });
    const day = await programRepo.createProgramDay(db, { id: 'd1', program_id: 'p1', order_index: 0, label: 'Day 1' });
    const pe = await programRepo.createProgramExercise(db, {
      id: 'pe1',
      program_day_id: day.id,
      exercise_id: 'seed_bench_press',
      order_index: 0,
      target_sets: 3,
      rep_low: 8,
      rep_high: 10,
    });
    await programRepo.addSubstitution(db, { id: 'sub1', program_exercise_id: pe.id, exercise_id: 'seed_incline_db_press' });

    await programRepo.deleteProgram(db, 'p1');

    expect(await programRepo.getProgram(db, 'p1')).toBeNull();
    expect(await programRepo.getProgramDay(db, 'd1')).toBeNull();
    expect(await programRepo.getProgramExercise(db, 'pe1')).toBeNull();
    expect(await programRepo.listSubstitutionsForExercise(db, 'pe1')).toEqual([]);
  });

  it('createProgramDay / listDaysForProgram orders by order_index', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'A', created_at: 1000 });
    await programRepo.createProgramDay(db, { id: 'd2', program_id: 'p1', order_index: 1, label: 'Day 2' });
    await programRepo.createProgramDay(db, { id: 'd1', program_id: 'p1', order_index: 0, label: 'Day 1' });

    const days = await programRepo.listDaysForProgram(db, 'p1');
    expect(days.map((d) => d.id)).toEqual(['d1', 'd2']);
  });

  it('reorderProgramDays rewrites order_index to match the given order', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'A', created_at: 1000 });
    await programRepo.createProgramDay(db, { id: 'd1', program_id: 'p1', order_index: 0, label: 'Day 1' });
    await programRepo.createProgramDay(db, { id: 'd2', program_id: 'p1', order_index: 1, label: 'Day 2' });

    await programRepo.reorderProgramDays(db, ['d2', 'd1']);

    const days = await programRepo.listDaysForProgram(db, 'p1');
    expect(days.map((d) => d.id)).toEqual(['d2', 'd1']);
  });

  it('createProgramExercise / listExercisesForDay orders by order_index and defaults optional fields to null', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'A', created_at: 1000 });
    const day = await programRepo.createProgramDay(db, { id: 'd1', program_id: 'p1', order_index: 0, label: 'Day 1' });

    const pe = await programRepo.createProgramExercise(db, {
      id: 'pe1',
      program_day_id: day.id,
      exercise_id: 'seed_bench_press',
      order_index: 0,
      target_sets: 3,
      rep_low: 8,
      rep_high: 10,
    });
    expect(pe.target_rir).toBeNull();
    expect(pe.rest_seconds).toBeNull();
    expect(pe.cues).toBeNull();
    expect(pe.demo_url).toBeNull();

    const exercises = await programRepo.listExercisesForDay(db, day.id);
    expect(exercises).toHaveLength(1);
  });

  it('updateProgramExercise patches fields and preserves explicit nulls vs. undefined-means-unchanged', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'A', created_at: 1000 });
    const day = await programRepo.createProgramDay(db, { id: 'd1', program_id: 'p1', order_index: 0, label: 'Day 1' });
    const pe = await programRepo.createProgramExercise(db, {
      id: 'pe1',
      program_day_id: day.id,
      exercise_id: 'seed_bench_press',
      order_index: 0,
      target_sets: 3,
      rep_low: 8,
      rep_high: 10,
      target_rir: 2,
      cues: 'old cue',
    });

    const patched = await programRepo.updateProgramExercise(db, pe.id, { target_sets: 4, cues: 'new cue' });
    expect(patched.target_sets).toBe(4);
    expect(patched.cues).toBe('new cue');
    expect(patched.target_rir).toBe(2); // untouched field preserved

    const cleared = await programRepo.updateProgramExercise(db, pe.id, { target_rir: null });
    expect(cleared.target_rir).toBeNull();
  });

  it('deleteProgramExercise cascades to its substitutions', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'A', created_at: 1000 });
    const day = await programRepo.createProgramDay(db, { id: 'd1', program_id: 'p1', order_index: 0, label: 'Day 1' });
    const pe = await programRepo.createProgramExercise(db, {
      id: 'pe1',
      program_day_id: day.id,
      exercise_id: 'seed_bench_press',
      order_index: 0,
      target_sets: 3,
      rep_low: 8,
      rep_high: 10,
    });
    await programRepo.addSubstitution(db, { id: 'sub1', program_exercise_id: pe.id, exercise_id: 'seed_incline_db_press' });

    await programRepo.deleteProgramExercise(db, pe.id);

    expect(await programRepo.getProgramExercise(db, pe.id)).toBeNull();
    expect(await programRepo.listSubstitutionsForExercise(db, pe.id)).toEqual([]);
  });

  it('addSubstitution / listSubstitutionsForExercise / deleteSubstitution', async () => {
    await programRepo.createProgram(db, { id: 'p1', name: 'A', created_at: 1000 });
    const day = await programRepo.createProgramDay(db, { id: 'd1', program_id: 'p1', order_index: 0, label: 'Day 1' });
    const pe = await programRepo.createProgramExercise(db, {
      id: 'pe1',
      program_day_id: day.id,
      exercise_id: 'seed_bench_press',
      order_index: 0,
      target_sets: 3,
      rep_low: 8,
      rep_high: 10,
    });

    const sub = await programRepo.addSubstitution(db, {
      id: 'sub1',
      program_exercise_id: pe.id,
      exercise_id: 'seed_incline_db_press',
      note: 'no bench',
    });
    expect(sub.note).toBe('no bench');

    expect(await programRepo.listSubstitutionsForExercise(db, pe.id)).toHaveLength(1);

    await programRepo.deleteSubstitution(db, sub.id);
    expect(await programRepo.listSubstitutionsForExercise(db, pe.id)).toHaveLength(0);
  });
});
