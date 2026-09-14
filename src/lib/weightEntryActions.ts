// ═══════════════════════════════════════════════════════════════════════
// WEIGHT ENTRY ACTIONS — PRD §9.6.
//
// One number, plus an optional one-tap confounder chip. Confounders are
// framed as making the reading *more* useful, not a confession (PRD §9.6,
// CLAUDE.md) — see the labels in src/components/ConfounderChips.tsx.
//
// Also the one hook point for the morning weigh-in reminder's "already
// weighed today, skip it" behaviour (CLAUDE.md, morning-reminder task):
// every successful save reconciles the reminder schedule, but
// reconcileAfterWeightLogged itself is a no-op unless `date` is today —
// backfilling or editing a past day's weight must never touch today's
// reminder state. See src/lib/notifications/reminderActions.ts for why
// this is implemented as "cancel + reschedule the daily trigger" rather
// than a fragile one-shot.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../db/database';
import type { Confounder } from '../engine/types';
import * as weightRepo from '../db/repositories/weightRepo';
import { reconcileAfterWeightLogged } from './notifications/reminderActions';

export async function logWeight(
  db: Database,
  date: string,
  weightKg: number,
  confounder: Confounder | null = null
): Promise<void> {
  await weightRepo.upsertWeight(db, { date, weight_kg: weightKg, confounder, source: 'manual' });
  await reconcileAfterWeightLogged(db, date);
}

/**
 * Display text + accessibility label for the permanent weight control on
 * Today (StatusBlock) — one number, formatted consistently with the rest
 * of the app's `numeric` figures, or a neutral (never guilt-toned)
 * invitation when nothing is logged yet for the day being shown. Kept as
 * a pure function, same reasoning as `computeMacroProgress`: the "what to
 * show" decision is trivial to get subtly wrong (e.g. reading a missing
 * weight as "0 kg") and cheap to unit test in isolation from any
 * rendering.
 */
export function formatWeightRow(weightKg: number | null): { value: string; a11yLabel: string } {
  if (weightKg === null) {
    return { value: 'Not logged', a11yLabel: 'Weight not logged. Tap to log.' };
  }
  const value = `${weightKg} kg`;
  return { value, a11yLabel: `Weight ${value}. Tap to update.` };
}
