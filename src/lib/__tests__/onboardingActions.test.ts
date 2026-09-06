import { createTestDatabase } from '../../db/__tests__/testDb';
import { runMigrations } from '../../db/migrations';
import * as profileRepo from '../../db/repositories/profileRepo';
import * as weightRepo from '../../db/repositories/weightRepo';
import {
  completeOnboarding,
  getHouseholdPrefs,
  PROVISIONAL_TARGET_LABEL,
  resetOnboardingStoreForTesting,
} from '../onboardingActions';
import { resetTargetsStoreForTesting, getAcceptedTargets, saveAcceptedTargets } from '../targetsStore';

describe('completeOnboarding', () => {
  beforeEach(() => {
    resetOnboardingStoreForTesting();
    resetTargetsStoreForTesting();
  });

  test('writes the user_profile row with the fields onboarding collected', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await completeOnboarding(
      db,
      {
        height_cm: 178,
        birth_year: 1990,
        sex: 'male',
        currentWeightKg: 82.4,
        goal: 'cut',
        rateKgPerWeek: 0.5,
        activity_seed: 'lightly_active',
        mealsPerDay: 3,
        whoCooks: 'both',
      },
      '2026-08-26'
    );

    const profile = await profileRepo.getProfile(db);
    expect(profile).not.toBeNull();
    expect(profile?.height_cm).toBe(178);
    expect(profile?.birth_year).toBe(1990);
    expect(profile?.sex).toBe('male');
    expect(profile?.goal).toBe('cut');
    expect(profile?.rate_kg_per_week).toBe(0.5);
    expect(profile?.activity_seed).toBe('lightly_active');
  });

  test('writes an initial weight_log reading for today from "current weight"', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await completeOnboarding(
      db,
      {
        height_cm: 165,
        birth_year: 1995,
        sex: 'female',
        currentWeightKg: 63.2,
        goal: 'maintain',
        rateKgPerWeek: 0,
        activity_seed: 'sedentary',
        mealsPerDay: 4,
        whoCooks: 'me',
      },
      '2026-08-26'
    );

    const reading = await weightRepo.getByDate(db, '2026-08-26');
    expect(reading).not.toBeNull();
    expect(reading?.weight_kg).toBe(63.2);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Provisional target seeding.
  //
  // This previously asserted onboarding wrote NO target, reading PRD
  // §9.3's "the only screen that changes targets" as "the check-in is the
  // sole writer". Changed 2026-08-28 after real use: that left the user
  // with no calorie target for their first three days (the check-in
  // banner needs 3+ logged days) while Today already displayed a usable
  // cold-start TDEE. §5's actual rule is "recalculated only at the weekly
  // check-in. Never daily." — which forbids drift, not a starting number.
  // See onboardingActions.ts's header for the full reasoning.
  // ─────────────────────────────────────────────────────────────────────

  const ONBOARDING_INPUT = {
    height_cm: 170,
    birth_year: 1988,
    sex: 'male' as const,
    currentWeightKg: 90,
    goal: 'cut' as const,
    rateKgPerWeek: 0.5,
    activity_seed: 'moderately_active' as const,
    mealsPerDay: 3,
    whoCooks: 'partner' as const,
  };

  test('seeds a provisional target from the cold-start estimate so day one has a number', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await completeOnboarding(db, ONBOARDING_INPUT, '2026-08-26');

    const targets = await getAcceptedTargets(db);
    expect(targets).not.toBeNull();
    expect(targets!.targetKcal).toBeGreaterThan(0);
    expect(targets!.proteinG).toBeGreaterThan(0);
    // Labelled as an estimate, never dressed up as measured (PRD §4.3).
    expect(targets!.weekLabel).toBe(PROVISIONAL_TARGET_LABEL);
  });

  test('re-running onboarding does NOT clobber a target already accepted at a check-in', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await completeOnboarding(db, ONBOARDING_INPUT, '2026-08-26');

    // Simulate a real weekly check-in accepting a measured target.
    const seeded = await getAcceptedTargets(db);
    await saveAcceptedTargets(db, { ...seeded!, targetKcal: 2100 }, { weekLabel: 'Week 3' });

    // Editing onboarding answers later from Settings must not silently
    // discard a measured result in favour of a Mifflin guess.
    await completeOnboarding(db, ONBOARDING_INPUT, '2026-08-27');

    const after = await getAcceptedTargets(db);
    expect(after!.targetKcal).toBe(2100);
    expect(after!.weekLabel).toBe('Week 3');
  });

  test('stores who-cooks preference, readable back via getHouseholdPrefs', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await completeOnboarding(
      db,
      {
        height_cm: 170,
        birth_year: 1988,
        sex: 'male',
        currentWeightKg: 90,
        goal: 'cut',
        rateKgPerWeek: 0.5,
        activity_seed: 'moderately_active',
        mealsPerDay: 3,
        whoCooks: 'partner',
      },
      '2026-08-26'
    );

    const prefs = await getHouseholdPrefs(db);
    expect(prefs?.whoCooks).toBe('partner');
    expect(prefs?.mealsPerDay).toBe(3);
  });

  test('re-running onboarding (editable later in settings, PRD §9.5) upserts rather than duplicating', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    const base = {
      height_cm: 170,
      birth_year: 1988,
      sex: 'male' as const,
      currentWeightKg: 90,
      goal: 'cut' as const,
      rateKgPerWeek: 0.5,
      activity_seed: 'moderately_active' as const,
      mealsPerDay: 3,
      whoCooks: 'partner' as const,
    };
    await completeOnboarding(db, base, '2026-08-26');
    await completeOnboarding(db, { ...base, height_cm: 171, mealsPerDay: 4 }, '2026-08-27');

    const profile = await profileRepo.getProfile(db);
    expect(profile?.height_cm).toBe(171);
    const prefs = await getHouseholdPrefs(db);
    expect(prefs?.mealsPerDay).toBe(4);
  });
});
