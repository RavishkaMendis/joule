import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../migrations';
import { createTestDatabase } from './testDb';

// Pinned to schema v1 only (not the full/latest MIGRATIONS list): this
// test asserts what the INITIAL schema creates, independent of however
// many tables later versions (v2+) go on to add. Each later migration has
// its own migrations.vN.test.ts asserting its own additions the same way.
const V1_ONLY = MIGRATIONS.filter((m) => m.version === 1);

describe('migrations', () => {
  it('creates all eight tables and sets user_version', async () => {
    const db = createTestDatabase();
    await runMigrations(db, V1_ONLY);

    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(1);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'day_intake',
        'external_estimate',
        'food_entry',
        'pot',
        'saved_food',
        'supplement',
        'user_profile',
        'weight_log',
      ].sort()
    );
  });

  it('runs idempotently: calling twice does not error and version is stable', async () => {
    const db = createTestDatabase();
    await runMigrations(db);
    await expect(runMigrations(db)).resolves.toBeUndefined();

    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);
  });

  it('enforces the user_profile singleton CHECK (id = 1)', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await db.runAsync(
      'INSERT INTO user_profile (id, height_cm, birth_year, sex, goal, rate_kg_per_week, activity_seed, protein_override, units) VALUES (1, 175, 1995, ?, ?, -0.5, ?, NULL, ?)',
      ['male', 'cut', 'lightly_active', 'metric']
    );

    await expect(
      db.runAsync(
        'INSERT INTO user_profile (id, height_cm, birth_year, sex, goal, rate_kg_per_week, activity_seed, protein_override, units) VALUES (2, 175, 1995, ?, ?, -0.5, ?, NULL, ?)',
        ['male', 'cut', 'lightly_active', 'metric']
      )
    ).rejects.toThrow();
  });

  it('enforces one weight_log reading per day via the date PRIMARY KEY', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await db.runAsync('INSERT INTO weight_log (date, weight_kg, confounder, source) VALUES (?, ?, NULL, ?)', [
      '2026-08-01',
      80.1,
      'manual',
    ]);

    await expect(
      db.runAsync('INSERT INTO weight_log (date, weight_kg, confounder, source) VALUES (?, ?, NULL, ?)', [
        '2026-08-01',
        81.0,
        'manual',
      ])
    ).rejects.toThrow();
  });

  it('enables foreign_keys pragma', async () => {
    const db = createTestDatabase();
    await runMigrations(db);
    const row = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(row?.foreign_keys).toBe(1);
  });
});
