import { linearScale, numericExtent, padDomain } from '../chartScale';

describe('linearScale', () => {
  test('maps domain endpoints to range endpoints', () => {
    const scale = linearScale([0, 100], [0, 300]);
    expect(scale(0)).toBe(0);
    expect(scale(100)).toBe(300);
    expect(scale(50)).toBe(150);
  });

  test('handles an inverted range (e.g. SVG y-axis, larger value = smaller pixel y)', () => {
    const scale = linearScale([0, 10], [200, 0]);
    expect(scale(0)).toBe(200);
    expect(scale(10)).toBe(0);
    expect(scale(5)).toBe(100);
  });

  test('degenerates to the range midpoint when domain has zero width (single data point)', () => {
    const scale = linearScale([50, 50], [0, 100]);
    expect(scale(50)).toBe(50);
    expect(Number.isFinite(scale(50))).toBe(true);
  });
});

describe('numericExtent', () => {
  test('finds min/max across one series', () => {
    expect(numericExtent([3, 1, 4, 1, 5])).toEqual([1, 5]);
  });

  test('ignores null/undefined/NaN values (gap days)', () => {
    expect(numericExtent([3, null, 4, undefined, NaN, 5])).toEqual([3, 5]);
  });

  test('combines multiple series (e.g. raw + smoothed weight)', () => {
    expect(numericExtent([80, 81], [79.5, 80.5])).toEqual([79.5, 81]);
  });

  test('returns null when every value is a gap', () => {
    expect(numericExtent([null, null, undefined])).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(numericExtent([])).toBeNull();
  });
});

describe('padDomain', () => {
  test('pads a normal domain by the given fraction', () => {
    expect(padDomain([0, 100], 0.1)).toEqual([-10, 110]);
  });

  test('uses a fixed pad when the domain has zero span (single value)', () => {
    expect(padDomain([50, 50], 0.1, 2)).toEqual([48, 52]);
  });
});
