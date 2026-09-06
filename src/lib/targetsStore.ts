// ═══════════════════════════════════════════════════════════════════════
// TARGETS STORE — the single place accepted calorie/macro targets live.
//
// PRD §5 / §9.3, and the single most important wiring constraint for this
// wave: "Targets change only at the weekly check-in ... no other screen
// may write them." Today must be able to *display* the last-accepted
// target without ever recomputing or persisting a new one itself.
//
// There is deliberately no `targets` table in src/db/schema.ts (§3's core
// four tables don't include one — targets are meant to be derived from
// TDEEResult + UserProfile, not stored as engine state). Since this task
// is scoped to leave src/db/** untouched, this module owns its own tiny
// additive table (`app_target_snapshot`) via `CREATE TABLE IF NOT EXISTS`,
// using the same `Database` connection everything else in the app shares
// (see src/lib/db.ts). It does not touch, import from, or duplicate
// src/db/migrations.ts's versioning — it just guarantees its own table
// exists before it's used, which is idempotent and safe to call every
// app start alongside the real migration runner.
//
// Whoever builds the weekly check-in screen (next wave) is the only
// caller expected to invoke `saveAcceptedTargets`. Today (this wave) only
// ever calls `getAcceptedTargets` — read-only.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../db/database';
import type { RailReason, TargetResult } from '../engine/targets';

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_target_snapshot (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  target_kcal       REAL NOT NULL,
  protein_g         REAL NOT NULL,
  fat_g             REAL NOT NULL,
  carbs_g           REAL NOT NULL,
  rail_reason_json  TEXT,
  accepted_at       INTEGER NOT NULL,
  week_label        TEXT
);
`;

export type StoredTargets = TargetResult & {
  acceptedAt: number;
  weekLabel: string | null;
};

type SnapshotRow = {
  id: 1;
  target_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  rail_reason_json: string | null;
  accepted_at: number;
  week_label: string | null;
};

let ensuredTable = false;

async function ensureTable(db: Database): Promise<void> {
  if (ensuredTable) return;
  await db.execAsync(ENSURE_TABLE_SQL);
  ensuredTable = true;
}

/**
 * Read the last-accepted target snapshot, or null if the user has never
 * been through a weekly check-in yet (e.g. brand-new install / onboarding
 * not finished — the next wave's onboarding flow is expected to write an
 * initial snapshot too).
 */
export async function getAcceptedTargets(db: Database): Promise<StoredTargets | null> {
  await ensureTable(db);
  const row = await db.getFirstAsync<SnapshotRow>('SELECT * FROM app_target_snapshot WHERE id = 1');
  if (!row) return null;
  return {
    targetKcal: row.target_kcal,
    proteinG: row.protein_g,
    fatG: row.fat_g,
    carbsG: row.carbs_g,
    railReason: row.rail_reason_json ? (JSON.parse(row.rail_reason_json) as RailReason) : null,
    acceptedAt: row.accepted_at,
    weekLabel: row.week_label,
  };
}

/**
 * Persist a newly-accepted target snapshot. This is the ONLY write path
 * for targets in the whole app — PRD §9.3: "This is the only screen that
 * changes targets." Today (and every other screen this wave builds) must
 * never call this.
 */
export async function saveAcceptedTargets(
  db: Database,
  targets: TargetResult,
  opts: { acceptedAt?: number; weekLabel?: string | null } = {}
): Promise<StoredTargets> {
  await ensureTable(db);
  const acceptedAt = opts.acceptedAt ?? Date.now();
  const weekLabel = opts.weekLabel ?? null;

  await db.runAsync(
    `INSERT INTO app_target_snapshot (id, target_kcal, protein_g, fat_g, carbs_g, rail_reason_json, accepted_at, week_label)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       target_kcal = excluded.target_kcal,
       protein_g = excluded.protein_g,
       fat_g = excluded.fat_g,
       carbs_g = excluded.carbs_g,
       rail_reason_json = excluded.rail_reason_json,
       accepted_at = excluded.accepted_at,
       week_label = excluded.week_label`,
    [
      targets.targetKcal,
      targets.proteinG,
      targets.fatG,
      targets.carbsG,
      targets.railReason ? JSON.stringify(targets.railReason) : null,
      acceptedAt,
      weekLabel,
    ]
  );

  const saved = await getAcceptedTargets(db);
  if (!saved) throw new Error('saveAcceptedTargets: failed to read back snapshot');
  return saved;
}

/** Test-only: forget the "table ensured" cache so tests against fresh in-memory DBs re-create it. */
export function resetTargetsStoreForTesting(): void {
  ensuredTable = false;
}
