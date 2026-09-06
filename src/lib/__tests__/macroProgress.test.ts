import { computeMacroProgress } from '../macroProgress';

describe('computeMacroProgress', () => {
  it('returns null ratio and zero fill when there is no target yet', () => {
    const result = computeMacroProgress(33, null);
    expect(result.ratio).toBeNull();
    expect(result.fillFraction).toBe(0);
    expect(result.isOverTarget).toBe(false);
  });

  it('treats a non-finite or non-positive target the same as no target', () => {
    expect(computeMacroProgress(50, 0).ratio).toBeNull();
    expect(computeMacroProgress(50, -10).ratio).toBeNull();
    expect(computeMacroProgress(50, NaN).ratio).toBeNull();
  });

  it('computes a partial ratio under target', () => {
    const result = computeMacroProgress(33, 165);
    expect(result.ratio).toBeCloseTo(0.2);
    expect(result.fillFraction).toBeCloseTo(0.2);
    expect(result.isOverTarget).toBe(false);
  });

  it('reaching target exactly is "over" (>=) and fills completely, not "danger"', () => {
    const result = computeMacroProgress(165, 165);
    expect(result.ratio).toBeCloseTo(1);
    expect(result.fillFraction).toBe(1);
    expect(result.isOverTarget).toBe(true);
  });

  it('clamps fillFraction to 1 when over target, without capping the reported ratio', () => {
    const result = computeMacroProgress(220, 165);
    expect(result.ratio).toBeCloseTo(220 / 165);
    expect(result.fillFraction).toBe(1);
    expect(result.isOverTarget).toBe(true);
  });

  it('wildly over target still reports fillFraction 1, not a longer bar', () => {
    const result = computeMacroProgress(1650, 165);
    expect(result.fillFraction).toBe(1);
    expect(result.isOverTarget).toBe(true);
  });

  it('treats a negative or non-finite value as zero rather than a negative fill', () => {
    expect(computeMacroProgress(-5, 100).fillFraction).toBe(0);
    expect(computeMacroProgress(NaN, 100).fillFraction).toBe(0);
  });

  it('zero value under a real target is a valid, non-over start state', () => {
    const result = computeMacroProgress(0, 165);
    expect(result.ratio).toBe(0);
    expect(result.fillFraction).toBe(0);
    expect(result.isOverTarget).toBe(false);
  });
});
