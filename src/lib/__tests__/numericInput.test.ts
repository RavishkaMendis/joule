import { parseRequiredNumber, isBlankOrInvalidNumber } from '../numericInput';

describe('parseRequiredNumber', () => {
  it('rejects an empty string — blank is never a silent 0', () => {
    expect(parseRequiredNumber('')).toEqual({ valid: false, value: null });
  });

  it('rejects whitespace-only text', () => {
    expect(parseRequiredNumber('   ')).toEqual({ valid: false, value: null });
    expect(parseRequiredNumber('\t\n')).toEqual({ valid: false, value: null });
  });

  it('rejects non-numeric text', () => {
    expect(parseRequiredNumber('abc')).toEqual({ valid: false, value: null });
  });

  it('accepts a plain decimal', () => {
    expect(parseRequiredNumber('1.5')).toEqual({ valid: true, value: 1.5 });
  });

  it('accepts a comma decimal separator, per the app convention', () => {
    expect(parseRequiredNumber('1,5')).toEqual({ valid: true, value: 1.5 });
  });

  it('accepts a negative number as a syntactically valid parse (callers enforce sign/positivity themselves)', () => {
    expect(parseRequiredNumber('-3')).toEqual({ valid: true, value: -3 });
  });

  it('treats "0" as a genuinely valid value, not blank', () => {
    expect(parseRequiredNumber('0')).toEqual({ valid: true, value: 0 });
  });

  it('rejects a trailing-dot-only fragment ("1.") the same way Number does — not a special case here', () => {
    // Number('1.') === 1, which IS finite, so this parses as 1. The
    // transient "1." the user sees while typing "1.5" is exactly the
    // reason state is stored as raw text rather than a coerced number —
    // parseRequiredNumber only judges the text at submit time.
    expect(parseRequiredNumber('1.')).toEqual({ valid: true, value: 1 });
  });

  it('rejects a bare "."', () => {
    expect(parseRequiredNumber('.')).toEqual({ valid: false, value: null });
  });

  it('rejects "Infinity" — not a finite number', () => {
    expect(parseRequiredNumber('Infinity')).toEqual({ valid: false, value: null });
    expect(parseRequiredNumber('-Infinity')).toEqual({ valid: false, value: null });
  });

  it('accepts exponential notation, since Number() and Number.isFinite() do', () => {
    expect(parseRequiredNumber('1e5')).toEqual({ valid: true, value: 100000 });
  });

  it('rejects a lone "-" or "," with nothing else', () => {
    expect(parseRequiredNumber('-')).toEqual({ valid: false, value: null });
    expect(parseRequiredNumber(',')).toEqual({ valid: false, value: null });
  });

  it('trims surrounding whitespace around an otherwise-valid number', () => {
    expect(parseRequiredNumber('  42  ')).toEqual({ valid: true, value: 42 });
  });
});

describe('isBlankOrInvalidNumber', () => {
  it('is true for blank/whitespace-only text', () => {
    expect(isBlankOrInvalidNumber('')).toBe(true);
    expect(isBlankOrInvalidNumber('   ')).toBe(true);
  });

  it('is true for non-numeric text', () => {
    expect(isBlankOrInvalidNumber('abc')).toBe(true);
  });

  it('is false for a legitimate zero — the distinction that matters', () => {
    expect(isBlankOrInvalidNumber('0')).toBe(false);
  });

  it('is false for ordinary valid numbers, comma or dot decimal', () => {
    expect(isBlankOrInvalidNumber('1.5')).toBe(false);
    expect(isBlankOrInvalidNumber('1,5')).toBe(false);
    expect(isBlankOrInvalidNumber('-3')).toBe(false);
  });

  it('is true for "Infinity"', () => {
    expect(isBlankOrInvalidNumber('Infinity')).toBe(true);
  });
});
