// ═══════════════════════════════════════════════════════════════════════
// PotCreateScreen — PRD §7.5, §9.4: "Cook batch -> log ingredients once
// (voice or search) -> weigh the finished pot -> enter total grams -> app
// computes kcal_per_g."
//
// Task brief ("Build the meal-prep (pot) workflow into a first-class,
// accurate feature") adds THREE ways to populate the ingredient list on
// top of manual typing, matching the user's own situation ("a Sri Lankan
// curry is mostly generic ingredients plus packaged goods"):
//   1. Photograph the raw ingredients -> Gemini identifies them
//      (PotIngredientsPhotoScreen -> back here with draft rows).
//   2. Scan a packaged ingredient's barcode (a bag of rice, a tin of
//      coconut milk) -> saved_food/Open Food Facts cascade
//      (PotBarcodeAddScreen -> back here with one draft row).
//   3. Search saved foods + the bundled AFCD database
//      (IngredientSearchModal, same screen, no navigation round-trip).
// Every route still lands in the SAME editable ingredient list below —
// none of them writes anything until "Create pot" is tapped, matching
// PRD §7's "always a human beat before save" even though this isn't the
// food_entry log itself.
//
// ⚠️ Raw vs cooked (PRD §7.5, unmistakable labelling required): the
// FINISHED/COOKED weight field is the one potRepo actually uses to derive
// kcal_per_g, and gets its own visually distinct, bordered callout so it
// cannot be mistaken for "just another field" — see `cookedWeightCallout`
// below. Per-ingredient weight fields are informational only (stored in
// `ingredients` JSON for reference) and are explicitly labelled "raw
// weight, before cooking" so a user entering 100g of raw rice doesn't
// confuse it with the ~300g it becomes cooked. Every ingredient-entry
// route (photo/barcode/search/manual) funnels into the same raw-labelled
// field, so the trap can't be reintroduced by a shortcut.
//
// ⚠️ Cooking oil (PRD §7.5: "the single largest hidden variable in South
// Asian home cooking… no vision model will ever see"): a one-tap "+ Add
// cooking oil/ghee" row reuses the exact same presets ConfirmSheet offers
// (src/lib/pendingEntry.ts's QUICK_ADD_PRESETS) so oil/ghee added here and
// oil/ghee added to a regular meal log use identical, already-audited
// per-100g figures — no second set of numbers to maintain or drift.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { PotIngredientDraftParam, RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import {
  createPot,
  updatePot,
  pendingEntryToDraftParam,
  potIngredientToDraftParam,
  computePotConfidenceSummary,
  formatPotConfidence,
  applyIngredientGramsEdit,
  applyIngredientMacroEdit,
  sumPotIngredientTotals,
  checkFatPlausibility,
  FAT_PLAUSIBILITY_NOTE,
  SPICE_AROMATICS_PRESET,
  round1String,
} from '../lib/potActions';
import * as potRepo from '../db/repositories/potRepo';
import type { PotIngredient } from '../db/repositories/potRepo';
import { parseRequiredNumber } from '../lib/numericInput';
import { pendingEntryFromQuickAdd, QUICK_ADD_PRESETS, type EntryConfidence, type QuickAddPreset } from '../lib/pendingEntry';
import { IngredientSearchModal, type IngredientSearchResult } from '../components/pot/IngredientSearchModal';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PotCreate'>;
type Route = RouteProp<RootStackParamList, 'PotCreate'>;

type IngredientDraft = PotIngredientDraftParam;

/** A directly-typed row is treated the same as any other manual food entry in this app (foodEntryActions.ts's `logManualEntry` defaults manual entries to 'exact' too) — the user asserting a number is ground truth until a scan says otherwise. */
function emptyIngredient(): IngredientDraft {
  return { name: '', gramsRaw: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '', confidence: 'exact' };
}

/**
 * AUDIT FIX: `parseRequiredNumber` only guarantees "something numeric was
 * typed" — it deliberately does not enforce positivity (see its own doc),
 * so a stray minus sign or a genuine "0g" typo in an ingredient's grams
 * field previously passed every existing check and would corrupt this
 * pot's `kcal_per_g` the moment it was created (a negative/zero-grams
 * ingredient still gets summed into the total). Grams must be a real,
 * positive amount; the four macro fields may legitimately be exactly 0
 * (fat in a black coffee, say) but never negative.
 */
