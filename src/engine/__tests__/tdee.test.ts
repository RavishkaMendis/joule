import { computeTDEE } from '../tdee';
import { weightedLinearRegression, weightedMean, recencyWeight } from '../tdee';
import { runKalmanFilter } from '../kalman';
import { makeProfile, makeIntakeDay, makeWeightDay } from './testFixtures';
import type { DayIntake, WeightLog } from '../types';

/** Build a run of N days starting at `startDate`, losing `kgPerDay` with intake `kcal`. */
function buildLosingSeries(
  startDate: string,
  days: number,
  startWeight: number,
  kgPerDay: number,
  kcal: number
): { intake: DayIntake[]; weights: WeightLog[] } {
  const intake: DayIntake[] = [];
  const weights: WeightLog[] = [];
  const start = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    weights.push(makeWeightDay(iso, startWeight - kgPerDay * i));
    intake.push(makeIntakeDay(iso, { kcal }));
  }
  return { intake, weights };
}

describe('computeTDEE — sign check (PRD §4.2)', () => {
  test('losing weight (negative slope) yields TDEE > mean intake', () => {
    const { intake, weights } = buildLosingSeries('2024-01-01', 25, 85, 0.05, 2200);
    const profile = makeProfile();
    const result = computeTDEE(intake, weights, profile);

    expect(result.trendKgPerWeek).toBeLessThan(0);
    expect(result.tdee).toBeGreaterThan(2200);
  });

  test('gaining weight (positive slope) yields TDEE < mean intake', () => {
    const { intake, weights } = buildLosingSeries('2024-01-01', 25, 75, -0.05, 2800);
    const profile = makeProfile({ goal: 'gain', rate_kg_per_week: -0.25 });
    const result = computeTDEE(intake, weights, profile);

    expect(result.trendKgPerWeek).toBeGreaterThan(0);
    expect(result.tdee).toBeLessThan(2800);
  });
});

describe('computeTDEE — confidence band narrows with more data (PRD §4.5)', () => {
  test('band at day 30 is narrower than band at day 12', () => {
    const full = buildLosingSeries('2024-01-01', 30, 85, 0.05, 2200);
    const profile = makeProfile();

    const day12Result = computeTDEE(
      full.intake.slice(0, 12),
      full.weights.slice(0, 12),
      profile
    );
    const day30Result = computeTDEE(full.intake, full.weights, profile);

    const bandAt12 = day12Result.confidenceHigh - day12Result.confidenceLow;
    const bandAt30 = day30Result.confidenceHigh - day30Result.confidenceLow;

    expect(bandAt30).toBeLessThan(bandAt12);
  });
});

describe('computeTDEE — edge cases (PRD §4.4)', () => {
  test('unlogged day is excluded from intake AND does not corrupt the window (no phantom zero)', () => {
    const { intake, weights } = buildLosingSeries('2024-01-01', 20, 85, 0.05, 2200);
    // Remove day index 10 from intake entirely (unlogged), but the
    // weight reading for that day remains.
    const withGap = intake.filter((_, i) => i !== 10);

    const resultNoGap = computeTDEE(intake, weights, makeProfile());
    const resultWithGap = computeTDEE(withGap, weights, makeProfile());

    // Removing a day (not zeroing it) should barely move the estimate —
    // both TDEEs should stay close since the true underlying series is
    // otherwise identical.
    expect(Math.abs(resultWithGap.tdee - resultNoGap.tdee)).toBeLessThan(50);

    // Weight series length (daysOfData) should be unaffected by the
    // missing intake day — only loggedDaysInWindow drops.
    expect(resultWithGap.daysOfData).toBe(resultNoGap.daysOfData);
    expect(resultWithGap.loggedDaysInWindow).toBe(resultNoGap.loggedDaysInWindow - 1);
  });

  test('a phantom zero-calorie day corrupts the estimate — demonstrating why exclusion (not imputation) is required', () => {
    const { intake, weights } = buildLosingSeries('2024-01-01', 20, 85, 0.05, 2200);
    const excluded = intake.filter((_, i) => i !== 10);
    const imputedZero = intake.map((d, i) => (i === 10 ? { ...d, kcal: 0 } : d));

    const resultExcluded = computeTDEE(excluded, weights, makeProfile());
    const resultImputedZero = computeTDEE(imputedZero, weights, makeProfile());

    // The imputed-zero run pulls the mean intake down hard versus the
    // properly-excluded run, proving a single phantom zero corrupts the
    // window — exactly the failure mode PRD §4.4 forbids.
    expect(Math.abs(resultImputedZero.tdee - resultExcluded.tdee)).toBeGreaterThan(20);
  });

  test('partial log (is_complete = false) is excluded from intake series but weight still counts', () => {
    const { intake, weights } = buildLosingSeries('2024-01-01', 20, 85, 0.05, 2200);
    const partial = intake.map((d, i) => (i === 10 ? { ...d, kcal: 50, is_complete: false } : d));

    const resultFull = computeTDEE(intake, weights, makeProfile());
    const resultPartial = computeTDEE(partial, weights, makeProfile());

    // Partial-log day should behave like an excluded day for intake
    // purposes (small TDEE delta), not like a real 50-kcal day.
    expect(Math.abs(resultPartial.tdee - resultFull.tdee)).toBeLessThan(50);
    expect(resultPartial.loggedDaysInWindow).toBe(resultFull.loggedDaysInWindow - 1);
    // Weight data (daysOfData) is untouched — the weight reading for that
    // day still counts in the Kalman series.
    expect(resultPartial.daysOfData).toBe(resultFull.daysOfData);
  });

  test('new diet phase (abs(trend) > 0.15 kg/day in first 14 days) gets damped, not taken at face value', () => {
    // Simulate a sudden 4kg drop over the first week purely from
    // water/glycogen — trend would imply a wildly unrealistic TDEE if
    // taken at face value.
    const days = 10;
    const intake: DayIntake[] = [];
    const weights: WeightLog[] = [];
    const start = new Date('2024-01-01T00:00:00Z');
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      // Steep early drop: 0.5 kg/day, far past the 0.15 threshold.
      weights.push(makeWeightDay(iso, 90 - 0.5 * i));
      intake.push(makeIntakeDay(iso, { kcal: 2200 }));
    }
    const result = computeTDEE(intake, weights, makeProfile());

    // Face-value (undamped) TDEE would be roughly
    // 2200 + 7700*0.5 ≈ 6050 kcal — absurd. Damping should keep the
    // reported TDEE far below that.
    expect(result.tdee).toBeLessThan(4500);
  });

  test('weight gain during a deficit does not throw and widens rather than alarms', () => {
    const days = 20;
    const intake: DayIntake[] = [];
    const weights: WeightLog[] = [];
    const start = new Date('2024-01-01T00:00:00Z');
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      // Weight inexplicably *rising* slightly while eating a deficit-sized intake.
      weights.push(makeWeightDay(iso, 80 + 0.05 * i));
      intake.push(makeIntakeDay(iso, { kcal: 1800 }));
    }
    expect(() => computeTDEE(intake, weights, makeProfile())).not.toThrow();
    const result = computeTDEE(intake, weights, makeProfile());
    for (const v of Object.values(result)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
  });

  test('gap > 7 days is exposed so the UI can prompt to recalibrate', () => {
    const weights: WeightLog[] = [
      makeWeightDay('2024-01-01', 80),
      makeWeightDay('2024-01-02', 80),
      makeWeightDay('2024-01-15', 79), // 13-day gap
    ];
    const intake: DayIntake[] = [
      makeIntakeDay('2024-01-01'),
      makeIntakeDay('2024-01-02'),
      makeIntakeDay('2024-01-15'),
    ];
    // computeTDEE itself must not throw; the long-gap flag is available
    // via the Kalman module for the UI layer to consume.
    expect(() => computeTDEE(intake, weights, makeProfile())).not.toThrow();

    const kalmanResult = runKalmanFilter(weights);
    expect(kalmanResult.hadLongGap).toBe(true);
  });
});

