// ═══════════════════════════════════════════════════════════════════════
// useCaptureBackHandler — wires the Android hardware back button to the
// capture phase machine so it is never a dead end. Task brief: "Ensure
// the hardware back button works throughout (Android). Check this
// specifically — it's the most likely thing to still trap the user."
//
// Only active while the screen is focused (useFocusEffect), matching
// react-navigation's documented BackHandler pattern, so a backgrounded
// capture screen doesn't steal the back press meant for whatever is on
// top of it.
//
// Delegates the actual decision to the pure `handleHardwareBack` in
// capturePhases.ts: `null` means "let the default happen" (navigate away
// from `camera`, or let the ConfirmSheet Modal's own back handling take
// over from `confirming`); anything else is applied via `setPhase` and
// the event is marked handled so React Navigation does not also pop the
// screen underneath it.
//
// Background-job wiring (task brief: "the AI analysis blocks the user for
// up to a minute"): backing out of `processing` still means "abandon this
// attempt, let me reconsider" — same as the explicit Cancel button always
// meant — so `onCancelProcessing` (optional) fires exactly when that
// specific transition happens, letting the caller dismiss the
// now-abandoned background job (src/lib/captureJobs) in the same gesture.
// This is deliberately NOT how a screen offers "leave it running in the
// background" — that is a separate, explicitly-labelled action
// (ProcessingOverlay's `onLeaveInBackground`) precisely so the ambiguous,
// easy-to-mis-tap hardware back button never accidentally either kills a
// job the user wanted to keep, or leaves one running that they meant to
// abandon.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { handleHardwareBack, type CapturePhase } from './capturePhases';

export function useCaptureBackHandler(
  phase: CapturePhase,
  setPhase: (next: CapturePhase) => void,
  onCancelProcessing?: () => void
) {
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        const wasProcessing = phase.phase === 'processing';
        const next = handleHardwareBack(phase);
        if (next === null) return false; // let navigation (or the ConfirmSheet Modal) handle it
        setPhase(next);
        if (wasProcessing) onCancelProcessing?.();
        return true; // handled — do not also pop the screen
      });
      return () => subscription.remove();
    }, [phase, setPhase, onCancelProcessing])
  );
}
