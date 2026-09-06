// ═══════════════════════════════════════════════════════════════════════
// CAPTURE JOB REDUCER — pure state transitions, deliberately I/O-free.
//
// Same philosophy as src/components/capture/capturePhases.ts: the store
// (store.ts) owns persistence, the actual Gemini call, and notifications;
// this file only ever computes "given a job and an event, what's the new
// job", so it's unit-testable without touching SQLite, expo-notifications,
// or React Native at all.
// ═══════════════════════════════════════════════════════════════════════

import type { AiRunResult } from '../ai/runs';
import type { PendingEntry } from '../pendingEntry';
import type { CaptureJob, CaptureJobInput, CaptureJobKind } from './types';

/** review/submit -> processing. The only place a job is born. */
export function createJob(id: string, date: string, input: CaptureJobInput, now: number): CaptureJob {
  return { id, date, input, status: 'processing', createdAt: now, updatedAt: now };
}

/** processing -> done, once Gemini returns a usable result. Clears any stale error from a previous failed attempt. */
export function markDone(job: CaptureJob, entries: PendingEntry[], now: number): CaptureJob {
  return { ...job, status: 'done', entries, errorMessage: undefined, updatedAt: now };
}

/** processing -> error, preserving the input so a retry can re-run it. */
export function markError(job: CaptureJob, message: string, now: number): CaptureJob {
  return { ...job, status: 'error', errorMessage: message, entries: undefined, updatedAt: now };
}

/**
 * Store-restart recovery: a job still `processing` when the store
 * rehydrates from disk means the process that owned it is gone — no
 * promise is ever coming back to settle it. Task brief: "never silently
 * vanishing" — this turns a job that would otherwise sit stuck forever
 * into a plain, retryable error. No-op on a job that isn't `processing`
 * (so re-hydrating twice, or hydrating a fresh in-memory job that hasn't
 * round-tripped through storage yet, is always safe).
 */
export function markInterrupted(job: CaptureJob, now: number): CaptureJob {
  if (job.status !== 'processing') return job;
  return markError(job, "Interrupted — the app closed before this finished analysing. Tap to retry.", now);
}

/** error -> processing, for an explicit retry. No-op from any other status. */
export function toRetrying(job: CaptureJob, now: number): CaptureJob {
  if (job.status !== 'error') return job;
  return { ...job, status: 'processing', errorMessage: undefined, updatedAt: now };
}

const KIND_LABEL: Record<CaptureJobKind, string> = {
  meal_photo: 'Photo',
  label_ocr: 'Label scan',
  voice: 'Voice log',
};

/** Lower-case variant for mid-sentence use ("reading your photo…"). */
const KIND_LABEL_LOWER: Record<CaptureJobKind, string> = {
  meal_photo: 'photo',
  label_ocr: 'label scan',
  voice: 'voice log',
};

/** The Today pill / notification body for a job, given its current status. Pure and exhaustively tested so the copy can't silently drift from what the three screens' own inline error text used to say. */
export function describeJob(job: CaptureJob): string {
  switch (job.status) {
    case 'processing':
      return `Reading your ${KIND_LABEL_LOWER[job.input.kind]}…`;
    case 'done':
      return `${KIND_LABEL[job.input.kind]} ready to confirm`;
    case 'error':
      return `${KIND_LABEL[job.input.kind]} failed — tap to retry`;
  }
}

/**
 * Maps a failed `AiRunResult` to the exact user-facing copy each capture
 * screen already showed inline before this queue existed (MealPhotoScreen/
 * LabelScanScreen/VoiceLogScreen's own `switch (result.reason)` blocks) —
 * centralised here so a background job surfaces the identical honest
 * message a synchronous failure always has, whichever path the result
 * takes to reach the user (task brief: "the real error, never silently
 * vanishing").
 */
export function describeAiFailure(kind: CaptureJobKind, result: Extract<AiRunResult, { ok: false }>): string {
  switch (result.reason) {
    case 'missing_key':
      return 'Add a Gemini API key in .env to enable this.';
    case 'no_items':
      if (kind === 'label_ocr') {
        return "Couldn't read a plausible nutrition panel from that photo. Try a clearer, well-lit shot of the per-100g column, or enter it manually.";
      }
      if (kind === 'voice') {
        return "Couldn't make out any food from that recording. Try again, speaking clearly.";
      }
      return "Couldn't identify any food in that photo. Try a clearer shot, add a note describing it, or enter manually.";
    case 'parse_failed':
      return "Gemini's response couldn't be understood after a retry. Enter this one manually.";
    case 'network':
      return `Couldn't reach Gemini (${result.detail ?? 'network error'}). Check your connection or enter manually.`;
    // The two proxy-specific failures below are deliberately NOT folded
    // into the 'network' copy above (task brief: "don't let it collapse
    // into a generic network error") — each names a different fix.
    case 'proxy_unauthorized':
      return "The Gemini proxy rejected this device's token. Check EXPO_PUBLIC_JOULE_PROXY_TOKEN, or enter manually.";
    case 'proxy_model_not_permitted':
      return `The Gemini proxy doesn't allow this model yet (${result.detail ?? 'model not permitted'}). Enter manually for now — the proxy's allowlist needs updating.`;
  }
}
