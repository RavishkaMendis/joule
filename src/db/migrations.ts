// ═══════════════════════════════════════════════════════════════════════
// MIGRATION RUNNER
//
// Versioned via PRAGMA user_version. Each entry in MIGRATIONS runs its SQL
// exactly once, in order, bringing the DB from its current user_version up
// to the latest defined version. Safe to call on every app start:
// migrations whose version is <= the current user_version are skipped, so
// running twice is a no-op the second time.
//
// Adding version 2+ later (Phases 2-4 add columns/tables): append a new
// entry to MIGRATIONS with `version: N` and the SQL to go from N-1 to N.
// Do not edit past entries — SQLite ALTER TABLE is limited (no DROP
// COLUMN / no column type change pre-3.35 semantics we want to rely on),
// so additive migrations (ADD COLUMN, CREATE TABLE, CREATE INDEX) are the
// expected shape going forward.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from './database';
import {
  SCHEMA_V1_SQL,
  SCHEMA_V2_SQL,
  SCHEMA_V3_SQL,
  SCHEMA_V4_SQL,
  SCHEMA_V5_SQL,
  SCHEMA_V6_SQL,
  SCHEMA_V7_SQL,
} from './schema';

export type Migration = {
  version: number;
  /** Human-readable label, shown in logs only. */
  name: string;
  sql: string;
};

/**
 * Ordered list of migrations. MUST be sorted ascending by `version` with no
 * gaps starting at 1 — `runMigrations` asserts this.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema (PRD §3)',
    sql: SCHEMA_V1_SQL,
  },
  {
    version: 2,
    name: 'meal grouping: food_entry.meal_type / meal_group_id / meal_name',
    sql: SCHEMA_V2_SQL,
  },
  {
    version: 3,
    name: 'saved_food.confidence (PRD §10: quick-add must not launder a photo/voice estimate into exact)',
    sql: SCHEMA_V3_SQL,
  },
  {
    version: 4,
    name: 'strength training: exercise / workout_session / workout_set (PRD §1 non-goal: no calorie-burn column, never fed to the TDEE engine)',
    sql: SCHEMA_V4_SQL,
  },
  {
    version: 5,
    name: 'supplements: supplement.unit/notes/is_active/created_at + supplement_log adherence table (never fed to the TDEE engine; food_entry writes only via explicit logDoseAndFood)',
    sql: SCHEMA_V5_SQL,
  },
  {
    version: 6,
    name: 'pot meal-prep workflow: pot_container table + food_entry.tare_g (never changes day_intake rollup semantics)',
    sql: SCHEMA_V6_SQL,
  },
  {
    version: 7,
    name: 'training programs/templates: program / program_day / program_exercise / program_substitution + workout_session.program_day_id (nullable — ad-hoc sessions unaffected; never fed to the TDEE engine)',
    sql: SCHEMA_V7_SQL,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

async function getUserVersion(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

async function setUserVersion(db: Database, version: number): Promise<void> {
  // PRAGMA does not accept bound parameters; the value is our own integer,
  // never user input, so string interpolation here is safe.
  await db.execAsync(`PRAGMA user_version = ${version}`);
}

function assertContiguousMigrations(migrations: Migration[]): void {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (let i = 0; i < sorted.length; i++) {
    const expected = i + 1;
    if (sorted[i].version !== expected) {
      throw new Error(
        `Migration list must be contiguous starting at 1 with no gaps/duplicates. ` +
          `Expected version ${expected}, found ${sorted[i].version} (${sorted[i].name}).`
      );
    }
  }
}

/**
 * Bring `db` up to `LATEST_SCHEMA_VERSION`. Idempotent: safe to call every
 * app start. Also enables foreign keys and WAL mode (both are per-connection
 * / per-file settings that should be applied on every open, not just once).
 */
export async function runMigrations(db: Database, migrations: Migration[] = MIGRATIONS): Promise<void> {
  assertContiguousMigrations(migrations);

  // PRAGMAs that should be (re-)applied on every connection open.
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA foreign_keys = ON');

  const currentVersion = await getUserVersion(db);
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  for (const migration of sorted) {
    if (migration.version <= currentVersion) continue;
    await db.execAsync(migration.sql);
    await setUserVersion(db, migration.version);
  }
}
