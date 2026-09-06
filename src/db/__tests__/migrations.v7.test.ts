// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V7 MIGRATION — training programs/templates: program /
// program_day / program_exercise / program_substitution +
// workout_session.program_day_id (task brief "training program / template
// system").
//
// Mirrors migrations.v6.test.ts's structure: simulates a real device
// upgrade from v6 to v7 (not just a fresh install), proves the migration
// is additive/non-destructive, proves the generic starter template seeds
// correctly and only once, and proves an OLD backup snapshot (pre-v7
// shape: none of the four program_* keys, no workout_session.program_day_id
// key) restores cleanly through the existing restoreFromSnapshot without
// this feature's migration touching src/lib/backup/snapshot.ts at all.
// ═══════════════════════════════════════════════════════════════════════

import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../migrations';
import { createTestDatabase } from './testDb';
import * as workoutRepo from '../repositories/workoutRepo';
import * as programRepo from '../repositories/programRepo';
import { restoreFromSnapshot } from '../../lib/backup/restore';
import type { BackupSnapshot } from '../../lib/backup/snapshot';

const UP_TO_V6 = MIGRATIONS.filter((m) => m.version <= 6);

describe('schema v7 migration — additive, non-destructive upgrade', () => {
  it('creates the four program tables with their indices', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('program');
    expect(names).toContain('program_day');
    expect(names).toContain('program_exercise');
    expect(names).toContain('program_substitution');

    const indexes = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index'"
    );
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_program_day_program');
    expect(indexNames).toContain('idx_program_exercise_day');
    expect(indexNames).toContain('idx_program_substitution_exercise');
    expect(indexNames).toContain('idx_workout_session_program_day');
  });

  it('adds workout_session.program_day_id as nullable', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const columns = await db.getAllAsync<{ name: string; notnull: number }>('PRAGMA table_info(workout_session)');
    const col = columns.find((c) => c.name === 'program_day_id');
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(0);
  });

  it('does not add or drop any other table — same tables as v6 plus the four program_* tables', async () => {
    const db = createTestDatabase();
    await runMigrations(db);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((t) => t.name).sort()).toEqual(
      [
        'day_intake',
        'exercise',
        'external_estimate',
        'food_entry',
        'pot',
        'pot_container',
        'program',
        'program_day',
        'program_exercise',
        'program_substitution',
        'saved_food',
        'supplement',
        'supplement_log',
        'user_profile',
        'weight_log',
        'workout_session',
        'workout_set',
        'workout_set_segment',
      ].sort()
    );
  });

  it('seeds exactly two starter templates (generic upper/lower + high-intensity bro split)', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const programs = await programRepo.listPrograms(db);
    expect(programs).toHaveLength(2);
    expect(programs.map((p) => p.id).sort()).toEqual(['seed_program_generic_ul', 'seed_program_hit_bro_split']);
  });

  it('seeds the generic upper/lower template with four days, built entirely from the existing v4 exercise library, active by default', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const program = await programRepo.getProgram(db, 'seed_program_generic_ul');
    expect(program).not.toBeNull();
    expect(program?.is_active).toBe(1);
    // Labelled plainly as generic, not attributed to any named program.
    expect(program?.name.toLowerCase()).toContain('generic');

    const days = await programRepo.listDaysForProgram(db, 'seed_program_generic_ul');
    expect(days).toHaveLength(4);
    expect(days.map((d) => d.label)).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    expect(days.map((d) => d.order_index)).toEqual([0, 1, 2, 3]);

    for (const day of days) {
      const exercises = await programRepo.listExercisesForDay(db, day.id);
      expect(exercises.length).toBeGreaterThan(0);
      for (const pe of exercises) {
        // Every seeded program_exercise must point at a real, already-seeded exercise row.
        const exerciseRow = await db.getFirstAsync('SELECT id FROM exercise WHERE id = ?', [pe.exercise_id]);
        expect(exerciseRow).not.toBeNull();
        expect(pe.target_sets).toBeGreaterThan(0);
        // The generic template is entirely rep_range — every row has a real rep_low/rep_high pair.
        expect(pe.prescription_type).toBe('rep_range');
        expect(pe.rep_low).not.toBeNull();
        expect(pe.rep_high).not.toBeNull();
        expect(pe.rep_low as number).toBeLessThanOrEqual(pe.rep_high as number);
      }
    }
  });

  it('seeds at least one substitution catalog entry pointing at a real exercise', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const days = await programRepo.listDaysForProgram(db, 'seed_program_generic_ul');
    const firstDayExercises = await programRepo.listExercisesForDay(db, days[0].id);
    const subs = await programRepo.listSubstitutionsForExercise(db, firstDayExercises[0].id);
    expect(subs.length).toBeGreaterThan(0);
    const subExercise = await db.getFirstAsync('SELECT id FROM exercise WHERE id = ?', [subs[0].exercise_id]);
    expect(subExercise).not.toBeNull();
  });

  it('seeds the high-intensity bro split with five days (one per major muscle group), inactive by default', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const program = await programRepo.getProgram(db, 'seed_program_hit_bro_split');
    expect(program).not.toBeNull();
    // Inactive by default — creating a second template must never silently switch the user off the one they're already following.
    expect(program?.is_active).toBe(0);
    // Descriptive name only — no person's name, no implied endorsement.
    expect(program?.name.toLowerCase()).not.toMatch(/nippard|athlean|mentzer|jeff|jay cutler/);

    const days = await programRepo.listDaysForProgram(db, 'seed_program_hit_bro_split');
    expect(days.map((d) => d.label)).toEqual(['Chest', 'Back', 'Shoulders', 'Legs', 'Arms']);
  });

  it('bro split: every prescribed exercise is real, every rep_range/amrap row satisfies the CHECK-equivalent invariant, and no day repeats an exercise_id', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const days = await programRepo.listDaysForProgram(db, 'seed_program_hit_bro_split');
    let sawAmrap = false;
    let sawDropCue = false;

    for (const day of days) {
      const exercises = await programRepo.listExercisesForDay(db, day.id);
      expect(exercises.length).toBeGreaterThan(0);

      const exerciseIdsThisDay = exercises.map((pe) => pe.exercise_id);
      expect(new Set(exerciseIdsThisDay).size).toBe(exerciseIdsThisDay.length);

      for (const pe of exercises) {
        const exerciseRow = await db.getFirstAsync('SELECT id FROM exercise WHERE id = ?', [pe.exercise_id]);
        expect(exerciseRow).not.toBeNull();
        expect(pe.target_sets).toBeGreaterThan(0);

        if (pe.prescription_type === 'amrap') {
          sawAmrap = true;
          expect(pe.rep_low).toBeNull();
          expect(pe.rep_high).toBeNull();
          if (pe.cues && /drop/i.test(pe.cues)) sawDropCue = true;
        } else {
          expect(pe.rep_low).not.toBeNull();
          expect(pe.rep_high).not.toBeNull();
          expect(pe.rep_low as number).toBeLessThanOrEqual(pe.rep_high as number);
        }
      }
    }

    // "several exercises prescribed to failure with drop sets on finishers"
    expect(sawAmrap).toBe(true);
    expect(sawDropCue).toBe(true);
  });

  it('the program_exercise CHECK constraint rejects an amrap row with a non-null rep range', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await expect(
      db.runAsync(
        `INSERT INTO program_exercise (id, program_day_id, exercise_id, order_index, target_sets, prescription_type, rep_low, rep_high, target_rir)
         VALUES ('bad-pe', 'seed_day_hit_chest', 'seed_bench_press', 99, 3, 'amrap', 8, 10, 0)`
      )
    ).rejects.toThrow();
  });

  it('the program_exercise CHECK constraint rejects a rep_range row with a null rep range', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await expect(
      db.runAsync(
        `INSERT INTO program_exercise (id, program_day_id, exercise_id, order_index, target_sets, prescription_type, rep_low, rep_high, target_rir)
         VALUES ('bad-pe-2', 'seed_day_hit_chest', 'seed_bench_press', 99, 3, 'rep_range', NULL, NULL, 2)`
      )
    ).rejects.toThrow();
  });

  it('the program_exercise CHECK constraint rejects rep_low > rep_high', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await expect(
      db.runAsync(
        `INSERT INTO program_exercise (id, program_day_id, exercise_id, order_index, target_sets, prescription_type, rep_low, rep_high, target_rir)
         VALUES ('bad-pe-3', 'seed_day_hit_chest', 'seed_bench_press', 99, 3, 'rep_range', 12, 8, 2)`
      )
    ).rejects.toThrow();
  });

  it('workout_set.set_type defaults to straight for a plain insert, and workout_set_segment stores drop-set segments', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const session = await workoutRepo.startSession(db, { id: 'seg-session', date: '2026-08-01', started_at: 1000 });
    const topSet = await workoutRepo.addSet(db, {
      id: 'seg-set-1',
      session_id: session.id,
      exercise_id: 'seed_incline_db_press',
      set_index: 0,
      weight_kg: 100,
      reps: 8,
      logged_at: 1000,
    });
    expect(topSet.set_type).toBe('straight');

    const dropSet = await workoutRepo.updateSet(db, topSet.id, { set_type: 'drop' });
    expect(dropSet.set_type).toBe('drop');

    await workoutRepo.addSetSegment(db, { id: 'seg-1', workout_set_id: topSet.id, segment_index: 1, weight_kg: 80, reps: 6 });
    await workoutRepo.addSetSegment(db, { id: 'seg-2', workout_set_id: topSet.id, segment_index: 2, weight_kg: 60, reps: 5 });

    const segments = await workoutRepo.getSegmentsForSet(db, topSet.id);
    expect(segments.map((s) => [s.weight_kg, s.reps])).toEqual([
      [80, 6],
      [60, 5],
    ]);

    // Deleting the parent set cascades to its segments.
    await workoutRepo.deleteSet(db, topSet.id);
    expect(await workoutRepo.getSegmentsForSet(db, topSet.id)).toEqual([]);
  });

  it('a v6 database with real pre-v7 sessions upgrades to v7 with data intact and program_day_id NULL', async () => {
    const db = createTestDatabase();

    // Simulate a device that has only ever run migrations 1-6.
    await runMigrations(db, UP_TO_V6);
    let version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(6);

    // Real v6-shaped insert: workout_session has no program_day_id column yet.
    await db.runAsync(
      `INSERT INTO workout_session (id, date, name, started_at, notes) VALUES ('pre-v7-session', '2026-08-01', 'Leg day', 1000, NULL)`
    );

    await runMigrations(db, MIGRATIONS);
    version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);

    const session = await workoutRepo.getSession(db, 'pre-v7-session');
    expect(session?.name).toBe('Leg day');
    expect(session?.program_day_id).toBeNull();
  });

  it('running the v7 migration twice (idempotent re-run) does not error, does not duplicate the seed program, and does not duplicate the column', async () => {
    const db = createTestDatabase();
    await runMigrations(db, UP_TO_V6);
    await runMigrations(db, MIGRATIONS);
    await expect(runMigrations(db, MIGRATIONS)).resolves.toBeUndefined();

    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(workout_session)');
    expect(columns.filter((c) => c.name === 'program_day_id')).toHaveLength(1);

    const programs = await programRepo.listPrograms(db);
    expect(programs).toHaveLength(2);
  });

  it('a session started from a program day round-trips through workoutRepo with program_day_id set', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const days = await programRepo.listDaysForProgram(db, 'seed_program_generic_ul');
    const session = await workoutRepo.startSession(db, {
      id: 'program-session-1',
      date: '2026-08-01',
      started_at: 1000,
      program_day_id: days[0].id,
    });
    expect(session.program_day_id).toBe(days[0].id);

    const reloaded = await workoutRepo.getSession(db, 'program-session-1');
    expect(reloaded?.program_day_id).toBe(days[0].id);
  });

  it('deleting a program cascades to its days/exercises/substitutions but leaves an existing session that followed it untouched', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const days = await programRepo.listDaysForProgram(db, 'seed_program_generic_ul');
    const session = await workoutRepo.startSession(db, {
      id: 'program-session-2',
      date: '2026-08-01',
      started_at: 1000,
      program_day_id: days[0].id,
    });

    await programRepo.deleteProgram(db, 'seed_program_generic_ul');

    expect(await programRepo.getProgram(db, 'seed_program_generic_ul')).toBeNull();
    expect(await programRepo.listDaysForProgram(db, 'seed_program_generic_ul')).toHaveLength(0);

    // The session survives with a now-orphaned program_day_id — exactly
    // the food_entry.pot_id precedent (schema.ts's v7 header).
    const reloaded = await workoutRepo.getSession(db, session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.program_day_id).toBe(days[0].id);
  });

  it('a pre-v7 backup snapshot (no program_* keys, no workout_session.program_day_id key) restores cleanly against a v7 database', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    // Shape a snapshot exactly as a pre-v7 app version's exportFullJson
    // would have produced it: no `program`/`program_day`/
    // `program_exercise`/`program_substitution` keys on the object at
    // all, and a `workout_session` row without a `program_day_id` field.
    // Cast through `unknown` since this deliberately does NOT satisfy the
    // current (post-v7) types — that mismatch IS the scenario being
    // tested.
    const legacySnapshot = {
      exported_at: '2026-01-01T00:00:00.000Z',
      schema_version: 6,
      backup_format_version: 1,
      day_intake: [],
      weight_log: [],
      external_estimate: [],
      food_entry: [],
      saved_food: [],
      pot: [],
      pot_container: [],
      exercise: [],
      workout_session: [
        { id: 'legacy-session-1', date: '2026-01-01', name: 'Push day', started_at: 1000, notes: null },
      ],
      workout_set: [],
      supplement: [],
      supplement_log: [],
      user_profile: [],
      app_target_snapshot: null,
      app_household_prefs: null,
      app_checkin_history: null,
    } as unknown as BackupSnapshot;

    await expect(restoreFromSnapshot(db, legacySnapshot)).resolves.toBeDefined();

    const session = await workoutRepo.getSession(db, 'legacy-session-1');
    expect(session?.name).toBe('Push day');
    expect(session?.program_day_id).toBeNull();

    // No program_* keys at all in the legacy snapshot -> every program
    // table restores to empty (hard replace-all, same contract as
    // exercise/workout_session/workout_set on an old-format snapshot).
    expect(await programRepo.listPrograms(db)).toHaveLength(0);
  });

  it('a snapshot WITH program_* rows and workout_session.program_day_id restores them intact', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const snapshot = {
      exported_at: '2026-01-01T00:00:00.000Z',
      schema_version: LATEST_SCHEMA_VERSION,
      backup_format_version: 1,
      day_intake: [],
      weight_log: [],
      external_estimate: [],
      food_entry: [],
      saved_food: [],
      pot: [],
      pot_container: [],
      exercise: [
        { id: 'seed_bench_press', name: 'Bench Press', category: 'chest', equipment: 'barbell', is_custom: 0 },
        { id: 'seed_incline_db_press', name: 'Incline Dumbbell Press', category: 'chest', equipment: 'dumbbell', is_custom: 0 },
      ],
      workout_session: [
        { id: 'session-1', date: '2026-01-01', name: 'Upper A', started_at: 1000, notes: null, program_day_id: 'day-1' },
      ],
      workout_set: [],
      program: [{ id: 'prog-1', name: 'My Program', description: null, is_active: 1, created_at: 500 }],
      program_day: [{ id: 'day-1', program_id: 'prog-1', order_index: 0, label: 'Upper A' }],
      program_exercise: [
        {
          id: 'pe-1',
          program_day_id: 'day-1',
          exercise_id: 'seed_bench_press',
          order_index: 0,
          target_sets: 3,
          rep_low: 8,
          rep_high: 10,
          target_rir: 2,
          rest_seconds: 120,
          cues: 'Brace and press.',
          demo_url: null,
        },
      ],
      program_substitution: [
        { id: 'sub-1', program_exercise_id: 'pe-1', exercise_id: 'seed_incline_db_press', note: 'No bench available' },
      ],
      supplement: [],
      user_profile: [],
      app_target_snapshot: null,
      app_household_prefs: null,
      app_checkin_history: null,
    } as unknown as BackupSnapshot;

    await restoreFromSnapshot(db, snapshot);

    const programs = await programRepo.listPrograms(db);
    expect(programs).toEqual([{ id: 'prog-1', name: 'My Program', description: null, is_active: 1, created_at: 500 }]);

    const days = await programRepo.listDaysForProgram(db, 'prog-1');
    expect(days).toHaveLength(1);

    const exercises = await programRepo.listExercisesForDay(db, 'day-1');
    expect(exercises).toHaveLength(1);
    expect(exercises[0].cues).toBe('Brace and press.');

    const subs = await programRepo.listSubstitutionsForExercise(db, 'pe-1');
    expect(subs).toHaveLength(1);

    const session = await workoutRepo.getSession(db, 'session-1');
    expect(session?.program_day_id).toBe('day-1');
  });
});
