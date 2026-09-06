// ═══════════════════════════════════════════════════════════════════════
// ConfirmSheet — THE one shared confirmation sheet (PRD §7).
//
// "Five paths, ONE shared confirmation sheet. Every path produces the
// same intermediate object. Build the sheet once, build it well. Every
// input method is then just a different way to populate it."
//
// Implements `ConfirmSheetProps` from src/lib/pendingEntry.ts EXACTLY —
// that file is owned by the orchestrator and is the shared contract
// with the concurrent agent building the Gemini AI paths (label OCR,
// meal photo, voice), which renders this same sheet. Do not fork it.
//
// Layout (polish-pass fix): this used to render as a bottom-anchored
// sheet capped at 90% height, which left the top third of the screen
// empty with 4-5 rows and made reviewing/editing macros feel cramped
// into the lower half. Reviewing 5 rows of macros is a task surface, not
// a quick yes/no confirmation, so it now reads as a full-height screen
// within the same `Modal` (still a `Modal` — the four capture screens
// render it directly and re-routing it to a navigation screen is out of
// scope for this pass): a pinned header (title + item count + meal
// controls), a body ScrollView that owns the remaining height, and a
// footer (Cancel / Log N) pinned to the bottom. `useSafeAreaInsets` pads
// the header's top and the footer's bottom directly, since this Modal's
// content sits outside the presenting screen's own safe-area padding.
//
// Responsibilities baked in here per the task brief:
//   - Every field editable, including `grams` — when `per100g` is known,
//     editing grams re-derives kcal/protein/carbs/fat live via
//     `scaleFromPer100g` rather than scaling stale absolute numbers
//     (this is what keeps a barcode/label-OCR edit numerically honest).
//   - Confidence is visible per row (PRD §10) using the existing
//     `colors.confidence` ladder — never red, never a pass/fail signal.
//   - `assumptions` surfaced verbatim when present (PRD §8: "Assumed
//     1 tbsp oil ≈ 14g" builds trust and catches errors).
//   - Per-row "Save to my foods" toggle — writes `saved_food` on confirm
//     so the personal library grows (PRD §7.3).
//   - `fallbackAction` rendered prominently so a barcode miss can offer
//     label OCR in the same flow rather than dead-ending (PRD §7.2).
//   - Confirm writes via foodRepo.addEntry (+ addSavedFood for toggled
//     rows) for `date`. foodRepo.addEntry triggers
//     intakeRepo.recomputeDay itself — this component must NOT call it
//     again.
//
// Quantity multiplier / portion fraction ("I ate 2 of these" / "I only
// ate half") — one mechanism, per `applyQuantityMultiplier` in
// pendingEntry.ts: a fraction is a multiplier below 1. ×2 is a single tap
// (PRD §9.1's 10-second test governs this sheet) reachable directly on
// every row's chip strip (½ ⅓ ¾ ×1 ×2 ×3) — no extra "expand" tap in the
// way. A row sitting at ×1 stays visually quiet: the ×1 chip is unstyled/
// low-contrast and no effective-grams readout is shown, so a normal
// one-item log with no adjustment looks exactly like the sheet did
// before this feature existed.
//
// Add missing items (PRD §7.5 — cooking oil is the single largest hidden
// variable a vision model cannot see) — a footer "+ Add item" control
// offers one-tap oil/ghee presets plus a freeform manual row, both marked
// `high` confidence (a stated quantity beats a model guess) rather than
// `low`, and never promoted to `exact` (reserved for barcode/label data).
//
// Meal grouping / naming (schema v2) — when a capture yields 2+ items,
// the sheet offers a "meal name" field pre-filled with a suggestion
// (`suggestMealName`, derived from the confirmed item list — see that
// module's header for why it derives from items rather than threading
// MealPhotoScreen's typed `textNote`: that screen is owned by a
// concurrent agent and out of scope to edit here). On confirm, every row
// in a 2+-item capture is written with a shared, freshly-generated
// `meal_group_id` and the same `meal_name`, so Today can collapse them
// into one row. A single-item capture gets neither — no meal-name field
// is shown, and its `meal_group_id` stays null — so the fast path (PRD
// §9.1's 10-second test) is completely unaffected by this feature.
//
// Meal type (breakfast/lunch/dinner/snack) is a single one-tap selector
// for the WHOLE sheet (not per-row — one capture is one meal, whichever
// number of components a photo/voice note explodes it into), defaulted
// from time-of-day via `defaultMealTypeForNow` (see mealType.ts for the
// exact hour thresholds) but always user-editable before confirming.
//
// Serving ⇄ grams unit toggle (task brief complaint #1: "It logs grams,
// not serving size, and there's no way to change it") — rendered per-row,
// only when the source resolved a `servingBasis` (today: barcode/Open
// Food Facts via servingSize.ts). `toDraft` calls `initializeServingDisplay`
// so a row with serving data DEFAULTS to serving mode showing 1 serving's
// resolved grams — the multiplier chips then already mean SERVINGS with
// zero changes to `applyQuantityMultiplier` itself, because the row's
// pinned `baseline` is one serving's worth of grams/macros rather than
// the usual 100g reference row; ×2 scales that baseline by 2, i.e. "2
// servings", via the exact same function every other row's ×2 goes
// through. Toggling units (`toggleDisplayUnit`) never touches grams,
// macros, or confidence — it only flips which label/gram-equivalent
// readout is shown next to the (unchanged) multiplier chips. This
// composes with continuous barcode scanning (BarcodeScanScreen) exactly
// like any other multi-item capture: each scanned row keeps its own
// independent serving/gram state, and the meal-grouping machinery above
// has no idea any of this exists.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import type { ConfirmSheetProps, EntryConfidence, PendingEntry, QuickAddPreset } from '../lib/pendingEntry';
import {
  applyGramsEdit,
  applyMultiplierWithPromotion,
  blankManualEntry,
  formatServingQuantity,
  getBaseline,
  initializeServingDisplay,
  pendingEntryFromQuickAdd,
  QUICK_ADD_PRESETS,
  toggleDisplayUnit,
} from '../lib/pendingEntry';
import { getDatabase } from '../lib/db';
import * as foodRepo from '../db/repositories/foodRepo';
import { generateId } from '../lib/ids';
import { suggestMealName } from '../lib/mealName';
import { defaultMealTypeForNow, MEAL_TYPES, MEAL_TYPE_LABEL } from '../lib/mealType';
import type { MealType } from '../db/types';
import { parseRequiredNumber } from '../lib/numericInput';

