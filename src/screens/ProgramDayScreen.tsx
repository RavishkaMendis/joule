// ═══════════════════════════════════════════════════════════════════════
// ProgramDayScreen — one program day's prescribed exercises, in order.
// Add/reorder/edit/delete here; a session's own pre-populated exercise
// list (WorkoutSessionScreen) reads this same program_exercise table
// directly and never duplicates it.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as programRepo from '../db/repositories/programRepo';
import * as workoutExerciseRepo from '../db/repositories/workoutExerciseRepo';
import type { ProgramDayRow, ProgramExerciseRow } from '../db/types';
import { formatTarget } from '../lib/training/targetFormat';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ProgramDay'>;
type Route = RouteProp<RootStackParamList, 'ProgramDay'>;

type ExerciseListItem = {
  programExercise: ProgramExerciseRow;
  exerciseName: string;
};

export function ProgramDayScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { programId, dayId } = route.params;

  const [day, setDay] = useState<ProgramDayRow | null>(null);
  const [items, setItems] = useState<ExerciseListItem[]>([]);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const dayRow = await programRepo.getProgramDay(db, dayId);
    setDay(dayRow);
    const exercises = await programRepo.listExercisesForDay(db, dayId);
    const withNames = await Promise.all(
      exercises.map(async (pe) => {
        const exercise = await workoutExerciseRepo.getExercise(db, pe.exercise_id);
        return { programExercise: pe, exerciseName: exercise?.name ?? 'Unknown exercise' };
      })
    );
    setItems(withNames);
  }, [dayId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleMoveExercise = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const db = await getDatabase();
    await programRepo.reorderProgramExercises(db, reordered.map((i) => i.programExercise.id));
    await load();
  };

  if (!day) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{day.label}</Text>
        <Pressable onPress={() => navigation.navigate('ProgramDayForm', { programId, dayId })} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.editLink}>Rename</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <Text style={styles.emptyHint}>No exercises yet — add one below.</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.programExercise.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <View style={styles.row}>
              <Pressable
                onPress={() => navigation.navigate('ProgramExerciseForm', { programDayId: dayId, programExerciseId: item.programExercise.id })}
                style={styles.rowMain}
                accessibilityRole="button"
              >
                <Text style={styles.exerciseName}>{item.exerciseName}</Text>
                <Text style={styles.targetLine}>
                  {formatTarget({
                    targetSets: item.programExercise.target_sets,
                    prescriptionType: item.programExercise.prescription_type,
                    repLow: item.programExercise.rep_low,
                    repHigh: item.programExercise.rep_high,
                    targetRir: item.programExercise.target_rir,
                  })}
                </Text>
              </Pressable>

              <View style={styles.reorderColumn}>
                <Pressable onPress={() => void handleMoveExercise(index, -1)} disabled={index === 0} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Move ${item.exerciseName} earlier`}>
                  <Text style={[styles.reorderArrow, index === 0 && styles.reorderArrowDisabled]}>▲</Text>
                </Pressable>
                <Pressable onPress={() => void handleMoveExercise(index, 1)} disabled={index === items.length - 1} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Move ${item.exerciseName} later`}>
                  <Text style={[styles.reorderArrow, index === items.length - 1 && styles.reorderArrowDisabled]}>▼</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <Pressable
        onPress={() => navigation.navigate('ProgramExerciseForm', { programDayId: dayId })}
        style={styles.addButton}
        accessibilityRole="button"
      >
        <Text style={styles.addButtonText}>+ Add exercise</Text>
      </Pressable>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    ...type.h1,
    color: colors.text,
  },
  editLink: {
    ...type.body,
    color: colors.accent,
  },
  emptyHint: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: minTouchTarget,
  },
  rowMain: {
    flex: 1,
  },
  exerciseName: {
    ...type.bodyStrong,
    color: colors.text,
  },
  targetLine: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  reorderColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  reorderArrow: {
    ...type.small,
    color: colors.textSecondary,
    padding: 2,
  },
  reorderArrowDisabled: {
    color: colors.border,
  },
  addButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  addButtonText: {
    ...type.bodyStrong,
    color: colors.accent,
  },
});
