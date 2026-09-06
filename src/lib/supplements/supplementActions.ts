// ═══════════════════════════════════════════════════════════════════════
// SUPPLEMENT ACTIONS — thin, testable orchestration over supplementRepo.
//
// Mirrors foodEntryActions.ts / potActions.ts's pattern: ID generation and
// "what happens when you tap X" logic lives here, out of components.
//
// ⚠️ logDoseAndFood is the ONE place a supplement's calories/protein can
// reach `food_entry` (and therefore `day_intake` and the TDEE engine's
// input window). It is a SEPARATE, explicit call from logDose — ticking a
// supplement off the due-today list (logDose) NEVER writes food_entry by
// itself, no matter what kcal/protein_g the supplement has stored.
//
// Why: PRD §3's engine input wall treats day_intake as measured truth,
// and CLAUDE.md is explicit that "missing data is never imputed" — the
// inverse failure mode is just as real: a value entering the engine's
// window that the user never actively confirmed on that day. A creatine
// scoop taken automatically every morning, silently adding 20 kcal /
// 0 protein_g to day_intake every single day forever, is a standing
// distortion the user never gets a chance to see, confirm, or later
// blame for a target that stops matching reality. Logging the dose (an
// adherence fact) and logging the food (an intake fact) are kept as two
// separate taps so the second one always has "a human beat before save"
// — exactly the same rule PRD §3 already applies to every one of the five
// capture input paths via ConfirmSheet. logDoseAndFood reuses
// foodEntryActions.logManualEntry (the same function FoodEntryScreen's
// own manual-entry path calls) rather than writing food_entry directly,
// so a supplement-sourced entry is indistinguishable, at the food_entry
// level, from any other manually-confirmed entry — same table, same
// invariants, same edit/delete path.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import type { SupplementRow, SupplementLogRow, FoodEntryRow } from '../../db/types';
import * as supplementRepo from '../../db/repositories/supplementRepo';
import { logManualEntry } from '../foodEntryActions';
import { generateId } from '../ids';
import { serializeSchedule, type ScheduleSpec } from './schedule';

export type NewSupplementInput = {
  name: string;
  dose: string;
  unit?: string | null;
  schedule: ScheduleSpec;
  kcal?: number;
  protein_g?: number;
  notes?: string | null;
};

export async function createSupplement(
  db: Database,
  input: NewSupplementInput,
  createdAt: number = Date.now()
): Promise<SupplementRow> {
  return supplementRepo.addSupplement(db, {
    id: generateId('supp'),
    name: input.name,
    dose: input.dose,
    unit: input.unit ?? null,
    schedule: serializeSchedule(input.schedule),
    kcal: input.kcal ?? 0,
    protein_g: input.protein_g ?? 0,
    notes: input.notes ?? null,
    created_at: createdAt,
  });
}

export type SupplementEditInput = Partial<Omit<NewSupplementInput, 'schedule'>> & {
  schedule?: ScheduleSpec;
};

export async function updateSupplement(
  db: Database,
  id: string,
  patch: SupplementEditInput
): Promise<SupplementRow> {
  return supplementRepo.updateSupplement(db, id, {
    name: patch.name,
    dose: patch.dose,
    unit: patch.unit,
    schedule: patch.schedule ? serializeSchedule(patch.schedule) : undefined,
    kcal: patch.kcal,
    protein_g: patch.protein_g,
    notes: patch.notes,
  });
}

export async function archiveSupplement(db: Database, id: string): Promise<void> {
  await supplementRepo.setActive(db, id, false);
}

export async function reactivateSupplement(db: Database, id: string): Promise<void> {
  await supplementRepo.setActive(db, id, true);
}

export async function deleteSupplement(db: Database, id: string): Promise<void> {
  await supplementRepo.deleteSupplement(db, id);
}

/**
 * Toggle a dose for `date`: logs it if not yet logged, un-logs it if it
 * is. Returns the new logged state. This is the single call the
 * due-today checklist's tap drives — deliberately a plain toggle with no
 * side effect on food_entry (see file header).
 */
export async function toggleDose(
  db: Database,
  supplementId: string,
  date: string,
  loggedAt: number = Date.now()
): Promise<{ logged: boolean }> {
  const existing = await supplementRepo.getLog(db, supplementId, date);
  if (existing) {
    await supplementRepo.unlogDose(db, supplementId, date);
    return { logged: false };
  }
  await supplementRepo.logDose(db, generateId('supplog'), supplementId, date, loggedAt);
  return { logged: true };
}

/**
 * Explicitly log this dose's calories/protein into food_entry too — a
 * SEPARATE confirmed action from toggleDose (see file header). Ensures a
 * supplement_log row exists for `date` first (a user might tap "also log
 * as food" for an as-needed supplement it hasn't logged a dose for yet),
 * then writes one food_entry via the normal manual-entry path and links
 * it back for reference.
 *
 * Callers should only offer this when the supplement actually has
 * kcal > 0 or protein_g > 0 — nothing here enforces that, since a user
 * could conceivably want a zero-macro placeholder entry for their own
 * record-keeping and this module has no opinion on that.
 */
export async function logDoseAndFood(
  db: Database,
  supplement: SupplementRow,
  date: string,
  loggedAt: number = Date.now()
): Promise<{ log: SupplementLogRow; entry: FoodEntryRow }> {
  const existingLog = await supplementRepo.getLog(db, supplement.id, date);
  const log = existingLog ?? (await supplementRepo.logDose(db, generateId('supplog'), supplement.id, date, loggedAt));

  const { entry } = await logManualEntry(
    db,
    {
      date,
      name: supplement.name,
      grams: 0,
      kcal: supplement.kcal,
      protein_g: supplement.protein_g,
      carbs_g: 0,
      fat_g: 0,
      source: 'manual',
      // The user is explicitly confirming these exact numbers right now
      // (they're reading them off the supplement label into this app's
      // own regimen entry) — 'exact', not a lower rung on the confidence
      // ladder reserved for estimates (PRD §10).
      confidence: 'exact',
    },
    loggedAt
  );

  await supplementRepo.attachFoodEntry(db, supplement.id, date, entry.id);

  return { log, entry };
}
