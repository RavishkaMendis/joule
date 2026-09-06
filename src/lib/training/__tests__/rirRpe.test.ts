import { rpeToRir, rirToRpe } from '../rirRpe';

describe('rirRpe conversion', () => {
  it('rpeToRir: RPE 10 (failure) is 0 RIR', () => {
    expect(rpeToRir(10)).toBe(0);
  });

  it('rpeToRir: RPE 6 is 4 RIR', () => {
    expect(rpeToRir(6)).toBe(4);
  });

  it('rpeToRir handles half-steps', () => {
    expect(rpeToRir(8.5)).toBe(1.5);
  });

  it('rirToRpe: 0 RIR is RPE 10', () => {
    expect(rirToRpe(0)).toBe(10);
  });

  it('rirToRpe: 2 RIR is RPE 8', () => {
    expect(rirToRpe(2)).toBe(8);
  });

  it('round-trips exactly for any value (plain 10-minus relationship)', () => {
    for (const value of [0, 1, 1.5, 2, 4, 6, 7.5, 9.5, 10]) {
      expect(rirToRpe(rpeToRir(value))).toBe(value);
      expect(rpeToRir(rirToRpe(value))).toBe(value);
    }
  });
});
