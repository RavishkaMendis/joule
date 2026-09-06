// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V5 MIGRATION — supplement.unit/notes/is_active/created_at +
// supplement_log adherence table (task brief "Feature 1 — Supplements").
//
// Mirrors migrations.v3.test.ts's structure: simulates a real device
// upgrade from v4 (strength training already applied) to v5, not just a
// fresh install, then also proves an OLD backup snapshot (pre-v5 shape:
// supplement rows with only the original six columns, no supplement_log
// key at all) restores cleanly through the existing restoreFromSnapshot
// — the "old backups must still restore" requirement — without this
// feature's migration touching src/lib/backup/** at all.
// ═══════════════════════════════════════════════════════════════════════

import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../migrations';
import { createTestDatabase } from './testDb';
import * as supplementRepo from '../repositories/supplementRepo';
import { restoreFromSnapshot } from '../../lib/backup/restore';
import type { BackupSnapshot } from '../../lib/backup/snapshot';

const UP_TO_V4 = MIGRATIONS.filter((m) => m.version <= 4);

describe('schema v5 migration — additive, non-destructive upgrade', () => {
  it('adds the four new supplement columns as nullable (is_active defaults to 1)', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const columns = await db.getAllAsync<{ name: string; notnull: number; dflt_value: string | null }>(
      'PRAGMA table_info(supplement)'
    );
    const byName = Object.fromEntries(columns.map((c) => [c.name, c]));

    expect(byName.unit).toBeDefined();
    expect(byName.unit.notnull).toBe(0);
    expect(byName.notes).toBeDefined();
    expect(byName.notes.notnull).toBe(0);
    expect(byName.is_active).toBeDefined();
    expect(byName.created_at).toBeDefined();
  });

  it('creates supplement_log with a unique (supplement_id, date) index', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((t) => t.name)).toContain('supplement_log');

    // Enforce the uniqueness at the SQL level, not just via repo logic.
    await db.runAsync(
      'INSERT INTO supplement_log (id, supplement_id, date, logged_at, food_entry_id) VALUES (?, ?, ?, ?, NULL)',
      ['l1', 's1', '2026-09-05', 1000]
    );
    await expect(
      db.runAsync('INSERT INTO supplement_log (id, supplement_id, date, logged_at, food_entry_id) VALUES (?, ?, ?, ?, NULL)', [
        'l2',
        's1',
        '2026-09-05',
        2000,
      ])
    ).rejects.toThrow();
  });

  it('does not add or drop any other table — same tables as v4 plus supplement_log', async () => {
    const db = createTestDatabase();
    // Pinned to v5 specifically (not the default latest-version run) so a
    // later migration (e.g. v6's pot_container) doesn't make this
    // v5-scoped assertion fail — this test is about what v5 itself adds,
    // not about the current LATEST_SCHEMA_VERSION's full table set.
    await runMigrations(db, MIGRATIONS.filter((m) => m.version <= 5));
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

  it('a v4 database with a real pre-v5 supplement row upgrades to v5 with the row intact and new columns NULL/default', async () => {
    const db = createTestDatabase();

    // Simulate a device that has only ever run migrations 1-4.
    await runMigrations(db, UP_TO_V4);
    let version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(4);

    // Real v4-shaped insert: only the six original columns exist at this point.
    await db.runAsync(
      'INSERT INTO supplement (id, name, dose, schedule, kcal, protein_g) VALUES (?, ?, ?, ?, ?, ?)',
      ['pre-v5-1', 'Fish Oil', '1000mg', 'once daily', 0, 0]
    );

    // The upgrade: app updates, calls runMigrations() with the FULL list on next launch.
    await runMigrations(db, MIGRATIONS);
    version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);

    const row = await supplementRepo.getSupplement(db, 'pre-v5-1');
    expect(row?.name).toBe('Fish Oil');
    expect(row?.dose).toBe('1000mg');
    expect(row?.schedule).toBe('once daily'); // legacy free-text value, untouched by the migration itself
    expect(row?.unit).toBeNull();
    expect(row?.notes).toBeNull();
    expect(row?.is_active).toBe(1); // ALTER TABLE ... DEFAULT 1 backfills existing rows
    expect(row?.created_at).toBeNull();
  });

  it('running the v5 migration twice (idempotent re-run) does not error and does not duplicate columns/tables', async () => {
    const db = createTestDatabase();
    await runMigrations(db, UP_TO_V4);
    await runMigrations(db, MIGRATIONS);
    await expect(runMigrations(db, MIGRATIONS)).resolves.toBeUndefined();

    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(supplement)');
    expect(columns.filter((c) => c.name === 'unit')).toHaveLength(1);
  });

  it('a pre-v5 backup snapshot (no supplement.unit/notes/is_active/created_at, no supplement_log key) restores cleanly against a v5 database', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    // Shape a snapshot exactly as an old app version's exportFullJson would
    // have produced it: `supplement` rows only carry the original six
    // fields (JSON.parse never invents keys that weren't serialized), and
    // there is no `supplement_log` key on the object at all. Cast through
    // `unknown` since this deliberately does NOT satisfy the current
    // (post-v5) SupplementRow type — that mismatch IS the scenario being
    // tested.
    const legacySnapshot = {
      exported_at: '2026-01-01T00:00:00.000Z',
      schema_version: 4,
      backup_format_version: 1,
      day_intake: [],
      weight_log: [],
      external_estimate: [],
      food_entry: [],
      saved_food: [],
      pot: [],
      supplement: [{ id: 'legacy-1', name: 'Fish Oil', dose: '1000mg', schedule: 'once daily', kcal: 0, protein_g: 0 }],
      user_profile: [],
      app_target_snapshot: null,
      app_household_prefs: null,
      app_checkin_history: null,
    } as unknown as BackupSnapshot;

    await expect(restoreFromSnapshot(db, legacySnapshot)).resolves.toBeDefined();

    const row = await supplementRepo.getSupplement(db, 'legacy-1');
    expect(row?.name).toBe('Fish Oil');
    // restore.ts's INSERT (unmodified by this feature) only lists the
    // original six columns — the new ones fall back to their column
    // defaults/NULL rather than the restore throwing. This is exactly the
    // gap flagged in the report: a NEW-format snapshot's unit/notes would
    // be silently dropped on restore today. Recorded here as a known,
    // deliberately-not-fixed-by-this-agent gap (src/lib/backup/** is out
    // of scope) rather than left undiscovered.
    expect(row?.unit).toBeNull();
    expect(row?.is_active).toBe(1);
  });
});
