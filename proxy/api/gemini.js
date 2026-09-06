// ═══════════════════════════════════════════════════════════════════════
// GEMINI PROXY — PRD §8, build-order item 17 ("mandatory before any APK
// leaves your device").
//
// The Joule app previously called generativelanguage.googleapis.com
// directly with the key inlined into the bundle via EXPO_PUBLIC_. That is
// acceptable for a personally sideloaded APK and NOT acceptable once the
// build reaches a second person's phone (TestFlight puts the bundle on
// Apple's servers and hers), because anyone who unpacks it has the key.
//
// This function holds the key server-side instead. The app sends the same
// generateContent payload it always did; this adds the key and forwards.
//
// ─── What this does and does not protect ───
//
// It DOES stop the Google API key from ever being present on a device.
// A leaked JOULE_PROXY_TOKEN can be rotated here in seconds without
// touching the Google account; a leaked API key cannot.
//
// It does NOT make the client trustworthy. The shared token still ships
// inside the app bundle and is extractable by anyone willing to unpack an
// IPA. What that buys an attacker is quota on a free tier, behind a model
// allowlist, on an endpoint that can be revoked — not a Google credential.
// That is the honest security posture, and it is the one PRD §8 asks for.
// ═══════════════════════════════════════════════════════════════════════

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Models this proxy will forward to. Mirrors MODEL_FALLBACKS in
 * src/lib/ai/geminiClient.ts — every id here was named by Google in a
 * real 404 body from the app, never guessed.
 *
 * An allowlist rather than a pattern: the model name is interpolated into
 * a URL, so a permissive regex is a path-traversal surface. Adding a
 * model is a deliberate one-line change in both places.
 */
const ALLOWED_MODELS = new Set([
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]);

/** Gemini requests carry base64 images and audio — generous, but not unbounded. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed. Use POST.' } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const expectedToken = process.env.JOULE_PROXY_TOKEN;

  // Fail loudly on misconfiguration rather than silently forwarding
  // unauthenticated traffic or calling Google with an undefined key.
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Proxy misconfigured: GEMINI_API_KEY is not set.' } });
  }
  if (!expectedToken) {
    return res.status(500).json({ error: { message: 'Proxy misconfigured: JOULE_PROXY_TOKEN is not set.' } });
  }

  const presented = req.headers['x-joule-token'];
  if (typeof presented !== 'string' || !safeEqual(presented, expectedToken)) {
    // Deliberately terse: a detailed reason helps whoever is probing.
    return res.status(401).json({ error: { message: 'Unauthorized.' } });
  }

  const { model, payload } = req.body ?? {};

  if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) {
    return res.status(400).json({
      error: { message: `Model not permitted by this proxy: ${String(model)}` },
    });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: { message: 'Missing generateContent payload.' } });
  }

  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    return res.status(413).json({ error: { message: 'Payload too large.' } });
  }

  try {
    const upstream = await fetch(
      `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
      }
    );

    const text = await upstream.text();

    // Pass the status and body through untouched. The app's own error
    // handling depends on seeing Google's real response — in particular
    // its model-deprecation 404s, which name the replacement model and
    // drive the client's fallback chain. Rewriting those would break it.
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    return res.send(text);
  } catch (err) {
    return res.status(502).json({
      error: { message: `Upstream request failed: ${err instanceof Error ? err.message : String(err)}` },
    });
  }
}

/** Length-independent comparison, so token checking doesn't leak length by timing. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
