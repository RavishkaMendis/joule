// ═══════════════════════════════════════════════════════════════════════
// PENDING ENTRY — the single intermediate object every input path
// produces, and the props contract for the one shared confirmation sheet.
//
// PRD §7: "Five paths, ONE shared confirmation sheet. Every path produces
// the same intermediate object. Build the sheet once, build it well.
// Every input method is then just a different way to populate it."
//
// PRD §7 also states the non-negotiable rule that governs all AI paths:
//   "The model never writes directly to the log — there is always a
//    human beat before save."
// No code path may call foodRepo.addEntry() straight from a model
// response. It must land here first and be confirmed by the user.
//
// This file is owned by the orchestrator specifically so the barcode and
// Gemini paths cannot drift into two incompatible sheets. Extend it
// rather than forking it.
// ═══════════════════════════════════════════════════════════════════════

/** Mirrors food_entry.source in PRD §3's schema. */
export type EntrySource =
  | 'barcode'
  | 'label_ocr'
  | 'meal_photo'
  | 'voice'
  | 'pot'
  | 'manual'
  | 'afcd';

/**
 * How much to trust the numbers. PRD §10: "Confidence always visible. A
 * ±15% photo estimate must not look identical to a barcode scan."
 */
export type EntryConfidence = 'exact' | 'high' | 'medium' | 'low';

