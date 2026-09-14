// ═══════════════════════════════════════════════════════════════════════
// CAPTURE JOB TYPES — the shape of a background analysis job.
//
// Task brief: "sometimes it takes a minute and I'm stuck waiting on the
// scan screen" — a Gemini call currently holds the user on the processing
// screen. This module's job is to let that call outlive the screen that
// started it, so the user can leave immediately.
//
// A job carries its OWN copy of whatever the AI call needs, independent
// of any screen's React state — that's what "survives navigation" and
// "survives the app being killed mid-flight" both actually require. Where
// possible it stores a file `uri` (already durable on disk) rather than
// the base64 payload itself, so a persisted row stays small; `runner.ts`
// re-reads the file when base64 isn't already in memory (the normal case
// right after capture, where the screen already has it, skips the extra
// read — see runner.ts's `resolveBase64`).
// ═══════════════════════════════════════════════════════════════════════

import type { PendingEntry } from '../pendingEntry';

/** Mirrors the three AI capture paths that can run long enough to matter (PRD §7.1/§7.3/§7.4). Barcode lookup and manual entry are synchronous local/network lookups, not Gemini calls, and never go through this queue. */
export type CaptureJobKind = 'meal_photo' | 'label_ocr' | 'voice';

/**
 * Everything needed to run (or re-run) a job's Gemini call. `*Base64`
 * fields are populated at submission time from data the screen already
 * has in memory (no redundant file read on the common path); they are
 * NOT persisted (see persistence.ts) and will be absent after an app
 * restart — `runner.ts` re-derives them from the corresponding `*Uri`
 * when missing, which is what makes a retry after a killed app possible
 * at all, as long as the OS hasn't cleared that cache file.
 */
export type CaptureJobInput =
  | {
      kind: 'meal_photo';
      photoUri: string;
      photoBase64?: string;
      photoMimeType?: string;
      /** Typed context, e.g. "chicken sushi, 2 tbsp oil" — PRD §7.4/§7.5. */
      textNote?: string;
      voiceNoteUri?: string;
      voiceNoteBase64?: string;
      voiceNoteMimeType?: string;
    }
  | {
      kind: 'label_ocr';
      photoUri: string;
      photoBase64?: string;
      photoMimeType?: string;
    }
  | {
      kind: 'voice';
      audioUri: string;
      audioBase64?: string;
      mimeType: string;
    };

export type CaptureJobStatus = 'processing' | 'done' | 'error';

/**
 * A job's public shape — what the store holds, persists, and hands to
 * React. `entries` (PRD §7's non-negotiable rule) is populated ONLY on
 * `status === 'done'` and is never written to `food_entry` by this
 * module — it is handed to the shared `ConfirmSheet`, and only the
 * user's own confirm action in that sheet ever reaches the log.
 */
export type CaptureJob = {
  id: string;
  /** ISO yyyy-mm-dd this will be logged against once confirmed. */
  date: string;
  input: CaptureJobInput;
  status: CaptureJobStatus;
  createdAt: number;
  updatedAt: number;
  entries?: PendingEntry[];
  /** Set on `status === 'error'` — the real failure reason, never a generic "something went wrong" (task brief: "the real error, never silently vanishing"). */
  errorMessage?: string;
  /**
   * How many times this job has been run, including the current/most
   * recent run — starts at 1 (`createJob`), bumped by every explicit
   * retry (`toRetrying`). Surfaced on the failed-job prompt once it
   * exceeds 1, so a job that keeps failing visibly says so rather than
   * looking like a fresh failure on every tap.
   */
  attempts: number;
};
