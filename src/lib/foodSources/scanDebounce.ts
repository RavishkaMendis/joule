// ═══════════════════════════════════════════════════════════════════════
// SCAN DEBOUNCE — the guard behind continuous barcode scanning.
//
// Real-use complaint (task brief #2): "I scan bread, log it, then have to
// scan the jam separately." The fix keeps the camera live after a
// successful lookup so the next barcode can be scanned immediately. But
// `expo-camera`'s `onBarcodeScanned` fires repeatedly (many times a
// second) while a code sits in frame — without a guard, holding the phone
// steady over one barcode for even half a second adds the same product
// five times to the basket.
//
// This is a pure predicate specifically so the debounce mechanism is
// unit-testable without mounting a camera. The screen calls
// `shouldAcceptScan(state, barcode, now)` on every `onBarcodeScanned`
// firing, THEN unconditionally calls `recordSighting(state, barcode,
// now)` to update its lock state — on every firing, not just accepted
// ones (see that function's own doc for why this order matters).
//
// ── BUG 3 FIX: root cause of the real double-add, and why the mechanism
//    changed (not just the number) ──────────────────────────────────────
//
// User report: "the barcode scanner scans the same item twice
// accidentally because it's so fast." The OLD implementation measured a
// fixed window from the moment a scan was ACCEPTED: a repeat of the same
// barcode was rejected only while `now - lastAcceptedAt < 1500`. That
// works fine for a quick, clean scan — but it does NOT model what
// actually happens in a kitchen: the user scans an item, then keeps the
// phone aimed roughly at the same spot for a beat longer than 1.5s while
// they set it down, reach for the next item, or just read the "Added"
// confirmation — all while the SAME barcode is still fully in frame and
// `onBarcodeScanned` keeps firing for it. Once total elapsed time passed
// 1500ms, the old code accepted that still-in-frame code as if it were a
// brand new scan, because it was only checking a clock, never whether the
// code had actually left and come back. A slow one, network-bound lookup
// (Open Food Facts) made this worse: the debounce clock started at
// acceptance, not at lookup completion, so a >1.5s round trip could
// elapse the window before the user had even had a chance to move the
// phone away.
//
// The fix: suppression is now based on CONTINUOUS PRESENCE, not elapsed
// wall-clock time since acceptance. `recordSighting` is called on every
// single `onBarcodeScanned` firing (accepted or rejected) and refreshes
// `lastSeenAt` for that barcode. `shouldAcceptScan` then asks "how long
// has it been since this exact barcode was last SEEN at all" rather than
// "how long has it been since it was last ACCEPTED" — so as long as a
// code stays continuously in frame, no matter how long (3 seconds, 10
// seconds), every firing keeps refreshing `lastSeenAt` and it is never
// re-accepted. Only once the code genuinely leaves frame for a full
// `SCAN_DEBOUNCE_MS` — meaning the LAST time it was seen at all is that
// old — does the next sighting count as a fresh scan. `SCAN_DEBOUNCE_MS`
// itself stays 1500ms: that number was never the problem (it comfortably
// exceeds `expo-camera`'s inter-frame gap, so it isn't blindly raised),
// the clock it was being measured against was.
// ═══════════════════════════════════════════════════════════════════════

/** The minimal state the debounce predicate needs: which barcode was last seen at all (accepted or not), and when. */
export type ScanDebounceState = {
  lastBarcode: string | null;
  lastSeenAt: number | null;
};

export const INITIAL_SCAN_DEBOUNCE_STATE: ScanDebounceState = { lastBarcode: null, lastSeenAt: null };

/**
 * Continuous-absence threshold, milliseconds. Not a "cooldown after
 * acceptance" — a gap this long with NO sighting of the same barcode is
 * what counts as "the code left frame". `expo-camera` fires
 * `onBarcodeScanned` many times a second while a code is in frame, so
 * 1500ms comfortably exceeds any inter-frame gap that can occur while the
 * code is still genuinely present (including brief motion blur / a
 * partial occlusion), while still being short enough that a deliberate
 * re-scan of the same product moments later (e.g. two identical yoghurt
 * tubs) isn't blocked for an annoying length of time once the phone has
 * actually moved away and back.
 */
export const SCAN_DEBOUNCE_MS = 1500;

/**
 * Decides whether a freshly-read barcode should be accepted (kick off a
 * lookup) or ignored as the same continuous dwell still in frame.
 *
 * A DIFFERENT barcode is always accepted immediately regardless of
 * timing — there is no reason to make the user wait between two
 * genuinely different products. The SAME barcode is accepted only when
 * it has not been sighted at all (accepted or not — see `recordSighting`)
 * for at least `SCAN_DEBOUNCE_MS`, i.e. it demonstrably left frame and
 * came back, not merely that a clock elapsed while it was still there.
 */
export function shouldAcceptScan(state: ScanDebounceState, barcode: string, now: number): boolean {
  if (state.lastBarcode !== barcode) return true;
  if (state.lastSeenAt === null) return true;
  return now - state.lastSeenAt >= SCAN_DEBOUNCE_MS;
}

/**
 * Pure state update for EVERY `onBarcodeScanned` firing — call this
 * unconditionally, whether `shouldAcceptScan` returned true or false.
 * This is what makes suppression last for the code's entire continuous
 * dwell instead of a fixed window from first acceptance: each firing
 * refreshes `lastSeenAt`, so the "has this genuinely gone quiet for
 * SCAN_DEBOUNCE_MS" check in `shouldAcceptScan` only ever sees a large
 * gap once the code has actually stopped being detected.
 */
export function recordSighting(barcode: string, now: number): ScanDebounceState {
  return { lastBarcode: barcode, lastSeenAt: now };
}
