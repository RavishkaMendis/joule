// ═══════════════════════════════════════════════════════════════════════
// ZEPP IMPORT — column mapping (PRD §11/§12).
//
// We do not know Zepp's exact export column names — they vary by region,
// app version, and which data category was requested. Rather than
// hardcoding a guessed schema (explicitly forbidden by the task brief),
// this module only *suggests* a mapping from the file's actual header row
// via case-insensitive substring matching on common patterns, and always
// leaves the final mapping up to the caller (the import UI). Unmapped
// target fields are simply left null — partial imports are expected and
// fine (a Zepp export might only contain steps, or only sleep).
// ═══════════════════════════════════════════════════════════════════════

/** Target fields on `external_estimate` a CSV column can be mapped to. `date` is required; the rest are optional. */
export type ZeppTargetField = 'date' | 'tdee_est' | 'active_kcal' | 'steps' | 'sleep_minutes' | 'readiness';

export const ZEPP_TARGET_FIELDS: readonly ZeppTargetField[] = [
  'date',
  'tdee_est',
  'active_kcal',
  'steps',
  'sleep_minutes',
  'readiness',
];

/** A mapping from source CSV header name -> target field, or null (unmapped). */
export type ColumnMapping = Partial<Record<ZeppTargetField, string>>;

// Substrings checked case-insensitively against each header. Order within
// a field's list doesn't matter; first field (in ZEPP_TARGET_FIELDS order)
// whose pattern matches a given header wins, and each header can only be
// suggested for one field. This is a convenience heuristic only — the
// task brief is explicit that suggestions must never be silently trusted.
const SUGGEST_PATTERNS: Record<ZeppTargetField, readonly string[]> = {
  date: ['date', 'day', 'time'],
  tdee_est: ['tdee', 'total energy', 'total calorie', 'estimated calorie', 'calorie burn', 'expenditure'],
  active_kcal: ['active calorie', 'active kcal', 'active energy', 'exercise calorie', 'workout calorie'],
  steps: ['step'],
  sleep_minutes: ['sleep'],
  readiness: ['readiness', 'recovery', 'pai', 'body reading'],
};

/**
 * Suggest a mapping from a CSV's actual header row to target fields, via
 * case-insensitive substring matching on common Zepp/wearable-export
 * header patterns. Always a suggestion — the caller (import UI) must let
 * the user confirm or override every field before committing. A header
 * that matches no pattern is simply left unmapped (undefined), never
 * guessed.
 *
 * Each source header is used for at most one target field (first match by
 * ZEPP_TARGET_FIELDS order), and each target field gets at most one
 * suggested header (first header, in file order, that matches).
 */
export function suggestColumnMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedHeaders = new Set<string>();

  for (const field of ZEPP_TARGET_FIELDS) {
    const patterns = SUGGEST_PATTERNS[field];
    const match = headers.find((h) => {
      if (usedHeaders.has(h)) return false;
      const lower = h.toLowerCase();
      return patterns.some((p) => lower.includes(p));
    });
    if (match) {
      mapping[field] = match;
      usedHeaders.add(match);
    }
  }

  return mapping;
}
