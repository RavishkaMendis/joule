// ═══════════════════════════════════════════════════════════════════════
// PER-PATH ORCHESTRATION — the one function each screen calls.
//
// Each `run*` function: builds the right prompt, calls Gemini with the
// right model + media, maps the structured response through the kJ/
// sanity-rail mapping layer, and returns a small result type the screen
// can render directly. None of these ever touch foodRepo/the database —
// they only ever produce PendingEntry[] for the shared ConfirmSheet
// (PRD §7's non-negotiable rule). The screens are responsible for
// rendering the sheet and letting the user's confirm action be the only
// thing that reaches the log.
// ═══════════════════════════════════════════════════════════════════════

import type { PendingEntry } from '../pendingEntry';
import { hasGeminiApiKey } from './apiKey';
import { callGeminiStructured, GEMINI_MODELS, type InlineMediaPart } from './geminiClient';
import {
  applyProviderConfidenceCap,
  applyUserQuantityOverrides,
  mapGeminiResponseToPendingEntries,
  type UserQuantityOverride,
} from './mapToPendingEntry';
import { buildLabelOcrPrompt, buildMealPhotoPrompt, buildPotIngredientsPrompt } from './prompts';

export type AiRunResult =
  | { ok: true; entries: PendingEntry[]; rejectedCount: number }
  | {
      ok: false;
      reason:
        | 'missing_key'
        | 'network'
        | 'parse_failed'
        | 'no_items'
        /** Proxy rejected the request's `x-joule-token` (bad/missing) — a config problem on this device's proxy setup, distinct from "no key at all" or "can't reach the network". Only ever produced when a proxy is configured (see apiKey.ts). */
        | 'proxy_unauthorized'
        /** Proxy's model allowlist doesn't include the model this client tried to use — the drift hazard documented in geminiClient.ts, surfaced honestly instead of collapsing into a generic network failure. */
        | 'proxy_model_not_permitted';
      detail?: string;
    };

/** PRD §7.3 label OCR: one nutrition-panel photo in, one entry out (usually). */
export async function runLabelOcr(photoBase64: string, mimeType = 'image/jpeg'): Promise<AiRunResult> {
  if (!hasGeminiApiKey()) return { ok: false, reason: 'missing_key' };

  const media: InlineMediaPart = { mimeType, base64Data: photoBase64 };
  const result = await callGeminiStructured(GEMINI_MODELS.labelOcr, buildLabelOcrPrompt(), media);

  return finishRun(result, 'label_ocr');
}

/**
 * PRD §7.4 meal photo + optional voice-note annotation, sent as ONE
 * multimodal call — the photo and the raw audio (no speech-to-text, per
 * PRD §7.1) are both attached as inline media parts, and the prompt
 * (prompts.ts) explicitly instructs the model to prefer any quantity it
 * hears in the audio over its own visual estimate for that item.
 *
 * `userQuantities` is a second, independent override mechanism for
 * quantities already known as structured data (e.g. a typed correction
 * on a previous attempt) — when present, applied on top of whatever the
 * model returned, same "user wins" rule.
 */
export async function runMealPhoto(
  photoBase64: string,
  options?: {
    photoMimeType?: string;
    voiceNote?: { audioBase64: string; mimeType?: string };
    /**
     * Typed note describing the meal, e.g. "chicken sushi" or "fried rice,
     * 2 tbsp oil". Faster than a voice note for the common case of simply
     * naming the dish, and it supplies the one thing a photo cannot show:
     * what the food actually IS, plus invisible cooking fat (PRD §7.5).
     */
    textNote?: string;
    userQuantities?: UserQuantityOverride[];
  }
): Promise<AiRunResult> {
  if (!hasGeminiApiKey()) return { ok: false, reason: 'missing_key' };

  const hasVoiceNote = Boolean(options?.voiceNote);
  const media: InlineMediaPart[] = [{ mimeType: options?.photoMimeType ?? 'image/jpeg', base64Data: photoBase64 }];
  if (options?.voiceNote) {
    media.push({ mimeType: options.voiceNote.mimeType ?? 'audio/m4a', base64Data: options.voiceNote.audioBase64 });
  }

  const result = await callGeminiStructured(
    GEMINI_MODELS.mealPhoto,
    buildMealPhotoPrompt(hasVoiceNote, options?.textNote),
    media
  );

  return finishRun(result, 'meal_photo', options?.userQuantities);
}

