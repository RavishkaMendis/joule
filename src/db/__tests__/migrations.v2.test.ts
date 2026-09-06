// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V2 MIGRATION — meal grouping columns (meal_type, meal_group_id,
// meal_name on food_entry). The task brief calls this "the highest-risk
// part of the task": an existing device sitting on a v1 database must
// upgrade to v2 with every row intact, and the day_intake rollup (which
// the TDEE engine reads) must be provably unaffected by the new grouping
// columns' mere existence.
//
// This test simulates a REAL device upgrade, not just a fresh install at
// v2: it runs ONLY the v1 migration against a fresh DB, inserts data the
// way a v1 app would have, THEN runs the full migration list (which
// re-invokes runMigrations — exactly what happens when the app updates
// and calls runMigrations() on next launch) and asserts nothing was lost
// or changed.
// ═══════════════════════════════════════════════════════════════════════

import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../migrations';
import { createTestDatabase } from './testDb';
import * as foodRepo from '../repositories/foodRepo';
import * as intakeRepo from '../repositories/intakeRepo';
import type { Database } from '../database';

const V1_ONLY = MIGRATIONS.filter((m) => m.version === 1);
// Pinned to versions 1-2 (not the full/latest MIGRATIONS list) so this
// test keeps verifying exactly what schema v2 itself adds, independent of
// whatever later versions (v3+) go on to add elsewhere.
const V1_AND_V2 = MIGRATIONS.filter((m) => m.version <= 2);

describe('schema v2 migration — additive, non-destructive upgrade', () => {
  it('adds meal_type/meal_group_id/meal_name as nullable columns on food_entry', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_AND_V2);

    const columns = await db.getAllAsync<{ name: string; notnull: number }>('PRAGMA table_info(food_entry)');
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

    expect(byName.meal_type).toBeDefined();
    expect(byName.meal_type.notnull).toBe(0);
    expect(byName.meal_group_id).toBeDefined();
    expect(byName.meal_group_id.notnull).toBe(0);
    expect(byName.meal_name).toBeDefined();
    expect(byName.meal_name.notnull).toBe(0);
  });

  it('does not add or drop any table — same eight tables as v1', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_AND_V2);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((t) => t.name).sort()).toEqual(
      ['day_intake', 'external_estimate', 'food_entry', 'pot', 'saved_food', 'supplement', 'user_profile', 'weight_log'].sort()
    );
  });

  it('a v1 database with real data upgrades to v2 with every row intact and new columns NULL', async () => {
    const db = createTestDatabase();

    // Simulate a device that has only ever run the v1 migration.
    await runMigrations(db, V1_ONLY);
    let version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(1);

    // Real v1-shaped data, inserted the way v1 foodRepo would have (no
    // meal_* columns exist yet in the schema at this point).
    await db.runAsync(
      `INSERT INTO food_entry (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pre-v2-1', '2026-08-01', 1000, 'Rice', 200, 260, 5.4, 56, 0.6, 'manual', 'exact', null, null]
    );
    await db.runAsync(
      `INSERT INTO food_entry (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pre-v2-2', '2026-08-01', 2000, 'Dal', 150, 180, 9, 24, 4, 'manual', 'exact', null, null]
    );
    await db.runAsync(
      'INSERT INTO weight_log (date, weight_kg, confounder, source) VALUES (?, ?, ?, ?)',
      ['2026-08-01', 78.4, null, 'manual']
    );
    await intakeRepo.recomputeDay(db, '2026-08-01');

    const dayBefore = await intakeRepo.getDay(db, '2026-08-01');
    expect(dayBefore).toEqual({ date: '2026-08-01', kcal: 440, protein_g: 14.4, carbs_g: 80, fat_g: 4.6, is_complete: 1 });

    // The upgrade: app updates, calls runMigrations() with the FULL list
    // on next launch (exactly the real-world code path — no special
    // "migrate to v2" entry point exists or is needed). Asserts against
    // LATEST_SCHEMA_VERSION rather than a hardcoded 2 — this test's intent
    // is "the full migration list actually gets applied to a v1 database,"
    // not "the latest version is specifically 2," and later migrations
    // (e.g. v3's saved_food.confidence) must not make this assertion stale.
    await runMigrations(db, MIGRATIONS);
    version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);

    // Both pre-existing rows survive, unchanged, with new columns NULL.
    const rows = await foodRepo.getEntriesForDate(db, '2026-08-01');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.meal_type).toBeNull();
      expect(row.meal_group_id).toBeNull();
      expect(row.meal_name).toBeNull();
    }
    const rice = rows.find((r) => r.id === 'pre-v2-1')!;
    expect(rice.name).toBe('Rice');
    expect(rice.grams).toBe(200);
    expect(rice.kcal).toBe(260);
    expect(rice.protein_g).toBe(5.4);
    expect(rice.confidence).toBe('exact');

    const dal = rows.find((r) => r.id === 'pre-v2-2')!;
    expect(dal.name).toBe('Dal');
    expect(dal.kcal).toBe(180);

    // The weight_log row (untouched by this migration at all) survives.
    const weight = await db.getFirstAsync<{ weight_kg: number }>('SELECT weight_kg FROM weight_log WHERE date = ?', [
      '2026-08-01',
    ]);
    expect(weight?.weight_kg).toBe(78.4);

    // day_intake rollup is byte-identical to before the upgrade — the
    // migration touched food_entry's schema, not its data, and never
    // recomputed or wrote day_intake itself.
    const dayAfter = await intakeRepo.getDay(db, '2026-08-01');
    expect(dayAfter).toEqual(dayBefore);
  });

  it('running the v2 migration twice (idempotent re-run) does not error and does not duplicate columns', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_ONLY);
    await runMigrations(db, MIGRATIONS);
    // Second call: version is already 2, so the v2 SQL (ALTER TABLE ADD
    // COLUMN) must NOT run again — re-running "ADD COLUMN meal_type" a
    // second time against a real SQLite engine throws ("duplicate column
    // name"), so this assertion also proves runMigrations' version-gate
    // (`migration.version <= currentVersion` skip) is doing its job here,
    // not just that the SQL happens to be re-runnable.
    await expect(runMigrations(db, MIGRATIONS)).resolves.toBeUndefined();

    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(food_entry)');
    const mealTypeCount = columns.filter((c) => c.name === 'meal_type').length;
    expect(mealTypeCount).toBe(1);
  });

  it('new food_entry columns can be written and read back through foodRepo', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await foodRepo.addEntry(db, {
      id: 'grouped-1',
      date: '2026-08-10',
      logged_at: 1000,
      name: 'Sushi rice',
      grams: 180,
      kcal: 234,
      protein_g: 4.9,
      carbs_g: 50.4,
      fat_g: 0.5,
      source: 'meal_photo',
      confidence: 'medium',
      meal_type: 'lunch',
      meal_group_id: 'grp-1',
      meal_name: 'Chicken Sushi',
    });

    const row = await foodRepo.getEntry(db, 'grouped-1');
    expect(row?.meal_type).toBe('lunch');
    expect(row?.meal_group_id).toBe('grp-1');
    expect(row?.meal_name).toBe('Chicken Sushi');
  });

  it('existing callers that omit meal_* fields entirely still insert NULLs (additive contract holds)', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    // Exactly the shape every pre-existing call site in the codebase uses
    // (no meal_type/meal_group_id/meal_name keys at all).
    await foodRepo.addEntry(db, {
      id: 'legacy-shape',
      date: '2026-08-10',
      logged_at: 1000,
      name: 'Chicken breast',
      grams: 150,
      kcal: 250,
      protein_g: 45,
      carbs_g: 0,
      fat_g: 6,
      source: 'manual',
      confidence: 'exact',
    });

    const row = await foodRepo.getEntry(db, 'legacy-shape');
    expect(row?.meal_type).toBeNull();
    expect(row?.meal_group_id).toBeNull();
    expect(row?.meal_name).toBeNull();
  });
});

