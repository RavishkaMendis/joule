// ═══════════════════════════════════════════════════════════════════════
// SCAN DEBOUNCE — guards continuous barcode scanning against
// `expo-camera`'s repeated `onBarcodeScanned` firings for one code sitting
// in frame (task brief: "without a guard you'll add the same product five
// times"), AND against BUG 3's real double-add ("scans the same item
// twice because it's so fast" — see scanDebounce.ts's header for the full
// root-cause diagnosis: the old window measured elapsed time since
// ACCEPTANCE, so a dwell longer than the window — entirely plausible in a
// one-handed kitchen scan — re-triggered on a code that never left frame).
//
// Pure predicate + pure state update, no camera/timer mocking needed. The
// contract under test: `recordSighting` must be called on EVERY firing
// (this file always pairs a `shouldAcceptScan` check with an unconditional
// `recordSighting`, exactly like BarcodeScanScreen does), so these tests
// exercise the real integration shape, not just the predicate in
// isolation.
// ═══════════════════════════════════════════════════════════════════════

import {
  INITIAL_SCAN_DEBOUNCE_STATE,
  recordSighting,
  SCAN_DEBOUNCE_MS,
  shouldAcceptScan,
  type ScanDebounceState,
} from '../scanDebounce';

/** Simulates one `onBarcodeScanned` firing exactly as BarcodeScanScreen does: check, then unconditionally record the sighting. */
function fire(state: ScanDebounceState, barcode: string, now: number): { accepted: boolean; next: ScanDebounceState } {
  const accepted = shouldAcceptScan(state, barcode, now);
  const next = recordSighting(barcode, now);
  return { accepted, next };
}

describe('shouldAcceptScan', () => {
  it('accepts the very first scan (no prior state)', () => {
    expect(shouldAcceptScan(INITIAL_SCAN_DEBOUNCE_STATE, '111', 1000)).toBe(true);
  });

  it('rejects an immediate repeat of the same barcode (the camera firing rapidly while the code is still in frame)', () => {
    const afterFirst = recordSighting('111', 1000);
    expect(shouldAcceptScan(afterFirst, '111', 1010)).toBe(false);
    expect(shouldAcceptScan(afterFirst, '111', 1000 + SCAN_DEBOUNCE_MS - 1)).toBe(false);
  });

  it('accepts the same barcode again once it has gone unseen for the full debounce window', () => {
    const afterFirst = recordSighting('111', 1000);
    expect(shouldAcceptScan(afterFirst, '111', 1000 + SCAN_DEBOUNCE_MS)).toBe(true);
    expect(shouldAcceptScan(afterFirst, '111', 1000 + SCAN_DEBOUNCE_MS + 500)).toBe(true);
  });

  it('accepts a DIFFERENT barcode immediately, regardless of timing (two different products scanned back-to-back)', () => {
    const afterFirst = recordSighting('111', 1000);
    expect(shouldAcceptScan(afterFirst, '222', 1001)).toBe(true);
  });

  it('is a pure function of its inputs — calling it twice with the same args gives the same answer', () => {
    const state: ScanDebounceState = recordSighting('111', 1000);
    expect(shouldAcceptScan(state, '111', 1200)).toBe(shouldAcceptScan(state, '111', 1200));
  });
});

