// ═══════════════════════════════════════════════════════════════════════
// GEMINI STRUCTURED OUTPUT SCHEMA — PRD §8
//
// One schema, shared by all three Gemini paths (label OCR, meal photo,
// voice). Forcing `responseMimeType: application/json` +
// `responseSchema` is what lets us skip a separate parsing/regex layer —
// Gemini returns exactly this shape or the call fails structurally.
//
// `energy_unit_detected` is the field the whole kJ trap (PRD §6) hinges
// on: Australian nutrition panels print kJ, and if the model doesn't
// tell us which unit it read, every downstream number is silently ~4x
// too high. See mapToPendingEntry.ts for where this gets converted.
// ═══════════════════════════════════════════════════════════════════════

/** One food item as Gemini reports it, before unit conversion/validation. */
export type GeminiFoodItem = {
  name: string;
  grams: number;
  kcal_per_100g: number;
  energy_unit_detected: 'kcal' | 'kJ';
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  assumptions: string;
};

/** Top-level shape of every structured Gemini response used by this app. */
export type GeminiStructuredResponse = {
  items: GeminiFoodItem[];
};

/**
 * Gemini `responseSchema` (a subset of OpenAPI 3.0 Schema Object, per
 * Gemini's structured-output docs) describing `GeminiStructuredResponse`.
 * Passed verbatim in `generationConfig.responseSchema`.
 */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          kcal_per_100g: { type: 'number' },
          energy_unit_detected: { type: 'string', enum: ['kcal', 'kJ'] },
          protein_per_100g: { type: 'number' },
          carbs_per_100g: { type: 'number' },
          fat_per_100g: { type: 'number' },
          confidence: { type: 'string', enum: ['exact', 'high', 'medium', 'low'] },
          assumptions: { type: 'string' },
        },
        required: [
          'name',
          'grams',
          'kcal_per_100g',
          'energy_unit_detected',
          'protein_per_100g',
          'carbs_per_100g',
          'fat_per_100g',
          'confidence',
          'assumptions',
        ],
      },
    },
  },
  required: ['items'],
} as const;

/**
 * Runtime guard for a parsed JSON blob before it's trusted as
 * `GeminiStructuredResponse`. `responseSchema` constrains generation but
 * does not guarantee the SDK/REST layer handed back valid JSON (truncated
 * output, safety-filtered response, etc.), so this still earns its keep.
 */
export function isGeminiStructuredResponse(value: unknown): value is GeminiStructuredResponse {
  if (typeof value !== 'object' || value === null) return false;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return false;
  return items.every(isGeminiFoodItem);
}

function isGeminiFoodItem(value: unknown): value is GeminiFoodItem {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.grams === 'number' &&
    typeof v.kcal_per_100g === 'number' &&
    (v.energy_unit_detected === 'kcal' || v.energy_unit_detected === 'kJ') &&
    typeof v.protein_per_100g === 'number' &&
    typeof v.carbs_per_100g === 'number' &&
    typeof v.fat_per_100g === 'number' &&
    (v.confidence === 'exact' || v.confidence === 'high' || v.confidence === 'medium' || v.confidence === 'low') &&
    typeof v.assumptions === 'string'
  );
}
