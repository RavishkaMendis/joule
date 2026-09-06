// ═══════════════════════════════════════════════════════════════════════
// ZEPP IMPORT — JSON support (cheap best-effort, CSV is the priority).
//
// Some Zepp app versions/regions export JSON instead of CSV. Full support
// for every shape Zepp might produce is out of scope (task brief: "support
// that too if it's cheap — but CSV is the priority, and say plainly what
// you did and didn't support"). What IS supported cheaply: a JSON array of
// flat objects (`[{ "date": "...", "steps": 1234, ... }, ...]`), which
// covers the common "array of daily records" export shape. NOT supported:
// nested/grouped JSON (e.g. `{ "days": { "2026-01-01": {...} } }`) or
// newline-delimited JSON — those would need format-specific unwrapping
// this module does not attempt, and are reported as an explicit error
// rather than silently producing zero rows.
//
// Flattening to Record<string, string> lets JSON reuse exactly the same
// header-suggestion (zeppMapping.ts) and row-parsing (zeppRows.ts) code
// CSV uses — one mapping UI, one validation path, regardless of input
// format.
// ═══════════════════════════════════════════════════════════════════════

export type JsonParseResult =
  | { ok: true; headers: string[]; rows: Record<string, string>[] }
  | { ok: false; error: string };

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Nested objects/arrays inside a row (e.g. a per-row `details: {...}`)
  // aren't a target field we map to, so stringify rather than drop —
  // harmless, since only mapped columns are ever read back out.
  return JSON.stringify(v);
}

/**
 * Parse Zepp JSON export text into the same flat-row shape parseCsv
 * produces, so the rest of the import pipeline (suggestColumnMapping,
 * parseZeppRows) is format-agnostic. Only handles a top-level array of
 * flat objects — the common "array of daily records" shape. Returns an
 * explicit error (never throws) for anything else, including a single
 * object (not an array) or nested/grouped structures, so the caller can
 * tell the user plainly rather than silently importing zero rows.
 */
export function parseZeppJson(text: string): JsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error:
        'This JSON file is not a flat array of records ([{...}, {...}]). Only that shape is supported — nested/grouped exports are not.',
    };
  }
  if (parsed.length === 0) {
    return { ok: true, headers: [], rows: [] };
  }

  const headerSet = new Set<string>();
  const rows: Record<string, string>[] = [];

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false, error: 'This JSON file contains an array entry that is not a plain object — cannot import.' };
    }
    const obj = item as Record<string, unknown>;
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      headerSet.add(key);
      row[key] = stringifyValue(value);
    }
    rows.push(row);
  }

  return { ok: true, headers: [...headerSet], rows };
}
