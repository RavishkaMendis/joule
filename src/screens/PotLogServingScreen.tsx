// ═══════════════════════════════════════════════════════════════════════
// PotLogServingScreen — PRD §7.5: "Every serving after: tap pot -> weigh
// bowl -> done." Task brief's central complaint this screen exists to
// fix, in the user's own words: "I've also bought a scale and usually
// weigh the whole thing (sometimes with the plate weight, sometimes
// without)."
//
// Two weighing modes, always one tap to switch between, and the active
// one is ALWAYS stated in a single un-missable line above the number pad
// — never a silent default, because a silently-unsubtracted 250g plate is
// roughly a 300 kcal error on a rice dish, invisible and repeated every
// serving:
//   - "Tared to zero"  — the scale was zeroed with the empty bowl on it,
//                         so the typed number IS the food's net weight.
//   - "Using a container" — the scale shows bowl+food together; pick a
//                         saved container (one tap, remembered from last
//                         time — task brief: "Remember commonly used
//                         container weights for one-tap reuse") or type a
//                         one-off tare weight, and the app subtracts it.
//
// All the actual gross-minus-tare arithmetic lives in
// src/lib/potActions.ts's pure, unit-tested `computeNetServingGrams` /
// `logPotServing` — this screen only collects the mode/reading/container
// and renders the result; it never does the subtraction itself.
//
// Confidence for the resulting entry is 'high' (set in potRepo.logServing,
// not here) — a scale reading against a computed kcal/g is genuinely
// trustworthy, materially better than a photo estimate, but the pot's own
// kcal_per_g inherits whatever uncertainty its ingredients were entered
// with, so it stops one rung short of 'exact' (reserved for a scanned
// nutrition panel).
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { todayLocalISO } from '../lib/localDate';
import * as potRepo from '../db/repositories/potRepo';
import type { PotRow, PotContainerRow } from '../db/types';
import {
  computeNetServingGrams,
  logPotServing,
  saveContainer,
  renameContainer,
  deleteContainer,
  potConfidenceSummary,
  formatPotConfidence,
  setPotCookedWeight,
  potIngredientTotals,
  potFatPlausibility,
  isFatPlausibilityNoteDismissed,
  dismissFatPlausibilityNote,
  isWeighedPot,
  FAT_PLAUSIBILITY_NOTE,
  type ServingWeighMode,
} from '../lib/potActions';
import { parseRequiredNumber } from '../lib/numericInput';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PotLogServing'>;
type Route = RouteProp<RootStackParamList, 'PotLogServing'>;

