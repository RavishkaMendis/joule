// ═══════════════════════════════════════════════════════════════════════
// WorkoutExercisePickerScreen — search/select from the exercise library,
// or add a custom one when the search comes up empty. Hands its selection
// back to WorkoutSessionScreen via route params rather than a prop
// callback (see navigation.ts's WorkoutSession.addExerciseId doc).
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, minTouchTarget, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as workoutExerciseRepo from '../db/repositories/workoutExerciseRepo';
import * as workoutRepo from '../db/repositories/workoutRepo';
import { addCustomExercise } from '../lib/training/workoutActions';
import type { ExerciseRow } from '../db/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'WorkoutExercisePicker'>;
type Route = RouteProp<RootStackParamList, 'WorkoutExercisePicker'>;

export function WorkoutExercisePickerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { sessionId } = route.params;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExerciseRow[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDatabase();
      setRecentIds(await workoutRepo.getRecentlyUsedExerciseIds(db, 6));
    })();
  }, []);

  const search = useCallback(async (text: string) => {
    const db = await getDatabase();
    setResults(await workoutExerciseRepo.searchExercises(db, text));
  }, []);

  useEffect(() => {
    void search(query);
  }, [query, search]);

  const selectExercise = (exerciseId: string) => {
    navigation.navigate('WorkoutSession', { sessionId, addExerciseId: exerciseId });
  };

  const handleAddCustom = async () => {
    const name = query.trim();
    if (name.length === 0) return;
    setAdding(true);
    try {
      const db = await getDatabase();
      const exercise = await addCustomExercise(db, name);
      selectExercise(exercise.id);
    } finally {
      setAdding(false);
    }
  };

  const recentExercises = results.filter((e) => recentIds.includes(e.id)).sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
  const exactNameExists = results.some((e) => e.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <View style={styles.screen}>
      <TextInput
        style={styles.searchInput}
        value={query}
        onChangeText={setQuery}
        placeholder="Search exercises…"
        placeholderTextColor={colors.textTertiary}
        autoFocus
      />

      {query.trim().length === 0 && recentExercises.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recent</Text>
          {recentExercises.map((exercise) => (
            <ExerciseRowItem key={exercise.id} exercise={exercise} onPress={() => selectExercise(exercise.id)} />
          ))}
        </View>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ExerciseRowItem exercise={item} onPress={() => selectExercise(item.id)} />}
        ListHeaderComponent={query.trim().length > 0 ? <Text style={styles.sectionLabel}>Results</Text> : null}
        ListEmptyComponent={<Text style={styles.emptyHint}>No matches — add it as a custom exercise below.</Text>}
        contentContainerStyle={styles.listContent}
      />

      {query.trim().length > 0 && !exactNameExists && (
        <Pressable onPress={() => void handleAddCustom()} disabled={adding} style={styles.addCustomButton} accessibilityRole="button">
          <Text style={styles.addCustomText}>{adding ? 'Adding…' : `+ Add "${query.trim()}" as a custom exercise`}</Text>
        </Pressable>
      )}
    </View>
  );
}

function ExerciseRowItem({ exercise, onPress }: { exercise: ExerciseRow; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row} accessibilityRole="button">
      <Text style={styles.rowName}>{exercise.name}</Text>
      <Text style={styles.rowMeta}>
        {[exercise.category, exercise.equipment].filter(Boolean).join(' · ')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  searchInput: {
    ...type.h2,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionLabel: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginBottom: spacing.xs,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  row: {
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowName: {
    ...type.body,
    color: colors.text,
  },
  rowMeta: {
    ...type.small,
    color: colors.textTertiary,
  },
  emptyHint: {
    ...type.body,
    color: colors.textSecondary,
    paddingVertical: spacing.md,
  },
  addCustomButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  addCustomText: {
    ...type.bodyStrong,
    color: colors.accent,
  },
});
