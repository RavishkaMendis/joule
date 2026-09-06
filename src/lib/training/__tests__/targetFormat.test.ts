import { formatTarget, formatRest } from '../targetFormat';

describe('formatTarget — rep_range', () => {
  it('formats a rep range with a target RIR', () => {
    expect(formatTarget({ targetSets: 3, prescriptionType: 'rep_range', repLow: 8, repHigh: 10, targetRir: 2 })).toBe('3 × 8–10 @ 2 RIR');
  });

  it('omits the RIR suffix when none is prescribed', () => {
    expect(formatTarget({ targetSets: 4, prescriptionType: 'rep_range', repLow: 6, repHigh: 8, targetRir: null })).toBe('4 × 6–8');
  });

  it('collapses a single-rep target to one number instead of "8–8"', () => {
    expect(formatTarget({ targetSets: 3, prescriptionType: 'rep_range', repLow: 8, repHigh: 8, targetRir: 2 })).toBe('3 × 8 @ 2 RIR');
  });

  it('renders a half-step RIR', () => {
    expect(formatTarget({ targetSets: 3, prescriptionType: 'rep_range', repLow: 8, repHigh: 10, targetRir: 1.5 })).toBe('3 × 8–10 @ 1.5 RIR');
  });
});

describe('formatTarget — amrap (to-failure)', () => {
  it('formats a to-failure prescription with a target RIR hint', () => {
    expect(formatTarget({ targetSets: 3, prescriptionType: 'amrap', repLow: null, repHigh: null, targetRir: 0 })).toBe('3 sets to failure @ 0 RIR');
  });

  it('omits the RIR suffix when no hint is given', () => {
    expect(formatTarget({ targetSets: 4, prescriptionType: 'amrap', repLow: null, repHigh: null, targetRir: null })).toBe('4 sets to failure');
  });

  it('uses singular "set" for one set', () => {
    expect(formatTarget({ targetSets: 1, prescriptionType: 'amrap', repLow: null, repHigh: null, targetRir: null })).toBe('1 set to failure');
  });
});

describe('formatRest', () => {
  it('formats seconds', () => {
    expect(formatRest(150)).toBe('Rest ~150s');
  });

  it('returns an empty string when no rest is prescribed', () => {
    expect(formatRest(null)).toBe('');
  });
});
