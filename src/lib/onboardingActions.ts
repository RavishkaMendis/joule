// ═══════════════════════════════════════════════════════════════════════
// ONBOARDING ACTIONS — PRD §9.5.
//
// Writes `user_profile`, the first weight reading, household prefs, and
// — see below — a PROVISIONAL target seeded from the cold-start estimate.
//
// ─── Why onboarding now writes a target (changed 2026-08-28) ───
//
// It originally wrote none, on the reading that PRD §9.3's "this is the
// only screen that changes targets" meant the check-in is the only writer
// at all. In real use that left the user with NO calorie target for their
// first three days (the check-in banner is gated on 3+ logged days), while
// the Today screen simultaneously displayed a perfectly good cold-start
// TDEE of ~2,343 kcal. A tracker whose headline number is absent on day
// one fails its basic job, and the user asked why it was missing.
//
// The rule §5 actually states is "recalculated ONLY at the weekly
// check-in. Never daily." That exists to stop targets DRIFTING day to day
// as the estimate wobbles — not to withhold a starting number. Seeding one
// provisional target once, at onboarding, and then never touching it again
// until a check-in accepts a new one, honours that rule exactly: there is
// still precisely one number, and it still only changes at a check-in.
//
// It is written with an explicit provisional week label so the UI can say
// where it came from. PRD §4.3 is emphatic that cold-start numbers must be
// labelled "Estimated — collecting data" and never dressed up as measured;
// the same honesty applies to a target derived from that estimate.
//
// `who_cooks` (PRD §9.5: "Ends by asking who cooks — used to frame
// pot-logging prompts") has no column in user_profile (PRD §3's schema is
// intentionally left untouched by this task). It's stored alongside the
// target snapshot's home — a tiny additive table here, following the same
// pattern targetsStore.ts uses for app_target_snapshot, since src/db/** is
// off-limits to modify.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../db/database';
import type { DayIntake, UserProfile, WeightLog } from '../engine/types';
import { computeTDEE } from '../engine/tdee';
import { computeTargets } from '../engine/targets';
import * as profileRepo from '../db/repositories/profileRepo';
import * as weightRepo from '../db/repositories/weightRepo';
import { getAcceptedTargets, saveAcceptedTargets } from './targetsStore';

/**
 * Week label stamped on the onboarding-seeded target so the UI can show
 * it is an estimate, not a measured result (PRD §4.3 — never pretend a
 * cold-start number is measured).
 */
export const PROVISIONAL_TARGET_LABEL = 'Provisional — from your starting estimate';

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_household_prefs (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  who_cooks   TEXT NOT NULL,
  meals_per_day INTEGER
);
`;

export type WhoCooks = 'me' | 'partner' | 'both' | 'other';

let ensuredTable = false;

async function ensureTable(db: Database): Promise<void> {
  if (ensuredTable) return;
  await db.execAsync(ENSURE_TABLE_SQL);
  ensuredTable = true;
}

export type OnboardingInput = {
  height_cm: number;
  birth_year: number;
  sex: UserProfile['sex'];
  currentWeightKg: number;
  goal: UserProfile['goal'];
  /** Positive = desired weekly loss magnitude, even for a cut (see engine/targets.ts sign convention). */
  rateKgPerWeek: number;
  activity_seed: UserProfile['activity_seed'];
  mealsPerDay: number;
  whoCooks: WhoCooks;
};

/**
 * Persist onboarding answers: the `user_profile` row plus today's first
 * weight reading (current weight — PRD §9.5 asks for it explicitly, and
 * without a first weight_log row the cold-start seed has no mass term
 * other than the 70kg placeholder, see coldstart.ts) and the household
 * "who cooks" preference. Does not touch targets.
 */
export async function completeOnboarding(
  db: Database,
  input: OnboardingInput,
  todayISO: string
): Promise<void> {
  await ensureTable(db);

  await profileRepo.upsertProfile(db, {
    height_cm: input.height_cm,
    birth_year: input.birth_year,
    sex: input.sex,
    goal: input.goal,
    rate_kg_per_week: input.rateKgPerWeek,
    activity_seed: input.activity_seed,
    protein_override: null,
    units: 'metric',
  });

  const existing = await weightRepo.getByDate(db, todayISO);
  if (!existing) {
    await weightRepo.upsertWeight(db, {
      date: todayISO,
      weight_kg: input.currentWeightKg,
      confounder: null,
      source: 'manual',
    });
  }

  await db.runAsync(
    `INSERT INTO app_household_prefs (id, who_cooks, meals_per_day)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       who_cooks = excluded.who_cooks,
       meals_per_day = excluded.meals_per_day`,
    [input.whoCooks, input.mealsPerDay]
  );

  await seedProvisionalTarget(db, input, todayISO);
}

/**
 * Seeds the first target from the cold-start estimate so the user has a
 * number on day one (see the header for why this does not violate §5).
 *
 * Only ever seeds when no target exists. Re-running onboarding from
 * Settings to edit answers must NOT clobber a target the user has since
 * accepted at a real weekly check-in — that would silently discard a
 * measured result in favour of a Mifflin guess, which is precisely
 * backwards.
 */
async function seedProvisionalTarget(
  db: Database,
  input: OnboardingInput,
  todayISO: string
): Promise<void> {
  const existingTargets = await getAcceptedTargets(db);
  if (existingTargets) return;

  const profile: UserProfile = {
    height_cm: input.height_cm,
    birth_year: input.birth_year,
    sex: input.sex,
    goal: input.goal,
    rate_kg_per_week: input.rateKgPerWeek,
    activity_seed: input.activity_seed,
    protein_override: null,
    units: 'metric',
  };

  // One weight reading, no intake history — computeTDEE's cold-start
  // branch (PRD §4.3) returns the Mifflin seed with a wide band and
  // dataQuality 'seeding'. That is exactly the honest basis for a
  // provisional target.
  const weights: WeightLog[] = [{ date: todayISO, weight_kg: input.currentWeightKg, confounder: null }];
  const intake: DayIntake[] = [];

  const tdee = computeTDEE(intake, weights, profile);
  const targets = computeTargets(tdee, profile);

  await saveAcceptedTargets(db, targets, { weekLabel: PROVISIONAL_TARGET_LABEL });
}

export type HouseholdPrefs = {
  whoCooks: WhoCooks;
  mealsPerDay: number | null;
};

export async function getHouseholdPrefs(db: Database): Promise<HouseholdPrefs | null> {
  await ensureTable(db);
  const row = await db.getFirstAsync<{ who_cooks: WhoCooks; meals_per_day: number | null }>(
    'SELECT who_cooks, meals_per_day FROM app_household_prefs WHERE id = 1'
  );
  if (!row) return null;
  return { whoCooks: row.who_cooks, mealsPerDay: row.meals_per_day };
}

/** Test-only: forget the "table ensured" cache. */
export function resetOnboardingStoreForTesting(): void {
  ensuredTable = false;
}
