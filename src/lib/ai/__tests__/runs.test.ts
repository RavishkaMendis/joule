// ═══════════════════════════════════════════════════════════════════════
// ORCHESTRATION TESTS — runLabelOcr / runMealPhoto / runVoiceParse.
//
// Exercises the full path from a fake `fetch` response through to
// PendingEntry[], including the missing-key degrade-gracefully behavior
// screens rely on, and that meal-photo user quantities actually reach
// the final entries (not just the lower-level mapping unit already
// covered in mapToPendingEntry.test.ts).
// ═══════════════════════════════════════════════════════════════════════

import { runLabelOcr, runMealPhoto, runVoiceParse, runPotIngredientsPhoto } from '../runs';

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const ORIGINAL_FETCH = global.fetch;

function mockFetchOnce(text: string, ok = true, status = 200) {
  global.fetch = jest.fn(async () => ({
    ok,
    status,
    statusText: '',
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  })) as unknown as typeof fetch;
}

describe('run* orchestration', () => {
  afterEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = ORIGINAL_ENV;
    global.fetch = ORIGINAL_FETCH;
  });

  it('runLabelOcr returns missing_key when no API key is configured, without network access', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    global.fetch = jest.fn() as unknown as typeof fetch;

    const result = await runLabelOcr('base64photo');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing_key');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('runLabelOcr converts a kJ label into a plausible kcal PendingEntry', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    mockFetchOnce(
      JSON.stringify({
        items: [
          {
            name: 'Weet-Bix',
            grams: 100,
            kcal_per_100g: 1500,
            energy_unit_detected: 'kJ',
            protein_per_100g: 12,
            carbs_per_100g: 70,
            fat_per_100g: 2,
            confidence: 'exact',
            assumptions: '',
          },
        ],
      })
    );

    const result = await runLabelOcr('base64photo');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].kcal).toBeCloseTo(358.5, 0);
    expect(result.entries[0].source).toBe('label_ocr');
  });

  it('runVoiceParse produces multiple entries from one audio call (the "one wrap..." example)', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    mockFetchOnce(
      JSON.stringify({
        items: [
          { name: 'Wrap', grams: 60, kcal_per_100g: 280, energy_unit_detected: 'kcal', protein_per_100g: 8, carbs_per_100g: 45, fat_per_100g: 6, confidence: 'high', assumptions: '' },
          { name: 'Chicken breast', grams: 150, kcal_per_100g: 165, energy_unit_detected: 'kcal', protein_per_100g: 31, carbs_per_100g: 0, fat_per_100g: 3.6, confidence: 'high', assumptions: '' },
          { name: 'Olive oil', grams: 14, kcal_per_100g: 884, energy_unit_detected: 'kcal', protein_per_100g: 0, carbs_per_100g: 0, fat_per_100g: 100, confidence: 'high', assumptions: '1 tbsp ≈ 14g' },
          { name: 'Greek yoghurt', grams: 30, kcal_per_100g: 97, energy_unit_detected: 'kcal', protein_per_100g: 9, carbs_per_100g: 4, fat_per_100g: 5, confidence: 'medium', assumptions: '' },
        ],
      })
    );

    const result = await runVoiceParse('base64audio', 'audio/m4a');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(4);
    expect(result.entries.every((e) => e.source === 'voice')).toBe(true);
    expect(result.entries[2].assumptions).toBe('1 tbsp ≈ 14g');
  });

  it('runMealPhoto applies user quantity overrides on top of the model estimate', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    mockFetchOnce(
      JSON.stringify({
        items: [
          { name: 'Grilled chicken', grams: 120, kcal_per_100g: 165, energy_unit_detected: 'kcal', protein_per_100g: 31, carbs_per_100g: 0, fat_per_100g: 3.6, confidence: 'low', assumptions: 'visual estimate' },
        ],
      })
    );

    const result = await runMealPhoto('base64photo', {
      voiceNote: { audioBase64: 'base64audio', mimeType: 'audio/m4a' },
      userQuantities: [{ name: 'chicken', grams: 150 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0].grams).toBe(150);
    expect(result.entries[0].confidence).toBe('high');
  });

  it('reports no_items (not a crash) when every item in the response is implausible', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    mockFetchOnce(
      JSON.stringify({
        items: [
          { name: 'Bad reading', grams: 100, kcal_per_100g: 5000, energy_unit_detected: 'kcal', protein_per_100g: 1, carbs_per_100g: 1, fat_per_100g: 1, confidence: 'low', assumptions: '' },
        ],
      })
    );

    const result = await runLabelOcr('base64photo');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_items');
  });
});

