import { dayOffset, addDaysISO, buildDailyAxis, parseISODateUTC, formatISODateUTC } from '../date';

describe('date helpers (UTC-safe)', () => {
  test('parseISODateUTC / formatISODateUTC round-trip', () => {
    expect(formatISODateUTC(parseISODateUTC('2024-03-10'))).toBe('2024-03-10');
    expect(formatISODateUTC(parseISODateUTC('2024-01-01'))).toBe('2024-01-01');
    expect(formatISODateUTC(parseISODateUTC('2024-12-31'))).toBe('2024-12-31');
  });

  test('dayOffset counts whole days regardless of DST-affected local zones', () => {
    // Northern-hemisphere spring-forward window (US DST starts ~Mar 10 2024).
    expect(dayOffset('2024-03-09', '2024-03-10')).toBe(1);
    expect(dayOffset('2024-03-08', '2024-03-11')).toBe(3);
    // Fall-back window.
    expect(dayOffset('2024-11-02', '2024-11-03')).toBe(1);
    // Across a year boundary.
    expect(dayOffset('2023-12-30', '2024-01-02')).toBe(3);
    // Same date.
    expect(dayOffset('2024-06-01', '2024-06-01')).toBe(0);
    // Negative direction.
    expect(dayOffset('2024-06-05', '2024-06-01')).toBe(-4);
  });

  test('addDaysISO advances/retreats by whole days across month and DST boundaries', () => {
    expect(addDaysISO('2024-02-28', 1)).toBe('2024-02-29'); // leap year
    expect(addDaysISO('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDaysISO('2024-03-10', -1)).toBe('2024-03-09');
    expect(addDaysISO('2024-01-01', -1)).toBe('2023-12-31');
  });

  test('buildDailyAxis produces a contiguous run with no gaps', () => {
    const axis = buildDailyAxis('2024-03-08', '2024-03-12');
    expect(axis).toEqual(['2024-03-08', '2024-03-09', '2024-03-10', '2024-03-11', '2024-03-12']);
  });

  test('buildDailyAxis of a single day returns that day only', () => {
    expect(buildDailyAxis('2024-05-01', '2024-05-01')).toEqual(['2024-05-01']);
  });

  test('buildDailyAxis throws if start is after end', () => {
    expect(() => buildDailyAxis('2024-05-02', '2024-05-01')).toThrow();
  });
});
