// ═══════════════════════════════════════════════════════════════════════
// GEMINI CLIENT TESTS — fake `fetch` only, never the live API.
//
// Covers: missing-key short-circuit, malformed-JSON retry-then-give-up
// (PRD §8: "reject and retry once on parse failure"), a successful
// first-try call, recovery on the second try, and HTTP/network error
// passthrough (which should NOT trigger the JSON-retry path — those are
// a different failure mode).
// ═══════════════════════════════════════════════════════════════════════

import { callGeminiStructured } from '../geminiClient';

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
