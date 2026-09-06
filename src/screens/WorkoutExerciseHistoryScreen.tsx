// ═══════════════════════════════════════════════════════════════════════
// WorkoutExerciseHistoryScreen — per-exercise best-set progression across
// every session it's been logged in. This is the "progression, done
// honestly" surface the task calls for: best set + estimated 1RM (with
// its own confidence, since a 1RM from a set of 12 is not the same claim
// as one from a triple) per session, and a % change whose basis is
// spelled out in the footnote exactly like the reference dashboard the
// user pointed to ("% change compares best-set weight, not reps").
//
// Newest session first (a history view), unlike progression.ts's
// internal chronological-ascending order — that ordering is what the math
// (latest-vs-previous) needs, this is what a reader wants to see.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as workoutRepo from '../db/repositories/workoutRepo';
import { computeExerciseProgression, type BestSetForSession, type ExerciseProgression } from '../lib/training/progression';
import { OneRepMaxBadge } from '../components/training/OneRepMaxBadge';
import { TrendBadge } from '../components/training/TrendBadge';
import { relativeDayLabel } from '../lib/localDate';

type Route = RouteProp<RootStackParamList, 'WorkoutExerciseHistory'>;

/** Weight-only % change between two consecutive history entries — null when the earlier entry has no weight basis (bodyweight exercise). Same basis/guard as progression.ts's overall percentChangeVsPrevious. */
function percentChangeBetween(previous: BestSetForSession, current: BestSetForSession): number | null {
  if (previous.weightKg === 0) return null;
  return ((current.weightKg - previous.weightKg) / previous.weightKg) * 100;
}

export function WorkoutExerciseHistoryScreen() {
  const route = useRoute<Route>();
  const { exerciseId, exerciseName } = route.params;
  const [progression, setProgression] = useState<ExerciseProgression | null>(null);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const history = await workoutRepo.getSetsForExercise(db, exerciseId);
    setProgression(
      computeExerciseProgression(
        history.map((h) => ({ session_id: h.session_id, date: h.date, weight_kg: h.weight_kg, reps: h.reps, is_warmup: h.is_warmup, logged_at: h.logged_at }))
      )
    );
  }, [exerciseId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!progression) return <View style={styles.screen} />;

  const newestFirst = [...progression.history].reverse();

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{exerciseName}</Text>

      {progression.history.length > 0 && (
        <View style={styles.trendRow}>
          <TrendBadge progression={progression} />
        </View>
      )}

      {progression.history.length === 0 ? (
        <Text style={styles.emptyHint}>No sets logged for this exercise yet.</Text>
      ) : (
        <FlatList
          data={newestFirst}
          keyExtractor={(item) => item.sessionId}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => {
            const previous = newestFirst[index + 1]; // chronologically earlier, since list is newest-first
            const change = previous ? percentChangeBetween(previous, item) : null;
            return (
              <View style={styles.row}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowDate}>{relativeDayLabel(item.date)}</Text>
                  {change !== null && (
                    <Text style={styles.rowChange}>
                      {change > 0 ? '+' : change < 0 ? '−' : ''}
                      {Math.abs(change).toFixed(1)}%
                    </Text>
                  )}
                </View>
                <Text style={styles.rowMain}>
                  {item.weightKg}kg × {item.reps}
                </Text>
                <OneRepMaxBadge estimate={item.estimatedOneRepMax} />
              </View>
            );
          }}
          ListFooterComponent={
            <Text style={styles.footnote}>
              % change compares best-set weight, not reps or volume. Estimated 1RM uses the Epley formula and is shown with its
              own confidence — a set of 12 is a rougher estimate than a set of 3.
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  title: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  trendRow: {
    marginBottom: spacing.md,
  },
  emptyHint: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowDate: {
    ...type.caption,
    color: colors.textTertiary,
  },
  rowChange: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  rowMain: {
    ...type.h2,
    ...numeric,
    color: colors.text,
  },
  footnote: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.lg,
  },
});
