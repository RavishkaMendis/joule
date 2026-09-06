import { buildAdherenceSeries } from '../adherenceSeries';

describe('buildAdherenceSeries — gap vs zero (PRD §9.2, §4.4)', () => {
  test('a day with no day_intake row at all is a gap (null), never a zero bar', () => {
    const series = buildAdherenceSeries(
      '2026-01-01',
      '2026-01-03',
      [
        { date: '2026-01-01', kcal: 2000, is_complete: true },
        // 2026-01-02 deliberately absent: the user logged nothing that day.
        { date: '2026-01-03', kcal: 1800, is_complete: true },
      ],
      2200
    );

    expect(series).toHaveLength(3);
    expect(series[0]).toMatchObject({ date: '2026-01-01', loggedKcal: 2000 });
    expect(series[1]).toMatchObject({ date: '2026-01-02', loggedKcal: null });
    expect(series[2]).toMatchObject({ date: '2026-01-03', loggedKcal: 1800 });
  });

  test('a logged day with genuinely 0 kcal from actual entries would still carry a row — but if none exists it must not be fabricated as 0', () => {
    // This test asserts the module's contract: absence of a row is the
    // ONLY gap signal. It must never coerce a missing entry to 0.
    const series = buildAdherenceSeries('2026-01-01', '2026-01-01', [], 2200);
    expect(series[0].loggedKcal).toBeNull();
    expect(series[0].loggedKcal).not.toBe(0);
  });

  test('target is threaded through to every day, gap or not', () => {
    const series = buildAdherenceSeries('2026-01-01', '2026-01-02', [], 2100);
    expect(series[0].targetKcal).toBe(2100);
    expect(series[1].targetKcal).toBe(2100);
  });

  test('target null (no check-in completed yet) is preserved, not defaulted to a number', () => {
    const series = buildAdherenceSeries(
      '2026-01-01',
      '2026-01-01',
      [{ date: '2026-01-01', kcal: 1900, is_complete: true }],
      null
    );
    expect(series[0].targetKcal).toBeNull();
  });

  test('partial log (is_complete=false) is still "logged" for chart purposes, not a gap', () => {
    const series = buildAdherenceSeries(
      '2026-01-01',
      '2026-01-01',
      [{ date: '2026-01-01', kcal: 900, is_complete: false }],
      2200
    );
    expect(series[0].loggedKcal).toBe(900);
    expect(series[0].isComplete).toBe(false);
  });

  test('a run of consecutive gaps all render as null, not interpolated/imputed values', () => {
    const series = buildAdherenceSeries('2026-01-01', '2026-01-05', [], 2000);
    expect(series.every((d) => d.loggedKcal === null)).toBe(true);
  });
});
