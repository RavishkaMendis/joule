// ═══════════════════════════════════════════════════════════════════════
// Open Food Facts mapping tests — PRD §6's kJ/kcal warning is the
// specific bug these guard against: "Getting this wrong makes every
// number ~4x too high." All fixtures are inline JSON; no network calls.
// ═══════════════════════════════════════════════════════════════════════

import {
  cleanProductName,
  mapOffResponse,
  mapOffSearchResponse,
  resolveKcalPer100g,
  lookupBarcode,
  searchOpenFoodFacts,
} from '../openFoodFacts';

describe('resolveKcalPer100g', () => {
  it('uses the kJ field when only kJ is present (the common AU case)', () => {
    // Weet-Bix-ish: ~1500 kJ/100g -> ~358 kcal/100g
    const kcal = resolveKcalPer100g({ 'energy-kj_100g': 1500 });
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeCloseTo(1500 / 4.184, 5);
    expect(kcal!).toBeLessThan(900);
  });

  it('uses the kcal field directly when only kcal is present', () => {
    const kcal = resolveKcalPer100g({ 'energy-kcal_100g': 250 });
    expect(kcal).toBe(250);
  });

  it('prefers the explicit kcal field when both kcal and kJ are present and consistent', () => {
    // 250 kcal ≈ 1046 kJ — both present and mutually consistent.
    const kcal = resolveKcalPer100g({ 'energy-kcal_100g': 250, 'energy-kj_100g': 1046 });
    expect(kcal).toBe(250);
  });

  it('falls back to kJ conversion when the kcal field is implausible (e.g. kJ value miswritten under the kcal key)', () => {
    // A garbled/miswritten record: someone put the kJ figure (1500) into
    // the kcal field. The sanity rail must reject 1500 as an implausible
    // kcal/100g and fall back to the (also present, correct) kJ field.
    const kcal = resolveKcalPer100g({ 'energy-kcal_100g': 1500, 'energy-kj_100g': 1500 });
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeCloseTo(1500 / 4.184, 5);
    expect(kcal!).toBeLessThan(900);
  });

  it('returns null when neither energy field is present', () => {
    expect(resolveKcalPer100g({})).toBeNull();
  });

  it('returns null when the only available figure is implausible even after kJ conversion', () => {
    // 50000 kJ/100g -> ~11950 kcal — still absurd after conversion.
    expect(resolveKcalPer100g({ 'energy-kj_100g': 50000 })).toBeNull();
  });

  it('falls back to the generic energy_100g field with its declared unit', () => {
    expect(resolveKcalPer100g({ energy_100g: 1046, energy_unit: 'kJ' })).toBeCloseTo(1046 / 4.184, 5);
    expect(resolveKcalPer100g({ energy_100g: 250, energy_unit: 'kcal' })).toBe(250);
  });

  it('handles numeric-looking strings (OFF sometimes returns numbers as strings)', () => {
    const kcal = resolveKcalPer100g({ 'energy-kj_100g': '1046' as unknown as number });
    expect(kcal).toBeCloseTo(1046 / 4.184, 5);
  });
});

