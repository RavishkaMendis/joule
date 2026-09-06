// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V6 MIGRATION — pot_container table + food_entry.tare_g (task
// brief "Build the meal-prep (pot) workflow into a first-class, accurate
// feature": tare/container handling for the user's own "sometimes with
// the plate weight and sometimes without").
//
// Mirrors migrations.v5.test.ts's structure: simulates a real device
// upgrade from v5 to v6, not just a fresh install, and proves an OLD
// backup snapshot (pre-v6 shape: no pot_container key at all, food_entry
// rows with no tare_g key) restores cleanly through the existing
// restoreFromSnapshot without this feature's migration touching
// src/lib/backup/snapshot.ts at all.
// ═══════════════════════════════════════════════════════════════════════

import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../migrations';
import { createTestDatabase } from './testDb';
import * as potRepo from '../repositories/potRepo';
import { restoreFromSnapshot } from '../../lib/backup/restore';
import type { BackupSnapshot } from '../../lib/backup/snapshot';

const UP_TO_V5 = MIGRATIONS.filter((m) => m.version <= 5);
// Schema v7 (training programs/templates) added four more tables after
// this file was written. This test asserts the table set AT v6, not at
// LATEST_SCHEMA_VERSION, so it must stop applying migrations at v6 rather
// than picking up whatever later versions add — same reasoning as
// migrations.test.ts's V1_ONLY.
const UP_TO_V6 = MIGRATIONS.filter((m) => m.version <= 6);

describe('schema v6 migration — additive, non-destructive upgrade', () => {
  it('creates pot_container with a frequency index', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((t) => t.name)).toContain('pot_container');

    const indexes = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pot_container'"
    );
    expect(indexes.map((i) => i.name)).toContain('idx_pot_container_frequency');
  });

  it('adds food_entry.tare_g as nullable', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const columns = await db.getAllAsync<{ name: string; notnull: number }>('PRAGMA table_info(food_entry)');
    const tareG = columns.find((c) => c.name === 'tare_g');
    expect(tareG).toBeDefined();
    expect(tareG?.notnull).toBe(0);
  });

  it('does not add or drop any other table — same tables as v5 plus pot_container', async () => {
    const db = createTestDatabase();
    await runMigrations(db, UP_TO_V6);
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
        'saved_food',
        'supplement',
        'supplement_log',
        'user_profile',
        'weight_log',
        'workout_session',
        'workout_set',
      ].sort()
    );
  });

  it('a v5 database with real pre-v6 rows upgrades to v6 with data intact and tare_g NULL', async () => {
    const db = createTestDatabase();

    // Simulate a device that has only ever run migrations 1-5.
    await runMigrations(db, UP_TO_V5);
    let version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(5);

    // Real v5-shaped insert: food_entry has no tare_g column yet.
    await db.runAsync(
      `INSERT INTO food_entry (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input)
       VALUES ('pre-v6-1', '2026-08-01', 1000, 'Rice & dal', 300, 450, 30, 45, 9, 'pot', 'exact', 'pot1', NULL)`
    );

    await runMigrations(db, MIGRATIONS);
    version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);

    const row = await db.getFirstAsync<{ tare_g: number | null; name: string }>(
      'SELECT * FROM food_entry WHERE id = ?',
      ['pre-v6-1']
    );
    expect(row?.name).toBe('Rice & dal');
    expect(row?.tare_g).toBeNull();
  });

  it('running the v6 migration twice (idempotent re-run) does not error and does not duplicate columns/tables', async () => {
    const db = createTestDatabase();
    await runMigrations(db, UP_TO_V5);
    await runMigrations(db, MIGRATIONS);
    await expect(runMigrations(db, MIGRATIONS)).resolves.toBeUndefined();

    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(food_entry)');
    expect(columns.filter((c) => c.name === 'tare_g')).toHaveLength(1);
  });

  it('a pre-v6 backup snapshot (no pot_container key, no food_entry.tare_g key) restores cleanly against a v6 database', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    // Shape a snapshot exactly as a pre-v6 app version's exportFullJson
    // would have produced it: no `pot_container` key on the object at all,
    // and `food_entry` rows without a `tare_g` field. Cast through
    // `unknown` since this deliberately does NOT satisfy the current
    // (post-v6) types — that mismatch IS the scenario being tested.
    const legacySnapshot = {
      exported_at: '2026-01-01T00:00:00.000Z',
      schema_version: 5,
      backup_format_version: 1,
      day_intake: [],
      weight_log: [],
      external_estimate: [],
      food_entry: [
        {
          id: 'legacy-entry-1',
          date: '2026-01-01',
          logged_at: 1000,
          name: 'Rice & dal',
          grams: 300,
          kcal: 450,
          protein_g: 30,
          carbs_g: 45,
          fat_g: 9,
          source: 'pot',
          confidence: 'exact',
          pot_id: 'legacy-pot-1',
          raw_input: null,
        },
      ],
      saved_food: [],
      pot: [
        {
          id: 'legacy-pot-1',
          name: 'Rice & dal',
          created_at: 1000,
          total_weight_g: 1000,
          remaining_g: 700,
          kcal_per_g: 1.5,
          protein_per_g: 0.1,
          carbs_per_g: 0.15,
          fat_per_g: 0.03,
          ingredients: '[]',
          is_active: 1,
        },
      ],
      supplement: [],
      user_profile: [],
      app_target_snapshot: null,
      app_household_prefs: null,
      app_checkin_history: null,
    } as unknown as BackupSnapshot;

    await expect(restoreFromSnapshot(db, legacySnapshot)).resolves.toBeDefined();

    const entry = await db.getFirstAsync<{ tare_g: number | null }>('SELECT * FROM food_entry WHERE id = ?', [
      'legacy-entry-1',
    ]);
    expect(entry?.tare_g).toBeNull();

    const containers = await potRepo.getContainers(db);
    expect(containers).toEqual([]);

    const pots = await potRepo.getAllPots(db);
    expect(pots).toHaveLength(1);
    expect(pots[0].remaining_g).toBe(700);
  });

  it('a snapshot WITH pot_container rows and food_entry.tare_g restores them intact', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const snapshot = {
      exported_at: '2026-01-01T00:00:00.000Z',
      schema_version: LATEST_SCHEMA_VERSION,
      backup_format_version: 1,
      day_intake: [],
      weight_log: [],
      external_estimate: [],
      food_entry: [
        {
          id: 'entry-1',
          date: '2026-01-01',
          logged_at: 1000,
          name: 'Rice & dal',
          grams: 300,
          kcal: 450,
          protein_g: 30,
          carbs_g: 45,
          fat_g: 9,
          source: 'pot',
          confidence: 'high',
          pot_id: 'pot-1',
          raw_input: null,
          meal_type: null,
          meal_group_id: null,
          meal_name: null,
          tare_g: 250,
        },
      ],
      saved_food: [],
      pot: [],
      pot_container: [{ id: 'container-1', name: 'Blue bowl', tare_g: 250, use_count: 3, last_used: 9999 }],
      supplement: [],
      user_profile: [],
      app_target_snapshot: null,
      app_household_prefs: null,
      app_checkin_history: null,
    } as unknown as BackupSnapshot;

    await restoreFromSnapshot(db, snapshot);

    const containers = await potRepo.getContainers(db);
    expect(containers).toEqual([{ id: 'container-1', name: 'Blue bowl', tare_g: 250, use_count: 3, last_used: 9999 }]);

    const entry = await db.getFirstAsync<{ tare_g: number }>('SELECT * FROM food_entry WHERE id = ?', ['entry-1']);
    expect(entry?.tare_g).toBe(250);
  });
});
