// ═══════════════════════════════════════════════════════════════════════
// numericInput — shared parsing/validation for free-text numeric fields
// (grams, kcal, macros, weight, rate, meals-per-day, ...).
//
// The trap this exists to close: `Number('')` is `0`, and `0` is
// `Number.isFinite`-true. Every numeric TextInput in this app stores its
// raw text in state (so the user can type "1." or "-" transiently without
// the field fighting them), and several screens historically validated
// with `Number.isFinite(Number(text))` alone — which treats an emptied
// field exactly like a deliberately-entered 0. For a kcal value or an
// ingredient's contribution to a pot's kcal_per_g, a silent 0 is a data
// corruption, not a reasonable default (PRD §10 "everything editable
// forever" assumes the numbers logged are real).
//
// `parseRequiredNumber` is the one place that distinction is decided:
// blank/whitespace-only text is always invalid, never a silent 0.
// ═══════════════════════════════════════════════════════════════════════

export type NumberFieldValidity =
  | { valid: true; value: number }
  | { valid: false; value: null };

/**
 * Parses a free-text numeric field (accepting comma as a decimal
 * separator, per the rest of the app's convention) and reports whether
 * the text is a genuinely present, finite number.
 *
 * Blank or whitespace-only text is always `valid: false` — it must never
 * be treated as an implicit 0. This is distinct from "0 is invalid";
 * callers that want to additionally require a positive value should check
 * `result.value > 0` themselves (grams and kcal generally should; a macro
 * like fat_g legitimately can be 0 for e.g. a black coffee).
 */
export function parseRequiredNumber(text: string): NumberFieldValidity {
  if (text.trim().length === 0) return { valid: false, value: null };
  const parsed = Number(text.replace(',', '.'));
  if (!Number.isFinite(parsed)) return { valid: false, value: null };
  return { valid: true, value: parsed };
}

/** True when `text` is blank/whitespace-only or does not parse to a finite number. */
export function isBlankOrInvalidNumber(text: string): boolean {
  return !parseRequiredNumber(text).valid;
}