describe('recordSighting', () => {
  it('records the barcode and timestamp', () => {
    expect(recordSighting('999', 5000)).toEqual({ lastBarcode: '999', lastSeenAt: 5000 });
  });

  it('overwrites the previous record entirely (only the most recent sighting matters)', () => {
    const first = recordSighting('111', 1000);
    const second = recordSighting('222', 2000);
    expect(second).toEqual({ lastBarcode: '222', lastSeenAt: 2000 });
    expect(second).not.toEqual(first);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BUG 3 FIX — the actual reported failure mode: holding the phone over a
// barcode for LONGER than the debounce window while it never leaves
// frame must still count as exactly ONE scan. The old "elapsed time
// since acceptance" mechanism would have re-accepted this; the new
// "continuous sighting" mechanism (recordSighting called on every
// firing, accepted or not) must not.
// ═══════════════════════════════════════════════════════════════════════

describe('a prolonged dwell on the SAME barcode (the real double-add bug)', () => {
  it('never re-accepts as long as the code keeps being sighted, even well past the old fixed window', () => {
    let state = INITIAL_SCAN_DEBOUNCE_STATE;
    const accepted: number[] = [];
    // The camera keeps firing for the same code every ~200ms for 4
    // seconds straight — comfortably longer than SCAN_DEBOUNCE_MS (1500)
    // — simulating a user who scanned, then just kept the phone aimed at
    // roughly the same spot while reaching for the next item.
    for (let t = 0; t <= 4000; t += 200) {
      const result = fire(state, 'BREAD', t);
      state = result.next;
      if (result.accepted) accepted.push(t);
    }
    expect(accepted).toEqual([0]); // accepted exactly once, at the very first sighting
  });

  it('DOES accept a second scan once the code has genuinely gone quiet for the full window (the user moved the phone away and back)', () => {
    let state = INITIAL_SCAN_DEBOUNCE_STATE;
    // First dwell: t=0..300.
    for (const t of [0, 100, 200, 300]) {
      state = fire(state, 'YOGHURT', t).next;
    }
    // Silence for longer than SCAN_DEBOUNCE_MS (the code left frame) — no
    // firings at all in this gap, unlike the "prolonged dwell" case above.
    const secondScanAt = 300 + SCAN_DEBOUNCE_MS + 1;
    const result = fire(state, 'YOGHURT', secondScanAt);
    expect(result.accepted).toBe(true); // a genuinely new dwell on the same product
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SIMULATING A REALISTIC BURST — expo-camera calling onBarcodeScanned
// several times per second while a code is held in frame, then the user
// moving to a new product.
// ═══════════════════════════════════════════════════════════════════════

describe('simulated scan burst (continuous scanning session)', () => {
  it('a rapid burst of identical reads accepts exactly once', () => {
    let state = INITIAL_SCAN_DEBOUNCE_STATE;
    let acceptedCount = 0;
    // Simulate ~10 firings over 300ms, same barcode, comfortably inside one dwell.
    for (let t = 0; t <= 300; t += 30) {
      const result = fire(state, 'AAA', t);
      state = result.next;
      if (result.accepted) acceptedCount += 1;
    }
    expect(acceptedCount).toBe(1);
  });

  it('scanning bread then jam in sequence accepts both (the continuous-scanning happy path)', () => {
    let state = INITIAL_SCAN_DEBOUNCE_STATE;
    const accepted: string[] = [];

    // Bread: burst of reads at t=0..200.
    for (const t of [0, 40, 80, 120, 160, 200]) {
      const result = fire(state, 'BREAD', t);
      state = result.next;
      if (result.accepted) accepted.push('BREAD');
    }

    // User moves the camera to the jam jar at t=2000 (well past the debounce window, and BREAD hasn't been sighted since t=200).
    for (const t of [2000, 2040, 2080]) {
      const result = fire(state, 'JAM', t);
      state = result.next;
      if (result.accepted) accepted.push('JAM');
    }

    expect(accepted).toEqual(['BREAD', 'JAM']);
  });

  it('re-scanning the identical product a second time (e.g. two tubs of the same yoghurt) works after a genuine gap', () => {
    let state = recordSighting('YOGHURT', 0);
    // Still within the window — must be ignored.
    expect(shouldAcceptScan(state, 'YOGHURT', 500)).toBe(false);
    // Past the window, with nothing sighted in between — the user genuinely wants a second one logged.
    expect(shouldAcceptScan(state, 'YOGHURT', SCAN_DEBOUNCE_MS + 1)).toBe(true);
    state = recordSighting('YOGHURT', SCAN_DEBOUNCE_MS + 1);
    expect(state.lastSeenAt).toBe(SCAN_DEBOUNCE_MS + 1);
  });
});
