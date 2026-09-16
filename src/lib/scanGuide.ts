// ═══════════════════════════════════════════════════════════════════════
// Scan guide geometry — LabelScanScreen's on-screen framing box.
//
// Pulled into a pure function because LabelScanScreen itself is
// camera-bound and hard to render in tests. This is the part that can
// (and must) be unit tested directly: given a viewport size and safe-area
// insets, what rectangle should the guide be?
//
// Two things this deliberately does NOT do:
//   - It does not crop anything. `expo-image-manipulator` is not
//     installed (an intentional scope boundary — adding it means a new
//     native build), so the full camera frame is still what's captured
//     and sent to Gemini. This guide is honest framing help, not a crop
//     boundary — see LabelScanScreen's hint copy, which says so.
//   - It does not hardcode pixels. The old box was a fixed 300×200
//     (landscape) rectangle that had no relationship to the phone it ran
//     on. This scales from the actual viewport (`useWindowDimensions`)
//     so it behaves the same on a 430×932 phone and a much smaller one,
//     and is clamped so it doesn't become absurd on a tablet.
// ═══════════════════════════════════════════════════════════════════════

export interface ScanGuideInsets {
  top: number;
  bottom: number;
}

export interface ScanGuideRect {
  width: number;
  height: number;
}

/**
 * width / height. Australian nutrition panels run tall and narrow — nothing
 * like the old hardcoded 300×200 landscape box, which fought the subject
 * instead of matching it.
 */
export const SCAN_GUIDE_ASPECT_RATIO = 0.62;

/** Fraction of viewport width the guide should span before clamping. */
const WIDTH_FRACTION = 0.78;

export const SCAN_GUIDE_MIN_WIDTH = 190;
export const SCAN_GUIDE_MAX_WIDTH = 340;
export const SCAN_GUIDE_MAX_HEIGHT = 480;

/**
 * Vertical space reserved OUTSIDE the guide for the rest of the capture
 * screen's chrome (date banner above; hint text, the flexible spacer, and
 * the shutter/gallery/manual-entry control row below), on top of the
 * screen's own safe-area insets. Deliberately approximate — the guide
 * only needs to leave enough room for that chrome, not align to it pixel
 * for pixel, since the screen's own flex layout does the actual
 * positioning of everything.
 */
const TOP_CHROME = 56;
const BOTTOM_CHROME = 200;

/** Smallest vertical budget we'll ever compute the guide against, so a pathological viewport can't drive it to zero. */
const MIN_AVAILABLE_HEIGHT = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Given the viewport size (from `useWindowDimensions`) and the screen's
 * safe-area insets, returns the on-screen scan guide's size: a portrait
 * rectangle shaped for a nutrition panel, scaled to fit the device.
 *
 * Invariants (see `src/lib/__tests__/scanGuide.test.ts`):
 *   - width / height always equals `SCAN_GUIDE_ASPECT_RATIO` exactly.
 *   - the result always fits within the viewport, insets included.
 *   - width never exceeds `SCAN_GUIDE_MAX_WIDTH`; height never exceeds
 *     `SCAN_GUIDE_MAX_HEIGHT`.
 *   - width and height are always positive, even for a degenerate
 *     (zero/negative) viewport input.
 */
export function computeScanGuideRect(
  viewportWidth: number,
  viewportHeight: number,
  insets: ScanGuideInsets
): ScanGuideRect {
  const safeViewportWidth = Math.max(viewportWidth, 1);
  const safeViewportHeight = Math.max(viewportHeight, 1);

  let width = clamp(safeViewportWidth * WIDTH_FRACTION, SCAN_GUIDE_MIN_WIDTH, SCAN_GUIDE_MAX_WIDTH);
  let height = width / SCAN_GUIDE_ASPECT_RATIO;

  const reservedVertical = Math.max(insets.top, 0) + Math.max(insets.bottom, 0) + TOP_CHROME + BOTTOM_CHROME;
  const availableHeight = Math.max(safeViewportHeight - reservedVertical, MIN_AVAILABLE_HEIGHT);
  const maxHeight = Math.min(SCAN_GUIDE_MAX_HEIGHT, availableHeight);

  if (height > maxHeight) {
    height = maxHeight;
    width = height * SCAN_GUIDE_ASPECT_RATIO;
  }

  return {
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}
