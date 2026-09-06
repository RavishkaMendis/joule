import { explainTargetChange, adherenceLabel, weekLabelFromDaysOfData } from '../checkInLogic';
import { computeTargets } from '../../engine/targets';
import type { TDEEResult } from '../../engine/types';
import { makeProfile } from '../../engine/__tests__/testFixtures';

function makeTDEEResult(overrides: Partial<TDEEResult> = {}): TDEEResult {
  return {
    tdee: 2500,
    confidenceLow: 2400,
    confidenceHigh: 2600,
    trendKgPerWeek: -0.42,
    smoothedWeightKg: 80,
    dataQuality: 'stable',
    daysOfData: 42,
    loggedDaysInWindow: 36,
    ...overrides,
  };
}

describe('explainTargetChange', () => {
  test('first check-in (no previous data) explains the seed/first measured target', () => {
    const newTdee = makeTDEEResult({ tdee: 2510 });
    const profile = makeProfile({ rate_kg_per_week: 0.5 });
    const newTargets = computeTargets(newTdee, profile);

    const sentence = explainTargetChange({
      previousTdee: null,
      newTdee,
      previousTargetKcal: null,
      newTargets,
      goalRateKgPerWeek: 0.5,
    });

    expect(sentence).toMatch(/first measured target/i);
    expect(sentence).toContain('2510');
  });

  test('seeding data quality explains the estimate is not yet measured', () => {
    const newTdee = makeTDEEResult({ dataQuality: 'seeding', daysOfData: 3 });
    const profile = makeProfile();
    const newTargets = computeTargets(newTdee, profile);

    const sentence = explainTargetChange({
      previousTdee: null,
      newTdee,
      previousTargetKcal: null,
      newTargets,
      goalRateKgPerWeek: 0.5,
    });

    expect(sentence).toMatch(/estimating/i);
  });

  test('rail reason (deficit cap) is surfaced plainly, not hidden behind a generic sentence', () => {
    const newTdee = makeTDEEResult({ tdee: 2500 });
    const profile = makeProfile({ rate_kg_per_week: 1.5 }); // aggressive, trips the 25% deficit cap
    const newTargets = computeTargets(newTdee, profile);
    expect(newTargets.railReason).not.toBeNull();

    const sentence = explainTargetChange({
      previousTdee: makeTDEEResult({ tdee: 2490 }),
      newTdee,
      previousTargetKcal: 2100,
      newTargets,
      goalRateKgPerWeek: 1.5,
    });

    expect(sentence).toMatch(/cap/i);
  });

  test('TDEE moved meaningfully: explanation cites the TDEE change, not a generic string', () => {
    const previousTdee = makeTDEEResult({ tdee: 2470, trendKgPerWeek: -0.42 });
    const newTdee = makeTDEEResult({ tdee: 2510, trendKgPerWeek: -0.42 }); // trend unchanged, TDEE rose 40
    const profile = makeProfile({ rate_kg_per_week: 0.5 });
    const previousTargets = computeTargets(previousTdee, profile);
    const newTargets = computeTargets(newTdee, profile);

    const sentence = explainTargetChange({
      previousTdee,
      newTdee,
      previousTargetKcal: previousTargets.targetKcal,
      newTargets,
      goalRateKgPerWeek: 0.5,
    });

    expect(sentence).toMatch(/TDEE/);
    expect(sentence).toMatch(/rose/i);
    expect(sentence).not.toMatch(/target has been updated/i);
  });

  test('target essentially unchanged: says so neutrally', () => {
    const previousTdee = makeTDEEResult({ tdee: 2500, trendKgPerWeek: -0.42 });
    const newTdee = makeTDEEResult({ tdee: 2500.2, trendKgPerWeek: -0.42 });
    const profile = makeProfile({ rate_kg_per_week: 0.5 });
    const previousTargets = computeTargets(previousTdee, profile);
    const newTargets = computeTargets(newTdee, profile);

    const sentence = explainTargetChange({
      previousTdee,
      newTdee,
      previousTargetKcal: previousTargets.targetKcal,
      newTargets,
      goalRateKgPerWeek: 0.5,
    });

    expect(sentence).toMatch(/steady/i);
  });

  test('trend diverging from goal rate is cited when TDEE itself barely moved', () => {
    // TDEE nearly flat, but measured trend has drifted well below the goal
    // rate (losing faster than the goal) — the dominant driver should be
    // the trend/rate mismatch, not a TDEE claim.
    const previousTdee = makeTDEEResult({ tdee: 2500, trendKgPerWeek: -0.5 });
    const newTdee = makeTDEEResult({ tdee: 2500, trendKgPerWeek: -0.1 });
    const profile = makeProfile({ rate_kg_per_week: 0.5 });
    const previousTargets = computeTargets(previousTdee, profile);
    const newTargets = computeTargets(newTdee, profile);

    const sentence = explainTargetChange({
      previousTdee,
      newTdee,
      previousTargetKcal: previousTargets.targetKcal,
      newTargets,
      goalRateKgPerWeek: 0.5,
    });

    expect(sentence).toMatch(/trend/i);
  });
});

describe('adherenceLabel', () => {
  test('renders neutrally, never as a streak or failure framing', () => {
    const label = adherenceLabel(4, 7);
    expect(label).toBe('Logged 4/7 days');
    expect(label).not.toMatch(/miss|fail|broke|streak/i);
  });
});

describe('weekLabelFromDaysOfData', () => {
  test('day 1-7 is Week 1, day 8-14 is Week 2, etc.', () => {
    expect(weekLabelFromDaysOfData(1)).toBe('Week 1');
    expect(weekLabelFromDaysOfData(7)).toBe('Week 1');
    expect(weekLabelFromDaysOfData(8)).toBe('Week 2');
    expect(weekLabelFromDaysOfData(42)).toBe('Week 6');
  });
});
