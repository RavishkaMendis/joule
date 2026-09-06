// ═══════════════════════════════════════════════════════════════════════
// GEMINI API KEY — PRD §8 key handling
//
// Read from `.env` via `EXPO_PUBLIC_GEMINI_API_KEY`. That prefix embeds
// the key in the JS bundle, which PRD §8 flags explicitly:
//
//   "Do not ship the API key in the app bundle... Personal build: key in
//   .env, EXPO_PUBLIC_ prefix, acceptable for your own sideloaded APK
//   only. Before sharing with partner/friends: put a Cloudflare Worker in
//   front... Do this before the APK leaves your device."
//
// i.e. this is a deliberate, temporary shortcut for a single-device
// personal build (build order item 17 is marked mandatory precisely so
// this file doesn't quietly become permanent). Do not widen this beyond
// what's needed to unblock local development.
//
// `.env` may not exist yet (the user creates it separately) — every
// caller of `getGeminiApiKey()` must treat `null` as an expected,
// non-error state and degrade to a "add a key" prompt, never a crash.
// ═══════════════════════════════════════════════════════════════════════

/** Returns the configured Gemini key, or null if none is set (expected when `.env` is absent). */
export function getGeminiApiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

export function hasGeminiApiKey(): boolean {
  return getGeminiApiKey() !== null;
}

/** Shared copy for the "no key configured" state across all three AI screens. */
export const MISSING_KEY_MESSAGE = 'Add a Gemini API key in .env to enable this.';
