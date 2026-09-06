// ═══════════════════════════════════════════════════════════════════════
// APP-LEVEL DATABASE BOOTSTRAP
//
// Opens the single expo-sqlite database and runs src/db's migration runner
// exactly once per process. Every screen/hook that needs the DB should go
// through `getDatabase()` rather than opening its own connection — that's
// what keeps "migrations run once before any query" true app-wide.
//
// This file is the *only* place that imports `expo-sqlite` directly; the
// repositories in src/db/repositories only depend on the structural
// `Database` interface (src/db/database.ts), which is what keeps them
// testable against node:sqlite in plain Node.
// ═══════════════════════════════════════════════════════════════════════

import * as SQLite from 'expo-sqlite';
import type { Database, RunResult, SQLBindValue } from '../db/database';
import { runMigrations } from '../db/migrations';

const DATABASE_NAME = 'joule.db';

let cachedDb: Database | null = null;
let openPromise: Promise<Database> | null = null;

/**
 * Thin adapter from expo-sqlite's `SQLiteDatabase` to the app's minimal
 * structural `Database` interface (src/db/database.ts). Needed only
 * because `SQLiteDatabase.runAsync`'s TS overloads require `params` to be
 * present, whereas `Database.runAsync` makes it optional (to match
 * node:sqlite's test adapter) — functionally identical at runtime, this
 * just satisfies both signatures.
 */
function adaptExpoDatabase(native: SQLite.SQLiteDatabase): Database {
  return {
    execAsync: (source: string) => native.execAsync(source),
    runAsync: (source: string, params: SQLBindValue[] = []): Promise<RunResult> => native.runAsync(source, params),
    getAllAsync: <T>(source: string, params: SQLBindValue[] = []) => native.getAllAsync<T>(source, params),
    getFirstAsync: <T>(source: string, params: SQLBindValue[] = []) => native.getFirstAsync<T>(source, params),
  };
}

/**
 * Returns the app's single SQLite connection, opening it and running
 * migrations on first call. Subsequent calls reuse the same in-flight/
 * resolved promise, so concurrent callers during startup never race to
 * open two connections or run migrations twice.
 */
export function getDatabase(): Promise<Database> {
  if (cachedDb) return Promise.resolve(cachedDb);
  if (!openPromise) {
    openPromise = (async () => {
      const native = await SQLite.openDatabaseAsync(DATABASE_NAME);
      const db = adaptExpoDatabase(native);
      await runMigrations(db);
      cachedDb = db;
      return db;
    })();
  }
  return openPromise;
}

/** Test/dev escape hatch: forget the cached connection so the next getDatabase() call reopens. */
export function resetDatabaseForTesting(): void {
  cachedDb = null;
  openPromise = null;
}