describe('computeTDEE — degenerate inputs never produce NaN or throw', () => {
  const profile = makeProfile();

  test('zero weights, zero intake', () => {
    expect(() => computeTDEE([], [], profile)).not.toThrow();
    const result = computeTDEE([], [], profile);
    for (const v of Object.values(result)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
    expect(result.dataQuality).toBe('seeding');
  });

  test('exactly one weight reading, one intake day', () => {
    const weights = [makeWeightDay('2024-01-01', 80)];
    const intake = [makeIntakeDay('2024-01-01')];
    expect(() => computeTDEE(intake, weights, profile)).not.toThrow();
    const result = computeTDEE(intake, weights, profile);
    for (const v of Object.values(result)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
  });

  test('all weight readings confounded', () => {
    const weights: WeightLog[] = [];
    const intake: DayIntake[] = [];
    const start = new Date('2024-01-01T00:00:00Z');
    for (let i = 0; i < 15; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      weights.push(makeWeightDay(iso, 80 - 0.05 * i, 'poor_sleep'));
      intake.push(makeIntakeDay(iso));
    }
    expect(() => computeTDEE(intake, weights, profile)).not.toThrow();
    const result = computeTDEE(intake, weights, profile);
    for (const v of Object.values(result)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
  });

  test('all intake days incomplete (no complete logged day at all)', () => {
    const weights: WeightLog[] = [];
    const intake: DayIntake[] = [];
    const start = new Date('2024-01-01T00:00:00Z');
    for (let i = 0; i < 15; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      weights.push(makeWeightDay(iso, 80 - 0.05 * i));
      intake.push(makeIntakeDay(iso, { is_complete: false }));
    }
    expect(() => computeTDEE(intake, weights, profile)).not.toThrow();
    const result = computeTDEE(intake, weights, profile);
    for (const v of Object.values(result)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
    expect(result.loggedDaysInWindow).toBe(0);
    // With no usable intake data, the engine must not fabricate a
    // measured estimate — should fall back toward the cold-start seed.
    expect(result.dataQuality).toBe('seeding');
  });
});

describe('weightedLinearRegression / weightedMean helpers', () => {
  test('weightedLinearRegression degenerates gracefully on empty input', () => {
    const r = weightedLinearRegression([], [], []);
    expect(Number.isNaN(r.slope)).toBe(false);
    expect(Number.isNaN(r.intercept)).toBe(false);
  });

  test('weightedLinearRegression degenerates gracefully on a single point', () => {
    const r = weightedLinearRegression([0], [80], [1]);
    expect(r.slope).toBe(0);
    expect(r.intercept).toBe(80);
  });

  test('weightedMean of empty array does not throw or NaN', () => {
    const r = weightedMean([], []);
    expect(Number.isNaN(r.mean)).toBe(false);
  });

  test('recencyWeight decays toward zero for larger days_ago and is 1 at days_ago=0', () => {
    expect(recencyWeight(0)).toBeCloseTo(1, 10);
    expect(recencyWeight(14)).toBeCloseTo(0.5, 5);
    expect(recencyWeight(100)).toBeLessThan(recencyWeight(10));
  });
});
