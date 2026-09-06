// ═══════════════════════════════════════════════════════════════════════
// ProgramDetailScreen — one program's days, in order. "Start" on a day
// creates a workout_session tagged with that program_day_id and jumps
// straight into WorkoutSessionScreen (task brief: "Pick a program -> see
// its days -> start the next one" — there is no extra form in between,
// same immediate-start philosophy as WorkoutHomeScreen's ad-hoc "Start
// workout"). Tapping a day row (rather than its Start button) opens
// ProgramDayScreen to edit its exercise prescriptions.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as programRepo from '../db/repositories/programRepo';
import { startSessionFromProgramDay } from '../lib/training/programActions';
import type { ProgramRow, ProgramDayRow, ProgramExerciseRow } from '../db/types';
import { todayLocalISO } from '../lib/localDate';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ProgramDetail'>;
type Route = RouteProp<RootStackParamList, 'ProgramDetail'>;

type DayListItem = {
  day: ProgramDayRow;
  exercises: ProgramExerciseRow[];
};

export function ProgramDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { programId } = route.params;

  const [program, setProgram] = useState<ProgramRow | null>(null);
  const [days, setDays] = useState<DayListItem[]>([]);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const programRow = await programRepo.getProgram(db, programId);
    setProgram(programRow);
    const dayRows = await programRepo.listDaysForProgram(db, programId);
    const withExercises = await Promise.all(
      dayRows.map(async (day) => ({ day, exercises: await programRepo.listExercisesForDay(db, day.id) }))
    );
    setDays(withExercises);
  }, [programId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleStartDay = async (dayId: string) => {
    setStarting(true);
    try {
      const db = await getDatabase();
      const session = await startSessionFromProgramDay(db, dayId, todayLocalISO());
      navigation.navigate('WorkoutSession', { sessionId: session.id });
    } finally {
      setStarting(false);
    }
  };

  const handleMoveDay = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= days.length) return;
    const reordered = [...days];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    const db = await getDatabase();
    await programRepo.reorderProgramDays(db, reordered.map((d) => d.day.id));
    await load();
  };

  if (!program) return <View style={styles.screen} />;

  return (
    <View style={styles.screen}>
      <View style={styles.headerBlock}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{program.name}</Text>
          <Pressable onPress={() => navigation.navigate('ProgramForm', { id: program.id })} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.editLink}>Edit</Text>
          </Pressable>
        </View>
        {program.description && <Text style={styles.description}>{program.description}</Text>}
      </View>

      {days.length === 0 ? (
        <Text style={styles.emptyHint}>No days yet — add one to start prescribing exercises.</Text>
      ) : (
        <FlatList
          data={days}
          keyExtractor={(item) => item.day.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <View style={styles.dayRow}>
              <Pressable
                onPress={() => navigation.navigate('ProgramDay', { programId, dayId: item.day.id })}
                style={styles.dayMain}
                accessibilityRole="button"
              >
                <Text style={styles.dayLabel}>{item.day.label}</Text>
                <Text style={styles.dayMeta}>
                  {item.exercises.length} {item.exercises.length === 1 ? 'exercise' : 'exercises'}
                </Text>
              </Pressable>

              <View style={styles.reorderColumn}>
                <Pressable onPress={() => void handleMoveDay(index, -1)} disabled={index === 0} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Move ${item.day.label} earlier`}>
                  <Text style={[styles.reorderArrow, index === 0 && styles.reorderArrowDisabled]}>▲</Text>
                </Pressable>
                <Pressable onPress={() => void handleMoveDay(index, 1)} disabled={index === days.length - 1} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Move ${item.day.label} later`}>
                  <Text style={[styles.reorderArrow, index === days.length - 1 && styles.reorderArrowDisabled]}>▼</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => void handleStartDay(item.day.id)}
                disabled={starting || item.exercises.length === 0}
                style={[styles.startButton, item.exercises.length === 0 && styles.startButtonDisabled]}
                accessibilityRole="button"
              >
                <Text style={styles.startButtonText}>Start</Text>
              </Pressable>
            </View>
          )}
        />
      )}

      <Pressable
        onPress={() => navigation.navigate('ProgramDayForm', { programId })}
        style={styles.addDayButton}
        accessibilityRole="button"
      >
        <Text style={styles.addDayText}>+ Add day</Text>
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
  headerBlock: {
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...type.h1,
    color: colors.text,
  },
  editLink: {
    ...type.body,
    color: colors.accent,
  },
  description: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  emptyHint: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: minTouchTarget,
  },
  dayMain: {
    flex: 1,
  },
  dayLabel: {
    ...type.bodyStrong,
    color: colors.text,
  },
  dayMeta: {
    ...type.caption,
    color: colors.textTertiary,
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
  startButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    minHeight: minTouchTarget * 0.8,
    justifyContent: 'center',
  },
  startButtonDisabled: {
    backgroundColor: colors.surfaceAlt,
  },
  startButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  addDayButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  addDayText: {
    ...type.bodyStrong,
    color: colors.accent,
  },
});