/** PRD §7's intermediate object, verbatim. */
export type PendingEntry = {
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: EntryConfidence;
  source: EntrySource;
  /**
   * Per-100g basis, retained when known (barcode / label OCR / AFCD) so
   * the sheet can re-derive macros live as the user edits grams instead
   * of scaling stale absolute numbers.
   */
  per100g?: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
  /**
   * Model's stated assumptions, surfaced verbatim in the sheet. PRD §8:
   * "Assumed 1 tbsp oil ≈ 14g" builds trust and catches errors."
   */
  assumptions?: string;
  /** Original transcript / raw model response → food_entry.raw_input. */
  rawInput?: string;
  /** Barcode paths only — lets "save to my foods" round-trip. */
  barcode?: string;
  /**
   * The un-multiplied basis this entry scales from: the grams/macros
   * exactly as the source (model or lookup) reported them, before any
   * quantity multiplier or portion fraction is applied.
   *
   * This exists so ×2 / ½ / grams-edits can be applied and re-applied
   * from a stable base rather than compounding onto an already-scaled
   * `grams`/`kcal` — see `applyQuantityMultiplier` in this file. Every
   * entry effectively has one (it defaults to the entry's own grams/
   * macros when absent), but it is only set explicitly once a multiplier
   * other than 1 has been applied, keeping existing callers' entries
   * (which never touch this field) unaffected.
   */
  baseline?: {
    grams: number;
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
  /**
   * Quantity multiplier applied on top of `baseline` — ×2, ×3, ×0.5, or a
   * portion fraction like ½ (0.5) / ⅓ (0.333…). A fraction is just a
   * multiplier below 1; there is deliberately one mechanism for both
   * ("I ate 2 of these" and "I only ate half" are the same operation in
   * opposite directions), not two parallel systems. Defaults to 1
   * (unset) when the user has not touched it.
   */
  quantityMultiplier?: number;
  /**
   * Serving basis, when the source knows one (barcode/Open Food Facts
   * today; additive so any future source can populate it too). PRD-driven
   * complaint (task brief): "It logs grams, not serving size." OFF's
   * `serving_size` / `serving_quantity` fields are inconsistently
   * populated — this is `undefined`, not a zero/empty guess, whenever
   * they can't be resolved. See src/lib/foodSources/servingSize.ts for the
   * parsing. Purely additive: every existing PendingEntry (manual, voice,
   * meal photo, label OCR) simply never sets this and behaves exactly as
   * before.
   */
  servingBasis?: {
    gramsPerServing: number;
    /** Human label for the serving ("2 slices", "1 tub"), when the source text had one worth showing. Absent when all that's known is a bare gram figure. */
    label?: string;
  };
  /**
   * Which unit the sheet is currently displaying/editing this entry in.
   * Additive, UI-facing state — defaults to `'serving'` when
   * `servingBasis` exists (PRD-driven: "Default to 1 serving when serving
   * data exists" — that's what people actually eat) and `'grams'`
   * otherwise. Not persisted to food_entry; it only shapes how the sheet
   * presents the existing grams/macro fields, which remain the source of
   * truth regardless of which unit is currently selected.
   */
  displayUnit?: 'serving' | 'grams';
};

/**
 * Props for the ONE shared confirmation sheet.
 *
 * `entries` is a list because voice and meal-photo paths routinely yield
 * several items from a single capture ("one wrap, 150g chicken, tbsp of
 * oil" → three entries). Barcode and label OCR simply pass one.
 */
export type ConfirmSheetProps = {
  entries: PendingEntry[];
  /** ISO yyyy-mm-dd the entries will be logged against. */
  date: string;
  /** Fired once the user has reviewed/edited and accepted. */
  onConfirm: (entries: PendingEntry[]) => Promise<void> | void;
  onCancel: () => void;
  /**
   * Shown when a lookup partially failed, e.g. barcode not found in Open
   * Food Facts. PRD §7.2: "On miss, offer label OCR immediately in the
   * same flow. Never dead-end the user."
   */
  fallbackAction?: { label: string; onPress: () => void };
};

/** kJ → kcal. PRD §6: Australian panels list kJ; getting this wrong makes every number ~4x too high. */
export function kjToKcal(kj: number): number {
  return kj / 4.184;
}

/**
 * PRD §6 sanity rail: reject implausible per-100g energy before saving.
 * Catches unit-detection failures (kJ read as kcal) and OCR garbage.
 */
export function isPlausibleKcalPer100g(kcal: number): boolean {
  return Number.isFinite(kcal) && kcal >= 0 && kcal <= 900;
}

/** Scale a per-100g basis to an absolute gram amount. */
export function scaleFromPer100g(
  per100g: NonNullable<PendingEntry['per100g']>,
  grams: number
): Pick<PendingEntry, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'> {
  const f = grams / 100;
  return {
    kcal: per100g.kcal * f,
    protein_g: per100g.protein_g * f,
    carbs_g: per100g.carbs_g * f,
    fat_g: per100g.fat_g * f,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// QUANTITY MULTIPLIER / PORTION FRACTION
//
// One mechanism serves both "I ate 2 of these" (×2, ×3) and "I only ate
// half" (½, ⅓, ¾) — a fraction is a multiplier below 1. Keeping this as
// pure functions, tested hard, because this is exactly where compounding
// a multiplier onto already-scaled absolutes produces silently wrong
// numbers (multiply once, scale from a stable baseline, never re-derive
// from the entry's own current — possibly already-multiplied — fields).
// ─────────────────────────────────────────────────────────────────────────

/** The un-multiplied {grams, kcal, protein_g, carbs_g, fat_g} an entry scales from. */
export type EntryBaseline = NonNullable<PendingEntry['baseline']>;

/** Extracts (or synthesizes) the baseline an entry's multiplier should scale from. */
export function getBaseline(entry: PendingEntry): EntryBaseline {
  if (entry.baseline) return entry.baseline;
  return {
    grams: entry.grams,
    kcal: entry.kcal,
    protein_g: entry.protein_g,
    carbs_g: entry.carbs_g,
    fat_g: entry.fat_g,
  };
}

/**
 * Sets up an entry's initial baseline/multiplier/displayUnit for
 * ConfirmSheet, given whatever `servingBasis` the source resolved.
 *
 * PRD-driven default (task brief): "Default to 1 serving when serving
 * data exists, grams otherwise. That's what people actually eat." This is
 * the ONE place that decides the initial unit — everything downstream
 * (the toggle, the ×2/½ chips) is just `applyQuantityMultiplier` against
 * whichever baseline this function pins.
 *
 * The reuse trick that avoids a parallel scaling path (task brief: "reuse
 * applyQuantityMultiplier rather than building a parallel scaling path"):
 * when defaulting to serving mode, `baseline` is set to ONE serving's
 * worth of grams/macros (re-derived from `per100g` when known, so it's
 * numerically identical to what `scaleFromPer100g` would produce for that
 * gram amount) rather than the source's original 100g/absolute basis.
 * With that baseline pinned, the existing ×2/×3/½ chips already mean
 * "servings" with no code change to `applyQuantityMultiplier` at all —
 * ×2 scales 1-serving-baseline × 2 = 2 servings, exactly like it scales
 * any other baseline × 2.
 *
 * Entries with no `servingBasis` (the vast majority of existing callers —
 * manual, voice, meal photo, most label OCR) pass through untouched:
 * `displayUnit` becomes `'grams'` and baseline/multiplier are left as
 * `getBaseline` would already synthesize them, so this is a no-op for
 * every caller that predates serving support.
 */
export function initializeServingDisplay(entry: PendingEntry): PendingEntry {
  const basis = entry.servingBasis;
  if (!basis || !Number.isFinite(basis.gramsPerServing) || basis.gramsPerServing <= 0) {
    return { ...entry, displayUnit: 'grams' };
  }

  const gramsPerServing = basis.gramsPerServing;
  const macros = entry.per100g ? scaleFromPer100g(entry.per100g, gramsPerServing) : scaleProportionally(entry, gramsPerServing);

  return {
    ...entry,
    displayUnit: 'serving',
    grams: gramsPerServing,
    ...macros,
    baseline: { grams: gramsPerServing, ...macros },
    quantityMultiplier: 1,
  };
}

/** Proportionally scales an entry's current absolute macros to a new gram amount, for the (rare) case a serving basis exists but no per100g basis does. */
function scaleProportionally(
  entry: Pick<PendingEntry, 'grams' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>,
  grams: number
): Pick<PendingEntry, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'> {
  if (!Number.isFinite(entry.grams) || entry.grams <= 0) {
    return { kcal: entry.kcal, protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g };
  }
  const f = grams / entry.grams;
  return {
    kcal: entry.kcal * f,
    protein_g: entry.protein_g * f,
    carbs_g: entry.carbs_g * f,
    fat_g: entry.fat_g * f,
  };
}

/**
 * Toggles an entry between serving and gram display. Pure UI-state flip —
 * the entry's `grams`/macros are already correct in absolute terms
 * regardless of `displayUnit` (they always reflect
 * `baseline × quantityMultiplier`); only the *label* ConfirmSheet renders
 * next to the multiplier chips changes ("servings" vs "×1/×2/×3" grams
 * mental model). No-op when the entry has no `servingBasis` — the toggle
 * only ever appears in the sheet when one exists.
 */
export function toggleDisplayUnit(entry: PendingEntry): PendingEntry {
  if (!entry.servingBasis) return entry;
  return { ...entry, displayUnit: entry.displayUnit === 'grams' ? 'serving' : 'grams' };
}

/**
 * Applies a quantity multiplier (×2, ×0.5, …) to an entry, scaling grams
 * and all macros together from the entry's `baseline` — never from its
 * current (possibly already-multiplied) absolute fields, which is how a
 * second tap of ×2 would otherwise silently yield ×4.
 *
 * When `per100g` is present, macros are re-derived via `scaleFromPer100g`
 * against the *effective* grams (baseline grams × multiplier) rather than
 * scaling the baseline's absolute macros proportionally — this keeps the
 * per-100g basis authoritative exactly as grams-editing already does, so
 * the two mechanisms round-trip together instead of drifting apart.
 *
 * Returns the entry with `baseline` pinned (so future multiplier changes
 * keep scaling from the same origin) and `quantityMultiplier` set.
 */
export function applyQuantityMultiplier(entry: PendingEntry, multiplier: number): PendingEntry {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return entry;
  }

  const baseline = getBaseline(entry);
  const grams = baseline.grams * multiplier;

  const macros = entry.per100g
    ? scaleFromPer100g(entry.per100g, grams)
    : {
        kcal: baseline.kcal * multiplier,
        protein_g: baseline.protein_g * multiplier,
        carbs_g: baseline.carbs_g * multiplier,
        fat_g: baseline.fat_g * multiplier,
      };

  return {
    ...entry,
    grams,
    ...macros,
    baseline,
    quantityMultiplier: multiplier,
  };
}

