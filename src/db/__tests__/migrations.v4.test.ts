// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V4 MIGRATION — strength training tables (exercise, workout_session,
// workout_set). Mirrors migrations.v2/v3.test.ts's structure: this
// simulates a REAL device upgrade from v3 to v4, not just a fresh
// install — it runs only migrations 1-3 against a fresh DB, inserts data
// the way a v3 app would have, THEN runs the full migration list (exactly
// what happens when the app updates and calls runMigrations() on next
// launch) and asserts nothing was lost, changed, or corrupted — including
// the day_intake rollup, which must be completely untouched by a
// migration that adds three unrelated tables.
// ═══════════════════════════════════════════════════════════════════════

import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../migrations';
import { createTestDatabase } from './testDb';
import * as foodRepo from '../repositories/foodRepo';
import * as intakeRepo from '../repositories/intakeRepo';
import * as workoutRepo from '../repositories/workoutRepo';
import * as workoutExerciseRepo from '../repositories/workoutExerciseRepo';

const V1_THROUGH_V3 = MIGRATIONS.filter((m) => m.version <= 3);
// Pinned to versions 1-4 (not the full/latest MIGRATIONS list) so this
// test keeps verifying exactly what schema v4 itself adds, independent of
// whatever later versions other concurrent work appends to the list.
const V1_THROUGH_V4 = MIGRATIONS.filter((m) => m.version <= 4);

describe('schema v4 migration — strength training, additive and non-destructive', () => {
  it('creates exercise, workout_session, workout_set alongside the existing eight tables (eleven total)', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_THROUGH_V4);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((t) => t.name).sort()).toEqual(
      [
        'day_intake',
        'external_estimate',
        'exercise',
        'food_entry',
        'pot',
        'saved_food',
        'supplement',
        'user_profile',
        'weight_log',
        'workout_session',
        'workout_set',
      ].sort()
    );
  });

  it('seeds a starter exercise library, marked is_custom = 0', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_THROUGH_V4);
    const exercises = await workoutExerciseRepo.listExercises(db);
    expect(exercises.length).toBeGreaterThanOrEqual(15);
    expect(exercises.every((e) => e.is_custom === 0)).toBe(true);
    const names = exercises.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['Back Squat', 'Bench Press', 'Deadlift', 'Overhead Press']));
  });

  it('a v3 database with real food/weight data upgrades to v4 with every row intact and day_intake untouched', async () => {
    const db = createTestDatabase();

    // Simulate a device that has only ever run migrations 1-3 (pre-training).
    await runMigrations(db, V1_THROUGH_V3);
    let version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(3);

    await db.runAsync(
      `INSERT INTO food_entry (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input, meal_type, meal_group_id, meal_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['fe-pre-v4', '2026-08-20', 1000, 'Chicken breast', 200, 330, 62, 0, 7.2, 'manual', 'exact', null, null, null, null, null]
    );
    await intakeRepo.recomputeDay(db, '2026-08-20');
    const dayBefore = await intakeRepo.getDay(db, '2026-08-20');

    await db.runAsync('INSERT INTO weight_log (date, weight_kg, confounder, source) VALUES (?, ?, ?, ?)', [
      '2026-08-20',
      82.4,
      null,
      'manual',
    ]);

    // The upgrade: app updates, calls runMigrations() with the FULL list on next launch.
    await runMigrations(db, MIGRATIONS);
    version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);

    // Pre-existing food_entry/day_intake/weight_log rows are completely unaffected.
    const entry = await foodRepo.getEntry(db, 'fe-pre-v4');
    expect(entry?.name).toBe('Chicken breast');
    expect(entry?.kcal).toBe(330);

    const dayAfter = await intakeRepo.getDay(db, '2026-08-20');
    expect(dayAfter).toEqual(dayBefore);

    const weightRow = await db.getFirstAsync<{ weight_kg: number }>('SELECT weight_kg FROM weight_log WHERE date = ?', [
      '2026-08-20',
    ]);
    expect(weightRow?.weight_kg).toBe(82.4);

    // And the new tables exist, seeded, ready to use.
    const exercises = await workoutExerciseRepo.listExercises(db);
    expect(exercises.length).toBeGreaterThan(0);
  });

  it('running the v4 migration twice (idempotent re-run) does not error and does not duplicate seed rows', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_THROUGH_V3);
    await runMigrations(db, MIGRATIONS);
    const countAfterFirst = (await workoutExerciseRepo.listExercises(db)).length;

    // Second call: version is already latest, so the v4 SQL must NOT run
    // again — re-running CREATE TABLE/INSERT against a real SQLite engine
    // a second time would otherwise duplicate seed rows or error.
    await expect(runMigrations(db, MIGRATIONS)).resolves.toBeUndefined();

    const countAfterSecond = (await workoutExerciseRepo.listExercises(db)).length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('a fresh v4 install can start a session, add a custom exercise, and log a set end-to-end', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const exercise = await workoutExerciseRepo.addCustomExercise(db, {
      id: 'custom-1',
      name: 'Trap Bar Deadlift',
      category: 'back',
      equipment: 'barbell',
    });
    expect(exercise.is_custom).toBe(1);

    const session = await workoutRepo.startSession(db, {
      id: 'session-1',
      date: '2026-09-05',
      started_at: 1000,
      name: 'Pull day',
    });

    const set = await workoutRepo.addSet(db, {
      id: 'set-1',
      session_id: session.id,
      exercise_id: exercise.id,
      set_index: 0,
      weight_kg: 140,
      reps: 5,
      logged_at: 2000,
    });
    expect(set.weight_kg).toBe(140);

    const sets = await workoutRepo.getSetsForSession(db, session.id);
    expect(sets).toHaveLength(1);
  });

  it('deleting a session cascades to delete its sets (ON DELETE CASCADE)', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const session = await workoutRepo.startSession(db, { id: 'session-del', date: '2026-09-05', started_at: 1000 });
    await workoutRepo.addSet(db, {
      id: 'set-del',
      session_id: session.id,
      exercise_id: 'seed_back_squat',
      set_index: 0,
      weight_kg: 100,
      reps: 5,
      logged_at: 1000,
    });

    await workoutRepo.deleteSession(db, session.id);

    const remainingSets = await workoutRepo.getSetsForSession(db, session.id);
    expect(remainingSets).toHaveLength(0);
    expect(await workoutRepo.getSession(db, session.id)).toBeNull();
  });

  it('no calorie/energy column exists on any training table (PRD §1 non-goal)', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    for (const table of ['exercise', 'workout_session', 'workout_set']) {
      const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
      const names = columns.map((c) => c.name.toLowerCase());
      expect(names.some((n) => n.includes('kcal') || n.includes('calorie') || n.includes('energy'))).toBe(false);
    }
  });
});
