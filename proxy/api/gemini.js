// ═══════════════════════════════════════════════════════════════════════
// AI PROXY (Gemini + OpenRouter failover) — PRD §8 build-order item 17
// ("mandatory before any APK leaves your device"), extended for the
// OpenRouter availability failover: Gemini fails for the owner once or
// twice a day, and until now that just dead-ended the AI paths. This
// function now fronts TWO upstream providers so a Google outage degrades
// to a second one instead of killing the feature.
//
// The Joule app previously called generativelanguage.googleapis.com
// directly with the key inlined into the bundle via EXPO_PUBLIC_. That is
// acceptable for a personally sideloaded APK and NOT acceptable once the
// build reaches a second person's phone (TestFlight puts the bundle on
// Apple's servers and hers), because anyone who unpacks it has the key.
// The same reasoning applies to the OpenRouter key added here — it is
// NEVER read from a client env var, only from this server's own
// environment, exactly like GEMINI_API_KEY always has been.
//
// ─── What this does and does not protect ───
//
// It DOES stop the Google/OpenRouter API keys from ever being present on
// a device. A leaked JOULE_PROXY_TOKEN can be rotated here in seconds
// without touching either upstream account; a leaked API key cannot.
//
// It does NOT make the client trustworthy. The shared token still ships
// inside the app bundle and is extractable by anyone willing to unpack an
// IPA. What that buys an attacker is quota on a free tier, behind a model
// allowlist, on an endpoint that can be revoked — not an upstream
// credential. That is the honest security posture, and it is the one
// PRD §8 asks for.
//
// ─── Request contract ───
//
//   POST /api/gemini
//   x-joule-token: <JOULE_PROXY_TOKEN>
//   { provider?: 'google' | 'openrouter', model: string, payload: object }
//
// `provider` defaults to `'google'` when absent so a client built before
// this field existed keeps working unmodified. `payload` is the
// untouched request body for whichever upstream API `provider` selects
// (Gemini's `generateContent` body, or an OpenAI-shaped chat-completions
// body) — this proxy does not interpret it beyond size-checking and (for
// OpenRouter) forcing `payload.model` to match the validated `model`.
// ═══════════════════════════════════════════════════════════════════════

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Google models this proxy will forward to. Mirrors MODEL_FALLBACKS in
 * src/lib/ai/geminiClient.ts — every id here was named by Google in a
 * real 404 body from the app, never guessed.
 *
 * An allowlist rather than a pattern: the model name is interpolated into
 * a URL, so a permissive regex is a path-traversal surface. Adding a
 * model is a deliberate one-line change in both places.
 */
const ALLOWED_GOOGLE_MODELS = new Set([
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]);

/**
 * OpenRouter models this proxy will forward to. Mirrors
 * OPENROUTER_BACKUP_MODEL in src/lib/ai/geminiClient.ts — kept as its own
 * allowlist (not merged with ALLOWED_GOOGLE_MODELS) for the same
 * URL-interpolation reasoning as above, even though OpenRouter's model id
 * doesn't go in a URL for this provider today: a single shared allowlist
 * would let a Google-model id slip through the OpenRouter branch (or vice
 * versa) purely by coincidence of one being added without the other in
 * mind. Update this alongside OPENROUTER_BACKUP_MODEL when it changes.
 */
const ALLOWED_OPENROUTER_MODELS = new Set(['openai/gpt-5-nano']);

/** Requests carry base64 images and audio — generous, but not unbounded. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed. Use POST.' } });
  }

  const expectedToken = process.env.JOULE_PROXY_TOKEN;
  if (!expectedToken) {
    return res.status(500).json({ error: { message: 'Proxy misconfigured: JOULE_PROXY_TOKEN is not set.' } });
  }

  const presented = req.headers['x-joule-token'];
  if (typeof presented !== 'string' || !safeEqual(presented, expectedToken)) {
    // Deliberately terse: a detailed reason helps whoever is probing.
    return res.status(401).json({ error: { message: 'Unauthorized.' } });
  }

  const { provider: rawProvider, model, payload } = req.body ?? {};
  // Absent `provider` means an older client, or a Google request that
  // never bothered naming its provider — both default to 'google'.
  const provider = rawProvider === undefined || rawProvider === null ? 'google' : rawProvider;

  if (provider !== 'google' && provider !== 'openrouter') {
    return res.status(400).json({ error: { message: `Unknown provider: ${String(rawProvider)}` } });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: { message: 'Missing request payload.' } });
  }

  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    return res.status(413).json({ error: { message: 'Payload too large.' } });
  }

  if (provider === 'openrouter') {
    return handleOpenRouter(model, payload, res);
  }
  return handleGoogle(model, serialized, res);
}

async function handleGoogle(model, serializedPayload, res) {
  if (typeof model !== 'string' || !ALLOWED_GOOGLE_MODELS.has(model)) {
    return res.status(400).json({
      error: { message: `Model not permitted by this proxy: ${String(model)}` },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  // Fail loudly on misconfiguration rather than silently forwarding
  // unauthenticated traffic or calling Google with an undefined key.
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Proxy misconfigured: GEMINI_API_KEY is not set.' } });
  }

  try {
    const upstream = await fetch(
      `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializedPayload,
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

async function handleOpenRouter(model, payload, res) {
  if (typeof model !== 'string' || !ALLOWED_OPENROUTER_MODELS.has(model)) {
    return res.status(400).json({
      error: { message: `Model not permitted by this proxy: ${String(model)}` },
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  // OPENROUTER_API_KEY is OPTIONAL at the environment level — this proxy
  // works with only GEMINI_API_KEY set, exactly as it always has, and the
  // client-side failover simply never fires (maybeFailoverToOpenRouter
  // only triggers when a proxy is configured; it has no way to know
  // whether THIS half of the proxy is also configured until it tries).
  // What must never happen is crashing, or silently calling Google
  // instead of the OpenRouter model the client asked for — both would
  // hide a real "you asked for a backup that isn't set up" misconfig
  // behind a confusing unrelated failure.
  if (!apiKey) {
    return res.status(500).json({
      error: { message: 'Proxy misconfigured: OpenRouter was requested but OPENROUTER_API_KEY is not set.' },
    });
  }

  // Force the upstream model to the one this proxy just validated —
  // never trust a `payload.model` the client could have set to something
  // else while passing a permitted top-level `model`.
  const forwardPayload = { ...payload, model };

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter attribution headers (their docs ask for these to
        // identify the calling app for their own leaderboard/analytics;
        // informational, not secret). `HTTP-Referer` defaults to a
        // clearly-inert placeholder rather than a fabricated real-looking
        // URL — set OPENROUTER_APP_URL if this app ever gets a public
        // page worth attributing to.
        'HTTP-Referer': process.env.OPENROUTER_APP_URL || 'https://joule.invalid',
        'X-Title': 'Joule',
      },
      body: JSON.stringify(forwardPayload),
    });

    const text = await upstream.text();

    // Same "pass it through untouched" reasoning as the Google branch —
    // the client's own error classification (classifyHttpError in
    // geminiClient.ts) depends on seeing OpenRouter's real status/body.
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