/**
 * Formats the "N servings · Xg" (or "1 serving · Xg") readout the sheet
 * shows alongside the multiplier chips in serving mode, so the resolved
 * gram amount is never opaque (task brief: "Always show the gram
 * equivalent alongside... so the user is never guessing" — this applies
 * to both the default 1-serving state and any ×2/½ adjustment).
 * `servingLabel` (e.g. "2 slices") is used in place of the bare word
 * "serving(s)" when the source supplied one, so a bread entry reads
 * "2 servings (2 slices) · 60 g" rather than the less concrete "2
 * servings · 60 g" — still always followed by the gram figure.
 */
export function formatServingQuantity(servingCount: number, grams: number, servingLabel?: string): string {
  const roundedGrams = Math.round(grams);
  const countText = Number.isInteger(servingCount) ? String(servingCount) : servingCount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const unit = servingCount === 1 ? 'serving' : 'servings';
  const labelSuffix = servingLabel ? ` (${servingLabel})` : '';
  return `${countText} ${unit}${labelSuffix} · ${roundedGrams} g`;
}

/**
 * Rebases an entry so its current grams/macros become the new baseline
 * and the multiplier resets to 1. Used when the user directly edits
 * grams (or any macro field) while a multiplier is active — that edit is
 * itself now the user-asserted "one serving" amount, so a subsequent ×2
 * should scale from *this* value, not silently re-derive from the older
 * pre-edit baseline and discard the manual edit.
 */
