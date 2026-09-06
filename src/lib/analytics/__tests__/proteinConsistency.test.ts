import { summarizeProteinConsistency } from '../proteinConsistency';

describe('summarizeProteinConsistency', () => {
  test('empty input returns all-null/zero stats, never NaN', () => {
    const summary = summarizeProteinConsistency([], 150);
    expect(summary.loggedDays).toBe(0);
    expect(summary.hitRateFraction).toBeNull();
    expect(summary.avgProteinG).toBeNull();
    expect(summary.medianProteinG).toBeNull();
    // Histogram buckets still exist (a fixed shape for the UI to render),
    // but every bucket count is 0 — never NaN, never fabricated.
    expect(summary.histogram.every((b) => b.count === 0)).toBe(true);
  });

  test('null target (no check-in yet) suppresses hit-rate/histogram but still reports raw average', () => {
    const summary = summarizeProteinConsistency(
      [{ date: '2026-01-01', proteinG: 140, isComplete: true }],
      null
    );
    expect(summary.avgProteinG).toBe(140);
    expect(summary.hitRateFraction).toBeNull();
    expect(summary.histogram).toEqual([]);
  });

  test('single logged day at exactly target counts as a hit', () => {
    const summary = summarizeProteinConsistency(
      [{ date: '2026-01-01', proteinG: 150, isComplete: true }],
      150
    );
    expect(summary.loggedDays).toBe(1);
    expect(summary.daysHitTarget).toBe(1);
    expect(summary.hitRateFraction).toBe(1);
    expect(summary.avgProteinG).toBe(150);
    expect(summary.medianProteinG).toBe(150);
  });

  test('gap days (proteinG null) are excluded entirely — not counted as 0g misses', () => {
    const summary = summarizeProteinConsistency(
      [
        { date: '2026-01-01', proteinG: 150, isComplete: true },
        { date: '2026-01-02', proteinG: null, isComplete: true }, // gap
        { date: '2026-01-03', proteinG: 160, isComplete: true },
      ],
      150
    );
    expect(summary.loggedDays).toBe(2);
    expect(summary.daysHitTarget).toBe(2);
    expect(summary.hitRateFraction).toBe(1);
    expect(summary.avgProteinG).toBe(155);
  });

  test('90% tolerance threshold: a day at 90% of target counts as a hit, 89% does not', () => {
    const summary = summarizeProteinConsistency(
      [
        { date: '2026-01-01', proteinG: 135, isComplete: true }, // exactly 90% of 150
        { date: '2026-01-02', proteinG: 133, isComplete: true }, // ~88.7%
      ],
      150
    );
    expect(summary.daysHitTarget).toBe(1);
    expect(summary.hitRateFraction).toBe(0.5);
  });

  test('histogram buckets sum to loggedDays and reflect distribution shape', () => {
    const summary = summarizeProteinConsistency(
      [
        { date: '2026-01-01', proteinG: 60, isComplete: true }, // 40% -> <60%
        { date: '2026-01-02', proteinG: 100, isComplete: true }, // ~66.7% -> 60-89%
        { date: '2026-01-03', proteinG: 150, isComplete: true }, // 100% -> 90-109%
        { date: '2026-01-04', proteinG: 200, isComplete: true }, // ~133% -> 110-139%
        { date: '2026-01-05', proteinG: 300, isComplete: true }, // 200% -> 140%+
      ],
      150
    );
    const total = summary.histogram.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(5);
    expect(summary.histogram.map((b) => b.count)).toEqual([1, 1, 1, 1, 1]);
  });
});
