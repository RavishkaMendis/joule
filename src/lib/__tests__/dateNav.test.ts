import {
  addLocalDaysISO,
  isFutureDate,
  clampToToday,
  previousDay,
  nextDay,
  isNextDayDisabled,
  resolveCaptureDate,
} from '../dateNav';
import { todayLocalISO } from '../localDate';

describe('addLocalDaysISO', () => {
  it('adds and subtracts days across a month boundary', () => {
    expect(addLocalDaysISO('2026-08-31', 1)).toBe('2026-09-01');
    expect(addLocalDaysISO('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('handles a year boundary', () => {
    expect(addLocalDaysISO('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('zero days is a no-op', () => {
    expect(addLocalDaysISO('2026-08-15', 0)).toBe('2026-08-15');
  });
});

describe('isFutureDate', () => {
  const today = todayLocalISO();

  it('today is not future', () => {
    expect(isFutureDate(today)).toBe(false);
  });

  it('a past date is not future', () => {
    expect(isFutureDate(addLocalDaysISO(today, -5))).toBe(false);
  });

  it('tomorrow IS future', () => {
    expect(isFutureDate(addLocalDaysISO(today, 1))).toBe(true);
  });
});

describe('clampToToday — the future-logging guardrail', () => {
  const today = todayLocalISO();

  it('passes through today and any past date unchanged', () => {
    expect(clampToToday(today)).toBe(today);
    expect(clampToToday(addLocalDaysISO(today, -30))).toBe(addLocalDaysISO(today, -30));
  });

  it('clamps any future date down to today', () => {
    expect(clampToToday(addLocalDaysISO(today, 1))).toBe(today);
    expect(clampToToday(addLocalDaysISO(today, 365))).toBe(today);
  });
});

describe('previousDay / nextDay', () => {
  const today = todayLocalISO();

  it('previousDay always steps back one day, unbounded into the past', () => {
    expect(previousDay(today)).toBe(addLocalDaysISO(today, -1));
    expect(previousDay(addLocalDaysISO(today, -100))).toBe(addLocalDaysISO(today, -101));
  });

  it('nextDay steps forward one day when not already at today', () => {
    const yesterday = addLocalDaysISO(today, -1);
    expect(nextDay(yesterday)).toBe(today);
  });

  it('nextDay from today stays clamped at today (cannot cross into the future)', () => {
    expect(nextDay(today)).toBe(today);
  });
});

describe('isNextDayDisabled', () => {
  const today = todayLocalISO();

  it('is true when viewing today', () => {
    expect(isNextDayDisabled(today)).toBe(true);
  });

  it('is false when viewing a past day', () => {
    expect(isNextDayDisabled(addLocalDaysISO(today, -1))).toBe(false);
  });
});

describe('resolveCaptureDate — the capture-route (barcode/label/photo/voice) date-threading fix', () => {
  const today = todayLocalISO();

  it('uses the passed date when present (a past day TodayScreen was browsing)', () => {
    const yesterday = addLocalDaysISO(today, -1);
    expect(resolveCaptureDate(yesterday)).toBe(yesterday);

    const lastWeek = addLocalDaysISO(today, -7);
    expect(resolveCaptureDate(lastWeek)).toBe(lastWeek);
  });

  it('falls back to today when the param is absent (older caller / direct deep-link)', () => {
    expect(resolveCaptureDate(undefined)).toBe(today);
  });

  it('passing today explicitly is a no-op', () => {
    expect(resolveCaptureDate(today)).toBe(today);
  });

  it('never bypasses the future-logging guardrail even if a bad/future param arrives', () => {
    const tomorrow = addLocalDaysISO(today, 1);
    expect(resolveCaptureDate(tomorrow)).toBe(today);
  });
});