export function rebaseQuantity(entry: PendingEntry): PendingEntry {
  return {
    ...entry,
    baseline: {
      grams: entry.grams,
      kcal: entry.kcal,
      protein_g: entry.protein_g,
      carbs_g: entry.carbs_g,
      fat_g: entry.fat_g,
    },
    quantityMultiplier: 1,
  };
}

/**
 * PRD §7.4: "The model identifies components; the user's stated
 * quantities win." When the user sets a multiplier/fraction (or edits
 * grams directly — see ConfirmSheet), the *quantity* is no longer the
 * model's guess, so confidence should move one rung up the ladder:
 * low → medium, medium → high. `high` and `exact` are left alone —
 * `exact` is reserved for barcode/label-panel data and a user-stated
 * quantity does not promote a photo/voice estimate that far, it only
 * says "trust the amount, not necessarily the per-gram macros."
 */
export function promoteConfidenceForUserQuantity(confidence: EntryConfidence): EntryConfidence {
  if (confidence === 'low') return 'medium';
  if (confidence === 'medium') return 'high';
  return confidence;
}

/**
 * Applies a one-tap multiplier/fraction chip AND the PRD §7.4 confidence
 * promotion in one pure step, anchored to `originalConfidence` — the
 * confidence the source (model/lookup) reported *before any user
 * quantity edit in this sheet session*, not the entry's current
 * (possibly already-promoted) confidence.
 *
 * This anchor matters because a user can tap between chips (×2, then
 * ×3, then ½) or retype a grams field character by character; re-deriving
 * promotion from the entry's own current confidence each time would
 * compound (low → medium → high after two edits) and overstate a single
 * quantity assertion as if it were two independent corrections.
 *
 * ×1 is treated as "no explicit quantity assertion" — the quiet default
 * every row starts at — so it restores `originalConfidence` rather than
 * promoting it.
 */
export function applyMultiplierWithPromotion(
  entry: PendingEntry,
  multiplier: number,
  originalConfidence: EntryConfidence
): PendingEntry {
  const scaled = applyQuantityMultiplier(entry, multiplier);
  const confidence = multiplier === 1 ? originalConfidence : promoteConfidenceForUserQuantity(originalConfidence);
  return { ...scaled, confidence };
}

