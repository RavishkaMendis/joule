import { parseSchedule, serializeSchedule, isDueOn, describeSchedule, DEFAULT_SCHEDULE } from '../schedule';

describe('serializeSchedule / parseSchedule round-trip', () => {
  it('round-trips daily', () => {
    expect(parseSchedule(serializeSchedule({ type: 'daily' }))).toEqual({ type: 'daily' });
  });

  it('round-trips as_needed', () => {
    expect(parseSchedule(serializeSchedule({ type: 'as_needed' }))).toEqual({ type: 'as_needed' });
  });

  it('round-trips days_of_week', () => {
    const spec = { type: 'days_of_week' as const, days: [1, 3, 5] };
    expect(parseSchedule(serializeSchedule(spec))).toEqual(spec);
  });

  it('DEFAULT_SCHEDULE is daily', () => {
    expect(DEFAULT_SCHEDULE).toEqual({ type: 'daily' });
  });
});

describe('parseSchedule defensive parsing', () => {
  it('falls back to as_needed on invalid JSON', () => {
    expect(parseSchedule('not json at all')).toEqual({ type: 'as_needed' });
  });

  it('falls back to as_needed on legacy free-text (pre-v5 stub) values', () => {
    expect(parseSchedule('once a day')).toEqual({ type: 'as_needed' });
  });

  it('falls back to as_needed on null JSON', () => {
    expect(parseSchedule('null')).toEqual({ type: 'as_needed' });
  });

  it('falls back to as_needed on an array (not an object)', () => {
    expect(parseSchedule('[1,2,3]')).toEqual({ type: 'as_needed' });
  });

  it('falls back to as_needed on an unrecognised type', () => {
    expect(parseSchedule(JSON.stringify({ type: 'hourly' }))).toEqual({ type: 'as_needed' });
  });

  it('falls back to as_needed when days_of_week has no days array', () => {
    expect(parseSchedule(JSON.stringify({ type: 'days_of_week' }))).toEqual({ type: 'as_needed' });
  });

  it('filters out-of-range / non-integer entries from days_of_week', () => {
    const result = parseSchedule(JSON.stringify({ type: 'days_of_week', days: [1, 7, -1, 3.5, 'Mon', 4] }));
    expect(result).toEqual({ type: 'days_of_week', days: [1, 4] });
  });

  it('accepts an empty days_of_week array (means "due on no day")', () => {
    expect(parseSchedule(JSON.stringify({ type: 'days_of_week', days: [] }))).toEqual({
      type: 'days_of_week',
      days: [],
    });
  });
});

describe('isDueOn', () => {
  it('daily is always due', () => {
    expect(isDueOn({ type: 'daily' }, '2026-09-01')).toBe(true);
    expect(isDueOn({ type: 'daily' }, '2026-12-25')).toBe(true);
  });

  it('as_needed is never due', () => {
    expect(isDueOn({ type: 'as_needed' }, '2026-09-01')).toBe(false);
  });

  it('days_of_week matches only the specified weekdays', () => {
    // 2026-09-07 is a Monday.
    const monday = '2026-09-07';
    const tuesday = '2026-09-08';
    const spec = { type: 'days_of_week' as const, days: [1] }; // Monday
    expect(isDueOn(spec, monday)).toBe(true);
    expect(isDueOn(spec, tuesday)).toBe(false);
  });

  it('days_of_week with an empty days array is never due', () => {
    expect(isDueOn({ type: 'days_of_week', days: [] }, '2026-09-07')).toBe(false);
  });

  it('days_of_week correctly identifies Sunday (0) and Saturday (6)', () => {
    // 2026-09-06 is a Sunday, 2026-09-12 is a Saturday.
    const sunday = '2026-09-06';
    const saturday = '2026-09-12';
    expect(isDueOn({ type: 'days_of_week', days: [0] }, sunday)).toBe(true);
    expect(isDueOn({ type: 'days_of_week', days: [6] }, saturday)).toBe(true);
    expect(isDueOn({ type: 'days_of_week', days: [0] }, saturday)).toBe(false);
  });
});

describe('describeSchedule', () => {
  it('describes daily and as_needed plainly', () => {
    expect(describeSchedule({ type: 'daily' })).toBe('Daily');
    expect(describeSchedule({ type: 'as_needed' })).toBe('As needed');
  });

  it('describes days_of_week sorted, using short weekday names', () => {
    expect(describeSchedule({ type: 'days_of_week', days: [5, 1, 3] })).toBe('Mon, Wed, Fri');
  });

  it('describes an empty days_of_week as "No days set"', () => {
    expect(describeSchedule({ type: 'days_of_week', days: [] })).toBe('No days set');
  });
});
