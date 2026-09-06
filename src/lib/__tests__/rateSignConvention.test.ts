// ═══════════════════════════════════════════════════════════════════════
// END-TO-END SIGN CHECK — task brief: "Write a test proving a cut goal
// produces a target BELOW TDEE."
//
// This exercises the exact path onboarding uses: a user declares a cut
// goal with a positive `rate_kg_per_week` (per engine/targets.ts's
// documented convention: positive = desired weekly LOSS magnitude), and
// asserts computeTargets, called with that profile, produces a target
// strictly below tdee — not above it, which is the bug this convention
// exists to prevent (see the comment block atop src/engine/targets.ts).
// ═══════════════════════════════════════════════════════════════════════

import { computeTargets } from '../../engine/targets';
import type { TDEEResult, UserProfile } from '../../engine/types';

function makeTDEEResult(tdee: number): TDEEResult {
  return {
    tdee,
    confidenceLow: tdee - 100,
    confidenceHigh: tdee + 100,
    trendKgPerWeek: -0.3,
    smoothedWeightKg: 80,
    dataQuality: 'stable',
    daysOfData: 30,
    loggedDaysInWindow: 28,
  };
}

describe('rate_kg_per_week sign convention (cut must lower the target)', () => {
  test('a cut goal (positive rate_kg_per_week) produces target_kcal BELOW tdee', () => {
    const tdeeResult = makeTDEEResult(2500);
    const cutProfile: UserProfile = {
      height_cm: 175,
      birth_year: 1994,
      sex: 'male',
      goal: 'cut',
      rate_kg_per_week: 0.5, // "I want to lose 0.5kg/week" — positive, per onboarding UX convention
      activity_seed: 'moderately_active',
      protein_override: null,
      units: 'metric',
    };

    const targets = computeTargets(tdeeResult, cutProfile);

    expect(targets.targetKcal).toBeLessThan(tdeeResult.tdee);
    // Sanity: the gap should roughly match the requested weekly deficit
    // (0.5 kg/week * 7700 kcal/kg / 7 days ≈ 550 kcal/day).
    expect(tdeeResult.tdee - targets.targetKcal).toBeCloseTo((0.5 * 7700) / 7, 5);
  });

  test('a gain goal (negative rate_kg_per_week) produces target_kcal ABOVE tdee', () => {
    const tdeeResult = makeTDEEResult(2500);
    const gainProfile: UserProfile = {
      height_cm: 175,
      birth_year: 1994,
      sex: 'male',
      goal: 'gain',
      rate_kg_per_week: -0.25, // "I want to gain 0.25kg/week" — negative in this convention
      activity_seed: 'moderately_active',
      protein_override: null,
      units: 'metric',
    };

    const targets = computeTargets(tdeeResult, gainProfile);
    expect(targets.targetKcal).toBeGreaterThan(tdeeResult.tdee);
  });

  test('maintenance (rate 0) leaves target_kcal equal to tdee', () => {
    const tdeeResult = makeTDEEResult(2500);
    const maintainProfile: UserProfile = {
      height_cm: 175,
      birth_year: 1994,
      sex: 'male',
      goal: 'maintain',
      rate_kg_per_week: 0,
      activity_seed: 'moderately_active',
      protein_override: null,
      units: 'metric',
    };

    const targets = computeTargets(tdeeResult, maintainProfile);
    expect(targets.targetKcal).toBeCloseTo(tdeeResult.tdee, 5);
  });

  test('getting the sign BACKWARDS (as trendKgPerWeek convention would) would raise the cut target — guard against regression', () => {
    // This test documents the failure mode explicitly: if a future change
    // accidentally fed rate_kg_per_week using TDEEResult.trendKgPerWeek's
    // convention (negative = losing) instead of the profile's own
    // convention (positive = losing), a cut would raise the target above
    // TDEE. Assert that does NOT happen with the current implementation.
    const tdeeResult = makeTDEEResult(2500);
    const cutProfile: UserProfile = {
      height_cm: 175,
      birth_year: 1994,
      sex: 'male',
      goal: 'cut',
      rate_kg_per_week: 0.5,
      activity_seed: 'moderately_active',
      protein_override: null,
      units: 'metric',
    };
    const targets = computeTargets(tdeeResult, cutProfile);
    const wouldBeBackwardsTarget = tdeeResult.tdee - -0.5 * (7700 / 7); // what you'd get with the flipped sign
    expect(targets.targetKcal).not.toBeCloseTo(wouldBeBackwardsTarget, 0);
    expect(targets.targetKcal).toBeLessThan(tdeeResult.tdee);
  });
});
