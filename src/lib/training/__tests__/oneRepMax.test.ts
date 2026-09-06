import { estimateOneRepMax } from '../oneRepMax';

describe('estimateOneRepMax (Epley)', () => {
  it('a single (reps === 1) returns the logged weight itself at high confidence — not an estimate', () => {
    const result = estimateOneRepMax(100, 1);
    expect(result).toEqual({ value: 100, confidence: 'high' });
  });

  it('reps <= 5 is high confidence', () => {
    const result = estimateOneRepMax(100, 5);
    expect(result?.confidence).toBe('high');
    expect(result?.value).toBeCloseTo(100 * (1 + 5 / 30));
  });

  it('reps 6-12 is medium confidence', () => {
    const result = estimateOneRepMax(100, 8);
    expect(result?.confidence).toBe('medium');
    expect(result?.value).toBeCloseTo(100 * (1 + 8 / 30));
  });

  it('reps > 12 is low confidence, still computed (never withheld)', () => {
    const result = estimateOneRepMax(60, 20);
    expect(result?.confidence).toBe('low');
    expect(result?.value).toBeCloseTo(60 * (1 + 20 / 30));
  });

  it('does not blow up or go negative at high rep counts, unlike Brzycki past r=37', () => {
    const result = estimateOneRepMax(40, 50);
    expect(result).not.toBeNull();
    expect(result!.value).toBeGreaterThan(0);
    expect(Number.isFinite(result!.value)).toBe(true);
  });

  it('zero weight (bodyweight exercise, no added load) is a valid input — returns 0, not null/NaN', () => {
    const result = estimateOneRepMax(0, 8);
    expect(result).toEqual({ value: 0, confidence: 'medium' });
  });

  it('zero reps carries no strength signal — returns null, never an implicit floor', () => {
    expect(estimateOneRepMax(100, 0)).toBeNull();
  });

  it('negative reps returns null', () => {
    expect(estimateOneRepMax(100, -3)).toBeNull();
  });

  it('negative weight (a data error) returns null', () => {
    expect(estimateOneRepMax(-20, 5)).toBeNull();
  });

  it('non-finite inputs return null', () => {
    expect(estimateOneRepMax(NaN, 5)).toBeNull();
    expect(estimateOneRepMax(100, NaN)).toBeNull();
    expect(estimateOneRepMax(Infinity, 5)).toBeNull();
  });
});
