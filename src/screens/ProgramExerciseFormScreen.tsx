// ═══════════════════════════════════════════════════════════════════════
// ProgramExerciseFormScreen — add (no id) or edit (id set) one
// program_exercise: which exercise, its set/rep/RIR/rest targets, free-
// text coaching cues, an optional reference URL, and — once the exercise
// itself has been saved — its substitution catalog (task brief: "swap in
// substitutions if you don't have the equipment").
//
// Substitutions can only be managed once this program_exercise has a real
// id (the FK target), so a brand-new exercise saves and returns; reopen
// it from ProgramDayScreen to add substitutions. This keeps the screen's
// state machine simple without costing the user an extra screen — editing
// a program is explicitly NOT on the 10-second path (task brief: "This is
// a settings-shaped task... clarity beats speed").
//
// "You cannot ship video demos — do not fake one or link to third-party
// content. A cues field plus an optional user-supplied URL is the honest
// scope" (task brief) — `demoUrl` is opened via the OS, never embedded.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as programRepo from '../db/repositories/programRepo';
import * as workoutExerciseRepo from '../db/repositories/workoutExerciseRepo';
import * as programActions from '../lib/training/programActions';
import type { ExerciseRow, ProgramSubstitutionRow, PrescriptionType } from '../db/types';
import { Stepper } from '../components/training/Stepper';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ProgramExerciseForm'>;
type Route = RouteProp<RootStackParamList, 'ProgramExerciseForm'>;

type SubstitutionListItem = ProgramSubstitutionRow & { exerciseName: string };

