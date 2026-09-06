// ═══════════════════════════════════════════════════════════════════════
// ProgramDayFormScreen — create (no dayId) or edit (dayId set) one day's
// label within a program ("Upper A", "Lower B"). Exercise prescriptions
// live on ProgramDayScreen, reached after saving a new day or by editing
// an existing one from ProgramDetailScreen directly.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as programRepo from '../db/repositories/programRepo';
import { addDay } from '../lib/training/programActions';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ProgramDayForm'>;
type Route = RouteProp<RootStackParamList, 'ProgramDayForm'>;

export function ProgramDayFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { programId, dayId } = route.params;
  const isEditing = dayId !== undefined;

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!dayId) return;
    void (async () => {
      const db = await getDatabase();
      const row = await programRepo.getProgramDay(db, dayId);
      if (row) setLabel(row.label);
      setLoading(false);
    })();
  }, [dayId]);

  const canSave = label.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      if (isEditing && dayId) {
        await programRepo.updateProgramDay(db, dayId, { label: label.trim() });
        navigation.goBack();
      } else {
        const day = await addDay(db, programId, label.trim());
        navigation.replace('ProgramDay', { programId, dayId: day.id });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!dayId) return;
    Alert.alert('Delete this day?', 'This removes every exercise prescription in it. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setSaving(true);
            try {
              const db = await getDatabase();
              await programRepo.deleteProgramDay(db, dayId);
              navigation.pop(2); // back past ProgramDayScreen to ProgramDetail
            } finally {
              setSaving(false);
            }
          })(),
      },
    ]);
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
      <View style={styles.content}>
        <Text style={styles.title}>{isEditing ? 'Edit day' : 'New day'}</Text>

        <Text style={styles.label}>Label</Text>
        <TextInput
          style={styles.textInput}
          value={label}
          onChangeText={setLabel}
          placeholder="e.g. Upper A, Push, Legs"
          placeholderTextColor={colors.textTertiary}
          autoFocus
        />

        <Pressable onPress={() => void handleSave()} disabled={!canSave || saving} style={[styles.saveButton, !canSave && styles.saveButtonDisabled]} accessibilityRole="button">
          <Text style={styles.saveButtonText}>{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add day'}</Text>
        </Pressable>

        {isEditing && (
          <Pressable onPress={handleDelete} disabled={saving} style={styles.deleteButton} accessibilityRole="button">
            <Text style={styles.deleteButtonText}>Delete day</Text>
          </Pressable>
        )}
      </View>
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
  },
  title: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.md,
  },
  label: {
    ...type.caption,
    color: colors.textSecondary,
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
  deleteButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  deleteButtonText: {
    ...type.caption,
    color: colors.textTertiary,
  },
});
