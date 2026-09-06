// ═══════════════════════════════════════════════════════════════════════
// WeightEntryScreen — PRD §9.6: one number, plus an optional one-tap
// confounder chip row. Reached from Today's morning prompt (or, in the
// future, from a past-day edit) — the date is threaded through via route
// params rather than assumed to be today, so editing a past reading works
// the same way (PRD §10: everything editable forever).
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { todayLocalISO, relativeDayLabel } from '../lib/localDate';
import * as weightRepo from '../db/repositories/weightRepo';
import { logWeight } from '../lib/weightEntryActions';
import { ConfounderChips } from '../components/ConfounderChips';
import type { Confounder } from '../engine/types';
import { parseRequiredNumber } from '../lib/numericInput';

type Nav = NativeStackNavigationProp<RootStackParamList, 'WeightEntry'>;
type Route = RouteProp<RootStackParamList, 'WeightEntry'>;

export function WeightEntryScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const date = route.params?.date ?? todayLocalISO();

  const [weightText, setWeightText] = useState('');
  const [confounder, setConfounder] = useState<Confounder | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDatabase();
      const existing = await weightRepo.getByDate(db, date);
      if (!cancelled && existing) {
        setWeightText(String(existing.weight_kg));
        setConfounder(existing.confounder);
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Weight has no legitimate 0 (unlike a macro such as fat_g) — blank AND
  // zero are both invalid here, so this stays a plain parseRequiredNumber
  // check plus a positivity check, rather than allowing 0 through.
  const parsedWeight = parseRequiredNumber(weightText);
  const canSave = parsedWeight.valid && parsedWeight.value > 0;

  const handleSave = async () => {
    if (!canSave || !parsedWeight.valid) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      await logWeight(db, date, parsedWeight.value, confounder);
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <View style={styles.screen} />;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Weight — {relativeDayLabel(date)}</Text>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={weightText}
          onChangeText={setWeightText}
          keyboardType="decimal-pad"
          placeholder="0.0"
          placeholderTextColor={colors.textTertiary}
          selectTextOnFocus
          returnKeyType="done"
          autoFocus
        />
        <Text style={styles.unit}>kg</Text>
      </View>

      <ConfounderChips selected={confounder} onSelect={setConfounder} />

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
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  title: {
    ...type.h2,
    color: colors.text,
    marginBottom: spacing.lg,
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