export function ingredientRowIsValid(i: Pick<IngredientDraft, 'gramsRaw' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>): boolean {
  const grams = parseRequiredNumber(i.gramsRaw);
  const kcal = parseRequiredNumber(i.kcal);
  const protein = parseRequiredNumber(i.protein_g);
  const carbs = parseRequiredNumber(i.carbs_g);
  const fat = parseRequiredNumber(i.fat_g);
  if (!grams.valid || grams.value === null || grams.value <= 0) return false;
  if (!kcal.valid || (kcal.value as number) < 0) return false;
  if (!protein.valid || (protein.value as number) < 0) return false;
  if (!carbs.valid || (carbs.value as number) < 0) return false;
  if (!fat.valid || (fat.value as number) < 0) return false;
  return true;
}

/**
 * Short, plain-text confidence label for a row (PRD §10 "Confidence
 * always visible") — deliberately just the word, no colour/badge styling,
 * which is the next design pass's job per this task's constraints.
 * 'Exact' is source-agnostic on purpose: a manually-typed, saved-food,
 * AFCD, or scanned-panel row can all legitimately be 'exact' (see
 * emptyIngredient's doc / pendingEntryToDraftParam), so the label never
 * claims a scan happened when it didn't.
 */
function confidenceLabel(c: EntryConfidence): string {
  switch (c) {
    case 'exact':
      return 'Exact';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low — estimate';
  }
}

