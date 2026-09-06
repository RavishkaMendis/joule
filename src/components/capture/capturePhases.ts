// ═══════════════════════════════════════════════════════════════════════
// CAPTURE PHASE MACHINE — shared shape for the three capture screens.
//
// Reported UX bugs this exists to fix (real device use, see task brief):
//   1. The "what is it?" text field used to sit on the camera screen
//      BEFORE capture. Users shoot or pick a photo first and only THEN
//      know what's worth typing — doubly true for gallery picks, where
//      the field made no sense at all. Correct order is
//      camera -> review (photo + context) -> processing -> confirming.
//   2. Picking from the gallery used to leave the user stuck on the
//      camera screen with a static "reading food" message: no way back,
//      no cancel, no sense of progress. That is the dead end this phase
//      machine exists to close — `processing` always carries a `from`
//      snapshot so `cancelProcessing` can return to `review` with the
//      photo and typed note fully intact.
//
// This module is deliberately UI-free — pure types and pure transition
// functions only — so the phase logic (and specifically "does cancel
// preserve the photo/note") is unit-testable without touching React
// Native rendering, which this repo's Jest config does not exercise.
// ═══════════════════════════════════════════════════════════════════════

/** A captured or picked photo, kept in memory across phases. */
export type CapturedPhoto = {
  /** Local file uri (camera capture or gallery pick) — used to render the preview. */
  uri: string;
  /** Base64-encoded bytes, sent straight to Gemini (PRD §7.4). */
  base64: string;
};

/**
 * The review-phase draft: everything the user has entered about the shot
 * before asking Gemini to analyse it. Carried forward untouched into
 * `processing` and restored verbatim by `cancelProcessing`.
 */
export type ReviewDraft = {
  photo: CapturedPhoto;
  /** Typed context, e.g. "chicken sushi", "5 pieces", "fried in 2 tbsp oil". */
  textNote: string;
  /** Whether a voice note has been recorded for this photo. */
  hasVoiceNote: boolean;
};

export type CapturePhase =
  | { phase: 'camera' }
  | { phase: 'review'; draft: ReviewDraft }
  | { phase: 'processing'; draft: ReviewDraft }
  | { phase: 'confirming'; draft: ReviewDraft }
  | { phase: 'error'; draft: ReviewDraft; message: string };

/** Initial state: nothing captured yet. */
export const INITIAL_CAPTURE_PHASE: CapturePhase = { phase: 'camera' };

/** camera -> review, after a shutter press or gallery pick lands a photo. */
export function toReview(photo: CapturedPhoto): CapturePhase {
  return { phase: 'review', draft: { photo, textNote: '', hasVoiceNote: false } };
}

/** Pure update of the in-progress typed note while still in `review`. */
export function updateTextNote(state: CapturePhase, textNote: string): CapturePhase {
  if (state.phase !== 'review') return state;
  return { ...state, draft: { ...state.draft, textNote } };
}

/** Pure update of the voice-note-attached flag while still in `review`. */
export function updateHasVoiceNote(state: CapturePhase, hasVoiceNote: boolean): CapturePhase {
  if (state.phase !== 'review') return state;
  return { ...state, draft: { ...state.draft, hasVoiceNote } };
}

/**
 * review -> processing, kicked off by the "Analyse" action. Carries the
 * exact draft forward so cancelling can restore it without re-deriving
 * anything.
 */
export function toProcessing(state: CapturePhase): CapturePhase {
  if (state.phase !== 'review') return state;
  return { phase: 'processing', draft: state.draft };
}

/**
 * The fix for bug #2: cancelling out of `processing` (back button, an
 * explicit cancel action, or an unmount-triggered abort) always returns
 * to `review` with the same photo and typed note — never to `camera`,
 * which would silently discard both. Only valid from `processing`; a
 * no-op everywhere else so it's safe to wire to a hardware back handler
 * that might fire in any phase.
 */
export function cancelProcessing(state: CapturePhase): CapturePhase {
  if (state.phase !== 'processing') return state;
  return { phase: 'review', draft: state.draft };
}

/** processing -> confirming, once Gemini returns a usable result. */
export function toConfirming(state: CapturePhase): CapturePhase {
  if (state.phase !== 'processing') return state;
  return { phase: 'confirming', draft: state.draft };
}

/** processing -> error, preserving the draft so the user isn't sent back to a blank camera. */
export function toError(state: CapturePhase, message: string): CapturePhase {
  if (state.phase !== 'processing') return state;
  return { phase: 'error', draft: state.draft, message };
}

/** error -> review: "try again" keeps the photo and note, just retries the Gemini call. */
export function retryFromError(state: CapturePhase): CapturePhase {
  if (state.phase !== 'error') return state;
  return { phase: 'review', draft: state.draft };
}

/**
 * review/error -> camera: explicit retake/re-pick. This is the one
 * transition that intentionally drops the draft — the user asked for a
 * different photo, so the old note no longer describes what's on screen.
 */
export function toCamera(): CapturePhase {
  return { phase: 'camera' };
}

/**
 * confirming -> camera: after ConfirmSheet's own cancel, or after a
 * successful log, the capture flow resets to a clean camera phase ready
 * for the next shot rather than returning to a stale confirm/processing
 * state (this mirrors the pre-existing "resetToCamera" behaviour that
 * predates this phase machine).
 */
export function resetAfterConfirm(): CapturePhase {
  return { phase: 'camera' };
}

/**
 * What the Android hardware back button (and the iOS swipe-back gesture,
 * where enabled) should do for a given phase, expressed as a pure
 * decision so it's testable without mounting anything:
 *
 *   - camera:      let the navigator handle it (leave the screen).
 *   - review:      go back to camera (retake), same as the retake button.
 *   - processing:  cancel back to review — never navigate away and never
 *                  drop the draft (this is the "dead end" bug fix).
 *   - confirming:  let ConfirmSheet's own onCancel/onRequestClose handle it
 *                  (the sheet is a Modal with its own back handling).
 *   - error:       go back to review (same draft, ready to retry or edit).
 *
 * Returns `null` when the phase machine has nothing to do and the caller
 * should fall through to default navigation behaviour (i.e. leave the
 * screen).
 */
export function handleHardwareBack(state: CapturePhase): CapturePhase | null {
  switch (state.phase) {
    case 'camera':
      return null;
    case 'review':
      return toCamera();
    case 'processing':
      return cancelProcessing(state);
    case 'error':
      return retryFromError(state);
    case 'confirming':
      return null;
  }
}