describe('runPotIngredientsPhoto', () => {
  it('returns missing_key when no API key is configured, without network access', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    global.fetch = jest.fn() as unknown as typeof fetch;

    const result = await runPotIngredientsPhoto('base64photo');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing_key');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps raw ingredients from a photo into PendingEntry[] tagged meal_photo, applying the kJ rail', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    mockFetchOnce(
      JSON.stringify({
        items: [
          {
            name: 'Basmati rice (raw)',
            grams: 200,
            kcal_per_100g: 1506,
            energy_unit_detected: 'kJ',
            protein_per_100g: 7.5,
            carbs_per_100g: 79,
            fat_per_100g: 0.75,
            confidence: 'medium',
            assumptions: 'read per-100g figures off the visible rice packet',
          },
          {
            name: 'Red lentils (raw)',
            grams: 150,
            kcal_per_100g: 347,
            energy_unit_detected: 'kcal',
            protein_per_100g: 24,
            carbs_per_100g: 60,
            fat_per_100g: 1.3,
            confidence: 'low',
            assumptions: 'estimated ~150g by bowl fill level',
          },
        ],
      })
    );

    const result = await runPotIngredientsPhoto('base64photo', { textNote: 'chicken curry ingredients' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((e) => e.source === 'meal_photo')).toBe(true);
    // 1506 kJ / 4.184 ≈ 360 kcal/100g, scaled to 200g raw rice ≈ 720 kcal.
    expect(result.entries[0].kcal).toBeCloseTo(720, 0);
    expect(result.entries[0].grams).toBe(200);
    expect(result.entries[1].grams).toBe(150);
  });

  it('reports no_items when every item is implausible (unit-detection failure)', async () => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key';
    mockFetchOnce(
      JSON.stringify({
        items: [
          {
            name: 'Bad reading',
            grams: 100,
            kcal_per_100g: 5000,
            energy_unit_detected: 'kcal',
            protein_per_100g: 1,
            carbs_per_100g: 1,
            fat_per_100g: 1,
            confidence: 'low',
            assumptions: '',
          },
        ],
      })
    );

    const result = await runPotIngredientsPhoto('base64photo');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_items');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PROXY ERROR MAPPING — the transport-level `GeminiCallError` kinds
// ('unauthorized' / 'model_not_permitted', geminiClient.ts's proxy-only
// classification) must reach the screens/capture-job queue as their own
// honest `AiRunResult.reason`, never collapsed into the generic 'network'
// bucket a plain HTTP failure gets.
// ═══════════════════════════════════════════════════════════════════════

describe('run* orchestration — proxy error mapping', () => {
  const ORIGINAL_PROXY_URL = process.env.EXPO_PUBLIC_JOULE_PROXY_URL;
  const ORIGINAL_PROXY_TOKEN = process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN;

  afterEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = ORIGINAL_ENV;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = ORIGINAL_PROXY_URL;
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = ORIGINAL_PROXY_TOKEN;
    global.fetch = ORIGINAL_FETCH;
  });

  it("maps a proxy 401 to reason 'proxy_unauthorized', distinct from a generic network failure", async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'wrong-token';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      statusText: '',
      json: async () => ({ error: { message: 'Unauthorized.' } }),
    })) as unknown as typeof fetch;

    const result = await runLabelOcr('base64photo');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('proxy_unauthorized');
    expect(result.reason).not.toBe('network');
  });

  it("maps the proxy's 400 'Model not permitted' to reason 'proxy_model_not_permitted'", async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
    process.env.EXPO_PUBLIC_JOULE_PROXY_URL = 'https://proxy.example/api/gemini';
    process.env.EXPO_PUBLIC_JOULE_PROXY_TOKEN = 'shared-token';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      statusText: '',
      json: async () => ({ error: { message: 'Model not permitted by this proxy: gemini-3.5-flash-lite' } }),
    })) as unknown as typeof fetch;

    const result = await runLabelOcr('base64photo');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('proxy_model_not_permitted');
    expect(result.detail).toContain('gemini-3.5-flash-lite');
  });
});
