// ═══════════════════════════════════════════════════════════════════════
// GEMINI CLIENT TESTS — fake `fetch` only, never the live API.
//
// Covers: missing-key short-circuit, malformed-JSON retry-then-give-up
// (PRD §8: "reject and retry once on parse failure"), a successful
// first-try call, recovery on the second try, and HTTP/network error
// passthrough (which should NOT trigger the JSON-retry path — those are
// a different failure mode).
// ═══════════════════════════════════════════════════════════════════════

import { callGeminiStructured, OPENROUTER_BACKUP_MODEL } from '../geminiClient';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

function geminiEnvelope(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

type FakeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function fakeFetchSequence(responses: Array<{ ok: boolean; status?: number; json: () => Promise<unknown>; statusText?: string }>) {
  let call = 0;
  const impl: FakeFetch = async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      ok: r.ok,
      status: r.status ?? 200,
      statusText: r.statusText ?? '',
      json: r.json,
    } as unknown as Response;
  };
  return jest.fn(impl);
}

describe('callGeminiStructured', () => {
  afterEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = ORIGINAL_ENV;
  });

  it('short-circuits with missing_key and never calls fetch when no key is configured', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    const fetchImpl = jest.fn();

    const result = await callGeminiStructured('gemini-2.5-flash-lite', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('missing_key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('succeeds on the first attempt with valid structured JSON', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const validJson = JSON.stringify({
      items: [
        {
          name: 'Rice',
          grams: 150,
          kcal_per_100g: 130,
          energy_unit_detected: 'kcal',
          protein_per_100g: 2.7,
          carbs_per_100g: 28,
          fat_per_100g: 0.3,
          confidence: 'medium',
          assumptions: '',
        },
      ],
    });
    const fetchImpl = fakeFetchSequence([{ ok: true, json: async () => geminiEnvelope(validJson) }]);

    const result = await callGeminiStructured('gemini-2.5-flash-lite', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retried).toBe(false);
    expect(result.response.items[0].name).toBe('Rice');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed JSON and succeeds on the second attempt', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const validJson = JSON.stringify({
      items: [
        {
          name: 'Chicken',
          grams: 100,
          kcal_per_100g: 165,
          energy_unit_detected: 'kcal',
          protein_per_100g: 31,
          carbs_per_100g: 0,
          fat_per_100g: 3.6,
          confidence: 'high',
          assumptions: '',
        },
      ],
    });
    const fetchImpl = fakeFetchSequence([
      { ok: true, json: async () => geminiEnvelope('not valid json {{{') },
      { ok: true, json: async () => geminiEnvelope(validJson) },
    ]);

    const result = await callGeminiStructured('gemini-2.5-flash-lite', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retried).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry also fails to parse, falling back to manual entry (parse_failed_twice)', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const fetchImpl = fakeFetchSequence([
      { ok: true, json: async () => geminiEnvelope('garbage 1') },
      { ok: true, json: async () => geminiEnvelope('garbage 2') },
    ]);

    const result = await callGeminiStructured('gemini-2.5-flash-lite', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('parse_failed_twice');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up when the response JSON does not match the schema (e.g. missing energy_unit_detected)', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const invalidShape = JSON.stringify({ items: [{ name: 'X', grams: 100 }] });
    const fetchImpl = fakeFetchSequence([
      { ok: true, json: async () => geminiEnvelope(invalidShape) },
      { ok: true, json: async () => geminiEnvelope(invalidShape) },
    ]);

    const result = await callGeminiStructured('gemini-2.5-flash-lite', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('parse_failed_twice');
  });

  it('does not retry on an HTTP error — surfaces it immediately', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({ error: { message: 'quota exceeded' } }) },
    ]);

    const result = await callGeminiStructured('gemini-2.5-flash-lite', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('http_error');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry on a network error — surfaces it immediately', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const fetchImpl = jest.fn(async () => {
      throw new Error('offline');
    });

    const result = await callGeminiStructured('gemini-2.5-flash-lite', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('network_error');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends both an image and an audio inline part when given an array (meal photo + voice note, PRD §7.4)', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const validJson = JSON.stringify({
      items: [
        { name: 'Rice', grams: 150, kcal_per_100g: 130, energy_unit_detected: 'kcal', protein_per_100g: 2.7, carbs_per_100g: 28, fat_per_100g: 0.3, confidence: 'medium', assumptions: '' },
      ],
    });
    const fetchImpl = fakeFetchSequence([{ ok: true, json: async () => geminiEnvelope(validJson) }]);

    await callGeminiStructured(
      'gemini-2.5-flash',
      'prompt',
      [
        { mimeType: 'image/jpeg', base64Data: 'photoBytes' },
        { mimeType: 'audio/m4a', base64Data: 'audioBytes' },
      ],
      fetchImpl
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    const parts = body.contents[0].parts;
    expect(parts).toHaveLength(3); // text prompt + image + audio
    expect(parts[1].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'photoBytes' });
    expect(parts[2].inlineData).toEqual({ mimeType: 'audio/m4a', data: 'audioBytes' });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MODEL DEPRECATION FALLBACK
