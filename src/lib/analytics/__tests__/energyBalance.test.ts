import { buildEnergyBalanceSeries, interpolateExpenditure } from '../energyBalance';

describe('buildEnergyBalanceSeries', () => {
  test('empty axis returns empty series', () => {
    expect(buildEnergyBalanceSeries([], [], new Map())).toEqual([]);
  });

  test('single day with both intake and expenditure known computes a balance', () => {
    const series = buildEnergyBalanceSeries(
      ['2026-01-01'],
      [{ date: '2026-01-01', loggedKcal: 2000 }],
      new Map([['2026-01-01', { value: 2400, quality: 'stable' }]])
    );
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({
      date: '2026-01-01',
      intakeKcal: 2000,
      expenditureKcal: 2400,
      balanceKcal: -400,
      expenditureQuality: 'stable',
    });
  });

  test('a gap day (no logged intake) has null intake AND null balance, never a fabricated balance against 0', () => {
    const series = buildEnergyBalanceSeries(
      ['2026-01-01'],
      [{ date: '2026-01-01', loggedKcal: null }],
      new Map([['2026-01-01', { value: 2400, quality: 'stable' }]])
    );
    expect(series[0].intakeKcal).toBeNull();
    expect(series[0].expenditureKcal).toBe(2400);
    expect(series[0].balanceKcal).toBeNull();
  });

  test('a day with no expenditure value at all also yields null balance even if intake is known', () => {
    const series = buildEnergyBalanceSeries(['2026-01-01'], [{ date: '2026-01-01', loggedKcal: 2000 }], new Map());
    expect(series[0].intakeKcal).toBe(2000);
    expect(series[0].expenditureKcal).toBeNull();
    expect(series[0].balanceKcal).toBeNull();
    expect(series[0].expenditureQuality).toBeNull();
  });

  test('multi-day series preserves per-day independence of gaps', () => {
    const series = buildEnergyBalanceSeries(
      ['2026-01-01', '2026-01-02', '2026-01-03'],
      [
        { date: '2026-01-01', loggedKcal: 2000 },
        { date: '2026-01-02', loggedKcal: null },
        { date: '2026-01-03', loggedKcal: 1800 },
      ],
      new Map([
        ['2026-01-01', { value: 2400, quality: 'stable' }],
        ['2026-01-02', { value: 2400, quality: 'stable' }],
        ['2026-01-03', { value: 2400, quality: 'stable' }],
      ])
    );
    expect(series.map((p) => p.balanceKcal)).toEqual([-400, null, -600]);
  });

  // ═══════════════════════════════════════════════════════════════════
  // HONESTY DEFECT REGRESSION — dataQuality propagation.
  //
  // A real user saw "Expend. 2,343" after two days of logging and asked
  // how there could already be an expenditure figure — it was a
  // Mifflin-St Jeor cold-start seed, not a measurement, but nothing
  // downstream could tell the two apart because `dataQuality` was
  // discarded before it reached the chart/table layer. These guard the
  // fix: expenditureQuality must reach every EnergyBalancePoint that has
  // an expenditure value at all.
  // ═══════════════════════════════════════════════════════════════════
  test('carries a seeding-quality expenditure estimate through untouched (the reported bug)', () => {
    const series = buildEnergyBalanceSeries(
      ['2026-01-01'],
      [{ date: '2026-01-01', loggedKcal: 1399 }],
      new Map([['2026-01-01', { value: 2343, quality: 'seeding' }]])
    );
    expect(series[0].expenditureKcal).toBe(2343);
    expect(series[0].expenditureQuality).toBe('seeding');
  });

  test('a converging-quality estimate is also carried through distinctly from seeding/stable', () => {
    const series = buildEnergyBalanceSeries(
      ['2026-01-01'],
      [{ date: '2026-01-01', loggedKcal: 2000 }],
      new Map([['2026-01-01', { value: 2200, quality: 'converging' }]])
    );
    expect(series[0].expenditureQuality).toBe('converging');
  });
});

