/// <reference types="node" />
// ═══════════════════════════════════════════════════════════════════════
// TEST-ONLY Database ADAPTER
//
// Wraps Node's built-in `node:sqlite` (Node 26+) behind the same minimal
// `Database` interface (src/db/database.ts) that `expo-sqlite`'s
// `SQLiteDatabase` satisfies. This is a genuine SQLite engine — not a
// hand-rolled fake — so repository tests exercise real SQL (constraints,
// CHECKs, indices, PRAGMAs) rather than a JS reimplementation of SQLite
// semantics.
//
// Known differences from expo-sqlite that could bite later (see report):
//  - node:sqlite's RunResult uses `lastInsertRowid` (lowercase d); expo
//    uses `lastInsertRowId`. We normalize to the Database interface's
//    `lastInsertRowId` here. Phase 1 repos use caller-supplied TEXT/UUID
//    primary keys throughout, not autoincrement, so no repo code should
//    ever depend on this value — but the field exists for completeness.
//  - node:sqlite's execAsync equivalent (`exec`) does not support bound
//    parameters or `;`-separated multi-statement + parameter mixes the
//    same way some other drivers do; our schema/migration SQL is pure DDL
//    with no parameters, so this is a non-issue here.
//  - node:sqlite is synchronous under the hood; we wrap every call in
//    Promise.resolve() so the interface (and call sites) are identical to
//    the real async expo-sqlite API. This means tests can't catch
//    genuine async-interleaving bugs (e.g. two concurrent writers) —
//    that class of bug is untested by this harness.
//  - PRAGMA journal_mode=WAL is a no-op on an in-memory database (silently
//    stays 'memory'); this is expected and does not indicate WAL is broken
//    against a real file-backed DB on-device.
//  - expo-sqlite's bind-value union includes `boolean` directly; node:sqlite
//    does not accept JS booleans as bind parameters at all (TS rejects it,
//    and it would throw at runtime too). No repository in this codebase
//    binds a raw boolean (booleans are always converted to 0/1 integers
//    before binding, e.g. intakeRepo's is_complete), so this is coerced
//    defensively below rather than relied upon.
// ═══════════════════════════════════════════════════════════════════════

import { DatabaseSync } from 'node:sqlite';
import type { Database, RunResult, SQLBindValue } from '../database';

type NodeSqliteBindValue = string | number | bigint | null;

function toNodeSqliteParams(params: SQLBindValue[]): NodeSqliteBindValue[] {
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function createTestDatabase(): Database {
  const raw = new DatabaseSync(':memory:');

  // node:sqlite throws synchronously; the real expo-sqlite API rejects a
  // promise. Wrap every call so synchronous SQLite errors (CHECK/UNIQUE
  // constraint violations etc.) surface as rejections here too, matching
  // the interface callers actually code against.
  return {
    async execAsync(source: string): Promise<void> {
      raw.exec(source);
    },

    async runAsync(source: string, params: SQLBindValue[] = []): Promise<RunResult> {
      const stmt = raw.prepare(source);
      const info = stmt.run(...toNodeSqliteParams(params));
      return {
        changes: Number(info.changes),
        lastInsertRowId: Number(info.lastInsertRowid),
      };
    },

    async getAllAsync<T>(source: string, params: SQLBindValue[] = []): Promise<T[]> {
      const stmt = raw.prepare(source);
      return stmt.all(...toNodeSqliteParams(params)) as T[];
    },

    async getFirstAsync<T>(source: string, params: SQLBindValue[] = []): Promise<T | null> {
      const stmt = raw.prepare(source);
      const row = stmt.get(...toNodeSqliteParams(params)) as T | undefined;
      return row ?? null;
    },
  };
}