//
// Regression guard for a real device failure on 2026-08-27: Google
// retired gemini-2.5-flash and returned
//   404 "This model models/gemini-2.5-flash is no longer available to
//        new users. Please update your code to use models/gemini-3.6-flash"
// which surfaced to the user as "Couldn't reach Gemini" with no recovery.
// Model ids are not stable, so the client must walk a fallback chain.
// ═══════════════════════════════════════════════════════════════════════

describe('model deprecation fallback', () => {
  afterEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = ORIGINAL_ENV;
  });

  const deprecation404 = {
    ok: false,
    status: 404,
    json: async () => ({
      error: { message: 'This model models/gemini-2.5-flash is no longer available to new users.' },
    }),
  };

  function validItemsJson() {
    return JSON.stringify({
      items: [
        {
          name: 'Rice',
          grams: 100,
          kcal_per_100g: 130,
          energy_unit_detected: 'kcal',
          protein_per_100g: 2.7,
          carbs_per_100g: 28,
          fat_per_100g: 0.3,
          confidence: 'high',
          assumptions: '',
        },
      ],
    });
  }

  it('falls back to the next model when the preferred one is retired', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const fetchImpl = fakeFetchSequence([
      deprecation404,
      { ok: true, json: async () => geminiEnvelope(validItemsJson()) },
    ]);

    const result = await callGeminiStructured('gemini-2.5-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    // Two calls: the retired model, then the fallback that answered.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondUrl = String((fetchImpl as jest.Mock).mock.calls[1][0]);
    expect(secondUrl).not.toContain('gemini-2.5-flash:');
  });

  it('does NOT walk the chain for non-deprecation errors', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'bad-key';
    // 401 is a bad key — retrying other models just multiplies the same
    // failure and delays the error the user actually needs to see.
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 401, json: async () => ({ error: { message: 'API key not valid' } }) },
    ]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('http_error');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces the real error when every candidate is retired', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    const fetchImpl = fakeFetchSequence([deprecation404]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('http_error');
    if (result.error.kind !== 'http_error') return;
    // Keeps Google's own message, which names the replacement model.
    expect(result.error.message).toContain('no longer available');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PROXY TRANSPORT — PRD §8 build-order item 17: route through
// proxy/api/gemini.js (deployed separately) instead of Google directly,
// once EXPO_PUBLIC_JOULE_PROXY_URL/TOKEN are set. Precedence per task
// brief: proxy wins when configured; the direct-key tests above (no
// proxy vars set) prove the fallback to direct calling still works
// unchanged. Every case here uses a fake `fetch` — never the live proxy
// or Google.
// ═══════════════════════════════════════════════════════════════════════