/** Editable draft of a single row. Mirrors PendingEntry plus per-row UI-only state. */
type RowDraft = PendingEntry & {
  saveToMyFoods: boolean;
  /**
   * Confidence exactly as the source (model/lookup) reported it, before
   * any user-asserted quantity edit. Promotion (see
   * `promoteConfidenceForUserQuantity`) always applies to *this* fixed
   * value, not to `row.confidence` as it stands mid-edit — otherwise
   * every keystroke while typing a new grams value would re-promote an
   * already-promoted confidence (low → medium → high across two
   * keystrokes for one edit), which overstates a single user assertion.
   */
  originalConfidence: EntryConfidence;
};

/** One-tap multiplier options. Fractions and whole multipliers share the same control. */
const MULTIPLIER_OPTIONS: { label: string; value: number }[] = [
  { label: '½', value: 0.5 },
  { label: '⅓', value: 1 / 3 },
  { label: '¾', value: 0.75 },
  { label: '×1', value: 1 },
  { label: '×2', value: 2 },
  { label: '×3', value: 3 },
];

/**
 * Builds a row draft, resolving the initial serving/gram display via
 * `initializeServingDisplay` (task brief: "Default to 1 serving when
 * serving data exists, grams otherwise"). This is a no-op for the vast
 * majority of entries (no `servingBasis`), so every existing caller's
 * row looks exactly as it did before this feature existed.
 */