export function PotCreateScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  // Edit mode (task brief #4, "Pots edit — fix it"): this same screen
  // doubles as the editor for an existing pot when `potId` is set —
  // App.tsx's dynamic header title is the other half of that cue. `potId`
  // is read once; it never changes for the lifetime of this screen
  // instance (a fresh navigate() with a different potId would be a
  // different screen instance).
  const [potId] = useState(route.params?.potId);
  const [name, setName] = useState('');
  const [cookedWeightG, setCookedWeightG] = useState('');
  const [ingredients, setIngredients] = useState<IngredientDraft[]>(() => {
    if (potId) return []; // populated by the load effect below once the existing pot arrives
    const draft = route.params?.draftIngredients;
    return draft && draft.length > 0 ? draft : [emptyIngredient()];
  });
  const [saving, setSaving] = useState(false);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  // Only meaningful in edit mode — the create flow never has anything to
  // fetch, so it's `false` from the start and this effect never runs.
  const [loadingExisting, setLoadingExisting] = useState(potId !== undefined);

  useEffect(() => {
    if (!potId) return;
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const pot = await potRepo.getPot(db, potId);
      if (cancelled || !pot) return;
      let parsedIngredients: PotIngredient[];
      try {
        const parsed: unknown = JSON.parse(pot.ingredients);
        parsedIngredients = Array.isArray(parsed) ? (parsed as PotIngredient[]) : [];
      } catch {
        parsedIngredients = [];
      }
      setName(pot.name);
      setCookedWeightG(pot.total_weight_g !== null ? round1String(pot.total_weight_g) : '');
      setIngredients(
        parsedIngredients.length > 0
          ? parsedIngredients.map((i) => potIngredientToDraftParam(i, i.confidence ?? 'exact'))
          : [emptyIngredient()]
      );
      setLoadingExisting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [potId]);

  // Appends (never replaces) newly-arrived draft rows from a SECOND trip
  // to the photo/barcode screens while this screen is already open (e.g.
  // "photograph the veg, then scan the coconut milk tin") — react-
  // navigation re-focuses this existing screen instance with fresh params
  // rather than mounting a new one, so a plain useState initializer alone
  // would only ever see the FIRST batch. Keyed on `draftKey` (a fresh id
  // per navigate() call from the photo/barcode screens) rather than the
  // array's own identity, since a re-render could otherwise recreate an
  // equivalent-looking params object without it being a genuinely new batch.
  const lastAppliedDraftKeyRef = useRef(route.params?.draftKey);
  useEffect(() => {
    const incoming = route.params?.draftIngredients;
    const key = route.params?.draftKey;
    if (!incoming || key === lastAppliedDraftKeyRef.current) return;
    lastAppliedDraftKeyRef.current = key;
    setIngredients((prev) => {
      // Drop a single still-blank starter row so a fresh "New pot" ->
      // "Photograph ingredients" flow doesn't leave an empty row sitting
      // above the AI's results.
      const withoutBlankStarter =
        prev.length === 1 && prev[0].name.trim().length === 0 && prev[0].gramsRaw.trim().length === 0 ? [] : prev;
      return [...withoutBlankStarter, ...incoming];
    });
  }, [route.params?.draftIngredients, route.params?.draftKey]);

  // Per-ingredient barcode upgrade (task brief headline feature): applies
  // PotBarcodeAddScreen's result IN PLACE at `rowIndex` rather than
  // appending — same "tell a fresh navigate() apart from a re-focus" guard
  // as the draftIngredients effect above, on its own independent key so
  // the two round-trips (add-new vs upgrade-existing) never interfere.
  const lastAppliedUpgradeKeyRef = useRef(route.params?.upgradeKey);
  useEffect(() => {
    const upgrade = route.params?.upgradeIngredient;
    const key = route.params?.upgradeKey;
    if (!upgrade || key === lastAppliedUpgradeKeyRef.current) return;
    lastAppliedUpgradeKeyRef.current = key;
    setIngredients((prev) => prev.map((ing, i) => (i === upgrade.rowIndex ? upgrade.ingredient : ing)));
  }, [route.params?.upgradeIngredient, route.params?.upgradeKey]);

  const updateIngredient = (index: number, patch: Partial<IngredientDraft>) => {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)));
  };

  // BUG FIX (task brief #1 — "changed the potatoes from 700g to 800g and
  // it never changed the calories"): grams/macro edits must go through
  // potActions' rescaling helpers, never a bare text-field patch, so the
  // row's per-100g basis (retained end-to-end since pendingEntryToDraftParam/
  // potIngredientToDraftParam/applyPanelToRow were fixed to stop dropping
  // it) actually gets used. See applyIngredientGramsEdit's own doc for
  // exactly how a from-scratch manual row without a basis yet degrades.
  const handleGramsChange = (index: number, value: string) => {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? applyIngredientGramsEdit(ing, value) : ing)));
  };

  const handleMacroChange = (index: number, field: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g', value: string) => {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? applyIngredientMacroEdit(ing, field, value) : ing)));
  };

  const addIngredientRow = () => setIngredients((prev) => [...prev, emptyIngredient()]);
  const removeIngredientRow = (index: number) => setIngredients((prev) => prev.filter((_, i) => i !== index));
  const appendIngredient = (draft: IngredientDraft) => setIngredients((prev) => [...prev, draft]);

  const addPresetIngredient = (preset: QuickAddPreset) => {
    appendIngredient(pendingEntryToDraftParam(pendingEntryFromQuickAdd(preset)));
  };

  const addFromSearch = (result: IngredientSearchResult) => {
    appendIngredient(
      pendingEntryToDraftParam({
        name: result.name,
        grams: result.grams,
        kcal: result.kcal,
        protein_g: result.protein_g,
        carbs_g: result.carbs_g,
        fat_g: result.fat_g,
        confidence: result.confidence,
        source: 'afcd',
        per100g: result.per100g,
      })
    );
    setSearchModalVisible(false);
  };

  /** Opens PotBarcodeAddScreen in "upgrade this row" mode — a hit replaces this row's macros in place (grams preserved); a miss leaves it untouched. Guarded on a valid, positive raw grams: an upgrade scales the scanned panel to the row's EXISTING grams, so there must be a grams value to scale to. */
  const scanBarcodeForRow = (index: number) => {
    const row = ingredients[index];
    const parsedGrams = parseRequiredNumber(row.gramsRaw);
    if (!parsedGrams.valid || parsedGrams.value === null || parsedGrams.value <= 0) return;
    navigation.navigate('PotBarcodeAdd', {
      upgradeRow: {
        rowIndex: index,
        grams: parsedGrams.value,
        currentName: row.name.trim() || 'this ingredient',
        currentConfidence: row.confidence,
      },
    });
  };

  // BUG FIX / task brief #1: the cooked weight is NO LONGER a mandatory
  // gate at creation — "The total weight is not needed... because I add
  // the ingredients and anything else is water" is correct for the
  // batch's total kcal (cooking only moves water, which is zero
  // calories); it's only needed to VALUE a serving (kcal_per_g = total
  // kcal / cooked weight). Blank is a valid, complete state; a non-blank
  // value must still parse as a real positive number, same rule as
  // before, just no longer required.
  const cookedWeightProvided = cookedWeightG.trim().length > 0;
  const parsedCookedWeight = parseRequiredNumber(cookedWeightG);
  const cookedWeightValid = !cookedWeightProvided || (parsedCookedWeight.valid && parsedCookedWeight.value > 0);
  const validIngredients = ingredients.filter((i) => i.name.trim().length > 0);
  // A named ingredient with a blank numeric field would otherwise silently
  // sum as 0 (Number('') === 0, indistinguishable from a genuinely-zero
  // value like fat_g in a black-coffee ingredient) into the pot total —
  // that corrupts kcal_per_g for every future serving logged from this
  // pot, invisibly. Require every numeric field to actually be typed for
  // every named ingredient before allowing save; an explicit "0" is fine
  // for a macro (fat can legitimately be 0), only blank/negative/zero-
  // grams blocks — see `ingredientRowIsValid`'s own doc (audit finding).
  const hasIncompleteIngredient = validIngredients.some((i) => !ingredientRowIsValid(i));
  const canSave =
    !loadingExisting &&
    name.trim().length > 0 &&
    cookedWeightValid &&
    validIngredients.length > 0 &&
    !hasIncompleteIngredient;

  // Live preview of the pot's own honesty measure (task brief "the pot's
  // own honesty") as ingredients are added/scanned — lets the user see
  // in-the-moment whether scanning one more row is worth the effort,
  // rather than only finding out after "Create pot". Computed from
  // whatever numbers are ALREADY typed/resolved, even for an incomplete
  // draft — this is a preview, not a save-gate.
  const previewIngredients: PotIngredient[] = validIngredients
    .filter(ingredientRowIsValid)
    .map((i) => ({
      name: i.name.trim(),
      grams: parseRequiredNumber(i.gramsRaw).value ?? 0,
      kcal: parseRequiredNumber(i.kcal).value ?? 0,
      protein_g: parseRequiredNumber(i.protein_g).value ?? 0,
      carbs_g: parseRequiredNumber(i.carbs_g).value ?? 0,
      fat_g: parseRequiredNumber(i.fat_g).value ?? 0,
      confidence: i.confidence,
    }));
  const confidenceSummary = computePotConfidenceSummary(previewIngredients);

  // Honest total (task brief #1: "A pot with no cooked weight yet should
  // display its total kcal and macros honestly, and say servings can't
  // be valued until it's weighed") — the batch total is fully known from
  // ingredients alone, independent of whether a cooked weight has been
  // entered yet.
  const ingredientTotals = sumPotIngredientTotals(previewIngredients);
  // Live "would-be" kcal/g for the fat-plausibility check only — never
  // shown to the user as a real kcal/g until the pot is actually saved
  // with this cooked weight.
  const previewKcalPerG =
    cookedWeightValid && cookedWeightProvided && parsedCookedWeight.value ? ingredientTotals.kcal / parsedCookedWeight.value : null;
  const fatCheck = checkFatPlausibility(ingredientTotals, previewKcalPerG);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const potIngredients: PotIngredient[] = validIngredients.map((i) => ({
        name: i.name.trim(),
        // Safe to assert `.value` directly: `canSave` already required
        // `!hasIncompleteIngredient`, i.e. every one of these five fields
        // on every validIngredients row parsed successfully.
        grams: parseRequiredNumber(i.gramsRaw).value as number,
        kcal: parseRequiredNumber(i.kcal).value as number,
        protein_g: parseRequiredNumber(i.protein_g).value as number,
        carbs_g: parseRequiredNumber(i.carbs_g).value as number,
        fat_g: parseRequiredNumber(i.fat_g).value as number,
        confidence: i.confidence,
        // Persisted so a future per-ingredient edit (were one ever added
        // post-creation) has a basis to rescale from — see potRepo.ts's
        // PotIngredient.per100g doc.
        per100g: i.per100g,
      }));
      const totalWeightG = cookedWeightProvided ? (parsedCookedWeight.value as number) : null;
      if (potId) {
        // Edit mode (task brief #4): recomputes kcal_per_g from the
        // CURRENT ingredients/cooked weight — see potRepo.updatePot's own
        // doc for the remaining_g-preservation rule and the guarantee
        // that already-logged food_entry rows are never touched.
        await updatePot(db, { id: potId, name: name.trim(), totalWeightG, ingredients: potIngredients });
      } else {
        await createPot(db, { name: name.trim(), totalWeightG, ingredients: potIngredients });
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  if (loadingExisting) {
    return <View style={styles.screen} />;
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.title}>{potId ? 'Edit pot' : 'New pot'}</Text>

        <Text style={styles.label}>Pot name</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Chicken &amp; dal batch"
          placeholderTextColor={colors.textTertiary}
        />

        {/* Bordered, visually distinct callout — this is the ONE field
            potRepo actually divides ingredient totals by, so it must never
            read like just another text field among the raw-weight ones
            below (PRD §7.5's unmistakable-labelling requirement).
            BUG FIX (task brief #1): no longer mandatory — "the total
            weight is not needed" is correct for the batch's total kcal
            (cooking only moves water around), only for VALUING a
            serving. Blank is fine here; it can be added later from the
            pot, or the app will ask for it at the first serving. */}
        <View style={styles.cookedWeightCallout}>
          <Text style={styles.cookedWeightTitle}>Finished / COOKED weight (optional)</Text>
          <Text style={styles.hint}>
            Needed to value a serving — the batch total is already known from your ingredients below. Leave this
            blank if you haven&apos;t weighed the pot yet; you&apos;ll be asked at your first serving, or you can set
            it here any time.
          </Text>
          <View style={styles.cookedWeightRow}>
            <TextInput
              style={styles.cookedWeightInput}
              value={cookedWeightG}
              onChangeText={setCookedWeightG}
              keyboardType="decimal-pad"
              placeholder="not yet weighed"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.unit}>g cooked</Text>
          </View>
        </View>

        {/* Honest total whether or not the pot has been weighed (task
            brief #1: "display its total kcal and macros honestly, and
            say servings can't be valued until it's weighed"). Never a
            fabricated/zero kcal/g — this is the batch TOTAL, not a
            per-gram figure. */}
        {ingredientTotals.kcal > 0 && (
          <Text style={styles.totalsLine}>
            Batch total: {Math.round(ingredientTotals.kcal)} kcal · P{Math.round(ingredientTotals.protein_g)} C
            {Math.round(ingredientTotals.carbs_g)} F{Math.round(ingredientTotals.fat_g)}
            {!cookedWeightProvided ? ' — servings can’t be valued until this pot is weighed.' : ''}
          </Text>
        )}

        <Text style={styles.sectionTitle}>Add ingredients</Text>
        <View style={styles.addMethodsRow}>
          <AddMethodButton label="📷 Photograph" onPress={() => navigation.navigate('PotIngredientsPhoto')} />
          <AddMethodButton label="🔍 Search" onPress={() => setSearchModalVisible(true)} />
          <AddMethodButton label="▮ Scan barcode" onPress={() => navigation.navigate('PotBarcodeAdd')} />
        </View>

        <Text style={styles.oilLabel}>Cooking oil/ghee — the amount no photo can see:</Text>
        <View style={styles.oilRow}>
          {QUICK_ADD_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => addPresetIngredient(preset)}
              style={({ pressed }) => [styles.oilChip, pressed && styles.oilChipPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Add ${preset.label} as an ingredient`}
            >
              <Text style={styles.oilChipText}>+ {preset.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Task brief #2: spices/aromatics are individually tiny (5-10
            kcal each) and typing ten of them fails the 10-second test for
            no material accuracy gain — but silently dropping them isn't
            honest either. One tap adds an honest, editable stand-in; see
            SPICE_AROMATICS_PRESET's own doc for exactly where the default
            figure comes from. Oil/ghee is deliberately NOT folded into
            this default — the reminder below is the whole point. */}
        <Text style={styles.oilLabel}>Spices add up to very little — a fast, honest default:</Text>
        <View style={styles.oilRow}>
          <Pressable
            onPress={() => addPresetIngredient(SPICE_AROMATICS_PRESET)}
            style={({ pressed }) => [styles.oilChip, pressed && styles.oilChipPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${SPICE_AROMATICS_PRESET.label} as an ingredient`}
          >
            <Text style={styles.oilChipText}>+ {SPICE_AROMATICS_PRESET.label}</Text>
          </Pressable>
        </View>
        <Text style={styles.hintSmall}>
          Basis: ~15g of mixed ground spice (turmeric, cumin, coriander, chilli) at ~320 kcal/100g — a rough,
          adjustable stand-in for a typical batch, not a real measurement. Oil/ghee is not a spice — add it with the
          chips above.
        </Text>

        {/* Task brief "Also" section: a neutral, dismissible-by-editing
            question, never a warning (PRD §10 forbids the red/guilt
            treatment) — see potActions.checkFatPlausibility's own doc for
            why this is purely numeric (fat kcal share + resulting kcal/g)
            rather than guessing at the dish from its name. */}
        {fatCheck.flagged && <Text style={styles.fatNote}>{FAT_PLAUSIBILITY_NOTE}</Text>}

        {ingredients.map((ing, i) => {
          const parsedRowGrams = parseRequiredNumber(ing.gramsRaw);
          const canScanThisRow = parsedRowGrams.valid && parsedRowGrams.value !== null && parsedRowGrams.value > 0;
          return (
            <View key={i} style={styles.ingredientCard}>
              <View style={styles.ingredientHeaderRow}>
                <TextInput
                  style={[styles.textInput, styles.ingredientNameInput]}
                  value={ing.name}
                  onChangeText={(v) => updateIngredient(i, { name: v })}
                  placeholder="Ingredient name"
                  placeholderTextColor={colors.textTertiary}
                />
                {/* Per-row confidence (task brief, PRD §10): at a glance, which
                    rows are panel-accurate and which are guesses — 'exact' rows
                    read distinctly so scanning the rest reads as an option, not
                    an obligation. */}
                <Text style={[styles.confidenceBadge, ing.confidence === 'exact' && styles.confidenceBadgeExact]}>
                  {confidenceLabel(ing.confidence)}
                </Text>
              </View>
              <Text style={styles.hintSmall}>RAW weight, before cooking (reference only — not divided by this)</Text>
              {/* Editing grams here rescales all four macros from this
                  row's per-100g basis (applyIngredientGramsEdit) rather
                  than leaving them stale — see the header note on Bug 1. */}
              <View style={styles.row}>
                <NumField label="Raw g" value={ing.gramsRaw} onChange={(v) => handleGramsChange(i, v)} />
                <NumField label="kcal (total)" value={ing.kcal} onChange={(v) => handleMacroChange(i, 'kcal', v)} />
              </View>
              <View style={styles.row}>
                <NumField label="Protein g" value={ing.protein_g} onChange={(v) => handleMacroChange(i, 'protein_g', v)} />
                <NumField label="Carbs g" value={ing.carbs_g} onChange={(v) => handleMacroChange(i, 'carbs_g', v)} />
                <NumField label="Fat g" value={ing.fat_g} onChange={(v) => handleMacroChange(i, 'fat_g', v)} />
              </View>
              {!ing.per100g && ing.name.trim().length > 0 && (
                <Text style={styles.hintSmall}>
                  Not yet scalable — fill in every field once; grams edits will then rescale macros automatically.
                </Text>
              )}
              <View style={styles.rowFooter}>
                {/* Per-ingredient barcode upgrade (task brief headline
                    feature): scanning replaces this row's macros with an
                    Open Food Facts/saved-food panel match and raises its
                    confidence — grams stays exactly what's typed above,
                    never overwritten by a scanned serving size. Disabled
                    until a positive raw grams is entered, since the
                    upgrade scales the panel to THIS row's grams. */}
                <Pressable
                  onPress={() => scanBarcodeForRow(i)}
                  disabled={!canScanThisRow}
                  accessibilityRole="button"
                  style={({ pressed }) => [pressed && canScanThisRow && styles.rowFooterActionPressed]}
                >
                  <Text style={[styles.scanRowText, !canScanThisRow && styles.scanRowTextDisabled]}>
                    ▮ Scan barcode{!canScanThisRow ? ' (enter grams first)' : ''}
                  </Text>
                </Pressable>
                {ingredients.length > 1 && (
                  <Pressable onPress={() => removeIngredientRow(i)} accessibilityRole="button">
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
        <Pressable onPress={addIngredientRow} style={styles.addButton} accessibilityRole="button">
          <Text style={styles.addButtonText}>+ Add ingredient manually</Text>
        </Pressable>

        {hasIncompleteIngredient && (
          <Text style={styles.validationHint}>
            Fill in grams, kcal, protein, carbs, and fat for every named ingredient before saving — grams must be
            greater than zero; a macro can be 0 but not negative, and blank isn&apos;t allowed either.
          </Text>
        )}

        {/* The pot's own honesty (task brief): a live preview of how much
            of this pot's calories are backed by an exact scan/database
            match, not a fabricated single score — see
            potActions.computePotConfidenceSummary's doc for why energy
            share, not mass share, and why 'exact' only. */}
        {confidenceSummary.totalKcal > 0 && <Text style={styles.confidenceSummary}>{formatPotConfidence(confidenceSummary)}</Text>}

        {/* Task brief #4: "Decide and clearly state whether future
            servings use the new figure (they should) and how the user is
            told." One sentence, right where the decision is made — never
            a lecture, matches how the weekly check-in explains a target
            change (PRD §10). */}
        {potId && (
          <Text style={styles.editNotice}>
            Saves apply to every serving logged from this pot from now on. Servings you&apos;ve already logged keep
            the numbers they were logged with.
          </Text>
        )}

        <View style={styles.actions}>
          <Pressable onPress={() => navigation.goBack()} style={styles.cancelButton} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleSave()}
            disabled={!canSave || saving}
            style={[styles.saveButton, (!canSave || saving) && styles.saveButtonDisabled]}
            accessibilityRole="button"
          >
            <Text style={styles.saveText}>{saving ? 'Saving…' : potId ? 'Save changes' : 'Create pot'}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <IngredientSearchModal
        visible={searchModalVisible}
        onClose={() => setSearchModalVisible(false)}
        onPick={addFromSearch}
        onManualEntry={(name) => {
          setSearchModalVisible(false);
          // PRD §7.2 "never dead-end the user" (task brief #2): carries the
          // typed search text into a new manually-editable row rather than
          // discarding it and making the user retype it.
          appendIngredient({ ...emptyIngredient(), name });
        }}
      />
    </KeyboardAvoidingView>
  );
}

function AddMethodButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.addMethodButton, pressed && styles.addMethodButtonPressed]} accessibilityRole="button">
      <Text style={styles.addMethodText}>{label}</Text>
    </Pressable>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.numField}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.textInput, numeric]}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.textTertiary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    ...type.h2,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  label: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  hint: {
    ...type.small,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  validationHint: {
    ...type.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  hintSmall: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  textInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // The one field the whole pot's math is based on — visually set apart
  // with a border and its own tinted title so raw-vs-cooked cannot be
  // confused with "just another field" (PRD §7.5).
  cookedWeightCallout: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  cookedWeightTitle: {
    ...type.sectionLabel,
    color: colors.accent,
    marginBottom: spacing.xs,
  },
  cookedWeightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cookedWeightInput: {
    ...type.h2,
    ...numeric,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flex: 1,
  },
  unit: {
    ...type.body,
    color: colors.textSecondary,
  },
  addMethodsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  addMethodButton: {
    flexGrow: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  addMethodButtonPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  addMethodText: {
    ...type.caption,
    color: colors.text,
  },
  oilLabel: {
    ...type.small,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  oilRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  oilChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  oilChipPressed: {
    backgroundColor: colors.border,
  },
  oilChipText: {
    ...type.caption,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  numField: {
    flex: 1,
  },
  ingredientCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ingredientHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ingredientNameInput: {
    flex: 1,
  },
  confidenceBadge: {
    ...type.small,
    color: colors.textTertiary,
  },
  confidenceBadgeExact: {
    color: colors.accent,
    fontWeight: '600',
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
  },
  rowFooterActionPressed: {
    opacity: 0.7,
  },
  scanRowText: {
    ...type.caption,
    color: colors.accent,
  },
  scanRowTextDisabled: {
    color: colors.textTertiary,
  },
  removeText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  addButton: {
    paddingVertical: spacing.sm,
  },
  addButtonText: {
    ...type.body,
    color: colors.accent,
  },
  confidenceSummary: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  totalsLine: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  // Neutral question, not a warning — no red, same secondary-text
  // treatment as every other honesty note in this screen (PRD §10).
  fatNote: {
    ...type.small,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  editNotice: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  cancelButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  cancelText: {
    ...type.body,
    color: colors.textSecondary,
  },
  saveButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveText: {
    ...type.bodyStrong,
    color: colors.background,
  },
});
