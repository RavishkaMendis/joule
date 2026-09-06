// ═══════════════════════════════════════════════════════════════════════
// PotBarcodeAddScreen — task brief "meal-prep workflow": "support building
// a pot from barcode scans (a bag of rice, a tin of coconut milk)", AND
// (the headline feature) the per-ingredient barcode upgrade: "after the
// photo returns its list, every ingredient row gets a Scan barcode
// action". Both flows share this one screen:
//
//   - Plain add (route.params.upgradeRow absent): scan -> hit -> ask how
//     many RAW grams went in -> ONE new draft row appended to PotCreate.
//     Unchanged from before this pass.
//   - Per-row upgrade (route.params.upgradeRow set): opened from an
//     EXISTING ingredient row's own "Scan barcode" action. A hit REPLACES
//     that row's macros with the scanned panel, scaled to the row's
//     CURRENT raw grams (never re-asked, never overwritten — PRD §7.5's
//     raw-vs-cooked rule: a panel is a per-100g composition, not a
//     serving size) and raises its confidence (never downgrades — see
//     potActions.ts's `maxConfidence`). A MISS leaves the row completely
//     untouched: nothing is written back to PotCreate, so whatever the
//     Gemini photo estimate was stays exactly as it was.
//
// Reuses the exact same saved_food -> Open Food Facts cascade
// (src/lib/foodSources/lookupCascade.ts's `lookupByBarcode`) every other
// barcode path in this app uses, and the same barcode-upgrade math
// (src/lib/potActions.ts's `applyPanelToRow`/`resolveBarcodeUpgrade`) that
// is unit-tested against the "grams preserved / confidence raised / a
// miss changes nothing" contract — no logic is reimplemented here, this
// screen only wires user input to those pure functions.
//
// ── "Never dead-end" on a miss (PRD §7.2, applied to a pot ingredient) ──
// A barcode miss now offers THREE ways forward, not two: try another
// barcode, scan the nutrition label instead (reuses `runLabelOcr` — the
// same Gemini label-reading path LabelScanScreen uses, but landing back
// in this screen's own `found`-equivalent state rather than a food_entry
// ConfirmSheet, since a pot ingredient isn't a food_entry row yet), or
// give up and keep what's already there (manual entry for a new
// ingredient; the untouched Gemini estimate for an upgrade).
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { PotIngredientDraftParam, RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { lookupByBarcode, type CascadeMissReason } from '../lib/foodSources/lookupCascade';
import { scaleFromPer100g, type EntryConfidence, type PendingEntry } from '../lib/pendingEntry';
import { parseRequiredNumber } from '../lib/numericInput';
import { generateId } from '../lib/ids';
import { hasGeminiApiKey, MISSING_KEY_MESSAGE } from '../lib/ai/apiKey';
import { runLabelOcr } from '../lib/ai/runs';
import { describeAiFailure } from '../lib/captureJobs/jobReducer';
import { applyPanelToRow, pendingEntryToDraftParam, potIngredientToDraftParam, resolveBarcodeUpgrade } from '../lib/potActions';
import type { PotIngredient } from '../db/repositories/potRepo';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PotBarcodeAdd'>;
type Route = RouteProp<RootStackParamList, 'PotBarcodeAdd'>;

type Per100g = NonNullable<PendingEntry['per100g']>;

type State =
  | { phase: 'scanning' }
  | { phase: 'looking_up' }
  | { phase: 'miss'; reason: CascadeMissReason }
  // Plain "add a new ingredient" hit (no upgradeRow) — still needs a raw-grams prompt before macros are known.
  | { phase: 'found'; name: string; per100g: Per100g; confidence: EntryConfidence }
  // Per-row upgrade hit (upgradeRow set) — already fully resolved via
  // potActions.applyPanelToRow/resolveBarcodeUpgrade (grams preserved,
  // confidence raised), nothing left to ask the user except "apply?".
  | { phase: 'found_upgrade'; upgraded: PotIngredient }
  // Label-OCR escape hatch off a barcode miss (never dead-end — PRD §7.2).
  | { phase: 'label_camera' }
  | { phase: 'label_analysing' }
  | { phase: 'label_error'; message: string };

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] as const;

