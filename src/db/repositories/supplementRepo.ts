// ═══════════════════════════════════════════════════════════════════════
// supplementRepo — CRUD on `supplement` and `supplement_log` (schema v5,
// PRD §3 stub built out for real — task brief "Feature 1 — Supplements").
//
// Two tables, two responsibilities:
//   supplement      — the regimen: what the user takes, how much, how
//                      often. Editable forever, archivable, deletable.
//   supplement_log  — adherence: did a dose happen on a given day. One
//                      row per (supplement_id, date) — see schema.ts's v5
//                      header for why this is boolean-per-day rather than
//                      a multi-dose ledger. logDose/unlogDose are the
//                      toggle a "due today" checklist tap drives.
//
// Neither table is read by src/engine/** — see schema.ts's v5 header for
// the full architectural-wall rationale (mirrors external_estimate and
// the v4 training tables).
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { SupplementRow, SupplementLogRow } from '../types';

export type NewSupplement = {
  id: string;
  name: string;
  dose: string;
  /** JSON-encoded ScheduleSpec — callers should build this via src/lib/supplements/schedule.ts's `serializeSchedule`, not hand-roll JSON here. */
  schedule: string;
  kcal?: number;
  protein_g?: number;
  unit?: string | null;
  notes?: string | null;
  created_at: number;
};

