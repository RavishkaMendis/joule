// ═══════════════════════════════════════════════════════════════════════
// WorkoutSessionScreen — the active/edit logging screen. One screen
// serves both "logging live at the gym right now" and "editing a session
// from three weeks ago" (PRD §10: everything editable forever) — there is
// no separate read-only history view for a past session, since every
// field here (name, notes, sets) stays editable regardless of date.
//
// Exercises appear here from two sources, merged in
// `activeExerciseIds` below: (1) any exercise that already has at least
// one set logged in this session (derived from the sets themselves via
// groupSetsByExercise — no separate join table needed), and (2) an
// exercise just added via WorkoutExercisePickerScreen but with no set
// logged yet, tracked in local `pendingExerciseIds` state until its first
// set makes it "real" via (1). The picker hands its selection back
// through route.params.addExerciseId (react-navigation's
// navigate-to-an-existing-screen-in-the-stack pattern), consumed once via
// a ref guard so re-focusing this screen doesn't re-add it.
//
// PROGRAM-FOLLOWING SESSIONS (schema v7, task brief "training program /
// template system"): when `session.program_day_id` is set, a THIRD,
// higher-priority source of exercises is added — every program_exercise
// prescribed for that day, always rendered regardless of whether a set
// (or even a pending pick) exists yet, so the session is pre-populated
// "with that day's exercises in order, each carrying its targets" the
// moment it's created. These render with a `target` (fed to
// ProgramTargetHeader, shown above the ordinary ExerciseCard) and are
// de-duplicated out of the ad-hoc groupedIds/pendingExerciseIds merge
// below so nothing ever renders twice. An in-session substitution swap
// (task brief) is purely local state (`pendingSwaps`, programExerciseId
// -> exerciseId) resolved via src/lib/training/programSession.ts's pure
// `resolveSlotExerciseId` — nothing is written anywhere until the user
// actually logs a set, at which point the logged workout_set.exercise_id
// IS the record of what was substituted (see that module's header). An
// ad-hoc (no-program) session is completely unaffected by any of this —
// same code path it always had, zero added taps.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as workoutRepo from '../db/repositories/workoutRepo';
import * as workoutExerciseRepo from '../db/repositories/workoutExerciseRepo';
import * as programRepo from '../db/repositories/programRepo';
import * as workoutActions from '../lib/training/workoutActions';
import type { ExerciseRow, WorkoutSessionRow, WorkoutSetRow, WorkoutSetSegmentRow } from '../db/types';
import { generateId } from '../lib/ids';
import { groupSetsByExercise } from '../lib/training/sessionView';
import { computeExerciseProgression, type ExerciseProgression, type TrainingSet } from '../lib/training/progression';
import { computeSessionSummary, type SessionSummary } from '../lib/training/volume';
import { planSessionFromProgramDay, resolveSlotExerciseId, type ProgramExerciseTarget } from '../lib/training/programSession';
import { suggestProgression, type ProgressionSuggestion } from '../lib/training/progressionSuggestion';
import { ExerciseCard, type SetDraft, type WeightRepsPrefill } from '../components/training/ExerciseCard';
import { ProgramTargetHeader, type SubstituteChip } from '../components/training/ProgramTargetHeader';
import { RestTimer } from '../components/training/RestTimer';

type Nav = NativeStackNavigationProp<RootStackParamList, 'WorkoutSession'>;
type Route = RouteProp<RootStackParamList, 'WorkoutSession'>;

type ExerciseState = {
  exercise: ExerciseRow;
  sets: WorkoutSetRow[];
  prefill: WeightRepsPrefill | null;
  lastTime: WorkoutSetRow | null;
  progression: ExerciseProgression;
  /** Set only for a program-prescribed slot (see file header). Null for every ad-hoc exercise. */
  target: ProgramExerciseTarget | null;
  programExerciseId: string | null;
  substitutes: SubstituteChip[];
  suggestion: ProgressionSuggestion | null;
};

function toTrainingSets(rows: (WorkoutSetRow & { date: string })[]): TrainingSet[] {
  return rows.map((r) => ({
    session_id: r.session_id,
    date: r.date,
    weight_kg: r.weight_kg,
    reps: r.reps,
    is_warmup: r.is_warmup,
    logged_at: r.logged_at,
  }));
}

