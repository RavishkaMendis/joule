import { buildDayOfWeekPattern } from '../dayOfWeekPattern';

describe('buildDayOfWeekPattern', () => {
  test('empty input returns 7 weekdays, all null/0', () => {
    const pattern = buildDayOfWeekPattern([]);
    expect(pattern).toHaveLength(7);
    expect(pattern.every((p) => p.avgKcal === null && p.sampleCount === 0)).toBe(true);
    expect(pattern.map((p) => p.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  test('single logged day populates only its own weekday', () => {
    // 2026-01-05 is a Monday.
    const pattern = buildDayOfWeekPattern([{ date: '2026-01-05', loggedKcal: 2100 }]);
    const monday = pattern.find((p) => p.label === 'Mon')!;
    expect(monday.avgKcal).toBe(2100);
    expect(monday.sampleCount).toBe(1);
    const others = pattern.filter((p) => p.label !== 'Mon');
    expect(others.every((p) => p.avgKcal === null)).toBe(true);
  });

  test('gap days (loggedKcal null) never contribute to any weekday average', () => {
    const pattern = buildDayOfWeekPattern([
      { date: '2026-01-05', loggedKcal: 2000 }, // Mon
      { date: '2026-01-06', loggedKcal: null }, // Tue, gap
      { date: '2026-01-12', loggedKcal: 2200 }, // Mon (next week)
    ]);
    const monday = pattern.find((p) => p.label === 'Mon')!;
    expect(monday.avgKcal).toBe(2100); // (2000+2200)/2
    expect(monday.sampleCount).toBe(2);
    const tuesday = pattern.find((p) => p.label === 'Tue')!;
    expect(tuesday.avgKcal).toBeNull();
    expect(tuesday.sampleCount).toBe(0);
  });

  test('weekend vs weekday split is computable from a realistic small sample', () => {
    const pattern = buildDayOfWeekPattern([
      { date: '2026-01-05', loggedKcal: 2000 }, // Mon
      { date: '2026-01-10', loggedKcal: 2600 }, // Sat
      { date: '2026-01-11', loggedKcal: 2700 }, // Sun
    ]);
    const sat = pattern.find((p) => p.label === 'Sat')!;
    const mon = pattern.find((p) => p.label === 'Mon')!;
    expect(sat.avgKcal).toBe(2600);
    expect(mon.avgKcal).toBe(2000);
  });
});
