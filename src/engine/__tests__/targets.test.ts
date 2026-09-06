import { computeTargets } from '../targets';
import { makeProfile } from './testFixtures';
import type { TDEEResult } from '../types';

function makeTDEEResult(overrides: Partial<TDEEResult> = {}): TDEEResult {
  return {
    tdee: 2500,
    confidenceLow: 2400,
    confidenceHigh: 2600,
    trendKgPerWeek: -0.3,
    smoothedWeightKg: 80,
    dataQuality: 'stable',
    daysOfData: 30,
    loggedDaysInWindow: 28,
    ...overrides,
  };
}

describe('computeTargets — basic calculation', () => {
  test('target_kcal = TDEE - (rate_kg_per_week * 7700 / 7)', () => {
    const tdeeResult = makeTDEEResult({ tdee: 2500 });
    // rate_kg_per_week is signed positive-for-loss (see targets.ts note).
    const profile = makeProfile({ rate_kg_per_week: 0.5 });
    const targets = computeTargets(tdeeResult, profile);
    const expected = 2500 - (0.5 * 7700) / 7;
    expect(targets.targetKcal).toBeCloseTo(expected, 5);
    expect(targets.railReason).toBeNull();
  });
});

describe('computeTargets — safety rails', () => {
  test('deficit capped at 25% of TDEE, with a structured reason', () => {
    const tdeeResult = makeTDEEResult({ tdee: 2500 });
    // Requesting an aggressive 1.5 kg/week loss rate implies a deficit of
    // 1.5*7700/7 ≈ 1650 kcal/day, far above the 25% (625 kcal) cap.
    const profile = makeProfile({ rate_kg_per_week: 1.5 });
    const targets = computeTargets(tdeeResult, profile);

    expect(targets.railReason).not.toBeNull();
    expect(targets.railReason?.rail).toBe('deficit_cap');
    expect(targets.targetKcal).toBeCloseTo(2500 * 0.75, 5);
  });

  test('absolute floor for male at 1500 kcal', () => {
    const tdeeResult = makeTDEEResult({ tdee: 1600 });
    // 25% deficit cap allows down to 1200, but the 1500 floor should bind
    // first for a male profile.
    const profile = makeProfile({ sex: 'male', rate_kg_per_week: 2 });
    const targets = computeTargets(tdeeResult, profile);

    expect(targets.railReason).not.toBeNull();
    expect(targets.targetKcal).toBe(1500);
  });

  test('absolute floor for female at 1200 kcal', () => {
    const tdeeResult = makeTDEEResult({ tdee: 1400 });
    const profile = makeProfile({ sex: 'female', rate_kg_per_week: 2 });
    const targets = computeTargets(tdeeResult, profile);

    expect(targets.railReason).not.toBeNull();
    expect(targets.targetKcal).toBe(1200);
  });

  test('no rail binds for a modest maintenance target', () => {
    const tdeeResult = makeTDEEResult({ tdee: 2800 });
    const profile = makeProfile({ goal: 'maintain', rate_kg_per_week: 0 });
    const targets = computeTargets(tdeeResult, profile);
    expect(targets.railReason).toBeNull();
    expect(targets.targetKcal).toBeCloseTo(2800, 5);
  });
});

describe('computeTargets — macro allocation order (PRD §5)', () => {
  test('protein at 2.2 g/kg for a cut, off smoothed weight', () => {
    const tdeeResult = makeTDEEResult({ tdee: 2800, smoothedWeightKg: 80 });
    const profile = makeProfile({ goal: 'cut', rate_kg_per_week: 0.3 });
    const targets = computeTargets(tdeeResult, profile);
    expect(targets.proteinG).toBeCloseTo(2.2 * 80, 5);
  });

  test('protein at 1.6 g/kg for maintain/gain', () => {
    const tdeeResult = makeTDEEResult({ tdee: 2800, smoothedWeightKg: 80 });
    const maintainProfile = makeProfile({ goal: 'maintain', rate_kg_per_week: 0 });
    const gainProfile = makeProfile({ goal: 'gain', rate_kg_per_week: -0.2 });
    expect(computeTargets(tdeeResult, maintainProfile).proteinG).toBeCloseTo(1.6 * 80, 5);
    expect(computeTargets(tdeeResult, gainProfile).proteinG).toBeCloseTo(1.6 * 80, 5);
  });

  test('protein_override takes precedence over the computed g/kg value', () => {
    const tdeeResult = makeTDEEResult({ tdee: 2800, smoothedWeightKg: 80 });
    const profile = makeProfile({ goal: 'cut', protein_override: 190 });
    const targets = computeTargets(tdeeResult, profile);
    expect(targets.proteinG).toBe(190);
  });

  test('fat floor is 0.8 g/kg minimum', () => {
    const tdeeResult = makeTDEEResult({ tdee: 3200, smoothedWeightKg: 80 });
    const profile = makeProfile({ goal: 'maintain', rate_kg_per_week: 0 });
    const targets = computeTargets(tdeeResult, profile);
    expect(targets.fatG).toBeGreaterThanOrEqual(0.8 * 80 - 1e-6);
  });

  test('carbs absorb the remainder and everything sums back to targetKcal', () => {
    const tdeeResult = makeTDEEResult({ tdee: 2800, smoothedWeightKg: 80 });
    const profile = makeProfile({ goal: 'maintain', rate_kg_per_week: 0 });
    const targets = computeTargets(tdeeResult, profile);
    const totalKcal = targets.proteinG * 4 + targets.fatG * 9 + targets.carbsG * 4;
    expect(totalKcal).toBeCloseTo(targets.targetKcal, 3);
  });

  test('extremely low target still yields non-negative macros (no negative carbs)', () => {
    const tdeeResult = makeTDEEResult({ tdee: 1550, smoothedWeightKg: 120 });
    const profile = makeProfile({ sex: 'male', goal: 'cut', rate_kg_per_week: 1, protein_override: null });
    const targets = computeTargets(tdeeResult, profile);
    expect(targets.carbsG).toBeGreaterThanOrEqual(0);
    expect(targets.fatG).toBeGreaterThanOrEqual(0);
    expect(targets.proteinG).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(targets.carbsG)).toBe(false);
  });
});
