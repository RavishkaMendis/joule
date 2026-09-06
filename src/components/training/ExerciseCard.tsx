// ═══════════════════════════════════════════════════════════════════════
// ExerciseCard — one exercise's block within the active/edit session
// screen: name (tap -> history), "last time" reference line, logged sets,
// and the entry row for adding the next one.
//
// The single biggest lever on the 10-second test (CLAUDE.md/PRD §10) is
// right here: the entry row's weight/reps always arrive PRE-FILLED
// (`prefill` prop, computed by the parent from the last set of this
// exercise — same session if one exists yet today, otherwise last time)
// so logging a repeat set is "look at the numbers, tap Log" rather than
// "type two numbers from scratch." Tapping an existing SetRow reuses this
// same entry row in edit mode instead of opening a second input UI.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, numeric, radii, spacing, type } from '../../lib/theme';
import type { ExerciseRow, WorkoutSetRow, WorkoutSetSegmentRow, SetType } from '../../db/types';
import type { ExerciseProgression } from '../../lib/training/progression';
import { estimateOneRepMax } from '../../lib/training/oneRepMax';
import { SetRow } from './SetRow';
import { Stepper } from './Stepper';
import { OneRepMaxBadge } from './OneRepMaxBadge';
import { TrendBadge } from './TrendBadge';

export type SetDraft = {
  weightKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  /** Defaults to 'straight' — see SetType (src/db/types.ts). An untouched Technique row behaves exactly as it always has; this is purely additive, same non-intrusive shape as the RPE/warm-up chips it sits next to. */
  setType: SetType;
};

/** The weight/reps half of a pre-fill — deliberately narrower than SetDraft: workoutActions.getPrefillForExercise has no opinion on RPE/warm-up for a brand-new set (those always start unset), only on continuing the weight/reps the user is already working with. */
export type WeightRepsPrefill = { weightKg: number; reps: number };

type Props = {
  exercise: ExerciseRow;
  sets: WorkoutSetRow[];
  /** Pre-fill for a brand-new set — same-session-or-last-time, computed by the parent (workoutActions.getPrefillForExercise). Null if never logged before. */
  prefill: WeightRepsPrefill | null;
  /** "Last time's numbers" reference line — always a PAST session, even if today already has sets logged (parent: workoutActions.getLastTimeForExercise). */
  lastTime: WorkoutSetRow | null;
  progression: ExerciseProgression | null;
  onLogSet: (draft: SetDraft) => void;
  onUpdateSet: (setId: string, draft: SetDraft) => void;
  onDeleteSet: (setId: string) => void;
  onOpenHistory: () => void;
  /**
   * Drop/myo-rep/partials segments (schema v7), keyed by their parent
   * workout_set.id. Empty/absent for an ordinary straight set — see
   * schema.ts's v7 header for the "parent row is segment 0" contract.
   */
  segmentsBySetId?: Record<string, WorkoutSetSegmentRow[]>;
  /**
   * One tap adds a new segment to this set, carrying the previous
   * segment's (or the parent set's own) reps AND weight forward as a
   * starting default (task brief: "Adding a segment should be one tap
   * that carries the previous segment's reps forward as a default" —
   * carrying weight forward too costs nothing and lets the user just
   * dial it down via the segment's own Stepper rather than retyping).
   * Omitted entirely when the parent screen doesn't support segments.
   */
  onAddSegment?: (setId: string) => void;
  onUpdateSegment?: (segmentId: string, patch: { weightKg?: number; reps?: number }) => void;
  onDeleteSegment?: (segmentId: string) => void;
};

const RPE_OPTIONS = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

const TECHNIQUE_OPTIONS: { value: SetType; label: string }[] = [
  { value: 'drop', label: 'Drop' },
  { value: 'myo_rep', label: 'Myo-rep' },
  { value: 'partials', label: 'Partials' },
];

function emptyDraft(): SetDraft {
  return { weightKg: 20, reps: 8, rpe: null, isWarmup: false, setType: 'straight' };
}