export function PotBarcodeAddScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const upgradeRow = route.params?.upgradeRow;
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<State>({ phase: 'scanning' });
  const [gramsText, setGramsText] = useState('');
  const [labelCameraRef, setLabelCameraRef] = useState<CameraView | null>(null);
  const lookupInFlightRef = useRef(false);

  const goBack = useCallback(() => navigation.goBack(), [navigation]);

  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    if (lookupInFlightRef.current) return;
    lookupInFlightRef.current = true;
    setState({ phase: 'looking_up' });

    (async () => {
      const db = await getDatabase();
      const outcome = await lookupByBarcode(db, result.data);
      lookupInFlightRef.current = false;

      if (upgradeRow) {
        // Built directly on the SAME cascade result every other barcode
        // path in this app produces — resolveBarcodeUpgrade only decides
        // "apply or leave untouched", it never re-looks-up or re-derives
        // energy units (potActions.ts's own doc on this function).
        const resolved = resolveBarcodeUpgrade({ grams: upgradeRow.grams, confidence: upgradeRow.currentConfidence }, outcome);
        setState(resolved.ok ? { phase: 'found_upgrade', upgraded: resolved.upgraded } : { phase: 'miss', reason: resolved.reason });
        return;
      }

      if (outcome.ok) {
        const per100g = outcome.entry.per100g ?? scaleTo100(outcome.entry);
        setState({ phase: 'found', name: outcome.entry.name, per100g, confidence: outcome.entry.confidence });
      } else {
        setState({ phase: 'miss', reason: outcome.reason });
      }
    })().catch(() => {
      lookupInFlightRef.current = false;
      setState({ phase: 'miss', reason: 'network_error' });
    });
  }, [upgradeRow]);

  const rescan = useCallback(() => {
    lookupInFlightRef.current = false;
    setGramsText('');
    setState({ phase: 'scanning' });
  }, []);

  // ── Label-OCR escape hatch (offered on a barcode miss) ──────────────
  const analyseLabelPhoto = useCallback(
    async (base64: string) => {
      setState({ phase: 'label_analysing' });
      const result = await runLabelOcr(base64);
      // runLabelOcr/finishRun (src/lib/ai/runs.ts) never returns `ok: true`
      // with an empty `entries` array — a zero-item response is already
      // surfaced as `ok: false, reason: 'no_items'` — so `!result.ok` alone
      // covers every failure case here.
      if (!result.ok) {
        // Shared exhaustive mapping, not a ternary — see the equivalent
        // comment in PotIngredientsPhotoScreen for why. `no_items` keeps
        // its label-specific wording; everything else defers.
        const message =
          result.reason === 'no_items'
            ? "Couldn't read that label — try again with the per-100g column in frame, or add this ingredient manually."
            : describeAiFailure('label_ocr', result);
        setState({ phase: 'label_error', message });
        return;
      }
      // A nutrition-panel photo is one product's per-100g figures — take
      // the first parsed item (mapGeminiItemToPendingEntry always
      // populates `per100g` for every entry it produces).
      const entry = result.entries[0];
      if (upgradeRow) {
        const upgraded = applyPanelToRow({ grams: upgradeRow.grams, confidence: upgradeRow.currentConfidence }, entry);
        setState({ phase: 'found_upgrade', upgraded });
        return;
      }
      const per100g = entry.per100g ?? scaleTo100(entry);
      setState({ phase: 'found', name: entry.name, per100g, confidence: entry.confidence });
    },
    [upgradeRow]
  );

  const captureLabelPhoto = useCallback(async () => {
    if (!labelCameraRef) return;
    try {
      const photo: CameraCapturedPicture = await labelCameraRef.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo.base64) return;
      await analyseLabelPhoto(photo.base64);
    } catch {
      // Capture failed transiently — stay on the label camera so the user can just retry the shutter.
    }
  }, [labelCameraRef, analyseLabelPhoto]);

  const pickLabelFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    await analyseLabelPhoto(asset.base64);
  }, [analyseLabelPhoto]);

  const parsedGrams = parseRequiredNumber(gramsText);
  const canAddNew = state.phase === 'found' && parsedGrams.valid && parsedGrams.value > 0;

  /** Plain "add a new ingredient" path (no upgradeRow) — unchanged: user states how many raw grams went in, one new draft row is appended. */
  const handleAddNew = () => {
    if (state.phase !== 'found' || !parsedGrams.valid) return;
    const grams = parsedGrams.value;
    const macros = scaleFromPer100g(state.per100g, grams);
    const draft: PotIngredientDraftParam = pendingEntryToDraftParam({
      name: state.name,
      grams,
      ...macros,
      confidence: state.confidence,
      source: 'barcode',
      per100g: state.per100g,
    });
    // BUG FIX (task brief #3, "the barcode scan goes to add a new pot"):
    // React Navigation v7's `navigate()` only reuses an existing route when
    // it's the CURRENTLY FOCUSED one — unlike v6, it no longer searches
    // back through the rest of the stack for a same-named screen (see
    // @react-navigation/routers' StackRouter NAVIGATE case: it checks
    // `state.routes[state.index]` and nothing else unless `pop`/`getId` is
    // involved). Since PotBarcodeAdd, not PotCreate, is the focused route
    // here, a plain `navigate('PotCreate', …)` PUSHED a second, blank
    // PotCreateScreen on top of the in-progress one instead of returning
    // to it — from the user's seat, "the barcode scan goes to add a new
    // pot," exactly as reported. `popTo` (v7's dedicated replacement for
    // the old dual-purpose `navigate`) walks back through the stack for
    // the existing 'PotCreate' route and merges these params onto it —
    // the actual in-progress pot (name, cooked weight, every already-
    // typed/scanned ingredient) is untouched. If 'PotCreate' somehow
    // isn't in the stack it falls back to adding it fresh, so this is a
    // strict improvement with no new failure mode.
    navigation.popTo('PotCreate', { draftIngredients: [draft], draftKey: generateId('draft') }, { merge: true });
  };

  /** Per-row upgrade path — the scan is already fully resolved (grams preserved, confidence raised) by the time this fires; this just hands it back to PotCreateScreen. */
  const handleApplyUpgrade = () => {
    if (!upgradeRow || state.phase !== 'found_upgrade') return;
    const draft = potIngredientToDraftParam(state.upgraded, state.upgraded.confidence ?? upgradeRow.currentConfidence);
    // Same popTo fix as handleAddNew above — this is the "upgrade an
    // existing row" path, so losing the in-progress pot here would be
    // even worse (it would also silently discard the upgrade itself).
    navigation.popTo(
      'PotCreate',
      {
        upgradeIngredient: { rowIndex: upgradeRow.rowIndex, ingredient: draft },
        upgradeKey: generateId('upgrade'),
      },
      { merge: true }
    );
  };

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.statusTitle}>Camera access needed</Text>
        <Text style={styles.statusMessage}>
          {permission.canAskAgain
            ? 'Joule needs the camera to scan a barcode.'
            : upgradeRow
              ? 'Camera permission was denied. The existing estimate for this ingredient is unaffected.'
              : 'Camera permission was denied. You can still add this ingredient manually.'}
        </Text>
        {permission.canAskAgain && (
          <Pressable onPress={() => void requestPermission()} style={styles.statusButton} accessibilityRole="button">
            <Text style={styles.statusButtonText}>Grant camera access</Text>
          </Pressable>
        )}
        <Pressable onPress={goBack} style={styles.statusButtonSecondary} accessibilityRole="button">
          <Text style={styles.statusButtonSecondaryText}>{upgradeRow ? 'Back' : 'Back to manual entry'}</Text>
        </Pressable>
      </View>
    );
  }

  if (state.phase === 'label_camera' || state.phase === 'label_analysing' || state.phase === 'label_error') {
    if (!hasGeminiApiKey()) {
      return (
        <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Text style={styles.statusTitle}>Label scan unavailable</Text>
          <Text style={styles.statusMessage}>{MISSING_KEY_MESSAGE}</Text>
          <Pressable onPress={rescan} style={styles.statusButtonSecondary} accessibilityRole="button">
            <Text style={styles.statusButtonSecondaryText}>Back to barcode scan</Text>
          </Pressable>
        </View>
      );
    }

    if (state.phase === 'label_analysing') {
      return (
        <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.statusMessage}>Reading the panel…</Text>
        </View>
      );
    }

    if (state.phase === 'label_error') {
      return (
        <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Text style={styles.statusTitle}>Couldn&apos;t read that label</Text>
          <Text style={styles.statusMessage}>{state.message}</Text>
          <Pressable onPress={() => setState({ phase: 'label_camera' })} style={styles.statusButton} accessibilityRole="button">
            <Text style={styles.statusButtonText}>Try again</Text>
          </Pressable>
          <Pressable onPress={goBack} style={styles.statusButtonSecondary} accessibilityRole="button">
            <Text style={styles.statusButtonSecondaryText}>
              {upgradeRow ? 'Cancel — keep the current estimate' : 'Add this ingredient manually instead'}
            </Text>
          </Pressable>
        </View>
      );
    }

    // label_camera
    return (
      <View style={styles.screen}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" ref={setLabelCameraRef} />
        <View style={[styles.overlay, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.reticleArea}>
            <View style={styles.labelFrame} />
            <View style={styles.hintPill}>
              <Text style={styles.hintText}>Frame the per-100g nutrition column</Text>
            </View>
          </View>
          <View style={styles.labelControlRow}>
            <Pressable onPress={() => void pickLabelFromGallery()} style={styles.smallButton} accessibilityRole="button">
              <Text style={styles.smallButtonText}>Gallery</Text>
            </Pressable>
            <Pressable onPress={() => void captureLabelPhoto()} style={styles.shutter} accessibilityRole="button" accessibilityLabel="Take photo" />
            <Pressable onPress={rescan} style={styles.smallButton} accessibilityRole="button">
              <Text style={styles.smallButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (state.phase === 'found_upgrade' && upgradeRow) {
    const { upgraded } = state;
    return (
      <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.statusTitle}>{upgraded.name}</Text>
        <Text style={styles.statusMessage}>
          Replace &ldquo;{upgradeRow.currentName}&rdquo; ({Math.round(upgradeRow.grams)}g) with this panel data? The grams
          stay exactly what you already entered — only the per-gram macros and confidence change.
        </Text>
        <Text style={styles.estimate}>
          ≈ {Math.round(upgraded.kcal)} kcal at {Math.round(upgraded.grams)}g · confidence: {upgraded.confidence}
        </Text>
        <Pressable onPress={handleApplyUpgrade} style={styles.statusButton} accessibilityRole="button">
          <Text style={styles.statusButtonText}>Apply to ingredient</Text>
        </Pressable>
        <Pressable onPress={rescan} style={styles.statusButtonSecondary} accessibilityRole="button">
          <Text style={styles.statusButtonSecondaryText}>Scan a different barcode</Text>
        </Pressable>
        <Pressable onPress={goBack} style={styles.statusButtonSecondary} accessibilityRole="button">
          <Text style={styles.statusButtonSecondaryText}>Cancel — keep the current estimate</Text>
        </Pressable>
      </View>
    );
  }

  if (state.phase === 'found') {
    return (
      <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.statusTitle}>{state.name}</Text>
        <Text style={styles.statusMessage}>How many RAW grams of this went into the pot?</Text>
        <View style={styles.gramsRow}>
          <TextInput
            style={styles.gramsInput}
            value={gramsText}
            onChangeText={setGramsText}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
            autoFocus
          />
          <Text style={styles.unit}>g</Text>
        </View>
        {parsedGrams.valid && parsedGrams.value > 0 && (
          <Text style={styles.estimate}>≈ {Math.round(scaleFromPer100g(state.per100g, parsedGrams.value).kcal)} kcal</Text>
        )}
        <Pressable
          onPress={handleAddNew}
          disabled={!canAddNew}
          style={[styles.statusButton, !canAddNew && styles.statusButtonDisabled]}
          accessibilityRole="button"
        >
          <Text style={styles.statusButtonText}>Add ingredient</Text>
        </Pressable>
        <Pressable onPress={rescan} style={styles.statusButtonSecondary} accessibilityRole="button">
          <Text style={styles.statusButtonSecondaryText}>Scan a different barcode</Text>
        </Pressable>
      </View>
    );
  }

  if (state.phase === 'miss') {
    const message =
      state.reason === 'not_found'
        ? "Couldn't find that barcode in Open Food Facts."
        : state.reason === 'network_error'
          ? "Couldn't reach Open Food Facts — check your connection."
          : 'Got an unexpected response looking that up.';
    return (
      <View style={[styles.statusScreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.statusTitle}>No match</Text>
        <Text style={styles.statusMessage}>{message}</Text>
        <Pressable onPress={rescan} style={styles.statusButton} accessibilityRole="button">
          <Text style={styles.statusButtonText}>Try another barcode</Text>
        </Pressable>
        {/* Never dead-end (PRD §7.2): offer label OCR as the next step before giving up entirely. */}
        {hasGeminiApiKey() && (
          <Pressable onPress={() => setState({ phase: 'label_camera' })} style={styles.statusButtonSecondary} accessibilityRole="button">
            <Text style={styles.statusButtonSecondaryText}>Scan the nutrition label instead</Text>
          </Pressable>
        )}
        <Pressable onPress={goBack} style={styles.statusButtonSecondary} accessibilityRole="button">
          <Text style={styles.statusButtonSecondaryText}>
            {upgradeRow ? 'Keep the current estimate for this ingredient' : 'Add this ingredient manually instead'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      <View style={[styles.overlay, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        {upgradeRow && (
          <View style={styles.upgradeBanner}>
            <Text style={styles.upgradeBannerText}>Scanning to upgrade &ldquo;{upgradeRow.currentName}&rdquo;</Text>
          </View>
        )}
        <View style={styles.reticleArea}>
          <View style={styles.scanFrame} />
          {state.phase === 'looking_up' && (
            <View style={styles.hintPill}>
              <Text style={styles.hintText}>Looking up…</Text>
            </View>
          )}
        </View>
        <Pressable onPress={goBack} style={styles.smallButton} accessibilityRole="button">
          <Text style={styles.smallButtonText}>{upgradeRow ? 'Cancel — keep the current estimate' : 'Cancel — add manually instead'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function scaleTo100(entry: PendingEntry): Per100g {
  if (!entry.grams || entry.grams <= 0) {
    return { kcal: entry.kcal, protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g };
  }
  const scale = 100 / entry.grams;
  return {
    kcal: entry.kcal * scale,
    protein_g: entry.protein_g * scale,
    carbs_g: entry.carbs_g * scale,
    fat_g: entry.fat_g * scale,
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  reticleArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  scanFrame: {
    width: 260,
    height: 160,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 10,
  },
  labelFrame: {
    width: 300,
    height: 200,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 10,
  },
  upgradeBanner: {
    marginTop: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  upgradeBannerText: {
    ...type.caption,
    color: colors.text,
  },
  hintPill: {
    marginTop: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  hintText: {
    ...type.caption,
    color: colors.text,
  },
  labelControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.text,
    borderWidth: 4,
    borderColor: colors.surfaceAlt,
  },
  smallButton: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  smallButtonText: {
    ...type.caption,
    color: colors.text,
  },
  statusScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  statusTitle: {
    ...type.h2,
    color: colors.text,
    textAlign: 'center',
  },
  statusMessage: {
    ...type.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  gramsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  gramsInput: {
    ...type.display,
    ...numeric,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minWidth: 140,
    paddingVertical: spacing.xs,
  },
  unit: {
    ...type.h2,
    color: colors.textSecondary,
  },
  estimate: {
    ...type.body,
    ...numeric,
    color: colors.textSecondary,
  },
  statusButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  statusButtonDisabled: {
    opacity: 0.4,
  },
  statusButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  statusButtonSecondary: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  statusButtonSecondaryText: {
    ...type.body,
    color: colors.accent,
  },
});
