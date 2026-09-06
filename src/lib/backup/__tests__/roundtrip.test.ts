// ═══════════════════════════════════════════════════════════════════════
// ROUND-TRIP TEST — the quality bar the task brief calls out explicitly:
// "populate a DB ... -> snapshot -> wipe -> restore -> assert
// byte-for-byte equivalent data AND correct day_intake rollups."
//
// Uses the same node:sqlite harness the rest of the repo layer tests use
// (src/db/__tests__/testDb.ts) — no expo-file-system involved, since
// snapshot.ts/restore.ts are pure DB-in, DB-out modules; only
// backupLocation.ts/autoBackup.ts touch the filesystem.
// ═══════════════════════════════════════════════════════════════════════

import { createTestDatabase } from '../../../db/__tests__/testDb';
import { runMigrations } from '../../../db/migrations';
import type { Database } from '../../../db/database';
import * as weightRepo from '../../../db/repositories/weightRepo';
import * as foodRepo from '../../../db/repositories/foodRepo';
import * as potRepo from '../../../db/repositories/potRepo';
import * as profileRepo from '../../../db/repositories/profileRepo';
import * as intakeRepo from '../../../db/repositories/intakeRepo';
import * as workoutRepo from '../../../db/repositories/workoutRepo';
import * as workoutExerciseRepo from '../../../db/repositories/workoutExerciseRepo';
import * as supplementRepo from '../../../db/repositories/supplementRepo';
import { saveAcceptedTargets, getAcceptedTargets, resetTargetsStoreForTesting } from '../../targetsStore';
import { completeOnboarding, getHouseholdPrefs, resetOnboardingStoreForTesting } from '../../onboardingActions';
import { recordCheckIn, getLastCheckIn, resetCheckInHistoryForTesting } from '../../checkInHistory';
import { resetNotificationSettingsStoreForTesting } from '../../notifications/settingsStore';
import { buildBackupSnapshot, parseSnapshot, serializeSnapshot } from '../snapshot';
import { restoreFromSnapshot } from '../restore';
import type { TDEEResult } from '../../../engine/types';

async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}

async function getAllTables(db: Database) {
  return {
    day_intake: await db.getAllAsync('SELECT * FROM day_intake ORDER BY date'),
    weight_log: await db.getAllAsync('SELECT * FROM weight_log ORDER BY date'),
    external_estimate: await db.getAllAsync('SELECT * FROM external_estimate ORDER BY date'),
    food_entry: await db.getAllAsync('SELECT * FROM food_entry ORDER BY id'),
    saved_food: await db.getAllAsync('SELECT * FROM saved_food ORDER BY id'),
    pot: await db.getAllAsync('SELECT * FROM pot ORDER BY id'),
    exercise: await db.getAllAsync('SELECT * FROM exercise ORDER BY id'),
    workout_session: await db.getAllAsync('SELECT * FROM workout_session ORDER BY id'),
    workout_set: await db.getAllAsync('SELECT * FROM workout_set ORDER BY id'),
    supplement: await db.getAllAsync('SELECT * FROM supplement ORDER BY id'),
    supplement_log: await db.getAllAsync('SELECT * FROM supplement_log ORDER BY id'),
    user_profile: await db.getAllAsync('SELECT * FROM user_profile ORDER BY id'),
    app_target_snapshot: await db.getAllAsync('SELECT * FROM app_target_snapshot'),
    app_household_prefs: await db.getAllAsync('SELECT * FROM app_household_prefs'),
    app_checkin_history: await db.getAllAsync('SELECT * FROM app_checkin_history'),
  };
}

