import {
  computeScanGuideRect,
  SCAN_GUIDE_ASPECT_RATIO,
  SCAN_GUIDE_MAX_HEIGHT,
  SCAN_GUIDE_MAX_WIDTH,
} from '../scanGuide';

describe('computeScanGuideRect', () => {
  it('maintains the portrait nutrition-panel aspect ratio', () => {
    const rect = computeScanGuideRect(430, 932, { top: 59, bottom: 34 });
    expect(rect.width / rect.height).toBeCloseTo(SCAN_GUIDE_ASPECT_RATIO, 5);
    expect(rect.width).toBeLessThan(rect.height); // portrait, not landscape
  });

  it('fits within the viewport on the owner\'s 430x932 phone', () => {
    const insets = { top: 59, bottom: 34 };
    const rect = computeScanGuideRect(430, 932, insets);
    expect(rect.width).toBeLessThanOrEqual(430);
    expect(rect.height).toBeLessThanOrEqual(932 - insets.top - insets.bottom);
  });

  it('fits within the viewport on a smaller iPhone', () => {
    const insets = { top: 47, bottom: 34 };
    const rect = computeScanGuideRect(375, 667, insets);
    expect(rect.width).toBeLessThanOrEqual(375);
    expect(rect.height).toBeLessThanOrEqual(667 - insets.top - insets.bottom);
    expect(rect.width / rect.height).toBeCloseTo(SCAN_GUIDE_ASPECT_RATIO, 5);
  });

  it('respects max bounds on a tablet-sized viewport', () => {
    const rect = computeScanGuideRect(768, 1024, { top: 24, bottom: 0 });
    expect(rect.width).toBeLessThanOrEqual(SCAN_GUIDE_MAX_WIDTH);
    expect(rect.height).toBeLessThanOrEqual(SCAN_GUIDE_MAX_HEIGHT);
  });

  it('scales up with a larger viewport but stays under the caps', () => {
    const small = computeScanGuideRect(360, 780, { top: 24, bottom: 0 });
    const large = computeScanGuideRect(768, 1024, { top: 24, bottom: 0 });
    expect(large.width).toBeGreaterThanOrEqual(small.width);
  });

  it('never returns a negative or zero dimension, even for a degenerate viewport', () => {
    const cases: Array<[number, number, { top: number; bottom: number }]> = [
      [0, 0, { top: 0, bottom: 0 }],
      [-100, -100, { top: 0, bottom: 0 }],
      [430, 100, { top: 59, bottom: 34 }], // absurdly short viewport
      [100, 932, { top: 500, bottom: 500 }], // insets that swamp the viewport
    ];
    for (const [w, h, insets] of cases) {
      const rect = computeScanGuideRect(w, h, insets);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  it('never exceeds the max width/height caps regardless of viewport size', () => {
    const rect = computeScanGuideRect(2000, 3000, { top: 0, bottom: 0 });
    expect(rect.width).toBeLessThanOrEqual(SCAN_GUIDE_MAX_WIDTH);
    expect(rect.height).toBeLessThanOrEqual(SCAN_GUIDE_MAX_HEIGHT);
  });
});
