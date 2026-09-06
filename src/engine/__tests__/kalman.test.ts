import { runKalmanFilter } from '../kalman';
import { KALMAN_DEFAULTS } from '../types';
import type { WeightLog } from '../types';

function makeWeights(entries: Array<[string, number, WeightLog['confounder']?]>): WeightLog[] {
  return entries.map(([date, weight_kg, confounder]) => ({
    date,
    weight_kg,
    confounder: confounder ?? null,
  }));
}

describe('runKalmanFilter', () => {
  test('empty input returns empty series', () => {
    const result = runKalmanFilter([]);
    expect(result.series).toEqual([]);
    expect(result.hadLongGap).toBe(false);
  });

  test('single reading produces a one-day series anchored at that weight', () => {
    const result = runKalmanFilter(makeWeights([['2024-01-01', 80]]));
    expect(result.series).toHaveLength(1);
    expect(result.series[0].smoothedWeightKg).toBeCloseTo(80, 5);
    expect(result.series[0].hasReading).toBe(true);
  });

  test('smooths noisy readings toward the true underlying trend', () => {
    // Perfectly linear underlying decline of 0.1 kg/day with alternating
    // +/-0.3kg noise. The smoothed estimate should track the trend much
    // more tightly than the raw noisy readings do.
    const entries: Array<[string, number]> = [];
    const start = new Date(Date.UTC(2024, 0, 1));
    let trueWeight = 85;
    for (let i = 0; i < 30; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const noise = i % 2 === 0 ? 0.3 : -0.3;
      entries.push([iso, trueWeight + noise]);
      trueWeight -= 0.1;
    }
    const result = runKalmanFilter(makeWeights(entries));
    const last = result.series[result.series.length - 1];
    // True weight at day 29 is 85 - 29*0.1 = 82.1
    expect(last.smoothedWeightKg).toBeGreaterThan(81.5);
    expect(last.smoothedWeightKg).toBeLessThan(82.7);
    // Trend should be negative and roughly near -0.1 kg/day.
    expect(last.trendKgPerDay).toBeLessThan(0);
    expect(last.trendKgPerDay).toBeGreaterThan(-0.25);
  });

  test('missing days run prediction-only and grow covariance without a reading', () => {
    const weights = makeWeights([
      ['2024-01-01', 80],
      ['2024-01-02', 80],
      ['2024-01-03', 80],
      // gap: 01-04, 01-05 missing
      ['2024-01-06', 80],
    ]);
    const result = runKalmanFilter(weights);
    expect(result.series).toHaveLength(6);
    const missingDay = result.series.find((d) => d.date === '2024-01-04')!;
    const priorDay = result.series.find((d) => d.date === '2024-01-03')!;
    expect(missingDay.hasReading).toBe(false);
    // Covariance (uncertainty) must grow on a missing day relative to the
    // last-updated day, since only the prediction step ran.
    expect(missingDay.covariance[0][0]).toBeGreaterThan(priorDay.covariance[0][0]);
  });

  test('confounded reading still updates the filter but with inflated R (less influence)', () => {
    // Build two parallel scenarios that are identical except one has the
    // final observation flagged with a confounder. The confounded run's
    // final smoothed weight should move less toward the outlier reading.
    const base: Array<[string, number]> = [
      ['2024-01-01', 80],
      ['2024-01-02', 80],
      ['2024-01-03', 80],
      ['2024-01-04', 80],
      ['2024-01-05', 80],
    ];
    const outlierDate = '2024-01-06';
    const outlierWeight = 84; // big spike, e.g. salty meal / travel

    const withoutConfounder = runKalmanFilter(makeWeights([...base, [outlierDate, outlierWeight]]));
    const withConfounder = runKalmanFilter(
      makeWeights([...base, [outlierDate, outlierWeight, 'ate_out']])
    );

    const lastNoConf = withoutConfounder.series[withoutConfounder.series.length - 1];
    const lastConf = withConfounder.series[withConfounder.series.length - 1];

    // The confounded observation should pull the smoothed estimate less
    // far toward the outlier than the unflagged one does.
    expect(lastConf.smoothedWeightKg).toBeLessThan(lastNoConf.smoothedWeightKg);
    // But it must still move the estimate somewhat (not discarded outright)
    expect(lastConf.smoothedWeightKg).toBeGreaterThan(80);
  });

  test('gap > 7 days sets hadLongGap and flags followsLongGap on the resuming day', () => {
    const weights = makeWeights([
      ['2024-01-01', 80],
      ['2024-01-02', 80],
      // 10-day gap
      ['2024-01-13', 79],
    ]);
    const result = runKalmanFilter(weights);
    expect(result.hadLongGap).toBe(true);
    const resumeDay = result.series.find((d) => d.date === '2024-01-13')!;
    expect(resumeDay.followsLongGap).toBe(true);
  });

  test('gap of exactly 7 days does not trigger the long-gap reset', () => {
    const weights = makeWeights([
      ['2024-01-01', 80],
      ['2024-01-08', 80], // exactly 7 days later
    ]);
    const result = runKalmanFilter(weights);
    expect(result.hadLongGap).toBe(false);
  });

  test('accepts KalmanParams overrides instead of only KALMAN_DEFAULTS', () => {
    const weights = makeWeights([
      ['2024-01-01', 80],
      ['2024-01-02', 79],
      ['2024-01-03', 78],
    ]);
    const customParams = { ...KALMAN_DEFAULTS, R: 5, Q_trend: 0.01 };
    const withDefaults = runKalmanFilter(weights);
    const withOverride = runKalmanFilter(weights, customParams);
    // Different tuning should produce a different (not identical) result.
    expect(withOverride.series[2].smoothedWeightKg).not.toBeCloseTo(
      withDefaults.series[2].smoothedWeightKg,
      8
    );
  });
});
