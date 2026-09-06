// ═══════════════════════════════════════════════════════════════════════
// CAPTURE JOB PERSISTENCE — the durable half of "survives the app being
// backgrounded or killed mid-flight" (task brief).
//
// Same additive-table pattern as src/lib/targetsStore.ts / src/lib/
// notifications/settingsStore.ts (`CREATE TABLE IF NOT EXISTS app_*`),
// since src/db/** is off-limits to modify for this task: this module owns
// its own tiny table via the same shared `Database` connection everything
// else in the app uses, and never touches src/db/migrations.ts's
// versioning.
//
// `input_json`/`entries_json` are stored as plain JSON text rather than
// normalized columns — a job's input shape varies by `kind` (see
// types.ts's discriminated union) and its entries are exactly the
// `PendingEntry[]` shape ConfirmSheet already round-trips as a unit
// elsewhere in this codebase, so there is no separate query need that
// would justify normalizing either one.
//
// Base64 payloads are deliberately NOT part of `input_json` — see
// types.ts's header for why only `uri`s are persisted. A crash report
// task brief item: "report whether it needs adding to
// src/lib/backup/snapshot.ts" — see this task's final report; in-flight
// scan jobs are not user data worth preserving across a restore (they
// reference on-device cache files that won't exist on a different
// device/reinstall), so this table is deliberately excluded there.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import type { PendingEntry } from '../pendingEntry';
import type { CaptureJob, CaptureJobInput, CaptureJobStatus } from './types';

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_capture_jobs (
  id            TEXT PRIMARY KEY,
  date          TEXT NOT NULL,
  status        TEXT NOT NULL,
  input_json    TEXT NOT NULL,
  entries_json  TEXT,
  error_message TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
`;

type JobRow = {
  id: string;
  date: string;
  status: string;
  input_json: string;
  entries_json: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
};

function rowToJob(row: JobRow): CaptureJob {
  return {
    id: row.id,
    date: row.date,
    status: row.status as CaptureJobStatus,
    input: JSON.parse(row.input_json) as CaptureJobInput,
    entries: row.entries_json ? (JSON.parse(row.entries_json) as PendingEntry[]) : undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

let ensuredTable = false;

async function ensureTable(db: Database): Promise<void> {
  if (ensuredTable) return;
  await db.execAsync(ENSURE_TABLE_SQL);
  ensuredTable = true;
}

/** All persisted jobs, in no particular order — callers sort as needed (the in-memory store sorts by `createdAt`). */
export async function listJobs(db: Database): Promise<CaptureJob[]> {
  await ensureTable(db);
  const rows = await db.getAllAsync<JobRow>('SELECT * FROM app_capture_jobs');
  return rows.map(rowToJob);
}

/** Insert-or-replace a job's full current state. Called on every transition (submit, done, error, retry) so a kill at any point leaves at most one job's worth of work stale, never the whole queue. */
export async function upsertJob(db: Database, job: CaptureJob): Promise<void> {
  await ensureTable(db);
  await db.runAsync(
    `INSERT INTO app_capture_jobs (id, date, status, input_json, entries_json, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       date = excluded.date,
       status = excluded.status,
       input_json = excluded.input_json,
       entries_json = excluded.entries_json,
       error_message = excluded.error_message,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
    [
      job.id,
      job.date,
      job.status,
      JSON.stringify(job.input),
      job.entries ? JSON.stringify(job.entries) : null,
      job.errorMessage ?? null,
      job.createdAt,
      job.updatedAt,
    ]
  );
}

/** Removes a job once it's been confirmed or discarded via the ConfirmSheet — it is no longer awaiting anything, so there is nothing left to survive a restart for. */
export async function deleteJob(db: Database, id: string): Promise<void> {
  await ensureTable(db);
  await db.runAsync('DELETE FROM app_capture_jobs WHERE id = ?', [id]);
}

/** Test-only: forget the "table ensured" cache so tests against fresh in-memory DBs re-create it. */
export function resetCaptureJobsPersistenceForTesting(): void {
  ensuredTable = false;
}
