// ═══════════════════════════════════════════════════════════════════════
// BACKUP/RESTORE COMPATIBILITY — strength training vs. src/lib/backup/**.
//
// UPDATED: restore.ts/export.ts/snapshot.ts now know about
// exercise/workout_session/workout_set (the gap this file originally
// documented has been closed — see restore.ts's header and its own report
// for the exact change). That flips this file's expectations:
//
//  1. A snapshot with NO knowledge of the training tables (a real backup
//     taken before this feature existed — its JSON simply has no
//     workout_session/workout_set/exercise keys) still restores cleanly
//     into a v4+ database with no thrown error. This is the "old backups
//     must still restore" requirement, satisfied via the same
//     `snapshot.workout_session ?? []`-style defaulting restore.ts already
//     used for `external_estimate`.
//  2. restore.ts is a hard replace-all, the same contract every other
//     table in this chain already has (food_entry, saved_food, pot, ...):
//     it now DOES delete existing exercise/workout_session/workout_set
//     rows unconditionally before restoring, same as it always has for
//     every other table. An old-format snapshot has nothing to restore
//     those three tables FROM, so a restore from one wipes local training
//     data (including the seeded exercise library) rather than leaving it
//     untouched — a real, deliberate trade-off of "replace-all, no merge"
//     semantics, not a bug. In practice this only bites a hypothetical
//     backup taken before schema v4 existed; every backup taken from here
//     forward carries its own copy of the training tables.
// ═══════════════════════════════════════════════════════════════════════

import { runMigrations } from '../migrations';
import { createTestDatabase } from './testDb';
import * as workoutRepo from '../repositories/workoutRepo';
import * as workoutExerciseRepo from '../repositories/workoutExerciseRepo';
import * as programRepo from '../repositories/programRepo';
import { restoreFromSnapshot } from '../../lib/backup/restore';
import type { BackupSnapshot } from '../../lib/backup/snapshot';

/**
 * A minimal "old" snapshot: exactly the shape a pre-v4 (indeed
 * pre-training-feature) build of this app would have produced. None of
 * the workout_session, workout_set, exercise, or supplement_log keys
 * exist on this object at all — that's the point, and exactly why it
 * needs a cast rather than a plain `BackupSnapshot` return type: those
 * fields are non-optional on `FullExport` now that export.ts fetches
 * them, but a REAL old backup file's JSON genuinely lacks the keys
 * (JSON.parse never invents them), so restore.ts must tolerate
 * `undefined` here, not just `null`.
 */
function oldFormatSnapshot(overrides: Partial<BackupSnapshot> = {}): BackupSnapshot {
  return {
    exported_at: '2026-01-01T00:00:00.000Z',
    schema_version: 1,
    backup_format_version: 1,
    day_intake: [{ date: '2026-01-01', kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, is_complete: 1 }],
    weight_log: [{ date: '2026-01-01', weight_kg: 80, confounder: null, source: 'manual' }],
    external_estimate: [],
    food_entry: [
      {
        id: 'old-fe-1',
        date: '2026-01-01',
        logged_at: 1000,
        name: 'Oats',
        grams: 100,
        kcal: 380,
        protein_g: 13,
        carbs_g: 68,
        fat_g: 7,
        source: 'manual',
        confidence: 'exact',
        pot_id: null,
        raw_input: null,
        meal_type: null,
        meal_group_id: null,
        meal_name: null,
      },
    ],
    saved_food: [],
    pot: [],
    supplement: [],
    user_profile: [
      {
        id: 1,
        height_cm: 178,
        birth_year: 1990,
        sex: 'male',
        goal: 'maintain',
        rate_kg_per_week: 0,
        activity_seed: 'moderately_active',
        protein_override: null,
        units: 'metric',
      },
    ],
    app_target_snapshot: null,
    app_household_prefs: null,
    app_checkin_history: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as BackupSnapshot;
}

describe('restoring an old (pre-training) backup into a v4 database', () => {
  it('restores every core table successfully with no error', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const result = await restoreFromSnapshot(db, oldFormatSnapshot());

    expect(result.rowCounts.food_entry).toBe(1);
    expect(result.rowCounts.weight_log).toBe(1);
    expect(result.rowCounts.user_profile).toBe(1);
  });

  it('wipes the seeded exercise library — an old-format snapshot has no exercise data to restore it from', async () => {
    const db = createTestDatabase();
    await runMigrations(db);
    const seededCountBefore = (await workoutExerciseRepo.listExercises(db)).length;
    expect(seededCountBefore).toBeGreaterThan(0);

    await restoreFromSnapshot(db, oldFormatSnapshot());

    // Hard replace-all: exercise is deleted unconditionally (same as every
    // other table in the chain) and there is nothing in an old-format
    // snapshot to re-insert it from.
    const seededCountAfter = (await workoutExerciseRepo.listExercises(db)).length;
    expect(seededCountAfter).toBe(0);
  });

  it('wipes the seeded generic starter program too — same hard replace-all contract, schema v7', async () => {
    const db = createTestDatabase();
    await runMigrations(db);
    const seededProgramsBefore = await programRepo.listPrograms(db);
    expect(seededProgramsBefore.length).toBeGreaterThan(0);

    await restoreFromSnapshot(db, oldFormatSnapshot());

    expect(await programRepo.listPrograms(db)).toHaveLength(0);
  });

  it('wipes pre-existing local training data on a restore — hard replace, same contract as every other table', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    // Real training data already on this device, logged before the restore.
    const session = await workoutRepo.startSession(db, { id: 'local-session', date: '2026-08-01', started_at: 1000, name: 'Leg day' });
    await workoutRepo.addSet(db, {
      id: 'local-set',
      session_id: session.id,
      exercise_id: 'seed_back_squat',
      set_index: 0,
      weight_kg: 120,
      reps: 5,
      logged_at: 1000,
    });
    await workoutExerciseRepo.addCustomExercise(db, { id: 'local-custom', name: 'Sissy Squat' });

    await restoreFromSnapshot(db, oldFormatSnapshot());

    // Gone: restore.ts's DELETE FROM list now includes these tables, and
    // an old-format snapshot has nothing to restore them from.
    expect(await workoutRepo.getSession(db, 'local-session')).toBeNull();
    expect(await workoutRepo.getSetsForSession(db, 'local-session')).toHaveLength(0);
    expect(await workoutExerciseRepo.getExercise(db, 'local-custom')).toBeNull();
  });

  it('restoring twice in a row (repeat restore) is still safe and idempotent for the core tables', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await restoreFromSnapshot(db, oldFormatSnapshot());
    const second = await restoreFromSnapshot(db, oldFormatSnapshot());

    expect(second.rowCounts.food_entry).toBe(1);
  });

  it('day_intake rollup after restore matches the restored food_entry, not the snapshot\'s stored rollup verbatim', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    // A deliberately WRONG stored day_intake row (simulating a snapshot
    // taken mid-edit) paired with a correct food_entry — restore.ts
    // recomputes from food_entry rather than trusting this number.
    const snapshot = oldFormatSnapshot({
      day_intake: [{ date: '2026-01-01', kcal: 999999, protein_g: 0, carbs_g: 0, fat_g: 0, is_complete: 1 }],
    });

    await restoreFromSnapshot(db, snapshot);

    const day = await db.getFirstAsync<{ kcal: number }>('SELECT kcal FROM day_intake WHERE date = ?', ['2026-01-01']);
    expect(day?.kcal).toBe(380); // the single restored food_entry's kcal, not 999999
  });
});