export function ProgramExerciseFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { programDayId, programExerciseId } = route.params;
  const isEditing = programExerciseId !== undefined;

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);

  const [selectedExercise, setSelectedExercise] = useState<ExerciseRow | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<ExerciseRow[]>([]);
  const [pickingExercise, setPickingExercise] = useState(!isEditing);

  const [targetSets, setTargetSets] = useState(3);
  const [prescriptionType, setPrescriptionType] = useState<PrescriptionType>('rep_range');
  // Kept as plain numbers (never null) even for an 'amrap' prescription,
  // where they're simply not sent to the DB — this is what lets the rep
  // Steppers always have something sane to show/adjust if the user
  // switches back to 'rep_range' after trying 'amrap'. The DB's CHECK
  // constraint (schema.ts's v7 header) is what actually enforces
  // rep_low/rep_high being NULL for 'amrap' — handleSave sends null for
  // them there regardless of what these hold.
  const [repLow, setRepLow] = useState(8);
  const [repHigh, setRepHigh] = useState(10);
  const [targetRir, setTargetRir] = useState<number | null>(2);
  const [restSeconds, setRestSeconds] = useState<number | null>(90);
  const [cues, setCues] = useState('');
  const [demoUrl, setDemoUrl] = useState('');

  const [substitutions, setSubstitutions] = useState<SubstitutionListItem[]>([]);
  const [addingSub, setAddingSub] = useState(false);
  const [subQuery, setSubQuery] = useState('');
  const [subResults, setSubResults] = useState<ExerciseRow[]>([]);

  useEffect(() => {
    if (!programExerciseId) return;
    void (async () => {
      const db = await getDatabase();
      const pe = await programRepo.getProgramExercise(db, programExerciseId);
      if (pe) {
        const exercise = await workoutExerciseRepo.getExercise(db, pe.exercise_id);
        setSelectedExercise(exercise);
        setTargetSets(pe.target_sets);
        setPrescriptionType(pe.prescription_type);
        // NULL for an 'amrap' row (see the repLow/repHigh state comment
        // above) — leave the Stepper defaults in place rather than
        // setting them to null, which the Stepper can't render anyway.
        if (pe.rep_low !== null) setRepLow(pe.rep_low);
        if (pe.rep_high !== null) setRepHigh(pe.rep_high);
        setTargetRir(pe.target_rir);
        setRestSeconds(pe.rest_seconds);
        setCues(pe.cues ?? '');
        setDemoUrl(pe.demo_url ?? '');

        const subs = await programRepo.listSubstitutionsForExercise(db, pe.id);
        const withNames = await Promise.all(
          subs.map(async (s) => {
            const subExercise = await workoutExerciseRepo.getExercise(db, s.exercise_id);
            return { ...s, exerciseName: subExercise?.name ?? 'Unknown exercise' };
          })
        );
        setSubstitutions(withNames);
      }
      setLoading(false);
    })();
  }, [programExerciseId]);

  useEffect(() => {
    if (!pickingExercise) return;
    void (async () => {
      const db = await getDatabase();
      setPickerResults(await workoutExerciseRepo.searchExercises(db, pickerQuery));
    })();
  }, [pickerQuery, pickingExercise]);

  useEffect(() => {
    if (!addingSub) return;
    void (async () => {
      const db = await getDatabase();
      setSubResults(await workoutExerciseRepo.searchExercises(db, subQuery));
    })();
  }, [subQuery, addingSub]);

  const canSave =
    selectedExercise !== null &&
    targetSets > 0 &&
    (prescriptionType === 'amrap' || (repLow > 0 && repHigh >= repLow));

  const handleSave = async () => {
    if (!selectedExercise || !canSave) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const trimmedCues = cues.trim().length > 0 ? cues.trim() : null;
      const trimmedDemoUrl = demoUrl.trim().length > 0 ? demoUrl.trim() : null;
      // 'amrap' means reps are an outcome, not a target — send NULL for
      // both regardless of whatever the (unused, left-over) Stepper
      // values currently hold. The DB CHECK constraint (schema.ts's v7
      // header) would reject a mismatched pairing anyway; this just
      // means the honest thing is sent in the first place.
      const repLowToSave = prescriptionType === 'rep_range' ? repLow : null;
      const repHighToSave = prescriptionType === 'rep_range' ? repHigh : null;

      if (isEditing && programExerciseId) {
        await programRepo.updateProgramExercise(db, programExerciseId, {
          exercise_id: selectedExercise.id,
          target_sets: targetSets,
          prescription_type: prescriptionType,
          rep_low: repLowToSave,
          rep_high: repHighToSave,
          target_rir: targetRir,
          rest_seconds: restSeconds,
          cues: trimmedCues,
          demo_url: trimmedDemoUrl,
        });
      } else {
        await programActions.addExerciseToDay(db, programDayId, {
          exerciseId: selectedExercise.id,
          targetSets,
          prescriptionType,
          repLow: repLowToSave,
          repHigh: repHighToSave,
          targetRir,
          restSeconds,
          cues: trimmedCues,
          demoUrl: trimmedDemoUrl,
        });
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!programExerciseId) return;
    Alert.alert('Remove this exercise from the day?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setSaving(true);
            try {
              const db = await getDatabase();
              await programRepo.deleteProgramExercise(db, programExerciseId);
              navigation.goBack();
            } finally {
              setSaving(false);
            }
          })(),
      },
    ]);
  };

  const handleAddSubstitution = async (exercise: ExerciseRow) => {
    if (!programExerciseId) return;
    const db = await getDatabase();
    await programActions.addSubstitutionOption(db, programExerciseId, exercise.id);
    const subs = await programRepo.listSubstitutionsForExercise(db, programExerciseId);
    const withNames = await Promise.all(
      subs.map(async (s) => {
        const subExercise = await workoutExerciseRepo.getExercise(db, s.exercise_id);
        return { ...s, exerciseName: subExercise?.name ?? 'Unknown exercise' };
      })
    );
    setSubstitutions(withNames);
    setAddingSub(false);
    setSubQuery('');
  };

  const handleRemoveSubstitution = async (id: string) => {
    const db = await getDatabase();
    await programRepo.deleteSubstitution(db, id);
    setSubstitutions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleOpenDemoUrl = () => {
    const trimmed = demoUrl.trim();
    if (trimmed.length === 0) return;
    void Linking.openURL(trimmed).catch(() => Alert.alert('Could not open that link', trimmed));
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{isEditing ? 'Edit exercise' : 'Add exercise'}</Text>

        {pickingExercise ? (
          <View style={styles.pickerBlock}>
            <TextInput
              style={styles.textInput}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              placeholder="Search exercises…"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            {pickerResults.map((exercise) => (
              <Pressable
                key={exercise.id}
                onPress={() => {
                  setSelectedExercise(exercise);
                  setPickingExercise(false);
                }}
                style={styles.pickerRow}
                accessibilityRole="button"
              >
                <Text style={styles.pickerRowText}>{exercise.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Pressable onPress={() => setPickingExercise(true)} style={styles.selectedExerciseRow} accessibilityRole="button">
            <Text style={styles.selectedExerciseName}>{selectedExercise?.name}</Text>
            <Text style={styles.changeLink}>Change</Text>
          </Pressable>
        )}

        {!pickingExercise && (
          <>
            <Text style={styles.label}>Prescription</Text>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setPrescriptionType('rep_range')}
                style={[styles.prescriptionChip, prescriptionType === 'rep_range' && styles.prescriptionChipActive]}
                accessibilityRole="button"
              >
                <Text style={[styles.prescriptionChipText, prescriptionType === 'rep_range' && styles.prescriptionChipTextActive]}>Rep range</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setPrescriptionType('amrap');
                  // 2 RIR is a sensible rep_range default but a poor "how
                  // close to failure" hint for AMRAP — nudge it toward
                  // literal failure the first time someone switches, but
                  // only if they haven't deliberately set something else.
                  if (targetRir === 2) setTargetRir(0);
                }}
                style={[styles.prescriptionChip, prescriptionType === 'amrap' && styles.prescriptionChipActive]}
                accessibilityRole="button"
              >
                <Text style={[styles.prescriptionChipText, prescriptionType === 'amrap' && styles.prescriptionChipTextActive]}>To failure (AMRAP)</Text>
              </Pressable>
            </View>
            {prescriptionType === 'amrap' && (
              <Text style={styles.hint}>Reps are an outcome, not a target — the rep fields below are hidden and not saved.</Text>
            )}

            <View style={styles.stepperRow}>
              <Stepper label="Sets" value={targetSets} step={1} min={1} onChange={setTargetSets} />
              {prescriptionType === 'rep_range' && (
                <>
                  <Stepper label="Reps low" value={repLow} step={1} min={1} onChange={setRepLow} />
                  <Stepper label="Reps high" value={repHigh} step={1} min={1} onChange={setRepHigh} />
                </>
              )}
            </View>

            <View style={styles.stepperRow}>
              <Stepper label="Target RIR" value={targetRir ?? 0} step={0.5} min={0} precision={1} onChange={setTargetRir} />
              <Stepper label="Rest" value={restSeconds ?? 0} step={15} min={0} suffix="s" onChange={setRestSeconds} />
            </View>

            <Text style={styles.label}>Coaching cues (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.multiline]}
              value={cues}
              onChangeText={setCues}
              placeholder="e.g. Brace core, control the descent, full range of motion."
              placeholderTextColor={colors.textTertiary}
              multiline
            />

            <Text style={styles.label}>Reference link (optional)</Text>
            <Text style={styles.hint}>Your own link — this app does not bundle or embed video demos.</Text>
            <View style={styles.urlRow}>
              <TextInput
                style={[styles.textInput, styles.urlInput]}
                value={demoUrl}
                onChangeText={setDemoUrl}
                placeholder="https://…"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                keyboardType="url"
              />
              {demoUrl.trim().length > 0 && (
                <Pressable onPress={handleOpenDemoUrl} style={styles.openLinkButton} accessibilityRole="button">
                  <Text style={styles.openLinkText}>Open</Text>
                </Pressable>
              )}
            </View>

            <Pressable onPress={() => void handleSave()} disabled={!canSave || saving} style={[styles.saveButton, !canSave && styles.saveButtonDisabled]} accessibilityRole="button">
              <Text style={styles.saveButtonText}>{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add to day'}</Text>
            </Pressable>

            {isEditing && (
              <>
                <Text style={[styles.label, styles.subsHeading]}>Substitutions</Text>
                <Text style={styles.hint}>Equipment alternatives, offered when logging in-session ("no squat rack? use leg press").</Text>

                {substitutions.map((sub) => (
                  <View key={sub.id} style={styles.subRow}>
                    <Text style={styles.subName}>{sub.exerciseName}</Text>
                    <Pressable onPress={() => void handleRemoveSubstitution(sub.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${sub.exerciseName} as a substitution`}>
                      <Text style={styles.subRemove}>Remove</Text>
                    </Pressable>
                  </View>
                ))}

                {addingSub ? (
                  <View style={styles.pickerBlock}>
                    <TextInput
                      style={styles.textInput}
                      value={subQuery}
                      onChangeText={setSubQuery}
                      placeholder="Search exercises…"
                      placeholderTextColor={colors.textTertiary}
                      autoFocus
                    />
                    {subResults
                      .filter((e) => e.id !== selectedExercise?.id)
                      .map((exercise) => (
                        <Pressable key={exercise.id} onPress={() => void handleAddSubstitution(exercise)} style={styles.pickerRow} accessibilityRole="button">
                          <Text style={styles.pickerRowText}>{exercise.name}</Text>
                        </Pressable>
                      ))}
                  </View>
                ) : (
                  <Pressable onPress={() => setAddingSub(true)} style={styles.addSubButton} accessibilityRole="button">
                    <Text style={styles.addSubText}>+ Add substitution</Text>
                  </Pressable>
                )}

                <Pressable onPress={handleDelete} disabled={saving} style={styles.deleteButton} accessibilityRole="button">
                  <Text style={styles.deleteButtonText}>Remove exercise from day</Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingText: {
    ...type.body,
    color: colors.textSecondary,
    padding: spacing.lg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pickerBlock: {
    gap: spacing.xs,
  },
  pickerRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    minHeight: minTouchTarget * 0.7,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerRowText: {
    ...type.body,
    color: colors.text,
  },
  selectedExerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectedExerciseName: {
    ...type.bodyStrong,
    color: colors.text,
  },
  changeLink: {
    ...type.caption,
    color: colors.accent,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  prescriptionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  prescriptionChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  prescriptionChipText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  prescriptionChipTextActive: {
    color: colors.background,
  },
  stepperRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  label: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  hint: {
    ...type.small,
    color: colors.textTertiary,
  },
  textInput: {
    ...type.body,
    color: colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  urlInput: {
    flex: 1,
  },
  openLinkButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  openLinkText: {
    ...type.caption,
    color: colors.accent,
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  subsHeading: {
    marginTop: spacing.xl,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  subName: {
    ...type.body,
    color: colors.text,
  },
  subRemove: {
    ...type.caption,
    color: colors.textTertiary,
  },
  addSubButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  addSubText: {
    ...type.caption,
    color: colors.accent,
  },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
  },
  deleteButtonText: {
    ...type.caption,
    color: colors.textTertiary,
  },
});
