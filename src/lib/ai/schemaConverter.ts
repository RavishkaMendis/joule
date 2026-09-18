// ═══════════════════════════════════════════════════════════════════════
// GEMINI → OPENAI STRICT JSON SCHEMA CONVERTER
//
// Gemini's `responseSchema` (schema.ts's GEMINI_RESPONSE_SCHEMA) is an
// OpenAPI-3.0-subset Schema Object: optionality is expressed by a
// property's ABSENCE from its parent's `required` array, and objects say
// nothing about extra properties.
//
// OpenAI's `response_format: { type: 'json_schema', json_schema: { strict:
// true, schema } }` (used by the OpenRouter failover path, which is
// OpenAI-shaped per the chat-completions API) enforces a stricter subset:
//
//   1. Every object must set `additionalProperties: false`.
//   2. Every property an object declares must ALSO appear in that
//      object's `required` array — there is no such thing as an "absent"
//      optional property in strict mode. An optional field is instead
//      expressed by unioning its `type` with `"null"` (and, if it has an
//      `enum`, adding `null` to that enum too, since JSON Schema applies
//      both constraints and a bare `type` union does not by itself make
//      `null` a valid enum member).
//
// This module does the mechanical translation. It is deliberately pure
// (no network, no Gemini/OpenAI SDK types) so it can be unit tested
// against plain schema fixtures. It walks `object`/`array` nodes
// recursively; every other node (`string`/`number`/`integer`/`boolean`,
// with or without `enum`) is a leaf and passes through unchanged apart
// from the nullable transform above.
//
// Constructs this converter does NOT attempt to translate, because
// Gemini's schema subset does not use them and OpenAI strict mode has no
// equivalent worth inventing one for: `$ref`/definitions (no schema this
// app builds is self-referential), `oneOf`/`anyOf`/`allOf` (Gemini's
// subset doesn't emit these), and `patternProperties` (objects here are
// always closed, known-shape records). If a future Gemini schema
// introduces one of these, this converter will pass the node through
// unchanged rather than silently mistranslating it — which will produce
// an OpenAI schema that the API rejects at call time (a loud failure)
// rather than one that looks strict but isn't (a silent one).
// ═══════════════════════════════════════════════════════════════════════

/** Loosely-typed JSON Schema node — both Gemini's and OpenAI's dialects are plain JSON objects. */
export type JsonSchemaNode = Record<string, unknown>;

/**
 * Converts a Gemini `responseSchema` node into an OpenAI strict
 * `json_schema` node. Safe to call on the root schema or any subschema;
 * used recursively on `properties` and `items`.
 */
export function convertGeminiSchemaToOpenAIStrict(schema: JsonSchemaNode): JsonSchemaNode {
  return convertNode(schema);
}

function convertNode(node: JsonSchemaNode): JsonSchemaNode {
  if (node.type === 'object') {
    return convertObjectNode(node);
  }
  if (node.type === 'array') {
    const items = node.items;
    return {
      ...node,
      type: 'array',
      items: items && typeof items === 'object' ? convertNode(items as JsonSchemaNode) : items,
    };
  }
  // Leaf (string/number/integer/boolean, or an already-nullable union) —
  // nothing here needs translating; `enum` and other leaf keywords
  // (format, minimum, maxLength, ...) are all supported as-is by OpenAI
  // strict mode for their respective types.
  return { ...node };
}

function convertObjectNode(node: JsonSchemaNode): JsonSchemaNode {
  const properties = (node.properties as Record<string, JsonSchemaNode> | undefined) ?? {};
  const requiredList = Array.isArray(node.required) ? (node.required as string[]) : [];
  const requiredSet = new Set(requiredList);

  const newProperties: Record<string, JsonSchemaNode> = {};
  const newRequired: string[] = [];

  for (const [key, propSchema] of Object.entries(properties)) {
    const wasRequired = requiredSet.has(key);
    const converted = convertNode(propSchema);
    newProperties[key] = wasRequired ? converted : makeNullable(converted);
    // Strict mode's one rule for optionality: the property still appears
    // in `required` — its nullability is what actually makes it optional.
    newRequired.push(key);
  }

  return {
    ...node,
    type: 'object',
    properties: newProperties,
    required: newRequired,
    additionalProperties: false,
  };
}

/**
 * Turns a schema node into its nullable form: `type` becomes a union with
 * `"null"`, and if the node has an `enum`, `null` is added to it too (a
 * `type: [x, "null"]` union does not by itself admit `null` past an
 * `enum` constraint — JSON Schema applies every keyword, so the enum list
 * needs `null` as an explicit member).
 */
function makeNullable(schema: JsonSchemaNode): JsonSchemaNode {
  const currentType = schema.type;
  const typeList = Array.isArray(currentType) ? (currentType as unknown[]) : currentType === undefined ? [] : [currentType];
  const nullableType = Array.from(new Set([...typeList, 'null']));

  const result: JsonSchemaNode = { ...schema, type: nullableType };

  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(null)) {
    result.enum = [...(schema.enum as unknown[]), null];
  }

  return result;
}