describe('day_intake rollup is unaffected by meal grouping', () => {
  let db: Database;
  beforeEach(async () => {
    db = createTestDatabase();
    return runMigrations(db);
  });

  it('grouped entries sum into day_intake identically to the same entries ungrouped', async () => {
    const date = '2026-08-15';

    // Group A: three entries sharing one meal_group_id (a "meal photo exploded into rows" capture).
    await foodRepo.addEntry(db, {
      id: 'g-rice', date, logged_at: 1000, name: 'Sushi rice', grams: 180, kcal: 234, protein_g: 4.9, carbs_g: 50.4, fat_g: 0.5,
      source: 'meal_photo', confidence: 'medium', meal_group_id: 'grp-sushi', meal_name: 'Chicken Sushi', meal_type: 'lunch',
    });
    await foodRepo.addEntry(db, {
      id: 'g-chicken', date, logged_at: 1001, name: 'Chicken filling', grams: 90, kcal: 149, protein_g: 27.9, carbs_g: 0, fat_g: 3.6,
      source: 'meal_photo', confidence: 'medium', meal_group_id: 'grp-sushi', meal_name: 'Chicken Sushi', meal_type: 'lunch',
    });
    await foodRepo.addEntry(db, {
      id: 'g-avocado', date, logged_at: 1002, name: 'Avocado', grams: 50, kcal: 80, protein_g: 1, carbs_g: 4.3, fat_g: 7.4,
      source: 'meal_photo', confidence: 'low', meal_group_id: 'grp-sushi', meal_name: 'Chicken Sushi', meal_type: 'lunch',
    });

    const groupedTotal = await intakeRepo.getDay(db, date);
    expect(groupedTotal).toEqual({
      date,
      kcal: 234 + 149 + 80,
      protein_g: 4.9 + 27.9 + 1,
      carbs_g: 50.4 + 0 + 4.3,
      fat_g: 0.5 + 3.6 + 7.4,
      is_complete: 1,
    });

    // Now build the identical set of macros as three UNGROUPED entries on
    // a different date and assert the rollup is numerically identical —
    // grouping must not change what gets summed by so much as a decimal.
    const ungroupedDate = '2026-08-16';
    await foodRepo.addEntry(db, {
      id: 'u-rice', date: ungroupedDate, logged_at: 1000, name: 'Sushi rice', grams: 180, kcal: 234, protein_g: 4.9, carbs_g: 50.4, fat_g: 0.5,
      source: 'manual', confidence: 'exact',
    });
    await foodRepo.addEntry(db, {
      id: 'u-chicken', date: ungroupedDate, logged_at: 1001, name: 'Chicken filling', grams: 90, kcal: 149, protein_g: 27.9, carbs_g: 0, fat_g: 3.6,
      source: 'manual', confidence: 'exact',
    });
    await foodRepo.addEntry(db, {
      id: 'u-avocado', date: ungroupedDate, logged_at: 1002, name: 'Avocado', grams: 50, kcal: 80, protein_g: 1, carbs_g: 4.3, fat_g: 7.4,
      source: 'manual', confidence: 'exact',
    });

    const ungroupedTotal = await intakeRepo.getDay(db, ungroupedDate);
    expect(ungroupedTotal?.kcal).toBe(groupedTotal?.kcal);
    expect(ungroupedTotal?.protein_g).toBe(groupedTotal?.protein_g);
    expect(ungroupedTotal?.carbs_g).toBe(groupedTotal?.carbs_g);
    expect(ungroupedTotal?.fat_g).toBe(groupedTotal?.fat_g);
  });

  it('deleting a meal group recomputes the rollup down to exactly the remaining entries', async () => {
    const date = '2026-08-17';
    await foodRepo.addEntry(db, {
      id: 'grp-a', date, logged_at: 1000, name: 'Rice', grams: 200, kcal: 260, protein_g: 5.4, carbs_g: 56, fat_g: 0.6,
      source: 'meal_photo', confidence: 'medium', meal_group_id: 'grp-1', meal_name: 'Lunch bowl',
    });
    await foodRepo.addEntry(db, {
      id: 'grp-b', date, logged_at: 1001, name: 'Chicken', grams: 150, kcal: 250, protein_g: 45, carbs_g: 0, fat_g: 6,
      source: 'meal_photo', confidence: 'medium', meal_group_id: 'grp-1', meal_name: 'Lunch bowl',
    });
    await foodRepo.addEntry(db, {
      id: 'standalone', date, logged_at: 1002, name: 'Apple', grams: 150, kcal: 80, protein_g: 0.5, carbs_g: 21, fat_g: 0.3,
      source: 'manual', confidence: 'exact',
    });

    let day = await intakeRepo.getDay(db, date);
    expect(day?.kcal).toBe(260 + 250 + 80);

    await foodRepo.deleteGroup(db, 'grp-1');

    day = await intakeRepo.getDay(db, date);
    expect(day?.kcal).toBe(80);
    expect(day?.protein_g).toBe(0.5);

    const remaining = await foodRepo.getEntriesForDate(db, date);
    expect(remaining.map((r) => r.id)).toEqual(['standalone']);
  });

  it('getEntriesByGroup returns members in log order and deleteGroup on an unknown id is a no-op', async () => {
    const date = '2026-08-18';
    await foodRepo.addEntry(db, {
      id: 'm2', date, logged_at: 2000, name: 'Nori', grams: 5, kcal: 15, protein_g: 1.5, carbs_g: 2, fat_g: 0.1,
      source: 'meal_photo', confidence: 'low', meal_group_id: 'grp-x',
    });
    await foodRepo.addEntry(db, {
      id: 'm1', date, logged_at: 1000, name: 'Rice', grams: 180, kcal: 234, protein_g: 4.9, carbs_g: 50.4, fat_g: 0.5,
      source: 'meal_photo', confidence: 'medium', meal_group_id: 'grp-x',
    });

    const members = await foodRepo.getEntriesByGroup(db, 'grp-x');
    expect(members.map((m) => m.id)).toEqual(['m1', 'm2']);

    await expect(foodRepo.deleteGroup(db, 'no-such-group')).resolves.toBeUndefined();
    // Real group untouched.
    expect(await foodRepo.getEntriesByGroup(db, 'grp-x')).toHaveLength(2);
  });
});
