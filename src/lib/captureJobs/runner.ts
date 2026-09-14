// ═══════════════════════════════════════════════════════════════════════
// CAPTURE JOB RUNNER — the one file in this module that calls into
// src/lib/ai/** (runs.ts/media.ts are settled/tested elsewhere per the
// task brief: call them, don't edit them). Mirrors the "one file imports
// the risky dependency, everything else is mockable" convention already
// used in this codebase (src/lib/db.ts is the only file importing
// `expo-sqlite`; src/lib/notifications/scheduler.ts the only one
// importing `expo-notifications`).
//
// Takes a `CaptureJobInput` (see types.ts) and produces the same
// `AiRunResult` the screens used to get directly from `runMealPhoto` /
// `runLabelOcr` / `runVoiceParse` — the store (store.ts) is the only
// caller, and it doesn't care which underlying path ran.
// ═══════════════════════════════════════════════════════════════════════

import { File } from 'expo-file-system';
import { readFileAsBase64 } from '../ai/media';
import { runLabelOcr, runMealPhoto, runVoiceParse, type AiRunResult } from '../ai/runs';
import type { CaptureJobInput } from './types';

/** Prefers an already-in-memory base64 payload (the normal case right after capture); falls back to reading the file at `uri` otherwise (a retry after this process restarted, where only the on-disk file survived). */
async function resolveBase64(uri: string, provided?: string): Promise<string> {
  if (provided) return provided;
  return readFileAsBase64(uri);
}

/**
 * The one file `executeCaptureJob` cannot proceed without for a given
 * input — the meal-photo/label-OCR photo, or the voice recording. NOT a
 * meal photo's optional `voiceNoteUri`: a missing voice note never fails
 * the job (see the try/catch below), so its absence must never make an
 * otherwise-retriable job look unretriable.
 */
function requiredSourceUri(input: CaptureJobInput): string {
  switch (input.kind) {
    case 'meal_photo':
    case 'label_ocr':
      return input.photoUri;
    case 'voice':
      return input.audioUri;
  }
}

/**
 * Whether a retry of this job could even attempt to re-read its source
 * bytes — checked BEFORE offering "Try again" on a failed job (see
 * CaptureJobsIndicator.tsx / jobPrompt.ts). types.ts's header documents
 * why this matters: `*Base64` payloads are deliberately not persisted, so
 * after a restart a retry can only work "as long as the OS hasn't cleared
 * that cache file" — a two-day-old camera cache file usually hasn't
 * survived. Without this check the app was offering, and automatically
 * performing, a retry that was guaranteed to fail.
 *
 * Synchronous — `expo-file-system`'s new `File#exists` is a plain getter,
 * no I/O await needed (see ../ai/media.ts's header for why this app uses
 * that API rather than the legacy `readAsStringAsync`-style one).
 */
export function captureJobSourceExists(input: CaptureJobInput): boolean {
  return new File(requiredSourceUri(input)).exists;
}

export async function executeCaptureJob(input: CaptureJobInput): Promise<AiRunResult> {
  switch (input.kind) {
    case 'label_ocr': {
      const base64 = await resolveBase64(input.photoUri, input.photoBase64);
      return runLabelOcr(base64, input.photoMimeType);
    }

    case 'meal_photo': {
      const base64 = await resolveBase64(input.photoUri, input.photoBase64);

      let voiceNote: { audioBase64: string; mimeType?: string } | undefined;
      if (input.voiceNoteUri) {
        try {
          const audioBase64 = await resolveBase64(input.voiceNoteUri, input.voiceNoteBase64);
          voiceNote = { audioBase64, mimeType: input.voiceNoteMimeType };
        } catch {
          // Voice note failed to read — proceed with the photo alone
          // rather than failing the whole capture (PRD: never dead-end
          // the user). Ported verbatim from MealPhotoScreen's previous
          // inline try/catch around this exact read.
        }
      }

      return runMealPhoto(base64, {
        photoMimeType: input.photoMimeType,
        textNote: input.textNote,
        voiceNote,
      });
    }

    case 'voice': {
      const base64 = await resolveBase64(input.audioUri, input.audioBase64);
      return runVoiceParse(base64, input.mimeType);
    }
  }
}