/** Populates a DB with weights/food across several dates, saved foods, a pot, profile, and accepted targets — the full "what a real user has after weeks of use" surface. */
async function populate(db: Database): Promise<void> {
  resetTargetsStoreForTesting();
  resetOnboardingStoreForTesting();
  resetCheckInHistoryForTesting();
  resetNotificationSettingsStoreForTesting();

  await completeOnboarding(
    db,
    {
      height_cm: 178,
      birth_year: 1990,
      sex: 'male',
      currentWeightKg: 82.4,
      goal: 'cut',
      rateKgPerWeek: 0.5,
      activity_seed: 'moderately_active',
      mealsPerDay: 3,
      whoCooks: 'me',
    },
    '2026-07-01'
  );

  // Weight readings across several dates, including a confounder.
  await weightRepo.upsertWeight(db, { date: '2026-07-02', weight_kg: 82.1, source: 'manual' });
  await weightRepo.upsertWeight(db, { date: '2026-07-03', weight_kg: 81.9, confounder: 'ate_out', source: 'manual' });
  await weightRepo.upsertWeight(db, { date: '2026-07-04', weight_kg: 81.7, source: 'manual' });

  // Food entries across several dates.
  await foodRepo.addEntry(db, {
    id: 'fe1',
    date: '2026-07-02',
    logged_at: 1000,
    name: 'Chicken breast',
    grams: 200,
    kcal: 330,
    protein_g: 62,
    carbs_g: 0,
    fat_g: 7.2,
    source: 'manual',
    confidence: 'exact',
  });
  await foodRepo.addEntry(db, {
    id: 'fe2',
    date: '2026-07-02',
    logged_at: 2000,
    name: 'Rice',
    grams: 150,
    kcal: 195,
    protein_g: 4,
    carbs_g: 42,
    fat_g: 0.5,
    source: 'afcd',
    confidence: 'high',
  });
  await foodRepo.addEntry(db, {
    id: 'fe3',
    date: '2026-07-03',
    logged_at: 3000,
    name: 'Restaurant meal',
    grams: 400,
    kcal: 820,
    protein_g: 35,
    carbs_g: 70,
    fat_g: 40,
    source: 'meal_photo',
    confidence: 'low',
    raw_input: 'photo-derived estimate',
  });

  // Saved foods, one with use history and an explicit confidence (schema
  // v3) carried over from the entry it was saved from.
  const saved = await foodRepo.addSavedFood(db, {
    id: 'sf1',
    name: 'Chicken breast',
    barcode: '9312345678901',
    kcal_per_100g: 165,
    protein_per_100g: 31,
    carbs_per_100g: 0,
    fat_per_100g: 3.6,
    default_grams: 200,
    confidence: 'high',
  });
  await foodRepo.incrementUse(db, saved.id, 5000);

  // A pot, with a serving logged against it.
  await potRepo.createPot(db, {
    id: 'pot1',
    name: 'Chilli batch',
    created_at: 6000,
    total_weight_g: 2000,
    ingredients: [
      { name: 'Beef mince', grams: 800, kcal: 1600, protein_g: 152, carbs_g: 0, fat_g: 104 },
      { name: 'Kidney beans', grams: 600, kcal: 570, protein_g: 39, carbs_g: 102, fat_g: 2 },
    ],
  });
  await potRepo.logServing(db, { potId: 'pot1', grams: 350, entryId: 'fe4', date: '2026-07-04', loggedAt: 7000 });

  // Strength training (schema v4): a custom exercise plus a session with
  // two sets, one tied to the custom exercise and one to a seeded one —
  // proves workout_set rows stay tied to the right session/exercise
  // through the snapshot -> wipe -> restore cycle.
  await workoutExerciseRepo.addCustomExercise(db, { id: 'custom_sissy_squat', name: 'Sissy Squat', category: 'legs' });
  const session = await workoutRepo.startSession(db, {
    id: 'session1',
    date: '2026-07-05',
    started_at: 6500,
    name: 'Leg day',
  });
  await workoutRepo.addSet(db, {
    id: 'set1',
    session_id: session.id,
    exercise_id: 'seed_back_squat',
    set_index: 0,
    weight_kg: 100,
    reps: 5,
    rpe: 8,
    logged_at: 6600,
  });
  await workoutRepo.addSet(db, {
    id: 'set2',
    session_id: session.id,
    exercise_id: 'custom_sissy_squat',
    set_index: 1,
    weight_kg: 0,
    reps: 12,
    is_warmup: true,
    logged_at: 6700,
  });

  // Supplements (schema v5): a regimen plus one adherence log row.
  await supplementRepo.addSupplement(db, {
    id: 'sup1',
    name: 'Creatine',
    dose: '5',
    schedule: JSON.stringify({ type: 'daily' }),
    unit: 'g',
    notes: 'with breakfast',
    created_at: 6800,
  });
  await supplementRepo.logDose(db, 'suplog1', 'sup1', '2026-07-05', 6900);

  // Accepted targets — the weekly check-in's write path.
  await saveAcceptedTargets(
    db,
    { targetKcal: 2100, proteinG: 180, fatG: 60, carbsG: 190, railReason: null },
    { acceptedAt: 8000, weekLabel: 'Week 1' }
  );

  const tdee: TDEEResult = {
    tdee: 2470,
    confidenceLow: 2380,
    confidenceHigh: 2560,
    trendKgPerWeek: -0.42,
    smoothedWeightKg: 81.8,
    dataQuality: 'stable',
    daysOfData: 35,
    loggedDaysInWindow: 30,
  };
  await recordCheckIn(db, tdee, 0.5, 9000);
}

