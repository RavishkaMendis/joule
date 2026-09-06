import { parseZeppDate } from '../zeppDates';

describe('parseZeppDate — ISO', () => {
  it('parses a plain ISO date', () => {
    expect(parseZeppDate('2026-03-04')).toEqual({ iso: '2026-03-04', ambiguityNote: null });
  });

  it('parses ISO with a time component', () => {
    expect(parseZeppDate('2026-03-04T08:00:00Z')).toEqual({ iso: '2026-03-04', ambiguityNote: null });
  });

  it('parses ISO with a space-separated time component', () => {
    expect(parseZeppDate('2026-03-04 08:00:00')).toEqual({ iso: '2026-03-04', ambiguityNote: null });
  });

  it('rejects an invalid ISO calendar date (Feb 30)', () => {
    expect(parseZeppDate('2026-02-30')).toEqual({ iso: null, ambiguityNote: null });
  });

  it('pads single-digit month/day', () => {
    expect(parseZeppDate('2026-3-4')).toEqual({ iso: '2026-03-04', ambiguityNote: null });
  });
});

describe('parseZeppDate — epoch', () => {
  it('parses epoch milliseconds', () => {
    // 2026-01-15T00:00:00.000Z
    const ms = Date.UTC(2026, 0, 15);
    expect(parseZeppDate(String(ms))).toEqual({ iso: '2026-01-15', ambiguityNote: null });
  });

  it('parses epoch seconds', () => {
    const seconds = Math.floor(Date.UTC(2026, 0, 15) / 1000);
    expect(parseZeppDate(String(seconds))).toEqual({ iso: '2026-01-15', ambiguityNote: null });
  });

  it('rejects an out-of-range numeric string', () => {
    expect(parseZeppDate('42')).toEqual({ iso: null, ambiguityNote: null });
  });
});

describe('parseZeppDate — slash/dash/dot separated', () => {
  it('parses unambiguous D/M/Y (day > 12)', () => {
    expect(parseZeppDate('25/03/2026')).toEqual({ iso: '2026-03-25', ambiguityNote: null });
  });

  it('parses unambiguous M/D/Y (second component > 12)', () => {
    expect(parseZeppDate('03/25/2026')).toEqual({ iso: '2026-03-25', ambiguityNote: null });
  });

  it('parses Y/M/D when the first component is 4 digits', () => {
    expect(parseZeppDate('2026/03/04')).toEqual({ iso: '2026-03-04', ambiguityNote: null });
  });

  it('defaults ambiguous D/M vs M/D to DD/MM/YYYY (AU locale) and reports the ambiguity', () => {
    const result = parseZeppDate('03/04/2026');
    expect(result.iso).toBe('2026-04-03');
    expect(result.ambiguityNote).toContain('DD/MM/YYYY');
    expect(result.ambiguityNote).toContain('03/04/2026');
  });

  it('rejects a date where neither component can be a valid month/day (both > 12 and not a valid pair)', () => {
    expect(parseZeppDate('13/13/2026')).toEqual({ iso: null, ambiguityNote: null });
  });

  it('handles dot separators', () => {
    expect(parseZeppDate('25.03.2026')).toEqual({ iso: '2026-03-25', ambiguityNote: null });
  });

  it('handles dash separators with a 2-digit year', () => {
    expect(parseZeppDate('25-03-26')).toEqual({ iso: '2026-03-25', ambiguityNote: null });
  });

  it('rejects an invalid calendar date via the slash path', () => {
    expect(parseZeppDate('31/02/2026')).toEqual({ iso: null, ambiguityNote: null });
  });
});

describe('parseZeppDate — edge cases', () => {
  it('returns null for an empty string', () => {
    expect(parseZeppDate('')).toEqual({ iso: null, ambiguityNote: null });
  });

  it('returns null for whitespace-only input', () => {
    expect(parseZeppDate('   ')).toEqual({ iso: null, ambiguityNote: null });
  });

  it('returns null for garbage text', () => {
    expect(parseZeppDate('not a date')).toEqual({ iso: null, ambiguityNote: null });
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseZeppDate('  2026-03-04  ')).toEqual({ iso: '2026-03-04', ambiguityNote: null });
  });
});
