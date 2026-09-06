// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V3 MIGRATION — saved_food.confidence (PRD §10 fix: quick-add must
// not launder a low-confidence photo/voice estimate into an `exact`
// entry).
//
// Mirrors migrations.v2.test.ts's structure: this simulates a REAL device
// upgrade from v2 (meal grouping already applied) to v3, not just a fresh
// install — it runs only migrations 1-2 against a fresh DB, inserts data
// the way a v2 app would have (no `confidence` column on saved_food yet),
// THEN runs the full migration list (re-invoking runMigrations, exactly
// what happens when the app updates and calls runMigrations() on next
// launch) and asserts nothing was lost or changed.
// ═══════════════════════════════════════════════════════════════════════

import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../migrations';
import { createTestDatabase } from './testDb';
import * as foodRepo from '../repositories/foodRepo';
import * as intakeRepo from '../repositories/intakeRepo';

const V1_AND_V2 = MIGRATIONS.filter((m) => m.version <= 2);
// Pinned to versions 1-3 (not the full/latest MIGRATIONS list) so this
// test keeps verifying exactly what schema v3 itself adds, independent of
// whatever later versions (v4+) go on to add elsewhere.
const V1_THROUGH_V3 = MIGRATIONS.filter((m) => m.version <= 3);

describe('schema v3 migration — additive, non-destructive upgrade', () => {
  it('adds saved_food.confidence as a nullable column', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_THROUGH_V3);

    const columns = await db.getAllAsync<{ name: string; notnull: number }>('PRAGMA table_info(saved_food)');
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

    expect(byName.confidence).toBeDefined();
    expect(byName.confidence.notnull).toBe(0);
  });

  it('does not add or drop any table — same eight tables as v2', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_THROUGH_V3);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((t) => t.name).sort()).toEqual(
      ['day_intake', 'external_estimate', 'food_entry', 'pot', 'saved_food', 'supplement', 'user_profile', 'weight_log'].sort()
    );
  });

  it('a v2 database with real saved_food data upgrades to v3 with every row intact and confidence NULL', async () => {
    const db = createTestDatabase();

    // Simulate a device that has only ever run migrations 1 and 2.
    await runMigrations(db, V1_AND_V2);
    let version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(2);

    // Real v2-shaped data, inserted the way v2 foodRepo would have (no
    // `confidence` column exists on saved_food yet at this point).
    await db.runAsync(
      `INSERT INTO saved_food (id, name, barcode, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, default_grams, use_count, last_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pre-v3-1', 'Chicken breast', '9312345678901', 165, 31, 0, 3.6, 200, 4, 12000]
    );
    await db.runAsync(
      `INSERT INTO saved_food (id, name, barcode, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, default_grams, use_count, last_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['pre-v3-2', 'Leftover curry (photo estimate)', null, 180, 8, 20, 7, 350, 1, 9000]
    );
    await db.runAsync(
      `INSERT INTO food_entry (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input, meal_type, meal_group_id, meal_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['fe-1', '2026-08-20', 1000, 'Chicken breast', 200, 330, 62, 0, 7.2, 'manual', 'exact', null, null, null, null, null]
    );
    await intakeRepo.recomputeDay(db, '2026-08-20');
    const dayBefore = await intakeRepo.getDay(db, '2026-08-20');

    // The upgrade: app updates, calls runMigrations() with the FULL list
    // on next launch.
    await runMigrations(db, MIGRATIONS);
    version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);

    // Both pre-existing saved_food rows survive, unchanged, with the new
    // column NULL.
    const chicken = await foodRepo.getSavedFood(db, 'pre-v3-1');
    expect(chicken?.name).toBe('Chicken breast');
    expect(chicken?.kcal_per_100g).toBe(165);
    expect(chicken?.use_count).toBe(4);
    expect(chicken?.confidence).toBeNull();

    const curry = await foodRepo.getSavedFood(db, 'pre-v3-2');
    expect(curry?.name).toBe('Leftover curry (photo estimate)');
    expect(curry?.confidence).toBeNull();

    // food_entry and its rollup are completely unaffected — this migration
    // touches saved_food only.
    const dayAfter = await intakeRepo.getDay(db, '2026-08-20');
    expect(dayAfter).toEqual(dayBefore);
  });

  it('running the v3 migration twice (idempotent re-run) does not error and does not duplicate the column', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_AND_V2);
    await runMigrations(db, MIGRATIONS);
    // Second call: version is already latest, so the v3 SQL (ALTER TABLE
    // ADD COLUMN) must NOT run again — re-running it a second time against
    // a real SQLite engine throws ("duplicate column name").
    await expect(runMigrations(db, MIGRATIONS)).resolves.toBeUndefined();

    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(saved_food)');
    const confidenceCount = columns.filter((c) => c.name === 'confidence').length;
    expect(confidenceCount).toBe(1);
  });

  it('addSavedFood writes and reads back an explicit confidence through foodRepo', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const saved = await foodRepo.addSavedFood(db, {
      id: 'low-conf-food',
      name: 'Mystery leftovers',
      kcal_per_100g: 200,
      protein_per_100g: 10,
      carbs_per_100g: 20,
      fat_per_100g: 8,
      default_grams: 300,
      confidence: 'low',
    });

    expect(saved.confidence).toBe('low');

    const row = await foodRepo.getSavedFood(db, 'low-conf-food');
    expect(row?.confidence).toBe('low');
  });

  it('existing callers that omit confidence entirely still insert NULL (additive contract holds)', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    // Exactly the shape every pre-existing call site used before this fix.
    const saved = await foodRepo.addSavedFood(db, {
      id: 'legacy-shape',
      name: 'Rice',
      kcal_per_100g: 130,
      protein_per_100g: 2.7,
      carbs_per_100g: 28,
      fat_per_100g: 0.3,
      default_grams: 200,
    });

    expect(saved.confidence).toBeNull();
    const row = await foodRepo.getSavedFood(db, 'legacy-shape');
    expect(row?.confidence).toBeNull();
  });
});
