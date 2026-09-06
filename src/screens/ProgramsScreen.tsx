// ═══════════════════════════════════════════════════════════════════════
// ProgramsScreen — the Train tab's entry point into training
// programs/templates (task brief: "Pick a program -> see its days ->
// start the next one"). Lists every program (the generic starter
// template ships pre-seeded, schema.ts's v7 header), which one is
// currently active, and lets the user switch which one they're following
// or create a new one from scratch.
//
// This screen and everything under it (ProgramDetail, ProgramDayForm,
// ProgramExerciseForm) is deliberately a SEPARATE surface from
// WorkoutSessionScreen's fast ad-hoc logging path — task brief: "This is
// a settings-shaped task... clarity beats speed. But logging against a
// program must not add taps versus today's ad-hoc flow." Nothing here
// runs while a workout is in progress.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as programRepo from '../db/repositories/programRepo';
import type { ProgramRow, ProgramDayRow } from '../db/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type ProgramListItem = {
  program: ProgramRow;
  days: ProgramDayRow[];
};

export function ProgramsScreen() {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<ProgramListItem[]>([]);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const programs = await programRepo.listPrograms(db);
    const withDays = await Promise.all(
      programs.map(async (program) => ({ program, days: await programRepo.listDaysForProgram(db, program.id) }))
    );
    setItems(withDays);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleSetActive = async (programId: string) => {
    const db = await getDatabase();
    await programRepo.setActiveProgram(db, programId);
    await load();
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Programs</Text>
        <Pressable
          onPress={() => navigation.navigate('ProgramForm', undefined)}
          style={styles.newButton}
          accessibilityRole="button"
        >
          <Text style={styles.newButtonText}>+ New</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <Text style={styles.emptyHint}>No programs yet — create one, or start from the generic starter template.</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.program.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate('ProgramDetail', { programId: item.program.id })}
              style={styles.row}
              accessibilityRole="button"
            >
              <View style={styles.rowMain}>
                <View style={styles.nameRow}>
                  <Text style={styles.rowName}>{item.program.name}</Text>
                  {item.program.is_active === 1 && <Text style={styles.activeTag}>Active</Text>}
                </View>
                <Text style={styles.rowMeta}>
                  {item.days.length} {item.days.length === 1 ? 'day' : 'days'}
                </Text>
              </View>
              {item.program.is_active !== 1 && (
                <Pressable
                  onPress={() => void handleSetActive(item.program.id)}
                  style={styles.setActiveButton}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={styles.setActiveText}>Set active</Text>
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    ...type.h1,
    color: colors.text,
  },
  newButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  newButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  emptyHint: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.xl,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: minTouchTarget,
  },
  rowMain: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowName: {
    ...type.bodyStrong,
    color: colors.text,
  },
  activeTag: {
    ...type.sectionLabel,
    color: colors.accent,
  },
  rowMeta: {
    ...type.caption,
    color: colors.textTertiary,
  },
  setActiveButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  setActiveText: {
    ...type.caption,
    color: colors.accent,
  },
});
