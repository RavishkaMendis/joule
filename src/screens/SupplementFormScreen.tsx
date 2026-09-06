// ═══════════════════════════════════════════════════════════════════════
// SupplementFormScreen — create (no route param) or edit (id set) a
// supplement's regimen (task brief "Feature 1 — Supplements").
//
// Peptides get no special treatment here: they're stored as a
// user-defined supplement with whatever name/dose/unit/schedule the user
// types (task brief: "treat as a user-defined supplement type... store
// what the user types"). There is deliberately no dosing guidance, no
// safety copy, no interaction checking anywhere on this screen — this is
// a personal log, not a medical tool.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as supplementRepo from '../db/repositories/supplementRepo';
import { createSupplement, updateSupplement, deleteSupplement } from '../lib/supplements/supplementActions';
import { parseSchedule, type ScheduleSpec } from '../lib/supplements/schedule';
import { parseRequiredNumber } from '../lib/numericInput';

type Nav = NativeStackNavigationProp<RootStackParamList, 'SupplementForm'>;
type Route = RouteProp<RootStackParamList, 'SupplementForm'>;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type ScheduleType = ScheduleSpec['type'];

export function SupplementFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const id = route.params?.id;
  const isEditing = id !== undefined;

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [unit, setUnit] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [days, setDays] = useState<number[]>([]);
  const [kcal, setKcal] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const db = await getDatabase();
      const row = await supplementRepo.getSupplement(db, id);
      if (row) {
        setName(row.name);
        setDose(row.dose);
        setUnit(row.unit ?? '');
        const spec = parseSchedule(row.schedule);
        setScheduleType(spec.type);
        setDays(spec.type === 'days_of_week' ? spec.days : []);
        setKcal(row.kcal ? String(row.kcal) : '');
        setProteinG(row.protein_g ? String(row.protein_g) : '');
        setNotes(row.notes ?? '');
      }
      setLoading(false);
    })();
  }, [id]);

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const canSave = name.trim().length > 0 && dose.trim().length > 0;

  const buildSchedule = (): ScheduleSpec => {
    if (scheduleType === 'daily') return { type: 'daily' };
    if (scheduleType === 'as_needed') return { type: 'as_needed' };
    return { type: 'days_of_week', days };
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const kcalValue = parseRequiredNumber(kcal);
      const proteinValue = parseRequiredNumber(proteinG);
      const input = {
        name: name.trim(),
        dose: dose.trim(),
        unit: unit.trim().length > 0 ? unit.trim() : null,
        schedule: buildSchedule(),
        kcal: kcalValue.valid ? kcalValue.value : 0,
        protein_g: proteinValue.valid ? proteinValue.value : 0,
        notes: notes.trim().length > 0 ? notes.trim() : null,
      };

      if (isEditing && id) {
        await updateSupplement(db, id, input);
      } else {
        await createSupplement(db, input);
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    Alert.alert(
      'Delete this supplement?',
      'This also removes its logged history. This cannot be undone. If you just stopped taking it, consider archiving instead (edit screen still shows an Archive option after cancelling here).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          onPress: () =>
            void (async () => {
              setSaving(true);
              try {
                const db = await getDatabase();
                await deleteSupplement(db, id);
                navigation.goBack();
              } finally {
                setSaving(false);
              }
            })(),
        },
      ]
    );
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>{isEditing ? 'Edit supplement' : 'New supplement'}</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Vitamin D3, BPC-157"
          placeholderTextColor={colors.textTertiary}
        />

        <View style={styles.row}>
          <View style={styles.doseField}>
            <Text style={styles.label}>Dose</Text>
            <TextInput
              style={styles.textInput}
              value={dose}
              onChangeText={setDose}
              placeholder="e.g. 2000, 1, 250"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={styles.doseField}>
            <Text style={styles.label}>Unit</Text>
            <TextInput
              style={styles.textInput}
              value={unit}
              onChangeText={setUnit}
              placeholder="mg, IU, capsule, mcg…"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </View>

        <Text style={styles.label}>Schedule</Text>
        <View style={styles.chipRow}>
          <ScheduleChip label="Daily" active={scheduleType === 'daily'} onPress={() => setScheduleType('daily')} />
          <ScheduleChip
            label="Specific days"
            active={scheduleType === 'days_of_week'}
            onPress={() => setScheduleType('days_of_week')}
          />
          <ScheduleChip label="As needed" active={scheduleType === 'as_needed'} onPress={() => setScheduleType('as_needed')} />
        </View>
        {scheduleType === 'days_of_week' && (
          <View style={styles.chipRow}>
            {WEEKDAY_LABELS.map((label, i) => (
              <ScheduleChip key={label} label={label} active={days.includes(i)} onPress={() => toggleDay(i)} />
            ))}
          </View>
        )}

        <Text style={styles.label}>Calories (optional)</Text>
        <Text style={styles.hint}>
          Only if this supplement has real macros (a protein/creatine scoop, for example). Marking a dose taken never
          adds these to today&apos;s food log by itself — that&apos;s always a separate, explicit step.
        </Text>
        <View style={styles.row}>
          <View style={styles.doseField}>
            <Text style={styles.label}>kcal</Text>
            <TextInput
              style={[styles.textInput, styles.numericTextInput]}
              value={kcal}
              onChangeText={setKcal}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
          <View style={styles.doseField}>
            <Text style={styles.label}>Protein (g)</Text>
            <TextInput
              style={[styles.textInput, styles.numericTextInput]}
              value={proteinG}
              onChangeText={setProteinG}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
          </View>
        </View>

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.textInput, styles.notesInput]}
          value={notes}
          onChangeText={setNotes}
          placeholder="Whatever you want to remember about this"
          placeholderTextColor={colors.textTertiary}
          multiline
        />

        <View style={styles.actions}>
          {isEditing && (
            <Pressable onPress={handleDelete} style={styles.deleteButton} accessibilityRole="button">
              <Text style={styles.deleteText}>Delete</Text>
            </Pressable>
          )}
          <View style={styles.actionsRight}>
            <Pressable onPress={() => navigation.goBack()} style={styles.cancelButton} accessibilityRole="button">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSave()}
              disabled={!canSave || saving}
              style={[styles.saveButton, (!canSave || saving) && styles.saveButtonDisabled]}
              accessibilityRole="button"
            >
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ScheduleChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
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
    margin: spacing.lg,
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    ...type.h2,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  label: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  hint: {
    ...type.small,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  textInput: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  numericTextInput: {
    ...numeric,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  doseField: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.background,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  actionsRight: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  deleteButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  deleteText: {
    ...type.body,
    color: colors.textSecondary,
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
