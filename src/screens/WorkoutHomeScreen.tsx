// ═══════════════════════════════════════════════════════════════════════
// WorkoutHomeScreen — the Train tab root: "Start workout" plus a
// chronological history of past sessions.
//
// Starting a workout immediately creates a workout_session row and
// navigates straight into WorkoutSessionScreen — there is no separate
// "new session" form to fill in first (PRD §10's 10-second test applies
// to the gym as much as the kitchen: the first tap should start logging,
// not open a form).
//
// The analytics dashboard (headline stats, volume-over-time, per-exercise
// progression, muscle-group balance) lives on its own screen
// (WorkoutDashboardScreen), reached via the "Progress" link below, rather
// than being folded into this one — the same 10-second-test reasoning:
// this screen's first job is getting a live workout started, and stacking
// several analytics panels above that button would put real distance
// between opening the Train tab and the first tap that matters.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, type, minTouchTarget } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as workoutRepo from '../db/repositories/workoutRepo';
import type { WorkoutSessionRow } from '../db/types';
import { startNewSession } from '../lib/training/workoutActions';
import { computeSessionSummary, type SessionSummary } from '../lib/training/volume';
import { todayLocalISO } from '../lib/localDate';
import { relativeDayLabel } from '../lib/localDate';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type SessionListItem = {
  session: WorkoutSessionRow;
  summary: SessionSummary;
};

const HISTORY_LIMIT = 50;

export function WorkoutHomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<SessionListItem[]>([]);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const sessions = await workoutRepo.listSessions(db, HISTORY_LIMIT);
    const withSummaries = await Promise.all(
      sessions.map(async (session) => {
        const [sets, segments] = await Promise.all([
          workoutRepo.getSetsForSession(db, session.id),
          workoutRepo.getSegmentsForSession(db, session.id),
        ]);
        // Drop/myo-rep/partials segments count toward this history row's
        // volume too (schema v7) — grouped by parent set id, same
        // one-query-per-session pattern as WorkoutSessionScreen.
        const segmentsByParent: Record<string, { weight_kg: number; reps: number }[]> = {};
        for (const segment of segments) {
          (segmentsByParent[segment.workout_set_id] ??= []).push({ weight_kg: segment.weight_kg, reps: segment.reps });
        }
        const summary = computeSessionSummary(
          sets.map((s) => ({
            exercise_id: s.exercise_id,
            weight_kg: s.weight_kg,
            reps: s.reps,
            is_warmup: s.is_warmup,
            segments: segmentsByParent[s.id] ?? [],
          }))
        );
        return { session, summary };
      })
    );
    setItems(withSummaries);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleStart = async () => {
    setStarting(true);
    try {
      const db = await getDatabase();
      const session = await startNewSession(db, todayLocalISO());
      navigation.navigate('WorkoutSession', { sessionId: session.id });
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Train</Text>
        <Pressable onPress={() => void handleStart()} disabled={starting} style={styles.startButton} accessibilityRole="button">
          <Text style={styles.startButtonText}>{starting ? 'Starting…' : 'Start workout'}</Text>
        </Pressable>
      </View>

      <View style={styles.linkRow}>
        <Pressable
          onPress={() => navigation.navigate('Programs')}
          style={styles.progressLink}
          accessibilityRole="button"
        >
          <Text style={styles.progressLinkText}>Programs →</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('WorkoutDashboard')}
          style={styles.progressLink}
          accessibilityRole="button"
        >
          <Text style={styles.progressLinkText}>View progress →</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <Text style={styles.emptyHint}>
          No sessions yet. Tap "Start workout" to log your first lift — sets, reps, and weight, nothing else required.
        </Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.session.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => navigation.navigate('WorkoutSession', { sessionId: item.session.id })}
              style={styles.sessionRow}
              accessibilityRole="button"
            >
              <View style={styles.sessionRowMain}>
                <Text style={styles.sessionDate}>{relativeDayLabel(item.session.date)}</Text>
                <Text style={styles.sessionName}>{item.session.name ?? 'Session'}</Text>
              </View>
              <View style={styles.sessionRowStats}>
                <Text style={styles.sessionStat}>{Math.round(item.summary.totalVolume).toLocaleString()} kg volume</Text>
                <Text style={styles.sessionStatSecondary}>
                  {item.summary.workingSetCount} sets · {item.summary.exerciseCount} exercises
                </Text>
              </View>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  title: {
    ...type.h1,
    color: colors.text,
  },
  startButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  startButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  emptyHint: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.xl,
  },
  linkRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  progressLink: {
    minHeight: minTouchTarget * 0.6,
    justifyContent: 'center',
  },
  progressLinkText: {
    ...type.body,
    color: colors.accent,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: minTouchTarget,
  },
  sessionRowMain: {
    flex: 1,
  },
  sessionDate: {
    ...type.caption,
    color: colors.textTertiary,
  },
  sessionName: {
    ...type.bodyStrong,
    color: colors.text,
  },
  sessionRowStats: {
    alignItems: 'flex-end',
  },
  sessionStat: {
    ...type.body,
    ...numeric,
    color: colors.text,
  },
  sessionStatSecondary: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
  },
});
