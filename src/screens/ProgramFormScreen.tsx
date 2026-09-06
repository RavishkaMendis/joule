// ═══════════════════════════════════════════════════════════════════════
// ProgramFormScreen — create (no id) or edit (id set) a program's
// name/description. Days and their exercises are managed one level down
// (ProgramDetailScreen -> ProgramDayForm/ProgramExercisForm) — this
// screen only owns the program's own two fields, plus duplicate/delete
// once editing.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as programRepo from '../db/repositories/programRepo';
import * as programActions from '../lib/training/programActions';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ProgramForm'>;
type Route = RouteProp<RootStackParamList, 'ProgramForm'>;

export function ProgramFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const id = route.params?.id;
  const isEditing = id !== undefined;

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const db = await getDatabase();
      const row = await programRepo.getProgram(db, id);
      if (row) {
        setName(row.name);
        setDescription(row.description ?? '');
      }
      setLoading(false);
    })();
  }, [id]);

  const canSave = name.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const trimmedDescription = description.trim().length > 0 ? description.trim() : null;
      if (isEditing && id) {
        await programRepo.updateProgram(db, id, { name: name.trim(), description: trimmedDescription });
      } else {
        await programActions.createProgram(db, name.trim(), trimmedDescription);
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      await programActions.duplicateProgram(db, id);
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!id) return;
    Alert.alert(
      'Delete this program?',
      'This removes every day and exercise prescription in it. Any past sessions you logged following it are kept exactly as they are. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              setSaving(true);
              try {
                const db = await getDatabase();
                await programRepo.deleteProgram(db, id);
                navigation.popToTop();
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{isEditing ? 'Edit program' : 'New program'}</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g. My upper/lower split"
          placeholderTextColor={colors.textTertiary}
          autoFocus={!isEditing}
        />

        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          style={[styles.textInput, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="A short note about this program"
          placeholderTextColor={colors.textTertiary}
          multiline
        />

        <Pressable onPress={() => void handleSave()} disabled={!canSave || saving} style={[styles.saveButton, !canSave && styles.saveButtonDisabled]} accessibilityRole="button">
          <Text style={styles.saveButtonText}>{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create program'}</Text>
        </Pressable>

        {isEditing && (
          <>
            <Pressable onPress={() => void handleDuplicate()} disabled={saving} style={styles.secondaryButton} accessibilityRole="button">
              <Text style={styles.secondaryButtonText}>Duplicate program</Text>
            </Pressable>
            <Pressable onPress={handleDelete} disabled={saving} style={styles.deleteButton} accessibilityRole="button">
              <Text style={styles.deleteButtonText}>Delete program</Text>
            </Pressable>
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
    marginBottom: spacing.md,
  },
  label: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
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
    minHeight: 80,
    textAlignVertical: 'top',
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
  secondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  secondaryButtonText: {
    ...type.bodyStrong,
    color: colors.accent,
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