describe('mapOffResponse', () => {
  it('maps a complete panel to an exact-confidence PendingEntry', () => {
    const result = mapOffResponse('9300633926390', {
      status: 1,
      product: {
        product_name: 'Weet-Bix',
        nutriments: {
          'energy-kj_100g': 1500,
          proteins_100g: 11.5,
          carbohydrates_100g: 67,
          fat_100g: 2.1,
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.name).toBe('Weet-Bix');
    expect(result.entry.confidence).toBe('exact');
    expect(result.entry.source).toBe('barcode');
    expect(result.entry.barcode).toBe('9300633926390');
    expect(result.entry.per100g?.kcal).toBeCloseTo(1500 / 4.184, 5);
    expect(result.entry.kcal).toBeCloseTo(1500 / 4.184, 5);
    // grams defaults to 100 (per-100g basis) so the sheet can rescale.
    expect(result.entry.grams).toBe(100);
  });

  it('downgrades confidence to medium when a macro is missing but energy is known', () => {
    const result = mapOffResponse('123', {
      status: 1,
      product: {
        product_name: 'Mystery Bar',
        nutriments: {
          'energy-kcal_100g': 400,
          proteins_100g: 5,
          // carbs and fat missing
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.confidence).toBe('medium');
    expect(result.entry.protein_g).toBe(5);
    // Missing macros surface as 0 for display, never coerced silently to
    // "measured" — confidence carries that signal instead.
    expect(result.entry.carbs_g).toBe(0);
  });

  it('downgrades confidence to low when energy itself is missing', () => {
    const result = mapOffResponse('123', {
      status: 1,
      product: {
        product_name: 'No Energy Field',
        nutriments: { proteins_100g: 5, carbohydrates_100g: 10, fat_100g: 2 },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.confidence).toBe('low');
    expect(result.entry.kcal).toBe(0);
  });

  it('returns a typed not_found miss when OFF has no product for the barcode', () => {
    const result = mapOffResponse('0000000000000', { status: 0 });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns invalid_response when the product has no usable name', () => {
    const result = mapOffResponse('123', { status: 1, product: { nutriments: {} } });
    expect(result).toEqual({ ok: false, reason: 'invalid_response' });
  });

  // ═════════════════════════════════════════════════════════════════════
  // SERVING BASIS — task brief complaint #1: "It logs grams, not serving
  // size." mapOffResponse must surface a resolved servingBasis when OFF's
  // serving fields are usable, and leave it undefined (never a guess)
  // when they are absent or unparseable.
  // ═════════════════════════════════════════════════════════════════════

  it('resolves servingBasis from serving_size text when present', () => {
    const result = mapOffResponse('9300633926390', {
      status: 1,
      product: {
        product_name: 'Bread',
        nutriments: {
          'energy-kcal_100g': 250,
          proteins_100g: 9,
          carbohydrates_100g: 45,
          fat_100g: 3,
          serving_size: '2 slices (60g)',
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.servingBasis).toEqual({ gramsPerServing: 60, label: '2 slices' });
  });

  it('prefers numeric serving_quantity over re-parsed serving_size text', () => {
    const result = mapOffResponse('123', {
      status: 1,
      product: {
        product_name: 'Yoghurt',
        nutriments: {
          'energy-kcal_100g': 100,
          serving_size: '1 tub (150g)',
          serving_quantity: 148,
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.servingBasis).toEqual({ gramsPerServing: 148, label: '1 tub' });
  });

  it('leaves servingBasis undefined when OFF supplies no usable serving fields', () => {
    const result = mapOffResponse('123', {
      status: 1,
      product: {
        product_name: 'Mystery Bar',
        nutriments: { 'energy-kcal_100g': 400 },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.servingBasis).toBeUndefined();
  });

  it('leaves servingBasis undefined when serving_size is garbled/unparseable text', () => {
    const result = mapOffResponse('123', {
      status: 1,
      product: {
        product_name: 'Mystery Bar',
        nutriments: { 'energy-kcal_100g': 400, serving_size: 'a generous handful' },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.servingBasis).toBeUndefined();
  });

  it('the resolved servingBasis grams derive per-serving macros consistent with per100g via the shared conversion', () => {
    // Weet-Bix-like: 250 kcal/100g, 2 biscuits = 30g serving -> 75 kcal/serving.
    const result = mapOffResponse('123', {
      status: 1,
      product: {
        product_name: 'Weet-Bix',
        nutriments: {
          'energy-kcal_100g': 250,
          proteins_100g: 11.5,
          carbohydrates_100g: 67,
          fat_100g: 2.1,
          serving_size: '2 biscuits (30g)',
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.servingBasis?.gramsPerServing).toBe(30);
    // per100g basis is unaffected by servingBasis — still a 100g reference row.
    expect(result.entry.per100g?.kcal).toBe(250);
    expect(result.entry.grams).toBe(100);
  });
});

describe('lookupBarcode (network layer, mocked fetch)', () => {
  it('sets a real User-Agent header (OFF rate-limits requests without one)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 1, product: { product_name: 'Test', nutriments: { 'energy-kcal_100g': 100 } } }),
    });

    await lookupBarcode('123', fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['User-Agent']).toMatch(/Joule/);
  });

  it('returns a typed network_error miss on fetch rejection, never throwing', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
    const result = await lookupBarcode('123', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });

  it('returns a typed not_found miss on HTTP 404, never throwing', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const result = await lookupBarcode('123', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns a typed network_error miss on other non-2xx responses', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await lookupBarcode('123', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });

  it('returns invalid_response when JSON parsing fails, never throwing', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    });
    const result = await lookupBarcode('123', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: 'invalid_response' });
  });

  it('correctly converts kJ end-to-end through the real network path (mocked)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 1,
        product: {
          product_name: 'Aussie Product (kJ only)',
          nutriments: {
            'energy-kj_100g': 1046,
            proteins_100g: 10,
            carbohydrates_100g: 20,
            fat_100g: 5,
          },
        },
      }),
    });

    const result = await lookupBarcode('9312345678901', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.kcal).toBeCloseTo(250, 0);
    expect(result.entry.per100g?.kcal).toBeCloseTo(250, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PRODUCT NAME CLEANING
//
// Regression guard for a real scan on 2026-08-27 that logged
// "15000545 Ayam Tuna Mayonnaise" — OFF contributors often paste the
// barcode into product_name, and that name would then propagate into
// saved_food and every quick-add chip built from it.
// ═══════════════════════════════════════════════════════════════════════

describe('cleanProductName', () => {
  it('strips the scanned barcode from the front of the name', () => {
    expect(cleanProductName('15000545 Ayam Tuna Mayonnaise', '15000545')).toBe('Ayam Tuna Mayonnaise');
  });

  it('strips a barcode-shaped number even when it is not the scanned code', () => {
    expect(cleanProductName('9310072011691 Weet-Bix', '5000112637922')).toBe('Weet-Bix');
  });

  it('strips a trailing barcode', () => {
    expect(cleanProductName('Greek Yoghurt 9310072011691', '9310072011691')).toBe('Greek Yoghurt');
  });

  it('handles separators between barcode and name', () => {
    expect(cleanProductName('15000545 - Ayam Tuna', '15000545')).toBe('Ayam Tuna');
  });

  it('leaves short numbers alone — they are usually part of the real name', () => {
    expect(cleanProductName('500 Island Dressing', '9310072011691')).toBe('500 Island Dressing');
    expect(cleanProductName('7 Grain Bread', '9310072011691')).toBe('7 Grain Bread');
  });

  it('keeps the original when the digits were the entire name', () => {
    expect(cleanProductName('15000545', '15000545')).toBe('15000545');
  });

  it('leaves a clean name untouched', () => {
    expect(cleanProductName('Ayam Tuna Mayonnaise', '15000545')).toBe('Ayam Tuna Mayonnaise');
  });

  // Search results (unlike a barcode scan) don't always have a known
  // barcode for the query — `barcode` must be safely omittable.
  it('still strips a barcode-shaped run when no barcode is supplied (search-result case)', () => {
    expect(cleanProductName('15000545 Ayam Tuna Mayonnaise')).toBe('Ayam Tuna Mayonnaise');
  });

  it('leaves short numbers alone when no barcode is supplied', () => {
    expect(cleanProductName('500 Island Dressing')).toBe('500 Island Dressing');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TEXT SEARCH — PRD §6 tier 3's search variant. Same kJ trap, same
// name-cleaning, applied to a list of products instead of one.
// ═══════════════════════════════════════════════════════════════════════

describe('mapOffSearchResponse', () => {
  it('maps multiple products, applying kJ conversion per product', () => {
    const results = mapOffSearchResponse({
      products: [
        {
          code: '9300633926390',
          product_name: 'Weet-Bix',
          nutriments: { 'energy-kj_100g': 1500, proteins_100g: 11.5, carbohydrates_100g: 67, fat_100g: 2.1 },
        },
        {
          code: '111',
          product_name: 'Plain Bar',
          nutriments: { 'energy-kcal_100g': 400, proteins_100g: 5, carbohydrates_100g: 50, fat_100g: 10 },
        },
      ],
    });

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Weet-Bix');
    expect(results[0].per100g?.kcal).toBeCloseTo(1500 / 4.184, 5);
    expect(results[0].kcal).toBeCloseTo(1500 / 4.184, 5);
    expect(results[1].kcal).toBe(400);
  });

  it('strips barcode-shaped noise from search-result names, same as barcode lookup', () => {
    const results = mapOffSearchResponse({
      products: [
        {
          code: '15000545',
          product_name: '15000545 Ayam Tuna Mayonnaise',
          nutriments: { 'energy-kcal_100g': 150 },
        },
      ],
    });
    expect(results[0].name).toBe('Ayam Tuna Mayonnaise');
  });

  it('drops products with no usable name instead of failing the whole search', () => {
    const results = mapOffSearchResponse({
      products: [
        { code: '1', nutriments: { 'energy-kcal_100g': 100 } },
        { code: '2', product_name: 'Real Product', nutriments: { 'energy-kcal_100g': 200 } },
      ],
    });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Real Product');
  });

  it('downgrades confidence exactly like barcode lookup when energy is missing', () => {
    const results = mapOffSearchResponse({
      products: [{ code: '1', product_name: 'Mystery', nutriments: {} }],
    });
    expect(results[0].confidence).toBe('low');
    expect(results[0].kcal).toBe(0);
  });

  it('returns an empty array when OFF returns no products field', () => {
    expect(mapOffSearchResponse({})).toEqual([]);
  });

  it('marks results with source "barcode" (a lookup-type entry, not a fabricated new EntrySource)', () => {
    const results = mapOffSearchResponse({
      products: [{ code: '1', product_name: 'X', nutriments: { 'energy-kcal_100g': 100 } }],
    });
    expect(results[0].source).toBe('barcode');
  });
});

describe('searchOpenFoodFacts (network layer, mocked fetch)', () => {
  it('sets a real User-Agent header, same policy as barcode lookup', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ products: [] }),
    });

    await searchOpenFoodFacts('sushi', fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(options.headers['User-Agent']).toMatch(/Joule/);
    expect(url).toContain('search_terms=sushi');
  });

  it('returns an empty-but-ok result for an empty query without hitting the network', async () => {
    const fetchMock = jest.fn();
    const result = await searchOpenFoodFacts('   ', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a typed network_error miss on fetch rejection, never throwing', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
    const result = await searchOpenFoodFacts('sushi', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });

  it('returns a typed network_error miss on a non-2xx response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const result = await searchOpenFoodFacts('sushi', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: 'network_error' });
  });

  it('returns invalid_response when JSON parsing fails, never throwing', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    });
    const result = await searchOpenFoodFacts('sushi', fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, reason: 'invalid_response' });
  });

  it('correctly converts kJ end-to-end through the real search network path (mocked)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        products: [
          {
            code: '9312345678901',
            product_name: 'Aussie Product (kJ only)',
            nutriments: { 'energy-kj_100g': 1046, proteins_100g: 10, carbohydrates_100g: 20, fat_100g: 5 },
          },
        ],
      }),
    });

    const result = await searchOpenFoodFacts('aussie product', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].kcal).toBeCloseTo(250, 0);
  });
});
