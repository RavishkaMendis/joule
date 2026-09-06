import {
  nextOccurrence,
  hasLoggedToday,
  shiftTime,
  formatTime12h,
  isWeighInReminderData,
  WEIGH_IN_NOTIFICATION_DATA,
} from '../weighInReminder';

describe('nextOccurrence', () => {
  test('returns later today when the chosen time has not passed yet', () => {
    const now = new Date(2026, 8, 3, 6, 30, 0); // 6:30am
    const next = nextOccurrence(now, 7, 0);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(8);
    expect(next.getDate()).toBe(3);
    expect(next.getHours()).toBe(7);
    expect(next.getMinutes()).toBe(0);
  });

  test('rolls to tomorrow when the chosen time has already passed today', () => {
    const now = new Date(2026, 8, 3, 8, 15, 0); // 8:15am, reminder was 7:00am
    const next = nextOccurrence(now, 7, 0);
    expect(next.getDate()).toBe(4);
    expect(next.getHours()).toBe(7);
    expect(next.getMinutes()).toBe(0);
  });

  test('treats an exact match as already passed (no immediate re-fire on the boundary tick)', () => {
    const now = new Date(2026, 8, 3, 7, 0, 0, 0);
    const next = nextOccurrence(now, 7, 0);
    expect(next.getDate()).toBe(4);
  });

  test('rolls over a month/year boundary correctly', () => {
    const now = new Date(2026, 11, 31, 20, 0, 0); // Dec 31, 8pm, reminder 7am already passed
    const next = nextOccurrence(now, 7, 0);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });

  test('ignores seconds/milliseconds on `now` when comparing', () => {
    const now = new Date(2026, 8, 3, 6, 59, 59, 999);
    const next = nextOccurrence(now, 7, 0);
    expect(next.getDate()).toBe(3);
    expect(next.getHours()).toBe(7);
  });
});

describe('hasLoggedToday (the already-weighed-today skip predicate)', () => {
  test('true when the most recent weight reading is today', () => {
    expect(hasLoggedToday('2026-09-03', '2026-09-03')).toBe(true);
  });

  test('false when the most recent reading is a previous day', () => {
    expect(hasLoggedToday('2026-09-02', '2026-09-03')).toBe(false);
  });

  test('false when there is no reading at all', () => {
    expect(hasLoggedToday(null, '2026-09-03')).toBe(false);
  });
});

describe('shiftTime', () => {
  test('adds minutes within the same hour', () => {
    expect(shiftTime(7, 0, 15)).toEqual({ hour: 7, minute: 15 });
  });

  test('rolls over into the next hour', () => {
    expect(shiftTime(7, 50, 15)).toEqual({ hour: 8, minute: 5 });
  });

  test('wraps past midnight forward', () => {
    expect(shiftTime(23, 50, 15)).toEqual({ hour: 0, minute: 5 });
  });

  test('wraps past midnight backward (negative delta)', () => {
    expect(shiftTime(0, 5, -15)).toEqual({ hour: 23, minute: 50 });
  });
});

describe('formatTime12h', () => {
  test('formats midnight as 12:00 AM', () => {
    expect(formatTime12h(0, 0)).toBe('12:00 AM');
  });

  test('formats noon as 12:00 PM', () => {
    expect(formatTime12h(12, 0)).toBe('12:00 PM');
  });

  test('formats a morning time with zero-padded minutes', () => {
    expect(formatTime12h(7, 5)).toBe('7:05 AM');
  });

  test('formats an evening time', () => {
    expect(formatTime12h(19, 30)).toBe('7:30 PM');
  });
});

describe('isWeighInReminderData', () => {
  test('recognizes this reminder\'s own data payload', () => {
    expect(isWeighInReminderData(WEIGH_IN_NOTIFICATION_DATA)).toBe(true);
  });

  test('rejects unrelated payloads', () => {
    expect(isWeighInReminderData({ type: 'something-else' })).toBe(false);
    expect(isWeighInReminderData(null)).toBe(false);
    expect(isWeighInReminderData(undefined)).toBe(false);
    expect(isWeighInReminderData('weigh-in-reminder')).toBe(false);
  });
});