export async function addSupplement(db: Database, input: NewSupplement): Promise<SupplementRow> {
  await db.runAsync(
    `INSERT INTO supplement (id, name, dose, schedule, kcal, protein_g, unit, notes, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      input.id,
      input.name,
      input.dose,
      input.schedule,
      input.kcal ?? 0,
      input.protein_g ?? 0,
      input.unit ?? null,
      input.notes ?? null,
      input.created_at,
    ]
  );
  const row = await getSupplement(db, input.id);
  if (!row) throw new Error(`addSupplement: failed to read back supplement ${input.id}`);
  return row;
}

export async function getSupplement(db: Database, id: string): Promise<SupplementRow | null> {
  return db.getFirstAsync<SupplementRow>('SELECT * FROM supplement WHERE id = ?', [id]);
}

export type SupplementPatch = Partial<
  Pick<NewSupplement, 'name' | 'dose' | 'schedule' | 'kcal' | 'protein_g' | 'unit' | 'notes'>
>;

/** Partial update — every field the "edit supplement" form can change. Does not touch is_active; use setActive for that. */
export async function updateSupplement(db: Database, id: string, patch: SupplementPatch): Promise<SupplementRow> {
  const existing = await getSupplement(db, id);
  if (!existing) throw new Error(`updateSupplement: no supplement with id ${id}`);

  // Built field-by-field (never `{...existing, ...patch}`): a caller that
  // constructs `patch` as an object literal with every key present but
  // some values `undefined` (this codebase's existing convention — see
  // foodEntryActions.editFoodEntry) would otherwise have those explicit
  // `undefined`s spread OVER existing's real values, corrupting the row
  // and then failing to bind at the SQL layer below.
  const merged: SupplementRow = {
    ...existing,
    name: patch.name !== undefined ? patch.name : existing.name,
    dose: patch.dose !== undefined ? patch.dose : existing.dose,
    schedule: patch.schedule !== undefined ? patch.schedule : existing.schedule,
    kcal: patch.kcal !== undefined ? patch.kcal : existing.kcal,
    protein_g: patch.protein_g !== undefined ? patch.protein_g : existing.protein_g,
    unit: patch.unit !== undefined ? patch.unit : existing.unit,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
  };

  await db.runAsync(
    `UPDATE supplement SET name = ?, dose = ?, schedule = ?, kcal = ?, protein_g = ?, unit = ?, notes = ? WHERE id = ?`,
    [merged.name, merged.dose, merged.schedule, merged.kcal, merged.protein_g, merged.unit, merged.notes, id]
  );

  const row = await getSupplement(db, id);
  if (!row) throw new Error(`updateSupplement: failed to read back supplement ${id}`);
  return row;
}

/** Archive (is_active = 0) or reactivate (is_active = 1) — the "I stopped taking this" path that keeps supplement_log history meaningful, unlike deleteSupplement. */
export async function setActive(db: Database, id: string, active: boolean): Promise<void> {
  await db.runAsync('UPDATE supplement SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
}

/**
 * Hard delete — the supplement row AND every supplement_log row that
 * references it (no DB-level cascade exists, see schema.ts's v5 header
 * for why supplement_log.supplement_id has no REFERENCES clause; this
 * repo does the cleanup at the app layer instead). Use `setActive(db, id,
 * false)` instead when the intent is "I stopped taking this" and past
 * adherence should stay visible.
 */
export async function deleteSupplement(db: Database, id: string): Promise<void> {
  await db.runAsync('DELETE FROM supplement_log WHERE supplement_id = ?', [id]);
  await db.runAsync('DELETE FROM supplement WHERE id = ?', [id]);
}

/** Active supplements only, most-recently-added first (index-only via idx_supplement_is_active). */
export async function listActive(db: Database): Promise<SupplementRow[]> {
  return db.getAllAsync<SupplementRow>(
    'SELECT * FROM supplement WHERE is_active = 1 ORDER BY created_at DESC, name ASC'
  );
}

/** Every supplement, active or archived — the "manage supplements" screen needs to show and reactivate archived ones. */
export async function listAll(db: Database): Promise<SupplementRow[]> {
  return db.getAllAsync<SupplementRow>('SELECT * FROM supplement ORDER BY is_active DESC, created_at DESC, name ASC');
}

// ─── supplement_log (adherence) ────────────────────────────────────────

/**
 * Mark a dose taken for `date` (upsert by (supplement_id, date) — tapping
 * an already-logged item again just refreshes `logged_at`, never
 * duplicates). Returns the resulting row.
 */
export async function logDose(
  db: Database,
  id: string,
  supplementId: string,
  date: string,
  loggedAt: number = Date.now()
): Promise<SupplementLogRow> {
  await db.runAsync(
    `INSERT INTO supplement_log (id, supplement_id, date, logged_at, food_entry_id)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(supplement_id, date) DO UPDATE SET logged_at = excluded.logged_at`,
    [id, supplementId, date, loggedAt]
  );
  const row = await getLog(db, supplementId, date);
  if (!row) throw new Error(`logDose: failed to read back supplement_log for ${supplementId}/${date}`);
  return row;
}

/** Un-mark a dose for `date` (the checklist "tap again to undo" path — PRD §10: this is a neutral toggle, not an admission of failure). No-op if nothing was logged. */
export async function unlogDose(db: Database, supplementId: string, date: string): Promise<void> {
  await db.runAsync('DELETE FROM supplement_log WHERE supplement_id = ? AND date = ?', [supplementId, date]);
}

export async function getLog(db: Database, supplementId: string, date: string): Promise<SupplementLogRow | null> {
  return db.getFirstAsync<SupplementLogRow>(
    'SELECT * FROM supplement_log WHERE supplement_id = ? AND date = ?',
    [supplementId, date]
  );
}

/** Every log row for one date, across all supplements — what dueToday.ts's buildDueTodayList needs to know "logged" status for. */
export async function getLogsForDate(db: Database, date: string): Promise<SupplementLogRow[]> {
  return db.getAllAsync<SupplementLogRow>('SELECT * FROM supplement_log WHERE date = ?', [date]);
}

/** Every log row for one supplement in [startDate, endDate] — for a factual (never scored) adherence display, if one is ever built. */
export async function getLogsForSupplement(
  db: Database,
  supplementId: string,
  startDate: string,
  endDate: string
): Promise<SupplementLogRow[]> {
  return db.getAllAsync<SupplementLogRow>(
    'SELECT * FROM supplement_log WHERE supplement_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
    [supplementId, startDate, endDate]
  );
}

/** Link an existing log row to the food_entry created by "log as food too" (supplementActions.logDoseAndFood — never called implicitly). */
export async function attachFoodEntry(
  db: Database,
  supplementId: string,
  date: string,
  foodEntryId: string
): Promise<void> {
  await db.runAsync(
    'UPDATE supplement_log SET food_entry_id = ? WHERE supplement_id = ? AND date = ?',
    [foodEntryId, supplementId, date]
  );
}