export function ExerciseCard({
  exercise,
  sets,
  prefill,
  lastTime,
  progression,
  onLogSet,
  onUpdateSet,
  onDeleteSet,
  onOpenHistory,
  segmentsBySetId,
  onAddSegment,
  onUpdateSegment,
  onDeleteSegment,
}: Props) {
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SetDraft>(
    prefill ? { ...prefill, rpe: null, isWarmup: false, setType: 'straight' } : emptyDraft()
  );

  // Re-seed the draft whenever the prefill changes (a new set was just
  // logged for this exercise elsewhere, or this card mounted) — but only
  // while not mid-edit of an existing set, so an in-progress edit is
  // never clobbered out from under the user.
  useEffect(() => {
    if (editingSetId !== null) return;
    setDraft(prefill ? { ...prefill, rpe: null, isWarmup: false, setType: 'straight' } : emptyDraft());
  }, [prefill?.weightKg, prefill?.reps]);

  const startEditing = (set: WorkoutSetRow) => {
    setEditingSetId(set.id);
    setDraft({ weightKg: set.weight_kg, reps: set.reps, rpe: set.rpe, isWarmup: set.is_warmup === 1, setType: set.set_type });
  };

  const cancelEditing = () => {
    setEditingSetId(null);
    setDraft(prefill ? { ...prefill, rpe: null, isWarmup: false, setType: 'straight' } : emptyDraft());
  };

  const handleSubmit = () => {
    if (editingSetId !== null) {
      onUpdateSet(editingSetId, draft);
      setEditingSetId(null);
    } else {
      onLogSet(draft);
    }
  };

  const oneRepMax = estimateOneRepMax(draft.weightKg, draft.reps);

  return (
    <View style={styles.card}>
      <Pressable onPress={onOpenHistory} accessibilityRole="button">
        <Text style={styles.exerciseName}>{exercise.name}</Text>
      </Pressable>

      {lastTime && (
        <Text style={styles.lastTime}>
          Last time: {lastTime.weight_kg}kg × {lastTime.reps}
          {lastTime.rpe !== null ? ` @ RPE ${lastTime.rpe}` : ''}
        </Text>
      )}

      {progression && progression.history.length > 0 && (
        <View style={styles.progressionRow}>
          <TrendBadge progression={progression} />
        </View>
      )}

      {sets.length > 0 && (
        <View style={styles.setList}>
          {sets.map((set, i) => (
            <SetRow
              key={set.id}
              set={set}
              index={i}
              selected={editingSetId === set.id}
              onPress={() => (editingSetId === set.id ? cancelEditing() : startEditing(set))}
              onDelete={() => onDeleteSet(set.id)}
              segments={segmentsBySetId?.[set.id] ?? []}
              onAddSegment={onAddSegment && set.set_type !== 'straight' ? () => onAddSegment(set.id) : undefined}
              onUpdateSegment={onUpdateSegment}
              onDeleteSegment={onDeleteSegment}
            />
          ))}
        </View>
      )}

      <View style={styles.entryRow}>
        <Stepper label="Weight" value={draft.weightKg} step={2.5} suffix="kg" precision={2} onChange={(weightKg) => setDraft((d) => ({ ...d, weightKg }))} />
        <Stepper label="Reps" value={draft.reps} step={1} min={1} onChange={(reps) => setDraft((d) => ({ ...d, reps }))} />
      </View>

      <View style={styles.rpeRow}>
        <Text style={styles.rpeLabel}>RPE</Text>
        {RPE_OPTIONS.map((option) => (
          <Pressable
            key={option}
            onPress={() => setDraft((d) => ({ ...d, rpe: d.rpe === option ? null : option }))}
            style={[styles.rpeChip, draft.rpe === option && styles.rpeChipActive]}
            accessibilityRole="button"
          >
            <Text style={[styles.rpeChipText, draft.rpe === option && styles.rpeChipTextActive]}>{option}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setDraft((d) => ({ ...d, isWarmup: !d.isWarmup }))}
          style={[styles.warmupChip, draft.isWarmup && styles.warmupChipActive]}
          accessibilityRole="button"
        >
          <Text style={[styles.rpeChipText, draft.isWarmup && styles.rpeChipTextActive]}>Warm-up</Text>
        </Pressable>
      </View>

      {/* Intensity technique (schema v7, high-intensity training). No chip
          for "Straight" — tapping an active chip again returns to it,
          same toggle pattern as the RPE chips above. Untouched, this row
          changes nothing about the logged set. */}
      <View style={styles.rpeRow}>
        <Text style={styles.rpeLabel}>Technique</Text>
        {TECHNIQUE_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => setDraft((d) => ({ ...d, setType: d.setType === option.value ? 'straight' : option.value }))}
            style={[styles.rpeChip, draft.setType === option.value && styles.rpeChipActive]}
            accessibilityRole="button"
          >
            <Text style={[styles.rpeChipText, draft.setType === option.value && styles.rpeChipTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {oneRepMax && <OneRepMaxBadge estimate={oneRepMax} />}

      <View style={styles.actionsRow}>
        {editingSetId !== null && (
          <Pressable onPress={cancelEditing} style={styles.cancelButton} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        )}
        <Pressable onPress={handleSubmit} style={styles.logButton} accessibilityRole="button">
          <Text style={styles.logText}>{editingSetId !== null ? 'Save changes' : 'Log set'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  exerciseName: {
    ...type.h2,
    color: colors.text,
  },
  lastTime: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  progressionRow: {
    marginTop: -spacing.xs,
  },
  setList: {
    marginTop: spacing.xs,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.sm,
  },
  rpeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  rpeLabel: {
    ...type.small,
    color: colors.textTertiary,
    marginRight: spacing.xs,
  },
  rpeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rpeChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  rpeChipText: {
    ...type.small,
    ...numeric,
    color: colors.textSecondary,
  },
  rpeChipTextActive: {
    color: colors.background,
  },
  warmupChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginLeft: 'auto',
  },
  warmupChipActive: {
    backgroundColor: colors.textSecondary,
    borderColor: colors.textSecondary,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  cancelButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
  },
  cancelText: {
    ...type.body,
    color: colors.textSecondary,
  },
  logButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    minWidth: 120,
    alignItems: 'center',
  },
  logText: {
    ...type.bodyStrong,
    color: colors.background,
  },
});
