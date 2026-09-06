// ═══════════════════════════════════════════════════════════════════════
// CAPTURE PHASE MACHINE — transition tests.
//
// The load-bearing case here is the reported "dead end while analysing"
// bug: cancelling out of `processing` must return to `review` with the
// exact photo and typed note intact, never drop back to a blank camera.
// Equally important: `handleHardwareBack` must have a defined, non-null
// action in every phase except `camera` and `confirming` (where the
// navigator/Modal already own back behaviour) — that is the "does the
// Android hardware back button work everywhere" requirement from the
// task brief, made testable without a device.
// ═══════════════════════════════════════════════════════════════════════

import {
  cancelProcessing,
  handleHardwareBack,
  INITIAL_CAPTURE_PHASE,
  resetAfterConfirm,
  retryFromError,
  toCamera,
  toConfirming,
  toError,
  toProcessing,
  toReview,
  updateHasVoiceNote,
  updateTextNote,
  type CapturedPhoto,
} from '../capturePhases';

const PHOTO: CapturedPhoto = { uri: 'file:///tmp/photo.jpg', base64: 'AAAA' };

describe('INITIAL_CAPTURE_PHASE', () => {
  it('starts in the camera phase', () => {
    expect(INITIAL_CAPTURE_PHASE).toEqual({ phase: 'camera' });
  });
});

describe('toReview', () => {
  it('lands on review with an empty note and no voice note yet', () => {
    const state = toReview(PHOTO);
    expect(state).toEqual({
      phase: 'review',
      draft: { photo: PHOTO, textNote: '', hasVoiceNote: false },
    });
  });
});

describe('updateTextNote / updateHasVoiceNote', () => {
  it('updates the note only while in review', () => {
    const review = toReview(PHOTO);
    const updated = updateTextNote(review, 'chicken sushi, 5 pieces');
    expect(updated).toEqual({
      phase: 'review',
      draft: { photo: PHOTO, textNote: 'chicken sushi, 5 pieces', hasVoiceNote: false },
    });
  });

  it('is a no-op outside review', () => {
    expect(updateTextNote(INITIAL_CAPTURE_PHASE, 'x')).toBe(INITIAL_CAPTURE_PHASE);
    const processing = toProcessing(toReview(PHOTO));
    expect(updateTextNote(processing, 'x')).toBe(processing);
  });

  it('flags a voice note only while in review', () => {
    const review = toReview(PHOTO);
    const updated = updateHasVoiceNote(review, true);
    expect(updated).toEqual({
      phase: 'review',
      draft: { photo: PHOTO, textNote: '', hasVoiceNote: true },
    });
    expect(updateHasVoiceNote(INITIAL_CAPTURE_PHASE, true)).toBe(INITIAL_CAPTURE_PHASE);
  });
});

describe('toProcessing', () => {
  it('carries the exact draft forward from review', () => {
    let state = toReview(PHOTO);
    state = updateTextNote(state, 'fried rice, 2 tbsp oil');
    state = updateHasVoiceNote(state, true);

    const processing = toProcessing(state);
    expect(processing.phase).toBe('processing');
    if (processing.phase === 'processing') {
      expect(processing.draft).toEqual({
        photo: PHOTO,
        textNote: 'fried rice, 2 tbsp oil',
        hasVoiceNote: true,
      });
    }
  });

  it('is a no-op outside review (e.g. double-tap from camera)', () => {
    expect(toProcessing(INITIAL_CAPTURE_PHASE)).toBe(INITIAL_CAPTURE_PHASE);
  });
});

