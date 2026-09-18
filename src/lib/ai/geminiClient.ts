// ═══════════════════════════════════════════════════════════════════════
// GEMINI REST CLIENT
//
// Talks to `generativelanguage.googleapis.com` via `fetch` — no
// `@google/generative-ai` or similar SDK dependency (task brief: "use the
// current Gemini model ids and the REST API directly via fetch; do not
// add a heavy SDK dependency") — either directly, or fronted by Joule's
// own Gemini proxy (`proxy/api/gemini.js`, deployed separately) so the
// real Google key never ships in the app bundle. `apiKey.ts`'s
// `getGeminiTransport()` decides which; this file just executes whichever
// transport it's handed. See `callOnce` for the two request shapes.
//
// Models (PRD §8): Flash-Lite for label OCR (cheap, fast, plenty for
// structured single-image extraction); Flash for meal photos (harder
// vision task — multiple food components on one plate — worth the larger
// model). A third tier, `voice`, existed here for the now-removed voice
// capture path (PRD §7.1) — see src/lib/captureJobs/types.ts.
//
// ⚠️ 2026-08-27: the gemini-2.5-* ids this originally shipped with were
// retired mid-flight. A real device hit:
//   HTTP 404 "This model models/gemini-2.5-flash is no longer available
//   to new users. Please update your code to use models/gemini-3.6-flash"
// Google names the replacement in the error body, so `MODEL_FALLBACKS`
// below now encodes a chain rather than a single id: on a 404 that looks
// like a deprecation, the client retries with the next candidate instead
// of dead-ending the user. This WILL happen again — model ids are not
// stable — so the chain is the fix, not just the new id.
//
// ⚠️ DRIFT HAZARD: `MODEL_FALLBACKS` below is mirrored by `ALLOWED_GOOGLE_MODELS`
// in `proxy/api/gemini.js` (the deployed proxy — read-only from here). If
// a model is added/removed in one but not the other, the proxy will 400
// a model this client believes is fine ("Model not permitted by this
// proxy"), surfaced here as `GeminiCallError.kind === 'model_not_permitted'`.
// Update both files together.
//
// If Google renames/retires these, only this file (and the proxy's
// mirrored allowlist) needs updating — every caller goes through
// `runLabelOcr` / `runMealPhoto`.
//
// Structured output (PRD §8): `responseMimeType: application/json` +
// `responseSchema` forces the shape described in schema.ts. "Reject and
// retry once on parse failure, then fall back to manual entry" is
// implemented in `callGeminiStructured`: one retry with a stricter
// reminder appended to the prompt, then the caller is handed a
// `{ ok: false }` result so the screen can drop to manual entry — this
// module never throws for the expected "model returned garbage twice"
// case, only for genuine network/HTTP failures.
//
// The proxy passes Google's HTTP status and body through **untouched**
// (proxy/api/gemini.js's own comment on this is explicit: "the app's
// fallback chain depends on seeing Google's real model-deprecation
// 404s"). That means `isModelDeprecationError` and the fallback-walking
// logic below work identically whether the request went direct or
// through the proxy — neither needs to know which transport is live.
// The two errors that ARE proxy-specific (bad/missing token → 401;
// model rejected by the proxy's own allowlist → 400) are classified in
// `classifyHttpError`, gated on `transport.kind === 'proxy'` so a
// same-shaped direct-call error is never misread as one of these.
// ═══════════════════════════════════════════════════════════════════════

import { getGeminiTransport, type GeminiTransport } from './apiKey';
import { convertGeminiSchemaToOpenAIStrict } from './schemaConverter';
import { GEMINI_RESPONSE_SCHEMA, isGeminiStructuredResponse, type GeminiStructuredResponse } from './schema';

export const GEMINI_MODELS = {
  /** Label OCR: single nutrition-panel photo, structured JSON out. */
  labelOcr: 'gemini-3.5-flash-lite',
  /** Meal photo: harder multi-component vision task. */
  mealPhoto: 'gemini-3.6-flash',
} as const;

