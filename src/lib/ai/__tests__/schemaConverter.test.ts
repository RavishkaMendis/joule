// ═══════════════════════════════════════════════════════════════════════
// GEMINI → OPENAI STRICT SCHEMA CONVERTER TESTS
//
// Covers the two OpenAI strict-mode rules that don't exist in Gemini's
// OpenAPI-subset dialect (every object needs `additionalProperties:
// false`; every property must be listed in `required`, with optionality
// expressed as a nullable type union instead), against the app's real
// GEMINI_RESPONSE_SCHEMA plus synthetic nested-object/array/optional-field
// fixtures.
// ═══════════════════════════════════════════════════════════════════════

import { convertGeminiSchemaToOpenAIStrict, type JsonSchemaNode } from '../schemaConverter';
import { GEMINI_RESPONSE_SCHEMA } from '../schema';

/** Recursively asserts every object node in a converted schema is OpenAI-strict-legal. */
function assertStrict(node: JsonSchemaNode, path = '$') {
  if (node.type === 'object') {
    expect(node.additionalProperties).toBe(false);
    const properties = (node.properties as Record<string, JsonSchemaNode>) ?? {};
    const required = (node.required as string[]) ?? [];
    for (const key of Object.keys(properties)) {
      expect(required).toContain(key);
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      assertStrict(propSchema, `${path}.${key}`);
    }
  }
  if (node.type === 'array' && node.items && typeof node.items === 'object') {
    assertStrict(node.items as JsonSchemaNode, `${path}[]`);
  }
}

describe('convertGeminiSchemaToOpenAIStrict — the real app schema', () => {
  it('converts GEMINI_RESPONSE_SCHEMA into a fully strict OpenAI schema', () => {
    const converted = convertGeminiSchemaToOpenAIStrict(GEMINI_RESPONSE_SCHEMA as unknown as JsonSchemaNode);
    assertStrict(converted);
  });

  it('preserves the nested array-of-objects shape (items.items)', () => {
    const converted = convertGeminiSchemaToOpenAIStrict(GEMINI_RESPONSE_SCHEMA as unknown as JsonSchemaNode);
    const itemsArray = (converted.properties as Record<string, JsonSchemaNode>).items;
    expect(itemsArray.type).toBe('array');
    const itemSchema = itemsArray.items as JsonSchemaNode;
    expect(itemSchema.type).toBe('object');
    expect(itemSchema.additionalProperties).toBe(false);
    expect(Object.keys(itemSchema.properties as object).sort()).toEqual(
      expect.arrayContaining(['name', 'grams', 'kcal_per_100g', 'energy_unit_detected', 'confidence'])
    );
  });

  it('preserves enum values on a required string field (confidence)', () => {
    const converted = convertGeminiSchemaToOpenAIStrict(GEMINI_RESPONSE_SCHEMA as unknown as JsonSchemaNode);
    const itemSchema = ((converted.properties as Record<string, JsonSchemaNode>).items.items) as JsonSchemaNode;
    const confidence = (itemSchema.properties as Record<string, JsonSchemaNode>).confidence;
    expect(confidence.type).toBe('string');
    expect(confidence.enum).toEqual(['exact', 'high', 'medium', 'low']);
  });

  it('every top-level required field from the Gemini schema survives into the converted required array', () => {
    const converted = convertGeminiSchemaToOpenAIStrict(GEMINI_RESPONSE_SCHEMA as unknown as JsonSchemaNode);
    expect(converted.required).toEqual(['items']);
  });
});

describe('convertGeminiSchemaToOpenAIStrict — nested objects and arrays', () => {
  it('adds additionalProperties:false to every nested object, not just the root', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: {
        outer: {
          type: 'object',
          properties: {
            inner: { type: 'string' },
          },
          required: ['inner'],
        },
      },
      required: ['outer'],
    };

    const converted = convertGeminiSchemaToOpenAIStrict(schema);
    expect(converted.additionalProperties).toBe(false);
    const outer = (converted.properties as Record<string, JsonSchemaNode>).outer;
    expect(outer.additionalProperties).toBe(false);
    assertStrict(converted);
  });

  it('recurses through an array of objects', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: {
        list: {
          type: 'array',
          items: {
            type: 'object',
            properties: { a: { type: 'number' } },
            required: ['a'],
          },
        },
      },
      required: ['list'],
    };

    const converted = convertGeminiSchemaToOpenAIStrict(schema);
    assertStrict(converted);
    const list = (converted.properties as Record<string, JsonSchemaNode>).list;
    expect((list.items as JsonSchemaNode).additionalProperties).toBe(false);
  });
});

describe('convertGeminiSchemaToOpenAIStrict — optional fields become nullable, not dropped', () => {
  it('keeps an optional property in `required` and unions its type with null', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nickname: { type: 'string' }, // optional: absent from `required` below
      },
      required: ['name'],
    };

    const converted = convertGeminiSchemaToOpenAIStrict(schema);

    // Strict mode's rule: EVERY property must be listed in `required`,
    // optional or not — nullability is what actually makes it optional.
    expect(converted.required).toEqual(expect.arrayContaining(['name', 'nickname']));
    expect((converted.required as string[])).toHaveLength(2);

    const nickname = (converted.properties as Record<string, JsonSchemaNode>).nickname;
    expect(nickname.type).toEqual(expect.arrayContaining(['string', 'null']));
    expect((nickname.type as string[])).toHaveLength(2);

    // The required field is untouched — still a plain string, not nullable.
    const name = (converted.properties as Record<string, JsonSchemaNode>).name;
    expect(name.type).toBe('string');
  });

  it('adds null to an optional enum field\'s enum list, not just its type union', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: {
        unit: { type: 'string', enum: ['kcal', 'kJ'] }, // optional
      },
      required: [],
    };

    const converted = convertGeminiSchemaToOpenAIStrict(schema);
    const unit = (converted.properties as Record<string, JsonSchemaNode>).unit;
    expect(unit.type).toEqual(expect.arrayContaining(['string', 'null']));
    expect(unit.enum).toEqual(expect.arrayContaining(['kcal', 'kJ', null]));
    expect(converted.required).toEqual(['unit']);
  });

  it('leaves an already-required field\'s enum untouched (no null added)', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: {
        unit: { type: 'string', enum: ['kcal', 'kJ'] },
      },
      required: ['unit'],
    };

    const converted = convertGeminiSchemaToOpenAIStrict(schema);
    const unit = (converted.properties as Record<string, JsonSchemaNode>).unit;
    expect(unit.type).toBe('string');
    expect(unit.enum).toEqual(['kcal', 'kJ']);
  });

  it('makes an optional nested object nullable at the object level too', () => {
    const schema: JsonSchemaNode = {
      type: 'object',
      properties: {
        detail: {
          type: 'object',
          properties: { note: { type: 'string' } },
          required: ['note'],
        },
      },
      required: [], // `detail` itself is optional
    };

    const converted = convertGeminiSchemaToOpenAIStrict(schema);
    const detail = (converted.properties as Record<string, JsonSchemaNode>).detail;
    // The object's own conversion still runs (additionalProperties/required
    // inside it), then the whole thing gets unioned with null.
    expect(detail.type).toEqual(expect.arrayContaining(['object', 'null']));
    expect(detail.additionalProperties).toBe(false);
    expect(converted.required).toEqual(['detail']);
  });
});