/**
 * Applies a direct grams-field edit: re-derives grams/macros (via
 * `per100g` when known, else proportional scaling of the current
 * absolutes), rebases the multiplier baseline to this new amount (see
 * `rebaseQuantity`), and promotes confidence from `originalConfidence` —
 * the same anchor rule as `applyMultiplierWithPromotion`, and for the
 * same reason: this function is called on every keystroke while a user
 * types a new value, so promoting from the entry's own current
 * confidence would over-promote across a multi-digit edit.
 */
export function applyGramsEdit(entry: PendingEntry, grams: number, originalConfidence: EntryConfidence): PendingEntry {
  const rescaled = entry.per100g
    ? { ...entry, grams, ...scaleFromPer100g(entry.per100g, grams) }
    : rescaleAbsolutesFromCurrent(entry, grams);

  return rebaseQuantity({
    ...rescaled,
    confidence: promoteConfidenceForUserQuantity(originalConfidence),
  });
}

/** Proportionally scales an entry's current absolute macros to a new gram amount (no per100g basis). */
function rescaleAbsolutesFromCurrent(entry: PendingEntry, grams: number): PendingEntry {
  const prevGrams = entry.grams;
  if (!Number.isFinite(prevGrams) || prevGrams <= 0) {
    return { ...entry, grams };
  }
  const factor = grams / prevGrams;
  return {
    ...entry,
    grams,
    kcal: entry.kcal * factor,
    protein_g: entry.protein_g * factor,
    carbs_g: entry.carbs_g * factor,
    fat_g: entry.fat_g * factor,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// QUICK-ADD PRESETS — cooking oil/ghee, the biggest hidden variable.
//
// PRD §7.5: "Three tablespoons of ghee is ~360 kcal no vision model will
// ever see." A meal photo cannot see oil poured into a pan, so the sheet
// offers one-tap presets to add it after the fact. These are per-100g
// bases (standard nutrition-panel figures for the oils/fats themselves)
// so the resulting PendingEntry carries `per100g` and behaves exactly
// like any other row for grams-editing/multiplier purposes.
//
// Confidence is deliberately 'high', not 'low': PRD §7.4 — the user
// asserting "2 tbsp olive oil" is a stated quantity of a known food, which
// is *more* trustworthy than a model's visual guess, not less. It is not
// 'exact' because that rung is reserved for barcode/label-panel data.
// ─────────────────────────────────────────────────────────────────────────

export type QuickAddPreset = {
  id: string;
  label: string;
  name: string;
  grams: number;
  per100g: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
};

/** Standard per-100g figures for common cooking fats (AFCD-consistent order of magnitude). */
export const QUICK_ADD_PRESETS: QuickAddPreset[] = [
  {
    id: 'oil_tbsp',
    label: '1 tbsp oil (~14g)',
    name: 'Cooking oil',
    grams: 14,
    per100g: { kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100 },
  },
  {
    id: 'oil_tsp',
    label: '1 tsp oil (~5g)',
    name: 'Cooking oil',
    grams: 5,
    per100g: { kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100 },
  },
  {
    id: 'ghee_tbsp',
    label: '1 tbsp ghee (~13g)',
    name: 'Ghee',
    grams: 13,
    per100g: { kcal: 897, protein_g: 0, carbs_g: 0, fat_g: 99.8 },
  },
];

/** Builds a user-asserted PendingEntry from a quick-add preset. */
export function pendingEntryFromQuickAdd(preset: QuickAddPreset): PendingEntry {
  const macros = scaleFromPer100g(preset.per100g, preset.grams);
  return {
    name: preset.name,
    grams: preset.grams,
    ...macros,
    confidence: 'high',
    source: 'manual',
    per100g: preset.per100g,
    assumptions: `Added manually — ${preset.label}`,
  };
}

/** Builds a blank, user-authored PendingEntry for the freeform "add item" row. */
export function blankManualEntry(): PendingEntry {
  return {
    name: '',
    grams: 100,
    kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    confidence: 'high',
    source: 'manual',
  };
}
