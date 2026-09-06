import { pickChartDayOffsets } from '../trendsChartMath';

describe('pickChartDayOffsets', () => {
  test('returns every day when totalDays is within the cap', () => {
    expect(pickChartDayOffsets(5, 20)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('returns exactly 0 for a zero-length window', () => {
    expect(pickChartDayOffsets(0, 20)).toEqual([0]);
  });

  test('returns empty for a negative window (defensive)', () => {
    expect(pickChartDayOffsets(-1, 20)).toEqual([]);
  });

  test('caps the number of points for a long history, always including day 0 and the final day', () => {
    const offsets = pickChartDayOffsets(120, 20);
    expect(offsets.length).toBeLessThanOrEqual(21);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(120);
  });

  test('offsets are strictly increasing (no duplicate/out-of-order points)', () => {
    const offsets = pickChartDayOffsets(365, 20);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
  });
});
