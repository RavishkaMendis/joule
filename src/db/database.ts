// ═══════════════════════════════════════════════════════════════════════
// MINIMAL DATABASE INTERFACE
//
// Everything in src/db talks to SQLite through this interface only, never
// through `expo-sqlite` types directly. That's what makes the repository
// layer testable in plain Node: `expo-sqlite`'s `SQLiteDatabase` satisfies
// this shape structurally, and so does a thin wrapper around Node's
// built-in `node:sqlite` (see src/db/__tests__/testDb.ts), which is a real
// SQLite engine and will catch genuine SQL errors that a hand-rolled fake
// would not.
//
// Keep this interface small and by-value (arrays for bind params) so both
// backends can implement it without leaking backend-specific types.
// ═══════════════════════════════════════════════════════════════════════

/** A single bindable SQL parameter value. */
export type SQLBindValue = string | number | null | boolean;

export type RunResult = {
  changes: number;
  lastInsertRowId: number;
};

/**
 * The subset of `expo-sqlite`'s `SQLiteDatabase` API the db layer depends
 * on. Deliberately minimal — do not widen this without checking that both
 * `expo-sqlite` and the test harness in src/db/__tests__/testDb.ts still
 * satisfy it.
 */
export interface Database {
  /** Execute one or more statements with no return value (DDL, PRAGMA). */
  execAsync(source: string): Promise<void>;
  /** Run a mutating statement (INSERT/UPDATE/DELETE) and get row-count/id info. */
  runAsync(source: string, params?: SQLBindValue[]): Promise<RunResult>;
  /** Run a query and return every matching row. */
  getAllAsync<T>(source: string, params?: SQLBindValue[]): Promise<T[]>;
  /** Run a query and return the first matching row, or null. */
  getFirstAsync<T>(source: string, params?: SQLBindValue[]): Promise<T | null>;
}