export function WorkoutSessionScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { sessionId } = route.params;

  const [session, setSession] = useState<WorkoutSessionRow | null>(null);
  const [exerciseStates, setExerciseStates] = useState<ExerciseState[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  /** Drop/myo-rep/partials segments (schema v7), keyed by parent workout_set.id — fetched once per load in one query (workoutRepo.getSegmentsForSession) rather than per-set. */
  const [segmentsBySetId, setSegmentsBySetId] = useState<Record<string, WorkoutSetSegmentRow[]>>({});
  const [nameDraft, setNameDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [restSignal, setRestSignal] = useState(0);
  const [pendingExerciseIds, setPendingExerciseIds] = useState<string[]>([]);
  /** In-session-only substitution choices, not yet backed by a logged set. programExerciseId -> chosen exerciseId. See file header. */
  const [pendingSwaps, setPendingSwaps] = useState<Record<string, string>>({});
  const lastAddedRef = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const sessionRow = await workoutRepo.getSession(db, sessionId);
    if (!sessionRow) return;
    setSession(sessionRow);
    setNameDraft(sessionRow.name ?? '');
    setNotesDraft(sessionRow.notes ?? '');

    const sets = await workoutRepo.getSetsForSession(db, sessionId);

    // Drop/myo-rep/partials segments for every set in this session, in
    // one query — grouped by parent set id so computeSessionSummary (and
    // ExerciseCard's rendering below) can include every segment's
    // contribution, not just each set's own top weight/reps (schema v7 —
    // see volume.ts's header for why this matters for this training
    // style specifically).
    const sessionSegments = await workoutRepo.getSegmentsForSession(db, sessionId);
    const segmentsByParent: Record<string, WorkoutSetSegmentRow[]> = {};
    for (const segment of sessionSegments) {
      (segmentsByParent[segment.workout_set_id] ??= []).push(segment);
    }
    setSegmentsBySetId(segmentsByParent);

    setSummary(
      computeSessionSummary(
        sets.map((s) => ({
          exercise_id: s.exercise_id,
          weight_kg: s.weight_kg,
          reps: s.reps,
          is_warmup: s.is_warmup,
          segments: (segmentsByParent[s.id] ?? []).map((seg) => ({ weight_kg: seg.weight_kg, reps: seg.reps })),
        }))
      )
    );

    const groups = groupSetsByExercise(sets);
    const groupedIds = groups.map((g) => g.exerciseId);

    // ─── Program-prescribed slots (task brief: pre-populated, in order,
    // each carrying its targets) — see file header for the full design.
    let programSlotStates: ExerciseState[] = [];
    let slotResolvedIds: string[] = [];
    if (sessionRow.program_day_id) {
      const programExercises = await programRepo.listExercisesForDay(db, sessionRow.program_day_id);
      const plan = planSessionFromProgramDay(programExercises);
      const substitutionsBySlot = await Promise.all(
        programExercises.map((pe) => programRepo.listSubstitutionsForExercise(db, pe.id))
      );

      const slotResolutions = plan.map((target, i) => {
        const subs = substitutionsBySlot[i] ?? [];
        const subIds = subs.map((s) => s.exercise_id);
        const resolvedId = resolveSlotExerciseId(
          { exerciseId: target.exerciseId },
          subIds,
          groupedIds,
          pendingSwaps[target.programExerciseId] ?? null
        );
        return { target, subs, resolvedId };
      });
      slotResolvedIds = slotResolutions.map((r) => r.resolvedId);

      const resolved = await Promise.all(
        slotResolutions.map(async ({ target, subs, resolvedId }): Promise<ExerciseState | null> => {
          const exercise = await workoutExerciseRepo.getExercise(db, resolvedId);
          if (!exercise) return null;
          const setsForThisExercise = groups.find((g) => g.exerciseId === resolvedId)?.sets ?? [];
          const [prefill, lastTime, history, substituteNames] = await Promise.all([
            workoutActions.getPrefillForExercise(db, resolvedId),
            workoutActions.getLastTimeForExercise(db, resolvedId, sessionId),
            workoutRepo.getSetsForExercise(db, resolvedId),
            Promise.all(
              subs.map(async (s): Promise<SubstituteChip> => {
                const subExercise = await workoutExerciseRepo.getExercise(db, s.exercise_id);
                return { exerciseId: s.exercise_id, name: subExercise?.name ?? 'Unknown exercise', note: s.note };
              })
            ),
          ]);
          const progression = computeExerciseProgression(toTrainingSets(history));
          const suggestion = suggestProgression(
            setsForThisExercise.map((s) => ({ weight_kg: s.weight_kg, reps: s.reps, rpe: s.rpe, is_warmup: s.is_warmup, logged_at: s.logged_at })),
            { prescriptionType: target.prescriptionType, repHigh: target.repHigh, targetRir: target.targetRir },
            // Only meaningful for the 'amrap' rule (task brief: "reps
            // achieved at the same load versus last session") — `lastTime`
            // is already "the most recent set from a DIFFERENT session"
            // (workoutActions.getLastTimeForExercise), exactly the
            // cross-session comparison point that rule needs.
            lastTime ? { weight_kg: lastTime.weight_kg, reps: lastTime.reps } : null
          );
          return {
            exercise,
            sets: setsForThisExercise,
            prefill,
            lastTime,
            progression,
            target,
            programExerciseId: target.programExerciseId,
            substitutes: substituteNames,
            suggestion,
          };
        })
      );
      programSlotStates = resolved.filter((s): s is ExerciseState => s !== null);
    }

    // ─── Ad-hoc exercises (unchanged logic, minus anything already shown
    // as a program slot above, so nothing renders twice).
    const adHocGroupedIds = groupedIds.filter((id) => !slotResolvedIds.includes(id));
    const extraPending = pendingExerciseIds.filter((id) => !groupedIds.includes(id) && !slotResolvedIds.includes(id));
    const orderedIds = [...adHocGroupedIds, ...extraPending];

    const adHocStates = await Promise.all(
      orderedIds.map(async (exerciseId): Promise<ExerciseState | null> => {
        const exercise = await workoutExerciseRepo.getExercise(db, exerciseId);
        if (!exercise) return null;
        const setsForThisExercise = groups.find((g) => g.exerciseId === exerciseId)?.sets ?? [];
        const [prefill, lastTime, history] = await Promise.all([
          workoutActions.getPrefillForExercise(db, exerciseId),
          workoutActions.getLastTimeForExercise(db, exerciseId, sessionId),
          workoutRepo.getSetsForExercise(db, exerciseId),
        ]);
        const progression = computeExerciseProgression(toTrainingSets(history));
        return {
          exercise,
          sets: setsForThisExercise,
          prefill,
          lastTime,
          progression,
          target: null,
          programExerciseId: null,
          substitutes: [],
          suggestion: null,
        };
      })
    );

    setExerciseStates([...programSlotStates, ...adHocStates.filter((s): s is ExerciseState => s !== null)]);
    // pendingExerciseIds/pendingSwaps intentionally excluded from deps:
    // they're read here, not written, and including them would re-run
    // this effect every time handleAddExercise/handleSwap updates them,
    // which is already handled explicitly at each call site.
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    const addId = route.params.addExerciseId;
    if (addId && addId !== lastAddedRef.current) {
      lastAddedRef.current = addId;
      setPendingExerciseIds((prev) => (prev.includes(addId) ? prev : [...prev, addId]));
      void load();
    }
  }, [route.params.addExerciseId]);

  const handleLogSet = async (exerciseId: string, draft: SetDraft) => {
    const db = await getDatabase();
    await workoutActions.logSet(db, {
      sessionId,
      exerciseId,
      weightKg: draft.weightKg,
      reps: draft.reps,
      rpe: draft.rpe,
      isWarmup: draft.isWarmup,
      setType: draft.setType,
    });
    setRestSignal((n) => n + 1);
    await load();
  };

  const handleUpdateSet = async (setId: string, draft: SetDraft) => {
    const db = await getDatabase();
    await workoutRepo.updateSet(db, setId, {
      weight_kg: draft.weightKg,
      reps: draft.reps,
      rpe: draft.rpe,
      is_warmup: draft.isWarmup ? 1 : 0,
      set_type: draft.setType,
    });
    await load();
  };

  const handleDeleteSet = async (setId: string) => {
    const db = await getDatabase();
    await workoutRepo.deleteSet(db, setId);
    await load();
  };

  /**
   * One tap adds a new drop/myo-rep/partials segment to `setId`, carrying
   * forward the previous segment's (or, for the first segment, the
   * parent set's own) weight AND reps as the starting default (task
   * brief: "Adding a segment should be one tap that carries the previous
   * segment's reps forward as a default" — carrying weight forward too
   * is a strictly faster starting point, since the Stepper-style +/- on
   * SetRow's segment row can dial it down from there instead of from
   * zero).
   */
  const handleAddSegment = async (setId: string) => {
    const db = await getDatabase();
    const parentSet = await workoutRepo.getSet(db, setId);
    if (!parentSet) return;
    const existingSegments = segmentsBySetId[setId] ?? [];
    const previous = existingSegments[existingSegments.length - 1];
    const defaults = previous ? { weight_kg: previous.weight_kg, reps: previous.reps } : { weight_kg: parentSet.weight_kg, reps: parentSet.reps };

    await workoutRepo.addSetSegment(db, {
      id: generateId('segment'),
      workout_set_id: setId,
      segment_index: existingSegments.length + 1,
      weight_kg: defaults.weight_kg,
      reps: defaults.reps,
    });
    await load();
  };

  const handleUpdateSegment = async (segmentId: string, patch: { weightKg?: number; reps?: number }) => {
    const db = await getDatabase();
    await workoutRepo.updateSetSegment(db, segmentId, { weight_kg: patch.weightKg, reps: patch.reps });
    await load();
  };

  const handleDeleteSegment = async (segmentId: string) => {
    const db = await getDatabase();
    await workoutRepo.deleteSetSegment(db, segmentId);
    await load();
  };

  const commitName = async () => {
    const db = await getDatabase();
    await workoutRepo.updateSession(db, sessionId, { name: nameDraft.trim().length > 0 ? nameDraft.trim() : null });
  };

  const commitNotes = async () => {
    const db = await getDatabase();
    await workoutRepo.updateSession(db, sessionId, { notes: notesDraft.trim().length > 0 ? notesDraft.trim() : null });
  };

  const handleDeleteSession = () => {
    Alert.alert('Delete session?', 'This removes the whole session and every set logged in it. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const db = await getDatabase();
            await workoutRepo.deleteSession(db, sessionId);
            navigation.goBack();
          })();
        },
      },
    ]);
  };

  if (!session) return <View style={styles.screen} />;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.nameInput}
          value={nameDraft}
          onChangeText={setNameDraft}
          onBlur={() => void commitName()}
          placeholder="Session name (optional)"
          placeholderTextColor={colors.textTertiary}
        />
        <Text style={styles.dateLabel}>{session.date}</Text>

        <RestTimer startSignal={restSignal} />

        {exerciseStates.map((state) => (
          <View key={state.programExerciseId ?? state.exercise.id}>
            {state.target && (
              <ProgramTargetHeader
                target={state.target}
                cues={state.target.cues}
                demoUrl={state.target.demoUrl}
                substitutes={state.substitutes}
                swapLocked={state.sets.length > 0}
                suggestion={state.suggestion}
                onSwap={(newExerciseId) => {
                  setPendingSwaps((prev) => ({ ...prev, [state.programExerciseId!]: newExerciseId }));
                  void load();
                }}
              />
            )}
            <ExerciseCard
              exercise={state.exercise}
              sets={state.sets}
              prefill={state.prefill}
              lastTime={state.lastTime}
              progression={state.progression}
              onLogSet={(draft) => void handleLogSet(state.exercise.id, draft)}
              onUpdateSet={(setId, draft) => void handleUpdateSet(setId, draft)}
              onDeleteSet={(setId) => void handleDeleteSet(setId)}
              onOpenHistory={() => navigation.navigate('WorkoutExerciseHistory', { exerciseId: state.exercise.id, exerciseName: state.exercise.name })}
              segmentsBySetId={segmentsBySetId}
              onAddSegment={(setId) => void handleAddSegment(setId)}
              onUpdateSegment={(segmentId, patch) => void handleUpdateSegment(segmentId, patch)}
              onDeleteSegment={(segmentId) => void handleDeleteSegment(segmentId)}
            />
          </View>
        ))}

        <Pressable
          onPress={() => navigation.navigate('WorkoutExercisePicker', { sessionId })}
          style={styles.addExerciseButton}
          accessibilityRole="button"
        >
          <Text style={styles.addExerciseText}>+ Add exercise</Text>
        </Pressable>

        {summary && summary.workingSetCount > 0 && (
          <View style={styles.summaryBlock}>
            <Text style={styles.summaryTitle}>Session summary</Text>
            <Text style={styles.summaryText}>
              {Math.round(summary.totalVolume).toLocaleString()} kg total volume · {summary.workingSetCount} working sets
              {summary.warmupSetCount > 0 ? ` · ${summary.warmupSetCount} warm-up` : ''} · {summary.exerciseCount} exercises
            </Text>
          </View>
        )}

        <TextInput
          style={styles.notesInput}
          value={notesDraft}
          onChangeText={setNotesDraft}
          onBlur={() => void commitNotes()}
          placeholder="Notes (optional)"
          placeholderTextColor={colors.textTertiary}
          multiline
        />

        <Pressable onPress={handleDeleteSession} style={styles.deleteSessionButton} accessibilityRole="button">
          <Text style={styles.deleteSessionText}>Delete session</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  nameInput: {
    ...type.h1,
    color: colors.text,
    paddingVertical: spacing.xs,
  },
  dateLabel: {
    ...type.caption,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  addExerciseButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  addExerciseText: {
    ...type.bodyStrong,
    color: colors.accent,
  },
  summaryBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  summaryTitle: {
    ...type.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  summaryText: {
    ...type.body,
    ...numeric,
    color: colors.text,
  },
  notesInput: {
    ...type.body,
    color: colors.text,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  deleteSessionButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  deleteSessionText: {
    ...type.caption,
    color: colors.textTertiary,
  },
});