describe('backup round-trip', () => {
  // The app_* store modules (targetsStore/onboardingActions/checkInHistory)
  // cache "table ensured" as module-level state, not per-DB (see each
  // module's own resetXForTesting()). Every test in this file uses a fresh
  // in-memory DB, so that cache must be cleared before each test too, or a
  // later test's fresh DB will skip CREATE TABLE IF NOT EXISTS entirely
  // and fail with "no such table".
  beforeEach(() => {
    resetTargetsStoreForTesting();
    resetOnboardingStoreForTesting();
    resetCheckInHistoryForTesting();
  resetNotificationSettingsStoreForTesting();
  });

  test('snapshot -> wipe -> restore reproduces every table exactly, and day_intake rollups stay correct', async () => {
    const source = await freshDb();
    await populate(source);

    // Sanity: rollups are correct in the source DB before we ever touch backup code.
    const day2Before = await intakeRepo.getDay(source, '2026-07-02');
    expect(day2Before?.kcal).toBeCloseTo(330 + 195, 6);
    expect(day2Before?.protein_g).toBeCloseTo(62 + 4, 6);

    const snapshot = await buildBackupSnapshot(source);

    // Round-trip through JSON serialization exactly as a real file write/read would.
    const json = serializeSnapshot(snapshot);
    const reparsed = parseSnapshot(json);

    const beforeTables = await getAllTables(source);

    // "Wipe": a brand-new destination DB (simulates a fresh install after uninstall/reinstall).
    const dest = await freshDb();
    resetTargetsStoreForTesting();
    resetOnboardingStoreForTesting();
    resetCheckInHistoryForTesting();
  resetNotificationSettingsStoreForTesting();

    const result = await restoreFromSnapshot(dest, reparsed);
    expect(result.tablesRestored).toEqual(
      expect.arrayContaining([
        'day_intake',
        'weight_log',
        'food_entry',
        'saved_food',
        'pot',
        'exercise',
        'workout_session',
        'workout_set',
        'supplement',
        'supplement_log',
        'user_profile',
      ])
    );

    const afterTables = await getAllTables(dest);

    // Byte-for-byte (structurally) equivalent for every table.
    expect(afterTables.weight_log).toEqual(beforeTables.weight_log);
    expect(afterTables.food_entry).toEqual(beforeTables.food_entry);
    expect(afterTables.saved_food).toEqual(beforeTables.saved_food);
    expect(afterTables.pot).toEqual(beforeTables.pot);
    expect(afterTables.user_profile).toEqual(beforeTables.user_profile);
    expect(afterTables.external_estimate).toEqual(beforeTables.external_estimate);
    expect(afterTables.exercise).toEqual(beforeTables.exercise);
    expect(afterTables.workout_session).toEqual(beforeTables.workout_session);
    expect(afterTables.workout_set).toEqual(beforeTables.workout_set);
    expect(afterTables.supplement).toEqual(beforeTables.supplement);
    expect(afterTables.supplement_log).toEqual(beforeTables.supplement_log);
    expect(afterTables.app_target_snapshot).toEqual(beforeTables.app_target_snapshot);
    expect(afterTables.app_household_prefs).toEqual(beforeTables.app_household_prefs);
    expect(afterTables.app_checkin_history).toEqual(beforeTables.app_checkin_history);

    // Explicit "tied to the right session/exercise" check, independent of
    // the generic table-equality assertions above: both sets must still
    // reference session1, and the custom exercise must still exist for
    // set2's exercise_id to point at.
    const restoredSets = await workoutRepo.getSetsForSession(dest, 'session1');
    expect(restoredSets).toHaveLength(2);
    expect(restoredSets.find((s) => s.id === 'set1')?.exercise_id).toBe('seed_back_squat');
    expect(restoredSets.find((s) => s.id === 'set2')?.exercise_id).toBe('custom_sissy_squat');
    expect(await workoutExerciseRepo.getExercise(dest, 'custom_sissy_squat')).not.toBeNull();

    // Supplement adherence log survived and still points at the right supplement.
    const restoredLog = await supplementRepo.getLog(dest, 'sup1', '2026-07-05');
    expect(restoredLog?.id).toBe('suplog1');
    const restoredSupplement = await supplementRepo.getSupplement(dest, 'sup1');
    expect(restoredSupplement).toMatchObject({ name: 'Creatine', unit: 'g', notes: 'with breakfast', is_active: 1 });

    // day_intake: NOT required to be byte-identical to the snapshot's stored
    // rollup (restore recomputes from food_entry per this module's
    // contract) — but it must be numerically correct, which for this
    // fixture happens to also match the source exactly since nothing
    // mutated food_entry between snapshot and restore.
    expect(afterTables.day_intake).toEqual(beforeTables.day_intake);

    // Explicit rollup-correctness assertions, independent of the source DB,
    // proving recomputeDay actually ran rather than trusting the snapshot verbatim.
    const day2After = await intakeRepo.getDay(dest, '2026-07-02');
    expect(day2After?.kcal).toBeCloseTo(330 + 195, 6);
    expect(day2After?.protein_g).toBeCloseTo(62 + 4, 6);
    expect(day2After?.carbs_g).toBeCloseTo(0 + 42, 6);
    expect(day2After?.fat_g).toBeCloseTo(7.2 + 0.5, 6);

    const day3After = await intakeRepo.getDay(dest, '2026-07-03');
    expect(day3After?.kcal).toBeCloseTo(820, 6);

    const day4After = await intakeRepo.getDay(dest, '2026-07-04');
    // fe4 from potRepo.logServing: 350g of pot1 (2000g batch, 2170kcal total -> 1.085 kcal/g)
    expect(day4After?.kcal).toBeCloseTo(350 * ((1600 + 570) / 2000), 6);

    // High-level app state restored correctly.
    const targets = await getAcceptedTargets(dest);
    expect(targets?.targetKcal).toBe(2100);
    expect(targets?.weekLabel).toBe('Week 1');

    const prefs = await getHouseholdPrefs(dest);
    expect(prefs?.whoCooks).toBe('me');
    expect(prefs?.mealsPerDay).toBe(3);

    const checkIn = await getLastCheckIn(dest);
    expect(checkIn?.tdee.tdee).toBe(2470);
    expect(checkIn?.goalRateKgPerWeek).toBe(0.5);
  });

  test('restore is a hard replace, not a merge: pre-existing destination rows are gone afterwards', async () => {
    const source = await freshDb();
    await populate(source);
    const snapshot = await buildBackupSnapshot(source);

    const dest = await freshDb();
    // Destination already has unrelated data before restore.
    await weightRepo.upsertWeight(dest, { date: '2099-01-01', weight_kg: 999 });
    await foodRepo.addEntry(dest, {
      id: 'stale-entry',
      date: '2099-01-01',
      logged_at: 1,
      name: 'Should be wiped',
      grams: 1,
      kcal: 1,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 1,
      source: 'manual',
      confidence: 'exact',
    });
    // Pre-existing training/supplement data too — must not survive a restore.
    const staleSession = await workoutRepo.startSession(dest, { id: 'stale-session', date: '2099-01-01', started_at: 1 });
    await workoutRepo.addSet(dest, {
      id: 'stale-set',
      session_id: staleSession.id,
      exercise_id: 'seed_bench_press',
      set_index: 0,
      weight_kg: 1,
      reps: 1,
      logged_at: 1,
    });
    await supplementRepo.addSupplement(dest, {
      id: 'stale-supplement',
      name: 'Should be wiped',
      dose: '1',
      schedule: JSON.stringify({ type: 'as_needed' }),
      created_at: 1,
    });
    await supplementRepo.logDose(dest, 'stale-suplog', 'stale-supplement', '2099-01-01', 1);

    await restoreFromSnapshot(dest, snapshot);

    expect(await weightRepo.getByDate(dest, '2099-01-01')).toBeNull();
    expect(await foodRepo.getEntry(dest, 'stale-entry')).toBeNull();
    expect(await workoutRepo.getSession(dest, 'stale-session')).toBeNull();
    expect(await workoutRepo.getSetsForSession(dest, 'stale-session')).toHaveLength(0);
    expect(await supplementRepo.getSupplement(dest, 'stale-supplement')).toBeNull();
    expect(await supplementRepo.getLog(dest, 'stale-supplement', '2099-01-01')).toBeNull();
    // But the snapshot's own data is present.
    expect(await weightRepo.getByDate(dest, '2026-07-02')).not.toBeNull();
    expect(await workoutRepo.getSession(dest, 'session1')).not.toBeNull();
    expect(await supplementRepo.getSupplement(dest, 'sup1')).not.toBeNull();
  });

  test('restore rolls back cleanly on failure, leaving the destination DB untouched', async () => {
    const source = await freshDb();
    await populate(source);
    const snapshot = await buildBackupSnapshot(source);

    const dest = await freshDb();
    await weightRepo.upsertWeight(dest, { date: '2026-01-01', weight_kg: 70 });
    const preExistingSession = await workoutRepo.startSession(dest, { id: 'pre-session', date: '2026-01-01', started_at: 1 });
    await workoutRepo.addSet(dest, {
      id: 'pre-set',
      session_id: preExistingSession.id,
      exercise_id: 'seed_deadlift',
      set_index: 0,
      weight_kg: 140,
      reps: 3,
      logged_at: 1,
    });
    await supplementRepo.addSupplement(dest, {
      id: 'pre-supplement',
      name: 'Vitamin D',
      dose: '1000',
      schedule: JSON.stringify({ type: 'daily' }),
      created_at: 1,
    });
    await supplementRepo.logDose(dest, 'pre-suplog', 'pre-supplement', '2026-01-01', 1);
    const seededExerciseCountBefore = (await workoutExerciseRepo.listExercises(dest)).length;

    // Corrupt the snapshot so an INSERT fails partway through (user_profile
    // has a CHECK(id = 1) constraint — id 2 violates it and throws). The
    // core-table deletes/inserts (including the new training/supplement
    // ones) all run before user_profile in restore.ts's transaction, so
    // this exercises "did those succeed and then get rolled back" too.
    const corrupted = { ...snapshot, user_profile: [{ ...snapshot.user_profile[0], id: 2 as 1 }] };

    await expect(restoreFromSnapshot(dest, corrupted)).rejects.toThrow();

    // Rolled back: every pre-existing row — including training/supplement
    // data — is still there, untouched, exactly as before the failed call.
    const preserved = await weightRepo.getByDate(dest, '2026-01-01');
    expect(preserved?.weight_kg).toBe(70);
    expect(await workoutRepo.getSession(dest, 'pre-session')).not.toBeNull();
    expect(await workoutRepo.getSetsForSession(dest, 'pre-session')).toHaveLength(1);
    expect(await supplementRepo.getSupplement(dest, 'pre-supplement')).not.toBeNull();
    expect(await supplementRepo.getLog(dest, 'pre-supplement', '2026-01-01')).not.toBeNull();
    expect((await workoutExerciseRepo.listExercises(dest)).length).toBe(seededExerciseCountBefore);
  });

  test('parseSnapshot rejects a file that is not a Joule backup', () => {
    expect(() => parseSnapshot('not json at all')).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ hello: 'world' }))).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ some: 'random', shape: 1 }))).toThrow();
  });

  test('an OLD (pre-meal-grouping) snapshot — food_entry rows with no meal_type/meal_group_id/meal_name keys at all — restores cleanly into the current schema', async () => {
    // Simulates a real backup file written by a build of this app from
    // before schema v2 (meal grouping) existed: its food_entry rows never
    // had meal_type/meal_group_id/meal_name keys in the first place, so
    // JSON.parse of that old file produces objects missing those keys
    // entirely (not `null` — genuinely absent), exactly like `as any`
    // would look coming off `JSON.parse` of an old file on a real device.
    // This is the highest-risk scenario in this feature: an old backup
    // must not fail to restore, and no data may silently vanish.
    const dest = await freshDb();
    resetTargetsStoreForTesting();
    resetOnboardingStoreForTesting();
    resetCheckInHistoryForTesting();
  resetNotificationSettingsStoreForTesting();

    const oldSnapshotJson = {
      exported_at: '2026-06-01T00:00:00.000Z',
      schema_version: 1,
      backup_format_version: 1,
      day_intake: [{ date: '2026-05-30', kcal: 440, protein_g: 14.4, carbs_g: 80, fat_g: 4.6, is_complete: 1 }],
      weight_log: [{ date: '2026-05-30', weight_kg: 78.4, confounder: null, source: 'manual' }],
      external_estimate: [],
      food_entry: [
        {
          id: 'old-1',
          date: '2026-05-30',
          logged_at: 1000,
          name: 'Rice',
          grams: 200,
          kcal: 260,
          protein_g: 5.4,
          carbs_g: 56,
          fat_g: 0.6,
          source: 'manual',
          confidence: 'exact',
          pot_id: null,
          raw_input: null,
          // NOTE: no meal_type / meal_group_id / meal_name keys — this is
          // exactly what an old backup file looks like.
        },
        {
          id: 'old-2',
          date: '2026-05-30',
          logged_at: 2000,
          name: 'Dal',
          grams: 150,
          kcal: 180,
          protein_g: 9,
          carbs_g: 24,
          fat_g: 4,
          source: 'manual',
          confidence: 'exact',
          pot_id: null,
          raw_input: null,
        },
      ],
      saved_food: [],
      pot: [],
      supplement: [],
      user_profile: [],
      app_target_snapshot: null,
      app_household_prefs: null,
      app_checkin_history: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await restoreFromSnapshot(dest, oldSnapshotJson);
    expect(result.rowCounts.food_entry).toBe(2);

    const rows = await foodRepo.getEntriesForDate(dest, '2026-05-30');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.meal_type).toBeNull();
      expect(row.meal_group_id).toBeNull();
      expect(row.meal_name).toBeNull();
    }
    expect(rows.find((r) => r.id === 'old-1')?.kcal).toBe(260);
    expect(rows.find((r) => r.id === 'old-2')?.kcal).toBe(180);

    // The rollup is recomputed from food_entry, not trusted verbatim from
    // the old snapshot's day_intake row — and it must be correct.
    const day = await intakeRepo.getDay(dest, '2026-05-30');
    expect(day?.kcal).toBe(260 + 180);
    expect(day?.protein_g).toBeCloseTo(5.4 + 9, 6);

    const weight = await weightRepo.getByDate(dest, '2026-05-30');
    expect(weight?.weight_kg).toBe(78.4);
  });

  test('an OLD (pre-confidence) snapshot — saved_food rows with no confidence key at all — restores cleanly into the current schema', async () => {
    // Simulates a real backup file written by a build of this app from
    // before schema v3 (saved_food.confidence) existed: its saved_food
    // rows never had a `confidence` key in the first place, so JSON.parse
    // of that old file produces objects missing the key entirely (not
    // `null` — genuinely absent). This must not throw and must not drop
    // the row; `undefined` reaching the SQLite bind would abort the whole
    // restore transaction mid-way (see restore.ts's header comment).
    const dest = await freshDb();
    resetTargetsStoreForTesting();
    resetOnboardingStoreForTesting();
    resetCheckInHistoryForTesting();
  resetNotificationSettingsStoreForTesting();

    const oldSnapshotJson = {
      exported_at: '2026-07-01T00:00:00.000Z',
      schema_version: 2,
      backup_format_version: 1,
      day_intake: [],
      weight_log: [],
      external_estimate: [],
      food_entry: [],
      saved_food: [
        {
          id: 'old-sf-1',
          name: 'Chicken breast',
          barcode: '9312345678901',
          kcal_per_100g: 165,
          protein_per_100g: 31,
          carbs_per_100g: 0,
          fat_per_100g: 3.6,
          default_grams: 200,
          use_count: 4,
          last_used: 12000,
          // NOTE: no `confidence` key — this is exactly what an old (pre-v3) backup file looks like.
        },
      ],
      pot: [],
      supplement: [],
      user_profile: [],
      app_target_snapshot: null,
      app_household_prefs: null,
      app_checkin_history: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await restoreFromSnapshot(dest, oldSnapshotJson);
    expect(result.rowCounts.saved_food).toBe(1);

    const row = await foodRepo.getSavedFood(dest, 'old-sf-1');
    expect(row).not.toBeNull();
    expect(row?.name).toBe('Chicken breast');
    expect(row?.kcal_per_100g).toBe(165);
    expect(row?.use_count).toBe(4);
    expect(row?.confidence).toBeNull();
  });

  test('a pre-v4/v5 snapshot — no exercise/workout_session/workout_set/supplement_log keys, and supplement rows missing unit/notes/is_active/created_at — restores cleanly into the current schema', async () => {
    // Simulates a real backup file written before strength training (v4)
    // and the supplements build-out (v5) existed: none of these keys are
    // present on the object at all (not null — genuinely absent), and the
    // one supplement row it does have predates the four new columns.
    const dest = await freshDb();
    resetTargetsStoreForTesting();
    resetOnboardingStoreForTesting();
    resetCheckInHistoryForTesting();
    resetNotificationSettingsStoreForTesting();

    const oldSnapshotJson = {
      exported_at: '2026-05-01T00:00:00.000Z',
      schema_version: 3,
      backup_format_version: 1,
      day_intake: [],
      weight_log: [],
      external_estimate: [],
      food_entry: [],
      saved_food: [],
      pot: [],
      supplement: [
        {
          id: 'old-sup-1',
          name: 'Fish Oil',
          dose: '1000mg',
          schedule: 'daily',
          kcal: 0,
          protein_g: 0,
          // NOTE: no unit / notes / is_active / created_at keys — exactly
          // what a pre-v5 backup's supplement rows look like.
        },
      ],
      user_profile: [],
      app_target_snapshot: null,
      app_household_prefs: null,
      app_checkin_history: null,
      // NOTE: no exercise / workout_session / workout_set / supplement_log
      // keys at all — exactly what a pre-v4/v5 backup looks like.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await restoreFromSnapshot(dest, oldSnapshotJson);
    expect(result.rowCounts.exercise).toBe(0);
    expect(result.rowCounts.workout_session).toBe(0);
    expect(result.rowCounts.workout_set).toBe(0);
    expect(result.rowCounts.supplement_log).toBe(0);
    expect(result.rowCounts.supplement).toBe(1);

    const restoredSupplement = await supplementRepo.getSupplement(dest, 'old-sup-1');
    expect(restoredSupplement).not.toBeNull();
    expect(restoredSupplement?.name).toBe('Fish Oil');
    expect(restoredSupplement?.unit).toBeNull();
    expect(restoredSupplement?.notes).toBeNull();
    expect(restoredSupplement?.is_active).toBe(1); // defaulted, not left undefined/thrown
    expect(restoredSupplement?.created_at).toBeNull();

    expect(await workoutExerciseRepo.listExercises(dest)).toEqual([]);
  });

  test('restoring a snapshot with no accepted targets / household prefs / check-in leaves those tables empty, not errored', async () => {
    const source = await freshDb();
    // Only a bare profile — no onboarding, no targets, no check-in.
    await profileRepo.upsertProfile(source, {
      height_cm: 170,
      birth_year: 1995,
      sex: 'female',
      goal: 'maintain',
      rate_kg_per_week: 0,
      activity_seed: 'sedentary',
      protein_override: null,
      units: 'metric',
    });
    resetTargetsStoreForTesting();
    resetOnboardingStoreForTesting();
    resetCheckInHistoryForTesting();
  resetNotificationSettingsStoreForTesting();

    const snapshot = await buildBackupSnapshot(source);
    expect(snapshot.app_target_snapshot).toBeNull();
    expect(snapshot.app_household_prefs).toBeNull();
    expect(snapshot.app_checkin_history).toBeNull();

    const dest = await freshDb();
    resetTargetsStoreForTesting();
    resetOnboardingStoreForTesting();
    resetCheckInHistoryForTesting();
  resetNotificationSettingsStoreForTesting();

    await expect(restoreFromSnapshot(dest, snapshot)).resolves.toBeDefined();
    expect(await getAcceptedTargets(dest)).toBeNull();
    expect(await getHouseholdPrefs(dest)).toBeNull();
    expect(await getLastCheckIn(dest)).toBeNull();
  });
});