function toDraft(entry: PendingEntry): RowDraft {
  const initialized = initializeServingDisplay(entry);
  return { ...initialized, saveToMyFoods: false, originalConfidence: initialized.confidence };
}

function toPendingEntry(row: RowDraft): PendingEntry {
  return {
    name: row.name,
    grams: row.grams,
    kcal: row.kcal,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
    confidence: row.confidence,
    source: row.source,
    per100g: row.per100g,
    assumptions: row.assumptions,
    rawInput: row.rawInput,
    barcode: row.barcode,
    baseline: row.baseline,
    quantityMultiplier: row.quantityMultiplier,
    servingBasis: row.servingBasis,
    displayUnit: row.displayUnit,
  };
}

const CONFIDENCE_LABEL: Record<EntryConfidence, string> = {
  exact: 'Exact',
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

/**
 * Re-derives macros from a direct grams edit via the pure
 * `applyGramsEdit` (per100g re-derivation when known, rebase, and
 * confidence promotion anchored to the row's `originalConfidence` — see
 * that function's doc for why the anchor matters: this runs on every
 * keystroke, and promoting from the row's own current confidence each
 * time would over-promote across a multi-digit edit).
 */
function rescaleForGrams(row: RowDraft, grams: number): RowDraft {
  return { ...row, ...applyGramsEdit(row, grams, row.originalConfidence) };
}

/**
 * Applies a one-tap multiplier/fraction chip via the pure
 * `applyMultiplierWithPromotion`, anchored to the row's
 * `originalConfidence` so switching between chips (×2, then ×3, then ½)
 * is always a single promotion from the source's original rating.
 */
function applyMultiplierToRow(row: RowDraft, multiplier: number): RowDraft {
  return { ...row, ...applyMultiplierWithPromotion(row, multiplier, row.originalConfidence) };
}

/**
 * Flips a row's serving/grams display via the pure `toggleDisplayUnit`.
 * Confidence is untouched (this function's return spread does not
 * include `confidence` at all) — a unit change must never move the
 * confidence ladder (task brief: "do not let a unit change alter
 * confidence"), unlike a grams-edit or multiplier tap which are user
 * quantity ASSERTIONS. Toggling units is not an assertion about quantity,
 * it's just a different lens on the same amount.
 */
function toggleUnitForRow(row: RowDraft): RowDraft {
  return { ...row, ...toggleDisplayUnit(row) };
}

export function ConfirmSheet({ entries, date, onConfirm, onCancel, fallbackAction }: ConfirmSheetProps) {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<RowDraft[]>(() => entries.map(toDraft));
  const [saving, setSaving] = useState(false);

  // Meal naming only makes sense for a multi-item capture — a single
  // barcode/label/manual entry must not demand a name (PRD §9.1's
  // 10-second test: that would add a mandatory extra field to the fast
  // path for every ordinary single-item log). `mealName` starts at the
  // derived suggestion but is fully user-editable/replaceable before
  // confirming, exactly like every other field in this sheet.
  const [mealName, setMealName] = useState<string>(() => (entries.length >= 2 ? suggestMealName(entries) : ''));
  const [mealType, setMealType] = useState<MealType>(() => defaultMealTypeForNow());

  // Keep in sync if the caller supplies a new `entries` list (e.g. a fresh
  // scan/capture while the sheet is already mounted).
  const entriesKey = useMemo(() => entries.map((e) => `${e.name}|${e.grams}|${e.source}`).join('~'), [entries]);
  const [lastEntriesKey, setLastEntriesKey] = useState(entriesKey);
  if (entriesKey !== lastEntriesKey) {
    setLastEntriesKey(entriesKey);
    setRows(entries.map(toDraft));
    setMealName(entries.length >= 2 ? suggestMealName(entries) : '');
  }

  const isMultiItem = rows.length >= 2;

  // kcal/protein/carbs/fat legitimately CAN be 0 (e.g. black coffee has
  // 0g fat) — unlike grams, they must not additionally require `> 0`, only
  // that the field is actually present (Number.isFinite, which NaN — the
  // sentinel a cleared field is stored as, see updateNumericField below —
  // always fails). Blank must block confirm rather than silently
  // confirming a fabricated 0, exactly like grams already does.
  const canConfirm =
    rows.length > 0 &&
    rows.every(
      (r) =>
        r.name.trim().length > 0 &&
        Number.isFinite(r.grams) &&
        r.grams > 0 &&
        Number.isFinite(r.kcal) &&
        Number.isFinite(r.protein_g) &&
        Number.isFinite(r.carbs_g) &&
        Number.isFinite(r.fat_g)
    );

  const updateRow = (index: number, patch: Partial<RowDraft>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const updateGrams = (index: number, gramsText: string) => {
    // Blank/invalid text is stored as NaN, not 0 — Number('') is 0, which
    // IS Number.isFinite-true, so without this the field would silently
    // read back as a real, deliberately-entered zero the instant it's
    // cleared. NaN round-trips back to an empty string display via
    // Field's `Number.isFinite(row.grams) ? String(row.grams) : ''` below.
    const parsed = parseRequiredNumber(gramsText);
    const grams = parsed.valid ? parsed.value : NaN;
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        if (!Number.isFinite(grams)) return { ...r, grams: NaN };
        return rescaleForGrams(r, grams);
      })
    );
  };

  const updateNumericField = (index: number, field: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g', text: string) => {
    // Same NaN-sentinel fix as updateGrams — a cleared kcal/macro field
    // must not silently become a real 0 (PRD §7.5: a corrupted kcal here
    // poisons kcal_per_g for every pot serving derived from it; the same
    // trap applies to any confirmed entry). 0 is still a legitimate,
    // explicitly-typed value (isBlankOrInvalidNumber only rejects blank/
    // unparseable text, never "0").
    const parsed = parseRequiredNumber(text);
    const value = parsed.valid ? parsed.value : NaN;
    updateRow(index, { [field]: value } as Partial<RowDraft>);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateMultiplier = (index: number, multiplier: number) => {
    setRows((prev) => prev.map((r, i) => (i === index ? applyMultiplierToRow(r, multiplier) : r)));
  };

  const toggleUnit = (index: number) => {
    setRows((prev) => prev.map((r, i) => (i === index ? toggleUnitForRow(r) : r)));
  };

  const addQuickAdd = (preset: QuickAddPreset) => {
    setRows((prev) => [...prev, toDraft(pendingEntryFromQuickAdd(preset))]);
  };

  const addManualRow = () => {
    setRows((prev) => [...prev, toDraft(blankManualEntry())]);
  };

  const handleConfirm = async () => {
    if (!canConfirm || saving) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const loggedAt = Date.now();

      // A shared meal_group_id links every row of a multi-item capture so
      // Today can collapse them into one row (see mealGrouping.ts). A
      // single-item capture gets no group at all — it must render exactly
      // as a standalone entry always has, not as a one-member "group".
      // Generated once per confirm, not per row, and not hoisted above
      // this function: a group id must be fresh for every save, never
      // reused across an earlier cancelled/edited attempt in the same
      // sheet session.
      const mealGroupId = isMultiItem ? generateId('meal') : null;
      const trimmedMealName = mealName.trim();

      for (const row of rows) {
        await foodRepo.addEntry(db, {
          id: generateId('entry'),
          date,
          logged_at: loggedAt,
          name: row.name.trim(),
          grams: row.grams,
          kcal: row.kcal,
          protein_g: row.protein_g,
          carbs_g: row.carbs_g,
          fat_g: row.fat_g,
          source: row.source,
          confidence: row.confidence,
          raw_input: row.rawInput ?? null,
          meal_type: mealType,
          meal_group_id: mealGroupId,
          meal_name: mealGroupId ? trimmedMealName || null : null,
        });

        if (row.saveToMyFoods && row.grams > 0) {
          // Per-100g is multiplier-invariant: a multiplier scales grams and
          // macros together, so kcal/grams is unchanged by ×2. Safe to
          // derive from the row's current (possibly multiplied) values.
          const per100 = row.per100g ?? scaleTo100(row);
          // default_grams, however, is NOT invariant. It seeds future
          // quick-add chips, so it must be the single-serve baseline, not
          // today's multiplied amount — otherwise logging ×2 once makes
          // every later one-tap quick-add of this food silently double.
          const defaultGrams = getBaseline(row).grams || row.grams;
          await foodRepo.addSavedFood(db, {
            id: generateId('food'),
            name: row.name.trim(),
            barcode: row.barcode ?? null,
            kcal_per_100g: per100.kcal,
            protein_per_100g: per100.protein_g,
            carbs_per_100g: per100.carbs_g,
            fat_per_100g: per100.fat_g,
            default_grams: defaultGrams,
            // The originating row's own confidence (schema v3) — NOT
            // hardcoded 'exact'. A `low`-confidence meal-photo item saved
            // here must stay tagged `low` when later quick-added, per PRD
            // §10 ("Confidence always visible") — see logQuickAdd's doc in
            // foodEntryActions.ts for the full reasoning.
            confidence: row.confidence,
          });
        }
      }

      // foodRepo.addEntry triggers intakeRepo.recomputeDay itself — do not
      // call it again here.
      const confirmed: PendingEntry[] = rows.map((row) => toPendingEntry(row));
      await onConfirm(confirmed);
    } finally {
      setSaving(false);
    }
  };

  const itemCountLabel = rows.length === 1 ? '1 item' : `${rows.length} items`;

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      {/*
        A Modal does NOT inherit the presenting screen's keyboard
        handling — it's a separate native window, so this needs its own
        KeyboardAvoidingView. Without it the pinned footer and the row
        being edited both sit under the keyboard: the user reported
        exactly this on the photo-review field, and every editable
        grams/macro field plus the meal-name input here has the same
        shape. `height` is correct for Android (the window resizes);
        `padding` is the iOS idiom.
      */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Confirm entries</Text>
            <Text style={styles.itemCount}>{itemCountLabel}</Text>
          </View>

          {fallbackAction && (
            <Pressable
              onPress={fallbackAction.onPress}
              style={({ pressed }) => [styles.fallbackBanner, pressed && styles.fallbackBannerPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.fallbackText}>{fallbackAction.label}</Text>
            </Pressable>
          )}

          <MealTypeSelector value={mealType} onChange={setMealType} />

          {isMultiItem && (
            <View style={styles.mealNameSection}>
              <Text style={styles.mealNameLabel}>Meal name</Text>
              <TextInput
                style={styles.mealNameInput}
                value={mealName}
                onChangeText={setMealName}
                placeholder="Name this meal"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="Meal name — shown as one row on Today, expandable to its components"
              />
            </View>
          )}
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          {rows.length === 0 && <Text style={styles.emptyText}>No items to confirm.</Text>}
          {rows.map((row, index) => (
            <EntryRow
              key={index}
              row={row}
              onChangeName={(v) => updateRow(index, { name: v })}
              onChangeGrams={(v) => updateGrams(index, v)}
              onChangeField={(field, v) => updateNumericField(index, field, v)}
              onToggleSave={(v) => updateRow(index, { saveToMyFoods: v })}
              onChangeMultiplier={(m) => updateMultiplier(index, m)}
              onToggleUnit={() => toggleUnit(index)}
              onRemove={() => removeRow(index)}
              removable={rows.length > 1}
            />
          ))}

          <AddItemFooter onAddQuickAdd={addQuickAdd} onAddManual={addManualRow} />
        </ScrollView>

        <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleConfirm()}
            disabled={!canConfirm || saving}
            style={({ pressed }) => [
              styles.confirmButton,
              pressed && !(!canConfirm || saving) && styles.confirmButtonPressed,
              (!canConfirm || saving) && styles.confirmButtonDisabled,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm || saving, busy: saving }}
          >
            {saving ? (
              <View style={styles.confirmLoadingRow}>
                <ActivityIndicator size="small" color={colors.background} />
                <Text style={styles.confirmText}>Saving…</Text>
              </View>
            ) : (
              <Text style={styles.confirmText}>{`Log ${rows.length || ''}`.trim()}</Text>
            )}
          </Pressable>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function scaleTo100(row: RowDraft): { kcal: number; protein_g: number; carbs_g: number; fat_g: number } {
  if (!row.grams || row.grams <= 0) {
    return { kcal: row.kcal, protein_g: row.protein_g, carbs_g: row.carbs_g, fat_g: row.fat_g };
  }
  const scale = 100 / row.grams;
  return {
    kcal: row.kcal * scale,
    protein_g: row.protein_g * scale,
    carbs_g: row.carbs_g * scale,
    fat_g: row.fat_g * scale,
  };
}

type EntryRowProps = {
  row: RowDraft;
  onChangeName: (v: string) => void;
  onChangeGrams: (v: string) => void;
  onChangeField: (field: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g', v: string) => void;
  onToggleSave: (v: boolean) => void;
  onChangeMultiplier: (multiplier: number) => void;
  onToggleUnit: () => void;
  onRemove: () => void;
  removable: boolean;
};

function EntryRow({
  row,
  onChangeName,
  onChangeGrams,
  onChangeField,
  onToggleSave,
  onChangeMultiplier,
  onToggleUnit,
  onRemove,
  removable,
}: EntryRowProps) {
  const tint = colors.confidence[row.confidence];
  const activeMultiplier = row.quantityMultiplier ?? 1;
  const baselineGrams = row.baseline?.grams;
  const isServingMode = row.displayUnit === 'serving' && !!row.servingBasis;
  // In serving mode the effective-grams readout (task brief: "Always show
  // the gram equivalent alongside... so the user is never guessing")
  // shows even at the default ×1 — 1 serving's gram equivalent is exactly
  // the thing this feature exists to make non-opaque. In grams mode the
  // existing quiet-×1 behaviour is untouched.
  const showEffectiveGrams = isServingMode ? Number.isFinite(baselineGrams) : activeMultiplier !== 1 && Number.isFinite(baselineGrams);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <TextInput
          style={styles.nameInput}
          value={row.name}
          onChangeText={onChangeName}
          placeholder="Food name"
          placeholderTextColor={colors.textTertiary}
        />
        <View style={styles.confidenceBadge} accessibilityLabel={`${CONFIDENCE_LABEL[row.confidence]}`}>
          <Text style={[styles.confidenceText, { color: tint, borderColor: tint }]}>
            {CONFIDENCE_LABEL[row.confidence]}
          </Text>
        </View>
      </View>

      {row.assumptions && (
        <Text style={styles.assumptions}>
          {'ⓘ'} {row.assumptions}
        </Text>
      )}

      {/* Serving ⇄ grams unit toggle (task brief complaint #1) — only
          rendered when the source actually resolved a serving basis (OFF's
          serving_size/serving_quantity). A row with no servingBasis shows
          nothing here at all, so the ordinary grams-only flow is visually
          identical to before this feature existed. */}
      {row.servingBasis && (
        <View style={styles.unitToggleRow}>
          <Pressable
            onPress={onToggleUnit}
            accessibilityRole="button"
            accessibilityLabel={isServingMode ? 'Switch to grams' : 'Switch to servings'}
            hitSlop={4}
            style={({ pressed }) => [styles.unitToggleChip, pressed && styles.unitToggleChipPressed]}
          >
            <Text style={styles.unitToggleText}>{isServingMode ? 'Servings' : 'Grams'} ⇄</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.multiplierRow}>
        {MULTIPLIER_OPTIONS.map((option) => {
          const active = Math.abs(activeMultiplier - option.value) < 1e-9;
          // A ×1 chip renders quiet (no fill, dim text) so a row nobody
          // adjusts looks the same as it always did — only an actually
          // active non-1 multiplier draws attention to itself. In serving
          // mode ×1 still means "1 serving" (the meaningful default), not
          // "no adjustment", but the visual treatment stays identical —
          // quiet is quiet regardless of what unit ×1 represents.
          const isQuietDefault = option.value === 1;
          return (
            <Pressable
              key={option.label}
              onPress={() => onChangeMultiplier(option.value)}
              accessibilityRole="button"
              accessibilityLabel={
                isServingMode
                  ? `Set quantity to ${option.label} servings`
                  : `Set quantity to ${option.label}`
              }
              hitSlop={4}
              style={({ pressed }) => [
                styles.multiplierChip,
                active && !isQuietDefault && styles.multiplierChipActive,
                pressed && styles.multiplierChipPressed,
              ]}
            >
              <Text
                style={[
                  styles.multiplierChipText,
                  active && !isQuietDefault && styles.multiplierChipTextActive,
                  isQuietDefault && !active && styles.multiplierChipTextQuiet,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
        {showEffectiveGrams && (
          <Text style={styles.effectiveGrams}>
            {isServingMode
              ? formatServingQuantity(activeMultiplier, row.grams, row.servingBasis?.label)
              : `${MULTIPLIER_OPTIONS.find((o) => Math.abs(activeMultiplier - o.value) < 1e-9)?.label ?? `×${activeMultiplier}`} = ${Math.round(row.grams)}g`}
          </Text>
        )}
      </View>

      <View style={styles.fieldRow}>
        <Field label="Grams" value={Number.isFinite(row.grams) ? String(row.grams) : ''} onChange={onChangeGrams} />
        <Field label="kcal" value={Number.isFinite(row.kcal) ? String(Math.round(row.kcal)) : ''} onChange={(v) => onChangeField('kcal', v)} />
      </View>
      <View style={styles.fieldRow}>
        <Field
          label="Protein g"
          value={Number.isFinite(row.protein_g) ? String(Math.round(row.protein_g)) : ''}
          onChange={(v) => onChangeField('protein_g', v)}
        />
        <Field
          label="Carbs g"
          value={Number.isFinite(row.carbs_g) ? String(Math.round(row.carbs_g)) : ''}
          onChange={(v) => onChangeField('carbs_g', v)}
        />
        <Field
          label="Fat g"
          value={Number.isFinite(row.fat_g) ? String(Math.round(row.fat_g)) : ''}
          onChange={(v) => onChangeField('fat_g', v)}
        />
      </View>

      <View style={styles.saveRow}>
        <Text style={styles.saveLabel}>Save to my foods</Text>
        <Switch
          value={row.saveToMyFoods}
          onValueChange={onToggleSave}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </View>

      {removable && (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
        >
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.textTertiary}
      />
    </View>
  );
}

/**
 * Footer control for adding an item the model missed — PRD §7.5's
 * emphatic case is cooking oil ("three tablespoons of ghee is ~360 kcal
 * no vision model will ever see"). One-tap presets cover the common
 * cases with sensible gram defaults; "Add custom item" drops in a blank
 * row for anything else, edited like any other row afterwards.
 */
function AddItemFooter({
  onAddQuickAdd,
  onAddManual,
}: {
  onAddQuickAdd: (preset: QuickAddPreset) => void;
  onAddManual: () => void;
}) {
  return (
    <View style={styles.addItemSection}>
      <Text style={styles.addItemLabel}>Missed something?</Text>
      <View style={styles.quickAddRow}>
        {QUICK_ADD_PRESETS.map((preset) => (
          <Pressable
            key={preset.id}
            onPress={() => onAddQuickAdd(preset)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${preset.label}`}
            style={({ pressed }) => [styles.quickAddChip, pressed && styles.quickAddChipPressed]}
          >
            <Text style={styles.quickAddChipText}>+ {preset.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={onAddManual}
        accessibilityRole="button"
        style={({ pressed }) => [styles.addCustomButton, pressed && styles.addCustomButtonPressed]}
      >
        <Text style={styles.addCustomText}>+ Add custom item</Text>
      </Pressable>
    </View>
  );
}

/**
 * One-tap meal-type selector for the whole sheet (breakfast/lunch/dinner/
 * snack — PRD's "meal type, chosen at log time"). Defaults from time of
 * day (see mealType.ts's defaultMealTypeForNow) but is always a plain,
 * quiet row of chips — never a mandatory field or a modal, so it never
 * threatens the 10-second test for a repeat single-item log.
 */
function MealTypeSelector({ value, onChange }: { value: MealType; onChange: (t: MealType) => void }) {
  return (
    <View style={styles.mealTypeRow}>
      {MEAL_TYPES.map((t) => {
        const active = t === value;
        return (
          <Pressable
            key={t}
            onPress={() => onChange(t)}
            accessibilityRole="button"
            accessibilityLabel={`Set meal type to ${MEAL_TYPE_LABEL[t]}`}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.mealTypeChip,
              active && styles.mealTypeChipActive,
              pressed && styles.mealTypeChipPressed,
            ]}
          >
            <Text style={[styles.mealTypeChipText, active && styles.mealTypeChipTextActive]}>
              {MEAL_TYPE_LABEL[t]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Lets the KeyboardAvoidingView fill the Modal so the footer lifts with the keyboard. */
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    ...type.h2,
    color: colors.text,
  },
  itemCount: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  fallbackBanner: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  fallbackBannerPressed: {
    backgroundColor: colors.border,
  },
  fallbackText: {
    ...type.body,
    color: colors.accent,
  },
  mealTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  mealTypeChip: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  mealTypeChipActive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.accent,
  },
  mealTypeChipPressed: {
    backgroundColor: colors.surface,
  },
  mealTypeChipText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  mealTypeChipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  mealNameSection: {
    marginBottom: spacing.md,
  },
  mealNameLabel: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  mealNameInput: {
    ...type.bodyStrong,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  emptyText: {
    ...type.body,
    color: colors.textTertiary,
    paddingVertical: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  nameInput: {
    ...type.bodyStrong,
    color: colors.text,
    flex: 1,
    paddingVertical: spacing.xs,
  },
  confidenceBadge: {
    alignItems: 'flex-end',
  },
  confidenceText: {
    ...type.small,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  assumptions: {
    ...type.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  unitToggleRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  unitToggleChip: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  unitToggleChipPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  unitToggleText: {
    ...type.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  multiplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  multiplierChip: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  multiplierChipActive: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  multiplierChipPressed: {
    backgroundColor: colors.surface,
  },
  multiplierChipText: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  multiplierChipTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  multiplierChipTextQuiet: {
    color: colors.textTertiary,
  },
  effectiveGrams: {
    ...type.small,
    ...numeric,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  field: {
    flex: 1,
  },
  fieldLabel: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  fieldInput: {
    ...type.body,
    ...numeric,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  saveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveLabel: {
    ...type.caption,
    color: colors.textSecondary,
  },
  removeButton: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    marginTop: spacing.xs,
    borderRadius: radii.sm,
  },
  removeButtonPressed: {
    backgroundColor: colors.surface,
  },
  removeText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  addItemSection: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  addItemLabel: {
    ...type.caption,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  quickAddRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  quickAddChip: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
  },
  quickAddChipPressed: {
    backgroundColor: colors.border,
  },
  quickAddChipText: {
    ...type.caption,
    color: colors.text,
  },
  addCustomButton: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  addCustomButtonPressed: {
    opacity: 0.6,
  },
  addCustomText: {
    ...type.body,
    color: colors.accent,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  cancelButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  cancelButtonPressed: {
    backgroundColor: colors.surface,
  },
  cancelText: {
    ...type.body,
    color: colors.textSecondary,
  },
  confirmButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  confirmButtonPressed: {
    opacity: 0.85,
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    ...type.bodyStrong,
    ...numeric,
    color: colors.background,
  },
  confirmLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