describe('proxy transport', () => {
  const ORIGINAL_PROXY_URL = process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
  const ORIGINAL_PROXY_TOKEN = process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;

  afterEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = ORIGINAL_ENV;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = ORIGINAL_PROXY_URL;
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = ORIGINAL_PROXY_TOKEN;
  });

  function validItemsJson() {
    return JSON.stringify({
      items: [
        {
          name: 'Rice',
          grams: 100,
          kcal_per_100g: 130,
          energy_unit_detected: 'kcal',
          protein_per_100g: 2.7,
          carbs_per_100g: 28,
          fat_per_100g: 0.3,
          confidence: 'high',
          assumptions: '',
        },
      ],
    });
  }

  it('sends the exact proxy contract: POST to the configured URL, x-joule-token header, { model, payload } body', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';
    const fetchImpl = fakeFetchSequence([{ ok: true, json: async () => geminiEnvelope(validItemsJson()) }]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('https://proxy.example/api/gemini');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'x-joule-token': 'shared-token' });
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe('gemini-3.6-flash');
    // The untouched generateContent body lives under `payload`, exactly
    // what a direct call would have sent as its own top-level body.
    expect(sent.payload.contents[0].parts[0]).toEqual({ text: 'prompt' });
    expect(sent.payload.generationConfig.responseMimeType).toBe('application/json');
    // Never a URL query param for the proxy — the token is header-only.
    expect(url).not.toContain('shared-token');
  });

  it('prefers the proxy over a direct key when both are configured', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'direct-key';
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';
    const fetchImpl = fakeFetchSequence([{ ok: true, json: async () => geminiEnvelope(validItemsJson()) }]);

    await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('https://proxy.example/api/gemini');
    expect(String(init.body)).not.toContain('direct-key');
  });

  it('treats a half-configured proxy (token but no URL) as not configured and falls back to direct', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'direct-key';
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';
    const fetchImpl = fakeFetchSequence([{ ok: true, json: async () => geminiEnvelope(validItemsJson()) }]);

    await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    const [url] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('generativelanguage.googleapis.com');
    expect(String(url)).toContain('direct-key');
  });

  it("surfaces a proxy 401 as its own distinct 'unauthorized' error, not a generic network failure", async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'wrong-token';
    const fetchImpl = fakeFetchSequence([{ ok: false, status: 401, json: async () => ({ error: { message: 'Unauthorized.' } }) }]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
    expect(result.error.kind).not.toBe('network_error');
    expect(result.error.kind).not.toBe('http_error');
    // A single 401 isn't a per-model deprecation — must not walk the fallback chain.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces the proxy's 400 'Model not permitted' as its own distinct error", async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 400, json: async () => ({ error: { message: 'Model not permitted by this proxy: gemini-9000' } }) },
    ]);

    const result = await callGeminiStructured('gemini-9000', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('model_not_permitted');
    if (result.error.kind !== 'model_not_permitted') return;
    expect(result.error.message).toContain('gemini-9000');
  });

  it('a direct-call 401 is never misclassified as the proxy-specific unauthorized error', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'bad-key';
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;
    const fetchImpl = fakeFetchSequence([{ ok: false, status: 401, json: async () => ({ error: { message: 'API key not valid' } }) }]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('http_error');
  });

  it('walks the model-deprecation fallback chain through the proxy exactly like a direct call', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';
    const fetchImpl = fakeFetchSequence([
      {
        ok: false,
        status: 404,
        json: async () => ({
          error: { message: 'This model models/gemini-2.5-flash is no longer available to new users.' },
        }),
      },
      { ok: true, json: async () => geminiEnvelope(validItemsJson()) },
    ]);

    const result = await callGeminiStructured('gemini-2.5-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Both calls go to the same proxy URL (unlike a direct call, the
    // model id moves in the JSON body, not the URL) — inspect the body
    // of each call to confirm the fallback candidate actually changed.
    const firstModel = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body as string).model;
    const secondModel = JSON.parse((fetchImpl as jest.Mock).mock.calls[1][1].body as string).model;
    expect(firstModel).toBe('gemini-2.5-flash');
    expect(secondModel).not.toBe('gemini-2.5-flash');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// OPENROUTER AVAILABILITY FAILOVER
//
// Gemini fails for the owner once or twice a day — plain outages (5xx,
// 429, network), not model-deprecation 404s. `MODEL_FALLBACKS` above does
// nothing for that case (there's no replacement model name to walk to),
// so this is a genuinely separate mechanism: after Gemini's own chain is
// exhausted, ONE last attempt goes to OpenRouter's `OPENROUTER_BACKUP_MODEL`
// — but only through the proxy (the OpenRouter key can never ship in the
// bundle), and only for availability failures, never 400/401 (those mean
// a bug/misconfig, and silently switching providers would hide it).
// ═══════════════════════════════════════════════════════════════════════

describe('OpenRouter availability failover', () => {
  const ORIGINAL_PROXY_URL = process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
  const ORIGINAL_PROXY_TOKEN = process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;

  afterEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = ORIGINAL_ENV;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = ORIGINAL_PROXY_URL;
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = ORIGINAL_PROXY_TOKEN;
  });

  function configureProxy() {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';
  }

  function openRouterEnvelope(content: string) {
    return { choices: [{ message: { content } }] };
  }

  function validItemsJson() {
    return JSON.stringify({
      items: [
        {
          name: 'Rice',
          grams: 100,
          kcal_per_100g: 130,
          energy_unit_detected: 'kcal',
          protein_per_100g: 2.7,
          carbs_per_100g: 28,
          fat_per_100g: 0.3,
          confidence: 'high',
          assumptions: '',
        },
      ],
    });
  }

  it('fails over to OpenRouter on a 500 from Google, mapping its OpenAI-shaped response into the same GeminiStructuredResponse', async () => {
    configureProxy();
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ error: { message: 'upstream overloaded' } }) },
      { ok: true, json: async () => openRouterEnvelope(validItemsJson()) },
    ]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe('openrouter');
    expect(result.response.items[0].name).toBe('Rice');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const secondBody = JSON.parse((fetchImpl as jest.Mock).mock.calls[1][1].body as string);
    expect(secondBody.provider).toBe('openrouter');
    expect(secondBody.model).toBe(OPENROUTER_BACKUP_MODEL);
    expect(secondBody.payload.messages[0].content[0]).toEqual({ type: 'text', text: 'prompt' });
    expect(secondBody.payload.response_format.type).toBe('json_schema');
    expect(secondBody.payload.response_format.json_schema.strict).toBe(true);
  });

  it('fails over to OpenRouter on a 429 from Google', async () => {
    configureProxy();
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({ error: { message: 'quota exceeded' } }) },
      { ok: true, json: async () => openRouterEnvelope(validItemsJson()) },
    ]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe('openrouter');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails over to OpenRouter on a network error reaching Google', async () => {
    configureProxy();
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('offline');
      return { ok: true, status: 200, statusText: '', json: async () => openRouterEnvelope(validItemsJson()) } as unknown as Response;
    });

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe('openrouter');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does NOT fail over on a 400 — surfaces Google/the proxy\'s own error instead', async () => {
    configureProxy();
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 400, json: async () => ({ error: { message: 'Model not permitted by this proxy: gemini-3.6-flash' } }) },
    ]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('model_not_permitted');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does NOT fail over on a 401 — a bad/missing proxy token is a config problem, not an availability one', async () => {
    configureProxy();
    const fetchImpl = fakeFetchSequence([{ ok: false, status: 401, json: async () => ({ error: { message: 'Unauthorized.' } }) }]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unauthorized');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does NOT fail over when no proxy is configured — a direct-key transport has no route to OpenRouter', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'direct-key';
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
    delete process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ error: { message: 'upstream overloaded' } }) },
    ]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('http_error');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does NOT fail over when the request carries non-image media (a voice note) — OpenRouter\'s content shape has no agreed slot for audio', async () => {
    configureProxy();
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ error: { message: 'upstream overloaded' } }) },
    ]);

    const result = await callGeminiStructured(
      'gemini-3.6-flash',
      'prompt',
      [
        { mimeType: 'image/jpeg', base64Data: 'photoBytes' },
        { mimeType: 'audio/m4a', base64Data: 'audioBytes' },
      ],
      fetchImpl
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('http_error');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces the OpenRouter error itself when Google fails AND the backup also fails', async () => {
    configureProxy();
    const fetchImpl = fakeFetchSequence([
      { ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({ error: { message: 'google overloaded' } }) },
      { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ error: { message: 'openrouter overloaded too' } }) },
    ]);

    const result = await callGeminiStructured('gemini-3.6-flash', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('http_error');
    if (result.error.kind !== 'http_error') return;
    expect(result.error.message).toBe('openrouter overloaded too');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails over to OpenRouter only after the Gemini model-deprecation chain is exhausted (last candidate 500s)', async () => {
    configureProxy();
    // Every MODEL_FALLBACKS candidate 404s as retired except the very
    // last one tried, which 500s instead — an availability failure, so
    // the backup should still fire once the chain gives up.
    const deprecation404 = {
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'This model is no longer available to new users.' } }),
    };
    const lastCandidateOverloaded = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: { message: 'upstream overloaded' } }),
    };
    let call = 0;
    const fetchImpl = jest.fn(async () => {
      call += 1;
      // preferred + 3 of the 4 MODEL_FALLBACKS entries 404 (calls 1-4),
      // the 4th fallback candidate 500s (call 5), then OpenRouter answers.
      if (call <= 4) {
        return { ok: false, status: 404, statusText: '', json: deprecation404.json } as unknown as Response;
      }
      if (call === 5) {
        return { ok: false, status: 500, statusText: 'Internal Server Error', json: lastCandidateOverloaded.json } as unknown as Response;
      }
      return { ok: true, status: 200, statusText: '', json: async () => openRouterEnvelope(validItemsJson()) } as unknown as Response;
    });

    const result = await callGeminiStructured('some-retired-model', 'prompt', undefined, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe('openrouter');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});
