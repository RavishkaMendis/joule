// ═══════════════════════════════════════════════════════════════════════
// GEMINI TRANSPORT CONFIG — PRD §8 key handling
//
// Originally just the direct key (`EXPO_PUBLIC_GEMINI_API_KEY`), read
// straight into the JS bundle. PRD §8 flagged that explicitly:
//
//   "Do not ship the API key in the app bundle... Personal build: key in
//   .env, EXPO_PUBLIC_ prefix, acceptable for your own sideloaded APK
//   only. Before sharing with partner/friends: put a proxy in front...
//   Do this before the APK leaves your device."
//
// The build is now about to reach a second phone via TestFlight, so this
// file also reads a server-side proxy config
// (`EXPO_PUBLIC_JOULE_PROXY_URL` + `EXPO_PUBLIC_JOULE_PROXY_TOKEN`) that
// keeps the real Google key off the device entirely — see
// `proxy/api/gemini.js` (the deployed proxy's actual source) for the
// contract this must match.
//
// Precedence, per task brief: **proxy when configured, otherwise the
// existing direct call.** The proxy is optional, not mandatory — a
// `.env` with only the direct key (today's state) must keep working
// completely unchanged. `getGeminiTransport()` is the single place that
// decides which mode wins; `geminiClient.ts` never inspects the raw env
// vars itself.
//
// `.env` may not carry either — every caller must treat "nothing
// configured" as an expected, non-error state and degrade to an "add a
// key" prompt, never a crash.
// ═══════════════════════════════════════════════════════════════════════

/** Returns the configured direct Gemini key, or null if none is set. */
export function getGeminiApiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

export type GeminiProxyConfig = {
  /** Full endpoint URL, e.g. https://.../api/gemini — NOT a base to append a model id to (the proxy takes the model in the JSON body). */
  url: string;
  /** Sent as the `x-joule-token` header. Not the Google key — safe to rotate independently (see proxy/README.md). */
  token: string;
};

/**
 * Returns the configured proxy, or null if either half is missing. Both
 * `EXPO_PUBLIC_JOULE_PROXY_URL` and `EXPO_PUBLIC_JOULE_PROXY_TOKEN` are
 * required — a URL with no token would call the proxy unauthenticated
 * (guaranteed 401), and a token with no URL has nowhere to send it, so a
 * half-configured proxy is treated as "not configured" rather than
 * attempted.
 */
export function getGeminiProxyConfig(): GeminiProxyConfig | null {
  const url = process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
  const token = process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;
  if (!url || url.trim().length === 0) return null;
  if (!token || token.trim().length === 0) return null;
  return { url: url.trim(), token: token.trim() };
}

/** True when a usable proxy config (both URL and token) is present. */
export function hasGeminiProxyConfig(): boolean {
  return getGeminiProxyConfig() !== null;
}

export type GeminiTransport = { kind: 'proxy'; config: GeminiProxyConfig } | { kind: 'direct'; apiKey: string };

/**
 * The one place transport precedence is decided: proxy first (when both
 * its env vars are set), otherwise the direct key, otherwise null (AI
 * unavailable — every caller already treats that as "show an add-a-key
 * prompt", not a crash).
 */
export function getGeminiTransport(): GeminiTransport | null {
  const proxy = getGeminiProxyConfig();
  if (proxy) return { kind: 'proxy', config: proxy };

  const apiKey = getGeminiApiKey();
  if (apiKey) return { kind: 'direct', apiKey };

  return null;
}

/**
 * AI is available when EITHER transport is usable — a proxy-only setup
 * (no direct key at all, the intended end state once the key moves
 * server-side) must light up every AI-gated path exactly like a
 * direct-key-only setup does today.
 */
export function hasGeminiApiKey(): boolean {
  return getGeminiTransport() !== null;
}

/** Shared copy for the "no key configured" state across all AI screens. */
export const MISSING_KEY_MESSAGE = 'Add a Gemini API key, or configure the proxy, in .env to enable this.';