/**
 * PRD §7.5 / task brief "meal-prep workflow": photo of raw, pre-cook
 * ingredients laid out for a batch → an editable ingredient list the user
 * turns into a pot (src/screens/PotCreateScreen.tsx). Reuses the exact
 * same `callGeminiStructured` plumbing (and therefore the same kJ-
 * conversion/0-900 plausibility rail applied in mapToPendingEntry.ts) as
 * every other AI path — only the prompt differs. Uses the harder/meal
 * model tier (`GEMINI_MODELS.mealPhoto`) since identifying several raw
 * ingredients spread out in one frame is at least as hard a vision task
 * as a cooked plate.
 *
 * Tagged with source `'meal_photo'` (there is no dedicated
 * "pot-ingredient" EntrySource — src/lib/pendingEntry.ts is owned by the
 * orchestrator and out of scope to extend for this feature) since these
 * entries are, honestly, a photo-based visual estimate exactly like a
 * meal photo's components; the resulting PendingEntry[] are never written
 * to food_entry directly (that would violate PRD §7's "always a human
 * beat before save" for a still-uncooked ingredient list) — the caller
 * (PotIngredientsPhotoScreen) turns each entry into an editable
 * ingredient-row draft the user reviews/edits in PotCreateScreen before
 * anything is saved, the same shape `potActions.pendingEntryToPotIngredient`
 * documents for a caller working with PendingEntry directly.
 */
export async function runPotIngredientsPhoto(
  photoBase64: string,
  options?: { mimeType?: string; textNote?: string }
): Promise<AiRunResult> {
  if (!hasGeminiApiKey()) return { ok: false, reason: 'missing_key' };

  const media: InlineMediaPart = { mimeType: options?.mimeType ?? 'image/jpeg', base64Data: photoBase64 };
  const result = await callGeminiStructured(GEMINI_MODELS.mealPhoto, buildPotIngredientsPrompt(options?.textNote), media);

  return finishRun(result, 'meal_photo');
}

function finishRun(
  result: Awaited<ReturnType<typeof callGeminiStructured>>,
  source: PendingEntry['source'],
  userQuantities?: UserQuantityOverride[]
): AiRunResult {
  if (!result.ok) {
    switch (result.error.kind) {
      case 'missing_key':
        return { ok: false, reason: 'missing_key' };
      case 'parse_failed_twice':
        return { ok: false, reason: 'parse_failed', detail: result.error.lastRawText };
      case 'http_error':
        return { ok: false, reason: 'network', detail: `HTTP ${result.error.status}: ${result.error.message}` };
      case 'unauthorized':
        return { ok: false, reason: 'proxy_unauthorized', detail: result.error.message };
      case 'model_not_permitted':
        return { ok: false, reason: 'proxy_model_not_permitted', detail: result.error.message };
      case 'network_error':
        return { ok: false, reason: 'network', detail: result.error.message };
    }
  }

  const { entries, rejected } = mapGeminiResponseToPendingEntries(result.response, source, result.rawText);
  // An OpenRouter-backup-answered entry's confidence is not the same
  // evidence as a Gemini one (geminiClient.ts's OpenRouter failover) —
  // capped here, before any user-quantity override, so a real stated
  // quantity can still promote confidence afterward.
  const cappedEntries = applyProviderConfidenceCap(entries, result.provider);
  const finalEntries = userQuantities ? applyUserQuantityOverrides(cappedEntries, userQuantities) : cappedEntries;

  if (finalEntries.length === 0) {
    return { ok: false, reason: 'no_items', detail: rejected.map((r) => r.reason).join('; ') || undefined };
  }

  return { ok: true, entries: finalEntries, rejectedCount: rejected.length };
}