describe('cancelProcessing — the dead-end fix', () => {
  it('returns to review with the photo and typed note fully intact', () => {
    let state = toReview(PHOTO);
    state = updateTextNote(state, 'chicken sushi');
    const processing = toProcessing(state);

    const cancelled = cancelProcessing(processing);

    expect(cancelled).toEqual({
      phase: 'review',
      draft: { photo: PHOTO, textNote: 'chicken sushi', hasVoiceNote: false },
    });
  });

  it('preserves a voice-note flag through cancel too', () => {
    let state = toReview(PHOTO);
    state = updateHasVoiceNote(state, true);
    const processing = toProcessing(state);

    const cancelled = cancelProcessing(processing);
    expect(cancelled.phase).toBe('review');
    if (cancelled.phase === 'review') {
      expect(cancelled.draft.hasVoiceNote).toBe(true);
      expect(cancelled.draft.photo).toEqual(PHOTO);
    }
  });

  it('is a no-op outside processing', () => {
    const review = toReview(PHOTO);
    expect(cancelProcessing(review)).toBe(review);
    expect(cancelProcessing(INITIAL_CAPTURE_PHASE)).toBe(INITIAL_CAPTURE_PHASE);
  });
});

describe('toConfirming / toError', () => {
  it('moves processing to confirming, keeping the draft', () => {
    const processing = toProcessing(toReview(PHOTO));
    const confirming = toConfirming(processing);
    expect(confirming.phase).toBe('confirming');
    if (confirming.phase === 'confirming') {
      expect(confirming.draft.photo).toEqual(PHOTO);
    }
  });

  it('moves processing to error with a message, keeping the draft', () => {
    const processing = toProcessing(toReview(PHOTO));
    const errored = toError(processing, 'Network error');
    expect(errored).toEqual({
      phase: 'error',
      draft: { photo: PHOTO, textNote: '', hasVoiceNote: false },
      message: 'Network error',
    });
  });

  it('are no-ops outside processing', () => {
    const review = toReview(PHOTO);
    expect(toConfirming(review)).toBe(review);
    expect(toError(review, 'x')).toBe(review);
  });
});

describe('retryFromError', () => {
  it('returns to review with the draft intact, ready to retry', () => {
    const processing = toProcessing(toReview(PHOTO));
    const errored = toError(processing, 'Network error');
    const retried = retryFromError(errored);
    expect(retried).toEqual({
      phase: 'review',
      draft: { photo: PHOTO, textNote: '', hasVoiceNote: false },
    });
  });

  it('is a no-op outside error', () => {
    const review = toReview(PHOTO);
    expect(retryFromError(review)).toBe(review);
  });
});

describe('toCamera / resetAfterConfirm', () => {
  it('always returns a fresh camera phase, dropping any draft', () => {
    expect(toCamera()).toEqual({ phase: 'camera' });
    expect(resetAfterConfirm()).toEqual({ phase: 'camera' });
  });
});

describe('handleHardwareBack', () => {
  it('defers to the navigator from camera', () => {
    expect(handleHardwareBack(INITIAL_CAPTURE_PHASE)).toBeNull();
  });

  it('goes from review back to camera (retake)', () => {
    const review = toReview(PHOTO);
    expect(handleHardwareBack(review)).toEqual({ phase: 'camera' });
  });

  it('cancels processing back to review, never navigating away or dropping the draft', () => {
    let state = toReview(PHOTO);
    state = updateTextNote(state, 'chicken sushi');
    const processing = toProcessing(state);

    const result = handleHardwareBack(processing);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      phase: 'review',
      draft: { photo: PHOTO, textNote: 'chicken sushi', hasVoiceNote: false },
    });
  });

  it('goes from error back to review with the draft intact', () => {
    const processing = toProcessing(toReview(PHOTO));
    const errored = toError(processing, 'boom');
    expect(handleHardwareBack(errored)).toEqual({
      phase: 'review',
      draft: { photo: PHOTO, textNote: '', hasVoiceNote: false },
    });
  });

  it('defers to the ConfirmSheet modal from confirming', () => {
    const confirming = toConfirming(toProcessing(toReview(PHOTO)));
    expect(handleHardwareBack(confirming)).toBeNull();
  });

  it('has a non-null action in every phase except camera and confirming', () => {
    const phases = ['review', 'processing', 'error'] as const;
    for (const phase of phases) {
      let state = toReview(PHOTO);
      if (phase === 'processing') state = toProcessing(state);
      if (phase === 'error') state = toError(toProcessing(toReview(PHOTO)), 'x');
      expect(handleHardwareBack(state)).not.toBeNull();
    }
  });
});