/**
 * Ordered fallback candidates tried when a model id 404s as deprecated.
 *
 * Every id here was NAMED BY GOOGLE in a real 404 body from this app —
 * none are guessed. The two deprecation errors we actually hit pointed at
 * different replacements per tier:
 *   gemini-2.5-flash      → gemini-3.6-flash
 *   gemini-2.5-flash-lite → gemini-3.5-flash-lite
 * Note the tier versions do NOT move in lockstep (3.6 vs 3.5), which is
 * exactly the sort of thing that makes guessing an id a bad bet.
 *
 * Flash is listed before flash-lite as a general fallback: if a lite id
 * dies, the full model is a safe (if slightly pricier) substitute, and at
 * ~6-10 calls/day on the free tier the cost difference is nil. The older
 * 2.5 ids stay last — existing keys may still reach them even though
 * they are closed to new users.
 */
export const MODEL_FALLBACKS: readonly string[] = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

/**
 * True when an HTTP 404 body looks like "this model is retired" rather
 * than a genuine bad-request. Matched on substance, not exact wording,
 * since Google's phrasing changes between deprecations.
 */
export function isModelDeprecationError(status: number, body: string): boolean {
  if (status !== 404) return false;
  const b = body.toLowerCase();
  return b.includes('no longer available') || b.includes('is not found') || b.includes('not supported');
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// ─── OpenRouter availability failover ───
//
// Google fails for the owner once or twice a day. `MODEL_FALLBACKS` above
// only helps when Google *names a replacement model*; it does nothing for
// a plain outage (5xx/429/timeout), which is the common case. OpenRouter
// sits AFTER that chain as a last resort: only tried once every Gemini
// candidate has been exhausted, and only for the kind of failure a
// different provider can plausibly fix (see `isAvailabilityFailure`).
//
// Deliberately a different company from Google — a Google-hosted model on
// OpenRouter (e.g. Gemini via OpenRouter) would go down in the same
// outage this is meant to survive. Swap this one line to change the
// backup model; nothing else in this file needs to change.
export const OPENROUTER_BACKUP_MODEL = 'openai/gpt-5-nano';

/** Which provider actually produced a successful structured response. */
export type AiProvider = 'google' | 'openrouter';

export type InlineMediaPart = {
  /** MIME type, e.g. 'image/jpeg' or 'audio/m4a'. */
  mimeType: string;
  /** Base64-encoded bytes, no `data:` prefix. */
  base64Data: string;
};

export type GeminiStructuredCallResult =
  | { ok: true; response: GeminiStructuredResponse; rawText: string; retried: boolean; provider: AiProvider }
  | { ok: false; error: GeminiCallError };

export type GeminiCallError =
  | { kind: 'missing_key' }
  | { kind: 'http_error'; status: number; message: string }
  /** Proxy rejected the request: missing/wrong `x-joule-token`. Only ever produced when `transport.kind === 'proxy'` — a direct call never reaches this (Google's own auth failures don't use bare 401). Distinct from `network_error` on purpose: this is a config/credentials problem on Joule's own proxy, not a connectivity one, and needs a different user action (fix the token) from either "no key" or "can't reach the internet". */
  | { kind: 'unauthorized'; message: string }
  /** Proxy's `ALLOWED_GOOGLE_MODELS` rejected this model id (its 400 "Model not permitted..." response) — the drift-hazard case documented above: the app thinks a model is fine but the proxy's mirrored allowlist hasn't been updated to match. Also proxy-only. */
  | { kind: 'model_not_permitted'; message: string }
  | { kind: 'network_error'; message: string }
  | { kind: 'parse_failed_twice'; lastRawText: string };

/**
 * Reclassifies a raw HTTP failure into the proxy-specific error kinds
 * above when the shape matches AND the request actually went through the
 * proxy — gating on `transport.kind` is what keeps a coincidentally
 * same-shaped direct-call error (Google returning some other 401/400)
 * from being misattributed to Joule's own proxy.
 */
function classifyHttpError(transport: GeminiTransport, status: number, message: string): GeminiCallError {
  if (transport.kind === 'proxy') {
    if (status === 401) return { kind: 'unauthorized', message };
    if (status === 400 && /not permitted/i.test(message)) return { kind: 'model_not_permitted', message };
  }
  return { kind: 'http_error', status, message };
}

/**
 * True for the failure shapes a second PROVIDER can plausibly fix:
 * upstream overload/rate-limit (5xx, 429) or not being able to reach the
 * network at all. False for 400/401 — those mean a bug or a
 * misconfiguration on Joule's side (bad request shape, bad key/token),
 * and switching providers would silently hide that instead of surfacing
 * it, per the failover design brief.
 */
function isAvailabilityFailure(result: CallOnceResult): boolean {
  if (result.kind === 'network_error') return true;
  if (result.kind === 'http_error') return result.status >= 500 || result.status === 429;
  return false;
}

/**
 * Calls a Gemini model with a text prompt plus optional inline media —
 * a single part (image OR audio) or an array (e.g. meal photo + voice
 * note together, PRD §7.4) — forcing strict structured JSON output. On a
 * parse failure (invalid JSON, or JSON that doesn't match
 * `GeminiStructuredResponse`), retries exactly once with a sterner
 * prompt reminder before giving up — per PRD §8 "reject and retry once
 * on parse failure, then fall back to manual entry". The "fall back to
 * manual entry" half of that sentence is the caller's job: this function
 * just reports `{ ok: false }` so the screen can route there.
 *
 * As a LAST resort — after the Gemini model-fallback chain is exhausted —
 * an availability failure (5xx/429/network; never 400/401) is retried
 * once more against OpenRouter's `OPENROUTER_BACKUP_MODEL`, but only when
 * a proxy transport is configured: OpenRouter's key lives server-side
 * exactly like Google's, so a direct-key-only setup (no proxy) has no
 * route to it and gets Google's own error instead. See `maybeFailoverToOpenRouter`.
 */
export async function callGeminiStructured(
  modelId: string,
  prompt: string,
  media?: InlineMediaPart | InlineMediaPart[],
  fetchImpl: typeof fetch = fetch
): Promise<GeminiStructuredCallResult> {
  const transport = getGeminiTransport();
  if (!transport) return { ok: false, error: { kind: 'missing_key' } };

  const { result: first, modelUsed } = await callWithModelFallback(modelId, prompt, media, transport, fetchImpl);
  if (first.kind === 'http_error' || first.kind === 'network_error') {
    const backup = await maybeFailoverToOpenRouter(first, prompt, media, transport, fetchImpl);
    if (backup) return backup;
    return {
      ok: false,
      error: first.kind === 'http_error' ? classifyHttpError(transport, first.status, first.message) : first,
    };
  }
  if (first.kind === 'ok') {
    return { ok: true, response: first.response, rawText: first.rawText, retried: false, provider: 'google' };
  }

  // First attempt parsed to invalid/malformed JSON — retry once with a
  // stricter reminder, per PRD §8.
  const retryPrompt = `${prompt}\n\nIMPORTANT: Your previous response could not be parsed. Respond with ONLY valid JSON matching the required schema — no markdown fences, no commentary, no trailing text.`;
  // Reuse the model that actually answered — no point re-walking the
  // fallback chain when we already know which id this transport can reach.
  const second = await callOnce(modelUsed, retryPrompt, media, transport, fetchImpl);
  if (second.kind === 'http_error' || second.kind === 'network_error') {
    const backup = await maybeFailoverToOpenRouter(second, prompt, media, transport, fetchImpl);
    if (backup) return backup;
    return {
      ok: false,
      error: second.kind === 'http_error' ? classifyHttpError(transport, second.status, second.message) : second,
    };
  }
  if (second.kind === 'ok') {
    return { ok: true, response: second.response, rawText: second.rawText, retried: true, provider: 'google' };
  }

  return { ok: false, error: { kind: 'parse_failed_twice', lastRawText: second.rawText } };
}

/**
 * The OpenRouter last-resort: returns `null` when failover shouldn't be
 * attempted at all (not an availability failure, or no proxy to route
 * through, or the request carries media OpenRouter's chat-completions
 * shape can't express — see `hasOnlyImageMedia`), in which case the
 * caller reports Gemini's own error unchanged. Otherwise makes exactly
 * ONE OpenRouter attempt (no further fallback chain — this IS the last
 * resort) and returns its outcome, success or failure, as the final word.
 */
async function maybeFailoverToOpenRouter(
  failure: CallOnceResult,
  prompt: string,
  media: InlineMediaPart | InlineMediaPart[] | undefined,
  transport: GeminiTransport,
  fetchImpl: typeof fetch
): Promise<GeminiStructuredCallResult | null> {
  if (transport.kind !== 'proxy') return null;
  if (!isAvailabilityFailure(failure)) return null;
  if (!hasOnlyImageMedia(media)) return null;

  const result = await callOpenRouterOnce(OPENROUTER_BACKUP_MODEL, prompt, media, transport, fetchImpl);

  if (result.kind === 'ok') {
    return { ok: true, response: result.response, rawText: result.rawText, retried: false, provider: 'openrouter' };
  }
  if (result.kind === 'network_error') {
    return { ok: false, error: result };
  }
  if (result.kind === 'http_error') {
    return { ok: false, error: classifyHttpError(transport, result.status, result.message) };
  }
  // 'parse_failed' — this is already the last resort, so there is no
  // second attempt to make against OpenRouter the way Gemini gets one;
  // reuse the existing "gave up on structured parsing" error kind.
  return { ok: false, error: { kind: 'parse_failed_twice', lastRawText: result.rawText } };
}

/**
 * OpenRouter's chat-completions `content` array (design brief) only
 * covers `text` and `image_url` parts — there is no agreed shape here for
 * audio (the meal-photo + voice-note path, PRD §7.4). Rather than
 * silently dropping the voice note or guessing at an `input_audio` shape
 * gpt-5-nano may not even support, failover is skipped entirely when any
 * attached media isn't an image, and Gemini's own error is surfaced
 * instead. Image-only requests (the common case: label OCR, meal photo
 * with no voice note, pot ingredients) fail over normally.
 */
function hasOnlyImageMedia(media: InlineMediaPart | InlineMediaPart[] | undefined): boolean {
  const parts = media ? (Array.isArray(media) ? media : [media]) : [];
  return parts.every((part) => part.mimeType.startsWith('image/'));
}

type CallOnceResult =
  | { kind: 'ok'; response: GeminiStructuredResponse; rawText: string }
  | { kind: 'parse_failed'; rawText: string }
  | { kind: 'http_error'; status: number; message: string }
  | { kind: 'network_error'; message: string };

/**
 * Try `preferredModel`, then walk `MODEL_FALLBACKS` if — and only if —
 * the failure was a model-deprecation 404.
 *
 * Google retired gemini-2.5-* while this app was mid-build and returned
 * a 404 naming the replacement, which dead-ended the user with "Couldn't
 * reach Gemini". Model ids are not stable, so a single hardcoded id is a
 * latent outage. Any other error (401 bad key, 429 rate limit, network)
 * returns immediately — retrying those against a different model would
 * just multiply the same failure and slow the error down.
 *
 * Returns the model that actually answered so the caller's parse-retry
 * doesn't re-walk the chain.
 */
async function callWithModelFallback(
  preferredModel: string,
  prompt: string,
  media: InlineMediaPart | InlineMediaPart[] | undefined,
  transport: GeminiTransport,
  fetchImpl: typeof fetch
): Promise<{ result: CallOnceResult; modelUsed: string }> {
  const candidates = [preferredModel, ...MODEL_FALLBACKS.filter((m) => m !== preferredModel)];

  let lastResult: CallOnceResult | null = null;
  for (const candidate of candidates) {
    const result = await callOnce(candidate, prompt, media, transport, fetchImpl);
    if (result.kind !== 'http_error' || !isModelDeprecationError(result.status, result.message)) {
      return { result, modelUsed: candidate };
    }
    lastResult = result;
  }

  // Every candidate was retired. Surface the last error rather than a
  // synthetic one, so the message still names whatever Google suggested.
  return { result: lastResult as CallOnceResult, modelUsed: preferredModel };
}

async function callOnce(
  modelId: string,
  prompt: string,
  media: InlineMediaPart | InlineMediaPart[] | undefined,
  transport: GeminiTransport,
  fetchImpl: typeof fetch
): Promise<CallOnceResult> {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  const mediaParts = media ? (Array.isArray(media) ? media : [media]) : [];
  for (const part of mediaParts) {
    parts.push({ inlineData: { mimeType: part.mimeType, data: part.base64Data } });
  }

  // Identical `generateContent` body regardless of transport — the proxy
  // forwards it verbatim (proxy/api/gemini.js: `{ model, payload }` where
  // `payload` IS this object), so only the request's envelope (URL,
  // headers, and where the model id goes) differs below.
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };

  let res: Response;
  try {
    if (transport.kind === 'proxy') {
      // Contract (proxy/api/gemini.js, proxy/README.md): POST the model id
      // and the untouched generateContent body together; auth is the
      // `x-joule-token` header, never a URL query param.
      res = await fetchImpl(transport.config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-joule-token': transport.config.token },
        body: JSON.stringify({ model: modelId, payload: body }),
      });
    } else {
      res = await fetchImpl(`${API_BASE}/${modelId}:generateContent?key=${encodeURIComponent(transport.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
  } catch (err) {
    return { kind: 'network_error', message: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody?.error?.message) message = errBody.error.message;
    } catch {
      // Body wasn't JSON; keep statusText.
    }
    return { kind: 'http_error', status: res.status, message };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { kind: 'parse_failed', rawText: '<non-JSON HTTP response>' };
  }

  const rawText = extractText(json);
  if (rawText === null) return { kind: 'parse_failed', rawText: JSON.stringify(json) };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { kind: 'parse_failed', rawText };
  }

  if (!isGeminiStructuredResponse(parsed)) {
    return { kind: 'parse_failed', rawText };
  }

  return { kind: 'ok', response: parsed, rawText };
}

/** Pulls the model's text output out of the `generateContent` envelope. */
function extractText(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = (candidates[0] as { content?: unknown })?.content;
  const parts = (content as { parts?: unknown })?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = (parts[0] as { text?: unknown })?.text;
  return typeof text === 'string' ? text : null;
}

/**
 * The OpenRouter (OpenAI-shaped) equivalent of `callOnce` — same
 * `CallOnceResult` shape so `maybeFailoverToOpenRouter` can reuse the
 * exact same http/network/parse handling as the Gemini path, but a
 * completely different request/response envelope:
 *
 *   - request: `messages[].content[]` (`text` + `image_url` parts) and
 *     `response_format: { type: 'json_schema', json_schema: { strict } }`
 *     instead of `contents[].parts[]` + `generationConfig.responseSchema`.
 *   - response: `choices[0].message.content` instead of
 *     `candidates[0].content.parts[0].text`.
 *
 * Always routed through the proxy (never called when
 * `transport.kind !== 'proxy'` — see `maybeFailoverToOpenRouter`) so the
 * OpenRouter key never ships in the app bundle, exactly like Google's.
 * The proxy contract gains a `provider` field for this
 * (`proxy/api/gemini.js`); `model`/`payload`/the `x-joule-token` header
 * are otherwise identical to a Gemini proxy call.
 */
async function callOpenRouterOnce(
  modelId: string,
  prompt: string,
  media: InlineMediaPart | InlineMediaPart[] | undefined,
  transport: Extract<GeminiTransport, { kind: 'proxy' }>,
  fetchImpl: typeof fetch
): Promise<CallOnceResult> {
  const payload = buildOpenRouterBody(modelId, prompt, media);

  let res: Response;
  try {
    res = await fetchImpl(transport.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-joule-token': transport.config.token },
      body: JSON.stringify({ provider: 'openrouter', model: modelId, payload }),
    });
  } catch (err) {
    return { kind: 'network_error', message: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody?.error?.message) message = errBody.error.message;
    } catch {
      // Body wasn't JSON; keep statusText.
    }
    return { kind: 'http_error', status: res.status, message };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { kind: 'parse_failed', rawText: '<non-JSON HTTP response>' };
  }

  const rawText = extractOpenRouterText(json);
  if (rawText === null) return { kind: 'parse_failed', rawText: JSON.stringify(json) };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { kind: 'parse_failed', rawText };
  }

  if (!isGeminiStructuredResponse(parsed)) {
    return { kind: 'parse_failed', rawText };
  }

  return { kind: 'ok', response: parsed, rawText };
}

/** Builds an OpenAI-shaped chat-completions body per the failover design brief. */
function buildOpenRouterBody(
  modelId: string,
  prompt: string,
  media: InlineMediaPart | InlineMediaPart[] | undefined
): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  const mediaParts = media ? (Array.isArray(media) ? media : [media]) : [];
  for (const part of mediaParts) {
    content.push({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.base64Data}` } });
  }

  return {
    model: modelId,
    messages: [{ role: 'user', content }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'joule_structured_response',
        strict: true,
        schema: convertGeminiSchemaToOpenAIStrict(GEMINI_RESPONSE_SCHEMA),
      },
    },
  };
}

/** Pulls the model's text output out of an OpenAI-shaped chat-completions envelope. */
function extractOpenRouterText(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: unknown })?.message;
  const content = (message as { content?: unknown })?.content;
  return typeof content === 'string' ? content : null;
}