export function PotLogServingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { potId } = route.params;

  const [pot, setPot] = useState<PotRow | null>(null);
  const [containers, setContainers] = useState<PotContainerRow[]>([]);
  const [mode, setMode] = useState<ServingWeighMode>('tared');
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [manualTareText, setManualTareText] = useState('');
  const [scaleReadingText, setScaleReadingText] = useState('');
  const [saveContainerName, setSaveContainerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // "Capture the cooked weight at first serve" (task brief #1): a pot
  // created from ingredients alone has no kcal_per_g yet — this is where
  // the user, already holding a scale, supplies it. `settingWeight` guards
  // the one-time async write; the input's own text is separate from
  // `scaleReadingText` below so switching between "weigh the pot" and
  // "weigh a serving" never cross-contaminates the two numbers.
  const [cookedWeightText, setCookedWeightText] = useState('');
  const [settingWeight, setSettingWeight] = useState(false);

  // Fat-plausibility note (task brief "Also" section) — dismissal is
  // per-pot and persisted, so `null` means "not loaded yet" (render
  // nothing rather than flash the note on for a beat).
  const [fatNoteDismissed, setFatNoteDismissed] = useState<boolean | null>(null);

  // Container rename/delete UI (task brief: "the repo functions exist,
  // the screen doesn't expose them" — deleteContainer already did;
  // renameContainer is new, see potActions.ts/potRepo.ts). Collapsed
  // behind a "Manage" toggle so the common case (just pick a container
  // and log) stays exactly as uncluttered as before.
  const [managingContainers, setManagingContainers] = useState(false);
  const [renamingContainerId, setRenamingContainerId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const refreshContainers = useCallback(async () => {
    const db = await getDatabase();
    setContainers(await potRepo.getContainers(db));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const [row, savedContainers, dismissed] = await Promise.all([
        potRepo.getPot(db, potId),
        potRepo.getContainers(db),
        isFatPlausibilityNoteDismissed(db, potId),
      ]);
      if (cancelled) return;
      setPot(row);
      setContainers(savedContainers);
      setFatNoteDismissed(dismissed);
    })();
    return () => {
      cancelled = true;
    };
  }, [potId]);

  const handleDismissFatNote = async () => {
    setFatNoteDismissed(true); // optimistic — this is a low-stakes preference, not worth a loading state
    const db = await getDatabase();
    await dismissFatPlausibilityNote(db, potId);
  };

  const parsedCookedWeight = parseRequiredNumber(cookedWeightText);
  const canSetCookedWeight = pot !== null && !settingWeight && parsedCookedWeight.valid && parsedCookedWeight.value > 0;

  const handleSetCookedWeight = async () => {
    if (!canSetCookedWeight || !pot || !parsedCookedWeight.valid) return;
    setSettingWeight(true);
    try {
      const db = await getDatabase();
      const updated = await setPotCookedWeight(db, pot.id, parsedCookedWeight.value);
      setPot(updated);
      setCookedWeightText('');
    } finally {
      setSettingWeight(false);
    }
  };

  const startRenameContainer = (c: PotContainerRow) => {
    setRenamingContainerId(c.id);
    setRenameText(c.name);
  };

  const commitRenameContainer = async () => {
    if (!renamingContainerId || renameText.trim().length === 0) return;
    const db = await getDatabase();
    await renameContainer(db, renamingContainerId, renameText.trim());
    setRenamingContainerId(null);
    setRenameText('');
    await refreshContainers();
  };

  const handleDeleteContainer = async (id: string) => {
    const db = await getDatabase();
    await deleteContainer(db, id);
    if (selectedContainerId === id) setSelectedContainerId(null);
    if (renamingContainerId === id) setRenamingContainerId(null);
    await refreshContainers();
  };

  const selectedContainer = containers.find((c) => c.id === selectedContainerId) ?? null;
  const parsedManualTare = parseRequiredNumber(manualTareText);
  const containerTareG =
    mode === 'container' ? (selectedContainer ? selectedContainer.tare_g : parsedManualTare.valid ? parsedManualTare.value : NaN) : 0;

  const parsedScaleReading = parseRequiredNumber(scaleReadingText);
  const weighResult =
    parsedScaleReading.valid && (mode === 'tared' || Number.isFinite(containerTareG))
      ? computeNetServingGrams(mode, parsedScaleReading.value, mode === 'container' ? containerTareG : 0)
      : null;

  // Every custom (non-saved) tare weight the user typed is offered as a
  // one-tap-save-for-next-time affordance (task brief: "Remember commonly
  // used container weights for one-tap reuse") — but never forced; a
  // one-off container never needs a name.
  const showSaveContainerOffer = mode === 'container' && !selectedContainer && parsedManualTare.valid && parsedManualTare.value > 0;

  // `weighResult?.ok === true` alone is sufficient: it already requires a
  // valid positive scale reading AND (in container mode) a resolved,
  // finite container tare weight — see its computation above.
  // `pot.total_weight_g === null` (task brief #1) means there's no
  // kcal_per_g to value a serving against yet — the render below shows
  // the "weigh this pot first" capture UI instead of the scale-a-serving
  // form in that case, so this is mostly a defensive belt-and-braces
  // check rather than something the user can actually hit.
  const canLog = pot !== null && pot.total_weight_g !== null && !saving && weighResult?.ok === true;

  const switchMode = (next: ServingWeighMode) => {
    setMode(next);
    setErrorMessage(null);
  };

  const handleLog = async () => {
    if (!canLog || !pot || !weighResult?.ok) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const db = await getDatabase();

      // Persist a freshly-typed, not-yet-saved container weight if the
      // user named it — done BEFORE logging so the fresh container's id
      // can be threaded through for the use_count bump on this very
      // serving, exactly as if they had picked a saved one from the start.
      let containerId = selectedContainer?.id;
      if (mode === 'container' && !containerId && showSaveContainerOffer && saveContainerName.trim().length > 0) {
        const created = await saveContainer(db, saveContainerName.trim(), parsedManualTare.value as number);
        containerId = created.id;
      }

      const result = await logPotServing(db, {
        potId: pot.id,
        date: todayLocalISO(),
        mode,
        scaleReadingG: parsedScaleReading.value as number,
        containerTareG: mode === 'container' ? containerTareG : undefined,
        containerId,
      });

      if (!result.ok) {
        setErrorMessage(
          result.reason === 'net_not_positive'
            ? "That container's weight is more than (or equal to) the scale reading — check the numbers."
            : result.reason === 'needs_cooked_weight'
              ? 'This pot needs a cooked weight before a serving can be valued — set one above.'
              : 'Enter a scale reading greater than zero.'
        );
        return;
      }

      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  if (!pot) return <View style={styles.screen} />;

  const confidenceSummary = potConfidenceSummary(pot);
  const editLink = (
    <Pressable onPress={() => navigation.navigate('PotCreate', { potId: pot.id })} accessibilityRole="button" hitSlop={8}>
      <Text style={styles.editLink}>Edit pot</Text>
    </Pressable>
  );

  // Task brief #1: "Capture the cooked weight at first serve if it's
  // missing — that's when the user is already holding a scale." A pot
  // created from ingredients alone has no kcal_per_g yet, so there's
  // nothing to value a scale reading against — show the totals honestly
  // (never a fabricated/zero kcal/g) and ask for the one number needed,
  // instead of the normal weigh-a-serving form.
  if (!isWeighedPot(pot)) {
    const totals = potIngredientTotals(pot);
    return (
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.titleRow}>
            <Text style={styles.title}>{pot.name}</Text>
            {editLink}
          </View>
          {totals.kcal > 0 && (
            <Text style={styles.subtitle}>
              Batch total: {Math.round(totals.kcal)} kcal · P{Math.round(totals.protein_g)} C{Math.round(totals.carbs_g)} F
              {Math.round(totals.fat_g)}
            </Text>
          )}
          {confidenceSummary.totalKcal > 0 && <Text style={styles.confidenceSummary}>{formatPotConfidence(confidenceSummary)}</Text>}

          <Text style={styles.needsWeightNotice}>
            This pot hasn&apos;t been weighed yet — servings can&apos;t be valued until it is. Weigh the whole pot now
            (you&apos;re already holding the scale) to log a serving.
          </Text>
          <Text style={styles.label}>Cooked weight (g)</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={cookedWeightText}
              onChangeText={setCookedWeightText}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <Text style={styles.unit}>g</Text>
          </View>

          <View style={styles.actions}>
            <Pressable onPress={() => navigation.goBack()} style={styles.cancelButton} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSetCookedWeight()}
              disabled={!canSetCookedWeight}
              style={[styles.saveButton, !canSetCookedWeight && styles.saveButtonDisabled]}
              accessibilityRole="button"
            >
              <Text style={styles.saveText}>{settingWeight ? 'Saving…' : 'Save weight'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const netGrams = weighResult?.ok ? weighResult.netGrams : null;
  const estimatedKcal = netGrams !== null ? Math.round(netGrams * pot.kcal_per_g) : null;
  const fatCheck = potFatPlausibility(pot);
  const showFatNote = fatCheck.flagged && fatNoteDismissed === false;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.titleRow}>
          <Text style={styles.title}>{pot.name}</Text>
          {editLink}
        </View>
        <Text style={styles.subtitle}>{Math.round(pot.remaining_g)}g remaining · {pot.kcal_per_g.toFixed(2)} kcal/g</Text>
        {/* The pot's own honesty (task brief): how much of THIS pot's
            calories are backed by a scanned/database match, right where
            the user is about to trust a serving estimate from it. */}
        {confidenceSummary.totalKcal > 0 && <Text style={styles.confidenceSummary}>{formatPotConfidence(confidenceSummary)}</Text>}

        {/* Task brief "Also" section: neutral, factual, dismissible —
            never a warning (PRD §10 forbids red/guilt). Shown right where
            the user is about to trust this pot's numbers, same spot the
            confidence summary above already occupies. */}
        {showFatNote && (
          <View style={styles.fatNoteRow}>
            <Text style={styles.fatNoteText}>{FAT_PLAUSIBILITY_NOTE}</Text>
            <Pressable onPress={() => void handleDismissFatNote()} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.fatNoteDismiss}>Dismiss</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.modeRow}>
          <ModeButton label="Tared to zero" active={mode === 'tared'} onPress={() => switchMode('tared')} />
          <ModeButton label="Using a container" active={mode === 'container'} onPress={() => switchMode('container')} />
        </View>

        {/* The single un-missable "which mode is active" statement — a
            silently-unsubtracted plate is the whole reason this screen
            exists to be redone. */}
        {mode === 'tared' ? (
          <Text style={styles.activeModeCallout}>
            Active: scale tared to zero — the number you type is the food&apos;s weight, nothing subtracted.
          </Text>
        ) : (
          <Text style={styles.activeModeCallout}>
            Active: using a container — the number you type is the SCALE READING (bowl + food); the container&apos;s
            weight below will be subtracted.
          </Text>
        )}

        {mode === 'container' && (
          <>
            {containers.length > 0 && (
              <>
                <View style={styles.containerChipRow}>
                  {containers.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        setSelectedContainerId((prev) => (prev === c.id ? null : c.id));
                        setManualTareText('');
                      }}
                      style={({ pressed }) => [
                        styles.containerChip,
                        selectedContainerId === c.id && styles.containerChipActive,
                        pressed && styles.containerChipPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedContainerId === c.id }}
                    >
                      <Text style={[styles.containerChipText, selectedContainerId === c.id && styles.containerChipTextActive]}>
                        {c.name} ({Math.round(c.tare_g)}g)
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Container rename/delete UI (task brief) — collapsed
                    behind a toggle so picking a container to log with
                    stays the one-tap common case. */}
                <Pressable onPress={() => setManagingContainers((v) => !v)} accessibilityRole="button">
                  <Text style={styles.manageContainersLink}>{managingContainers ? 'Done managing' : 'Manage saved containers'}</Text>
                </Pressable>

                {managingContainers && (
                  <View style={styles.manageContainersList}>
                    {containers.map((c) => (
                      <View key={c.id} style={styles.manageContainerRow}>
                        {renamingContainerId === c.id ? (
                          <>
                            <TextInput
                              style={[styles.textInput, styles.manageContainerRenameInput]}
                              value={renameText}
                              onChangeText={setRenameText}
                              autoFocus
                            />
                            <Pressable onPress={() => void commitRenameContainer()} accessibilityRole="button" hitSlop={8}>
                              <Text style={styles.manageContainerActionText}>Save</Text>
                            </Pressable>
                            <Pressable onPress={() => setRenamingContainerId(null)} accessibilityRole="button" hitSlop={8}>
                              <Text style={styles.manageContainerActionTextSecondary}>Cancel</Text>
                            </Pressable>
                          </>
                        ) : (
                          <>
                            <Text style={styles.manageContainerName} numberOfLines={1}>
                              {c.name} ({Math.round(c.tare_g)}g)
                            </Text>
                            <Pressable onPress={() => startRenameContainer(c)} accessibilityRole="button" hitSlop={8}>
                              <Text style={styles.manageContainerActionText}>Rename</Text>
                            </Pressable>
                            <Pressable onPress={() => void handleDeleteContainer(c.id)} accessibilityRole="button" hitSlop={8}>
                              <Text style={styles.manageContainerActionTextSecondary}>Delete</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {!selectedContainer && (
              <>
                <Text style={styles.label}>Container weight (empty, grams)</Text>
                <TextInput
                  style={[styles.textInput, numeric]}
                  value={manualTareText}
                  onChangeText={(v) => {
                    setManualTareText(v);
                    setSelectedContainerId(null);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textTertiary}
                />
                {showSaveContainerOffer && (
                  <>
                    <Text style={styles.hintSmall}>Save this container for one-tap reuse next time (optional)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={saveContainerName}
                      onChangeText={setSaveContainerName}
                      placeholder="e.g. Blue bowl"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}

        <Text style={styles.label}>{mode === 'tared' ? 'Food weight (g)' : 'Scale reading — bowl + food (g)'}</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={scaleReadingText}
            onChangeText={setScaleReadingText}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textTertiary}
            autoFocus
          />
          <Text style={styles.unit}>g</Text>
        </View>

        {netGrams !== null && (
          <Text style={styles.netGramsText}>
            {mode === 'container' ? `= ${Math.round(netGrams)}g of food · ` : ''}≈ {estimatedKcal} kcal
          </Text>
        )}

        {weighResult?.ok === false && weighResult.reason === 'net_not_positive' && (
          <Text style={styles.errorText}>That container weight looks too high for this reading.</Text>
        )}
        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        <View style={styles.actions}>
          <Pressable onPress={() => navigation.goBack()} style={styles.cancelButton} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => void handleLog()}
            disabled={!canLog}
            style={[styles.saveButton, !canLog && styles.saveButtonDisabled]}
            accessibilityRole="button"
          >
            <Text style={styles.saveText}>{saving ? 'Logging…' : 'Log serving'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.modeButton, active && styles.modeButtonActive, pressed && styles.modeButtonPressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...type.h2,
    color: colors.text,
  },
  editLink: {
    ...type.caption,
    color: colors.accent,
  },
  subtitle: {
    ...type.caption,
    ...numeric,
    color: colors.textTertiary,
    marginBottom: spacing.lg,
  },
  needsWeightNotice: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  fatNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  fatNoteText: {
    ...type.small,
    color: colors.textSecondary,
    flex: 1,
    marginRight: spacing.sm,
  },
  fatNoteDismiss: {
    ...type.caption,
    color: colors.accent,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  modeButton: {
    flex: 1,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  modeButtonPressed: {
    opacity: 0.85,
  },
  modeButtonText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  modeButtonTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  activeModeCallout: {
    ...type.small,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  containerChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  containerChip: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  containerChipActive: {
    backgroundColor: colors.accent,
  },
  containerChipPressed: {
    opacity: 0.85,
  },
  containerChipText: {
    ...type.caption,
    ...numeric,
    color: colors.text,
  },
  containerChipTextActive: {
    color: colors.background,
    fontWeight: '600',
  },
  manageContainersLink: {
    ...type.small,
    color: colors.accent,
    marginBottom: spacing.sm,
  },
  manageContainersList: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  manageContainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  manageContainerName: {
    ...type.caption,
    ...numeric,
    color: colors.text,
    flex: 1,
  },
  manageContainerRenameInput: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  manageContainerActionText: {
    ...type.caption,
    color: colors.accent,
  },
  manageContainerActionTextSecondary: {
    ...type.caption,
    color: colors.textSecondary,
  },
  confidenceSummary: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  label: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  hintSmall: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  textInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  input: {
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
  netGramsText: {
    ...type.body,
    ...numeric,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorText: {
    ...type.caption,
    color: colors.textSecondary,
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
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveText: {
    ...type.bodyStrong,
    color: colors.background,
  },
});
