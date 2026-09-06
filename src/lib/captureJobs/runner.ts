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

import { readFileAsBase64 } from '../ai/media';
import { runLabelOcr, runMealPhoto, runVoiceParse, type AiRunResult } from '../ai/runs';
import type { CaptureJobInput } from './types';

/** Prefers an already-in-memory base64 payload (the normal case right after capture); falls back to reading the file at `uri` otherwise (a retry after this process restarted, where only the on-disk file survived). */
async function resolveBase64(uri: string, provided?: string): Promise<string> {
  if (provided) return provided;
  return readFileAsBase64(uri);
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
