import { summarizeSourceBreakdown } from '../sourceBreakdown';

describe('summarizeSourceBreakdown', () => {
  test('empty input returns zero totals and null fractions, never NaN', () => {
    const summary = summarizeSourceBreakdown([]);
    expect(summary.totalKcal).toBe(0);
    expect(summary.totalEntries).toBe(0);
    expect(summary.trustedFraction).toBeNull();
    expect(summary.byConfidence.every((c) => c.fraction === null)).toBe(true);
  });

  test('single exact entry is 100% trusted', () => {
    const summary = summarizeSourceBreakdown([{ kcal: 500, confidence: 'exact', source: 'barcode' }]);
    expect(summary.totalKcal).toBe(500);
    expect(summary.trustedFraction).toBe(1);
    const exact = summary.byConfidence.find((c) => c.confidence === 'exact')!;
    expect(exact.fraction).toBe(1);
  });

  test('kcal-weighted, not entry-count-weighted: a big low-confidence meal dominates a small exact one', () => {
    const summary = summarizeSourceBreakdown([
      { kcal: 40, confidence: 'exact', source: 'barcode' }, // small exact condiment
      { kcal: 900, confidence: 'low', source: 'meal_photo' }, // big estimated meal
    ]);
    expect(summary.totalKcal).toBe(940);
    // trusted (exact+high) fraction should be small, dominated by the low-confidence meal.
    expect(summary.trustedFraction).toBeCloseTo(40 / 940, 5);
    const low = summary.byConfidence.find((c) => c.confidence === 'low')!;
    expect(low.fraction).toBeCloseTo(900 / 940, 5);
  });

  test('mixed confidence levels partition to 1.0 total fraction', () => {
    const summary = summarizeSourceBreakdown([
      { kcal: 100, confidence: 'exact', source: 'barcode' },
      { kcal: 100, confidence: 'high', source: 'label_ocr' },
      { kcal: 100, confidence: 'medium', source: 'voice' },
      { kcal: 100, confidence: 'low', source: 'meal_photo' },
    ]);
    const totalFraction = summary.byConfidence.reduce((sum, c) => sum + (c.fraction ?? 0), 0);
    expect(totalFraction).toBeCloseTo(1, 10);
    expect(summary.trustedFraction).toBeCloseTo(0.5, 10);
  });
});