describe('interpolateExpenditure', () => {
  test('empty known map returns empty result', () => {
    expect(interpolateExpenditure(['2026-01-01', '2026-01-02'], new Map()).size).toBe(0);
  });

  test('single known point on the axis maps through unchanged, no extrapolation elsewhere', () => {
    const result = interpolateExpenditure(
      ['2026-01-01', '2026-01-02', '2026-01-03'],
      new Map([['2026-01-02', { value: 2500, quality: 'stable' }]])
    );
    expect(result.get('2026-01-02')).toEqual({ value: 2500, quality: 'stable' });
    expect(result.has('2026-01-01')).toBe(false);
    expect(result.has('2026-01-03')).toBe(false);
  });

  test('linearly interpolates the value between two known cutoffs', () => {
    const result = interpolateExpenditure(
      ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'],
      new Map([
        ['2026-01-01', { value: 2000, quality: 'stable' }],
        ['2026-01-05', { value: 2400, quality: 'stable' }],
      ])
    );
    expect(result.get('2026-01-01')?.value).toBe(2000);
    expect(result.get('2026-01-05')?.value).toBe(2400);
    expect(result.get('2026-01-03')?.value).toBeCloseTo(2200, 5); // midpoint
  });

  test('does not extrapolate before the first or after the last known point', () => {
    const result = interpolateExpenditure(
      ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'],
      new Map([['2026-01-01', { value: 2000, quality: 'stable' }]])
    );
    expect(result.has('2025-12-30')).toBe(false);
    expect(result.has('2025-12-31')).toBe(false);
    expect(result.has('2026-01-02')).toBe(false);
    expect(result.get('2026-01-01')).toEqual({ value: 2000, quality: 'stable' });
  });

  // ═══════════════════════════════════════════════════════════════════
  // HONESTY DEFECT — weakest-wins quality propagation through interpolation.
  //
  // "Interpolated days inherit the weaker of the two surrounding cutoffs'
  // qualities — an interpolated point between a seeded and a converging
  // cutoff is not better than seeded" (task brief). These are the
  // pure-function tests for that rule.
  // ═══════════════════════════════════════════════════════════════════
  test('an interpolated point between two stable cutoffs is stable', () => {
    const result = interpolateExpenditure(
      ['2026-01-01', '2026-01-02', '2026-01-03'],
      new Map([
        ['2026-01-01', { value: 2000, quality: 'stable' }],
        ['2026-01-03', { value: 2200, quality: 'stable' }],
      ])
    );
    expect(result.get('2026-01-02')?.quality).toBe('stable');
  });

  test('an interpolated point between a seeded and a stable cutoff inherits seeding (the weaker one), not an average of trust', () => {
    const result = interpolateExpenditure(
      ['2026-01-01', '2026-01-02', '2026-01-03'],
      new Map([
        ['2026-01-01', { value: 2000, quality: 'seeding' }],
        ['2026-01-03', { value: 2400, quality: 'stable' }],
      ])
    );
    expect(result.get('2026-01-02')?.quality).toBe('seeding');
    // The kcal value itself still interpolates normally — only quality is weakest-wins.
    expect(result.get('2026-01-02')?.value).toBeCloseTo(2200, 5);
  });

  test('an interpolated point between a seeded and a converging cutoff is seeded, not converging', () => {
    const result = interpolateExpenditure(
      ['2026-01-01', '2026-01-02', '2026-01-03'],
      new Map([
        ['2026-01-01', { value: 2000, quality: 'converging' }],
        ['2026-01-03', { value: 2400, quality: 'seeding' }],
      ])
    );
    expect(result.get('2026-01-02')?.quality).toBe('seeding');
  });

  test('an interpolated point between a converging and a stable cutoff is converging', () => {
    const result = interpolateExpenditure(
      ['2026-01-01', '2026-01-02', '2026-01-03'],
      new Map([
        ['2026-01-01', { value: 2000, quality: 'converging' }],
        ['2026-01-03', { value: 2400, quality: 'stable' }],
      ])
    );
    expect(result.get('2026-01-02')?.quality).toBe('converging');
  });
});
