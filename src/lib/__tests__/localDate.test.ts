import { toLocalISO, todayLocalISO, isToday, relativeDayLabel, formatDayLabel } from '../localDate';
import { addLocalDaysISO } from '../dateNav';

describe('toLocalISO / todayLocalISO', () => {
  it('formats a Date using local calendar fields, zero-padded', () => {
    expect(toLocalISO(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toLocalISO(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('todayLocalISO matches toLocalISO(new Date()) at call time', () => {
    expect(todayLocalISO()).toBe(toLocalISO(new Date()));
  });
});

describe('isToday', () => {
  const today = todayLocalISO();

  it('is true for today', () => {
    expect(isToday(today)).toBe(true);
  });

  it('is false for yesterday or tomorrow', () => {
    expect(isToday(addLocalDaysISO(today, -1))).toBe(false);
    expect(isToday(addLocalDaysISO(today, 1))).toBe(false);
  });
});

describe('relativeDayLabel', () => {
  const today = todayLocalISO();

  it('labels today, yesterday, tomorrow specially', () => {
    expect(relativeDayLabel(today)).toBe('Today');
    expect(relativeDayLabel(addLocalDaysISO(today, -1))).toBe('Yesterday');
    expect(relativeDayLabel(addLocalDaysISO(today, 1))).toBe('Tomorrow');
  });

  it('falls back to the raw ISO string beyond +/-1 day', () => {
    const lastWeek = addLocalDaysISO(today, -7);
    expect(relativeDayLabel(lastWeek)).toBe(lastWeek);
  });
});

describe('formatDayLabel — capture screens\' "Logging to <date>" banner text', () => {
  it('renders a short weekday + day + month label', () => {
    // 2026-08-26 is a Wednesday.
    expect(formatDayLabel('2026-08-26')).toMatch(/\bWed\b/);
    expect(formatDayLabel('2026-08-26')).toMatch(/\b26\b/);
    expect(formatDayLabel('2026-08-26')).toMatch(/\bAug\b/);
  });

  it('handles a year boundary correctly (no off-by-one from month indexing)', () => {
    // 2026-01-01 is a Thursday.
    expect(formatDayLabel('2026-01-01')).toMatch(/\bThu\b/);
    expect(formatDayLabel('2026-01-01')).toMatch(/\bJan\b/);
  });
});
