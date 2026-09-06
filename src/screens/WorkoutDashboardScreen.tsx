// ═══════════════════════════════════════════════════════════════════════
// WorkoutDashboardScreen — strength-training analytics ("Progress" from
// the Train tab). A dedicated screen rather than folding this into
// WorkoutHomeScreen: PRD §10's 10-second test says the FIRST thing the
// Train tab shows must stay "Start workout" plus recent history, one tap
// away with nothing analytical in front of it — exactly the same reason
// Today and Trends are separate tabs on the nutrition side rather than one
// screen. A "Progress" button on WorkoutHomeScreen (kept there, in the
// file this task owns) is the one extra tap to get here.
//
// Data-fetch note — the session list's known N+1 (one getSetsForSession
// call per session, task brief) is NOT reproduced here. Instead this
// fetches every exercise actually used (workoutRepo.getRecentlyUsedExerciseIds,
// bounded by the exercise LIBRARY size — currently 22 seeded + however
// many custom, which grows far slower than session count) and pulls each
// exercise's full cross-session history in one call
// (workoutRepo.getSetsForExercise already joins in session.date). Every
// workout_set row in the app is reachable this way, since every set
// belongs to exactly one exercise. That converts the query cost from
// O(sessions logged so far) — unbounded, growing every single workout —
// to O(distinct exercises ever used) — small and slow-growing. It is
// still technically N queries, not 1, because no repo function currently
// returns "every set, joined to its session" in a single call; adding one
// would mean editing src/db/repositories, which is out of this task's
// scope (constraints: "repos have what you need — report if genuinely
// not"). Reported: a single `getAllSetsWithSessionDate` repo function
// would let this (and WorkoutHomeScreen's existing N+1) collapse to one
// query; worth adding next time src/db/ is in scope.
//
// Drop-set segments (schema v7): a parallel `workoutRepo.getSegmentsForExercise`
// call is batched in alongside `getSetsForExercise`, one per used exercise
// — same O(distinct exercises) bound, not O(sessions). Every stat below
// that derives volume or set counts (`computeHeadlineStats`,
// `buildSessionVolumeSeries`, `computeMuscleGroupBalance`) is fed the
// attached `segments` array so `computeVolume` (./lib/training/volume)
// sums every drop/myo-rep/partials segment, not just the parent set's top
// weight — see workoutActions.ts / volume.ts for why counting only the
// parent silently halves a drop set's true volume.
//
// The window selector (4wk/12wk/all) scopes ONLY the headline stats and
// the volume-over-time chart — both are explicitly "over a selectable
// window" per the task brief. Exercise progression and muscle-group
// balance intentionally ignore it and always reflect full history: a
// "first vs latest" comparison or a "which regions are neglected" read is
// naturally a whole-history question, and windowing them would make
// exercise cards inconsistently appear/disappear as the user flips the
// selector. A closing footnote states this split explicitly.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as workoutRepo from '../db/repositories/workoutRepo';
import * as workoutExerciseRepo from '../db/repositories/workoutExerciseRepo';
import type { ExerciseRow, WorkoutSessionRow } from '../db/types';
import type { WorkoutSetWithDate } from '../db/repositories/workoutRepo';
import type { SetSegmentForVolume } from '../lib/training/volume';
import { todayLocalISO } from '../lib/localDate';
import { DASHBOARD_WINDOW_OPTIONS, windowStartDate, isWithinWindow, type DashboardWindow } from '../lib/training/dashboardWindow';
import { computeHeadlineStats } from '../lib/training/dashboardStats';
import { buildSessionVolumeSeries } from '../lib/training/sessionVolumeSeries';
import { computeMuscleGroupBalance } from '../lib/training/muscleGroupBalance';
import { selectTopExercises } from '../lib/training/exerciseSelection';
import { computeExerciseProgression } from '../lib/training/progression';
import { WindowSelector } from '../components/training/WindowSelector';
import { DashboardHeadlineStats } from '../components/training/DashboardHeadlineStats';
import { SessionVolumeChart } from '../components/training/SessionVolumeChart';
import { MuscleGroupBalanceChart } from '../components/training/MuscleGroupBalanceChart';
import { ExerciseProgressionPanel, type ExerciseProgressionItem } from '../components/training/ExerciseProgressionPanel';

const MAX_PROGRESSION_EXERCISES = 6;

type DashboardData = {
  sessions: WorkoutSessionRow[];
  sets: WorkoutSetWithDate[];
  exercisesById: Map<string, ExerciseRow>;
  /** Drop/myo-rep/partials segments (schema v7), keyed by parent workout_set.id — see file header. */
  segmentsBySetId: Record<string, SetSegmentForVolume[]>;
};

const EMPTY_DATA: DashboardData = { sessions: [], sets: [], exercisesById: new Map(), segmentsBySetId: {} };

export function WorkoutDashboardScreen() {
  const insets = useSafeAreaInsets();
  const [selectedWindow, setSelectedWindow] = useState<DashboardWindow>('12w');
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const db = await getDatabase();

    // Batched: bounded by exercise-library size, not by session count — see file header.
    const [sessions, exercises, usedExerciseIds] = await Promise.all([
      workoutRepo.listSessions(db),
      workoutExerciseRepo.listExercises(db),
      workoutRepo.getRecentlyUsedExerciseIds(db, 500),
    ]);
    const [setsByExercise, segmentsByExercise] = await Promise.all([
      Promise.all(usedExerciseIds.map((id) => workoutRepo.getSetsForExercise(db, id))),
      Promise.all(usedExerciseIds.map((id) => workoutRepo.getSegmentsForExercise(db, id))),
    ]);
    const sets = setsByExercise.flat();
    const exercisesById = new Map(exercises.map((e) => [e.id, e]));

    const segmentsBySetId: Record<string, SetSegmentForVolume[]> = {};
    for (const segment of segmentsByExercise.flat()) {
      (segmentsBySetId[segment.workout_set_id] ??= []).push({ weight_kg: segment.weight_kg, reps: segment.reps });
    }

    setData({ sessions, sets, exercisesById, segmentsBySetId });
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const derived = useMemo(() => {
    const todayISO = todayLocalISO();
    const windowStart = windowStartDate(selectedWindow, todayISO);

    const sessionsInWindow = data.sessions.filter((s) => isWithinWindow(s.date, windowStart, todayISO));
    const sessionIdsInWindow = new Set(sessionsInWindow.map((s) => s.id));
    const setsInWindow = data.sets.filter((s) => sessionIdsInWindow.has(s.session_id));

    const headlineStats = computeHeadlineStats(
      data.sets.map((s) => ({
        sessionId: s.session_id,
        weight_kg: s.weight_kg,
        reps: s.reps,
        is_warmup: s.is_warmup,
        segments: data.segmentsBySetId[s.id] ?? [],
      })),
      data.sessions,
      windowStart,
      todayISO
    );

    const volumeSeries = buildSessionVolumeSeries(
      sessionsInWindow.map((s) => ({ id: s.id, date: s.date, name: s.name })),
      setsInWindow.map((s) => ({
        sessionId: s.session_id,
        weight_kg: s.weight_kg,
        reps: s.reps,
        is_warmup: s.is_warmup,
        segments: data.segmentsBySetId[s.id] ?? [],
      }))
    );

    // Muscle-group balance and exercise progression: full history, not window-scoped — see file header.
    const muscleBalance = computeMuscleGroupBalance(
      data.sets.map((s) => ({
        weight_kg: s.weight_kg,
        reps: s.reps,
        is_warmup: s.is_warmup,
        segments: data.segmentsBySetId[s.id] ?? [],
        category: data.exercisesById.get(s.exercise_id)?.category ?? null,
      }))
    );

    const setsByExerciseId = new Map<string, WorkoutSetWithDate[]>();
    for (const s of data.sets) {
      const bucket = setsByExerciseId.get(s.exercise_id);
      if (bucket) bucket.push(s);
      else setsByExerciseId.set(s.exercise_id, [s]);
    }

    const topExerciseIds = selectTopExercises(
      data.sets.map((s) => ({ exerciseId: s.exercise_id, sessionId: s.session_id, is_warmup: s.is_warmup })),
      MAX_PROGRESSION_EXERCISES
    );

    const progressionItems: ExerciseProgressionItem[] = topExerciseIds.map((exerciseId) => ({
      exerciseId,
      exerciseName: data.exercisesById.get(exerciseId)?.name ?? 'Unknown exercise',
      progression: computeExerciseProgression(setsByExerciseId.get(exerciseId) ?? []),
    }));

    return { headlineStats, volumeSeries, muscleBalance, progressionItems };
  }, [data, selectedWindow]);

  const windowLabel = DASHBOARD_WINDOW_OPTIONS.find((o) => o.value === selectedWindow)?.label ?? '';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.header}>Progress</Text>

        {!loaded ? (
          <Text style={styles.loading}>Loading…</Text>
        ) : (
          <>
            <WindowSelector value={selectedWindow} onChange={setSelectedWindow} />
            <DashboardHeadlineStats stats={derived.headlineStats} windowLabel={windowLabel} />
            <SessionVolumeChart series={derived.volumeSeries} />
            <ExerciseProgressionPanel items={derived.progressionItems} />
            <MuscleGroupBalanceChart balance={derived.muscleBalance} />

            <Text style={styles.footnote}>
              The window above (4 wks / 12 wks / all time) scopes headline stats and volume-over-time only. Exercise
              progression and muscle-group balance always reflect your full training history — a "first vs latest"
              comparison and "what's neglected" read are whole-history questions, not windowed ones. A missed week
              is neutral here, same as everywhere else in this app — nothing on this screen tracks a streak.
            </Text>
          </>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: spacing.lg,
  },
  header: {
    ...type.h1,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  loading: {
    ...type.body,
    color: colors.textTertiary,
    paddingHorizontal: spacing.lg,
  },
  footnote: {
    ...type.caption,
    color: colors.textTertiary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  bottomPadding: {
    height: 48,
  },
});
