// ═══════════════════════════════════════════════════════════════════════
// SetRow — one already-logged set: "100 kg × 5", optional RPE, a neutral
// (not red/orange) "warm-up" tag when applicable. Tapping the row hands
// editing back to the parent (ExerciseCard reuses its own entry-row
// Steppers for editing, so there is only one input UI to build/maintain).
// The delete control is its own generously-sized touch target, separate
// from the tap-to-edit area, so a between-sets thumb doesn't delete a set
// while trying to correct it.
//
// DROP/MYO-REP/PARTIALS SEGMENTS (schema v7): when this set carries
// additional `workout_set_segment` rows (a drop, a myo-rep cluster, a
// partials tail — see schema.ts's v7 header), they render as their own
// compact rows beneath the main one, each independently adjustable
// (+/- on weight and reps) and removable. `onAddSegment`, when provided,
// is ONE tap that appends a new segment — the parent (ExerciseCard/
// WorkoutSessionScreen) computes its carried-forward defaults (task
// brief: "Adding a segment should be one tap that carries the previous
// segment's reps forward as a default"); this component has no opinion
// on what those defaults are.
// ═══════════════════════════════════════════════════════════════════════

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../../lib/theme';
import type { WorkoutSetRow, WorkoutSetSegmentRow } from '../../db/types';

type Props = {
  set: WorkoutSetRow;
  index: number;
  selected: boolean;
  onPress: () => void;
  onDelete: () => void;
  /** Additional segments logged after this set's own top weight/reps — empty for an ordinary straight set. */
  segments?: WorkoutSetSegmentRow[];
  /** One tap adds a new segment (parent supplies carried-forward defaults). Omitted entirely when the parent screen doesn't support segments. */
  onAddSegment?: () => void;
  onUpdateSegment?: (segmentId: string, patch: { weightKg?: number; reps?: number }) => void;
  onDeleteSegment?: (segmentId: string) => void;
};

const TECHNIQUE_LABELS: Record<string, string> = {
  drop: 'drop',
  myo_rep: 'myo-rep',
  partials: 'partials',
};

function formatWeight(kg: number): string {
  return Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(/\.0$/, '');
}

export function SetRow({ set, index, selected, onPress, onDelete, segments = [], onAddSegment, onUpdateSegment, onDeleteSegment }: Props) {
  const techniqueLabel = set.set_type !== 'straight' ? TECHNIQUE_LABELS[set.set_type] : null;

  return (
    <View>
      <Pressable onPress={onPress} style={[styles.row, selected && styles.rowSelected]} accessibilityRole="button">
        <Text style={styles.index}>{index + 1}</Text>
        <Text style={styles.main}>
          {formatWeight(set.weight_kg)} kg × {set.reps}
        </Text>
        {set.rpe !== null && <Text style={styles.rpe}>RPE {set.rpe}</Text>}
        {set.is_warmup === 1 && <Text style={styles.warmupTag}>warm-up</Text>}
        {techniqueLabel && <Text style={styles.warmupTag}>{techniqueLabel}</Text>}
        <View style={styles.spacer} />
        <Pressable onPress={onDelete} style={styles.deleteButton} accessibilityRole="button" accessibilityLabel={`Delete set ${index + 1}`} hitSlop={8}>
          <Text style={styles.deleteText}>Remove</Text>
        </Pressable>
      </Pressable>

      {segments.length > 0 && (
        <View style={styles.segmentList}>
          {segments.map((segment, i) => (
            <View key={segment.id} style={styles.segmentRow}>
              <Text style={styles.segmentIndex}>
                {index + 1}.{i + 1}
              </Text>
              <View style={styles.segmentAdjustGroup}>
                <Pressable
                  onPress={() => onUpdateSegment?.(segment.id, { weightKg: Math.max(0, segment.weight_kg - 2.5) })}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Decrease segment ${i + 1} weight`}
                >
                  <Text style={styles.segmentAdjustText}>–</Text>
                </Pressable>
                <Text style={styles.segmentMain}>{formatWeight(segment.weight_kg)} kg</Text>
                <Pressable
                  onPress={() => onUpdateSegment?.(segment.id, { weightKg: segment.weight_kg + 2.5 })}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Increase segment ${i + 1} weight`}
                >
                  <Text style={styles.segmentAdjustText}>+</Text>
                </Pressable>
              </View>
              <Text style={styles.segmentTimes}>×</Text>
              <View style={styles.segmentAdjustGroup}>
                <Pressable
                  onPress={() => onUpdateSegment?.(segment.id, { reps: Math.max(1, segment.reps - 1) })}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Decrease segment ${i + 1} reps`}
                >
                  <Text style={styles.segmentAdjustText}>–</Text>
                </Pressable>
                <Text style={styles.segmentMain}>{segment.reps}</Text>
                <Pressable
                  onPress={() => onUpdateSegment?.(segment.id, { reps: segment.reps + 1 })}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Increase segment ${i + 1} reps`}
                >
                  <Text style={styles.segmentAdjustText}>+</Text>
                </Pressable>
              </View>
              <View style={styles.spacer} />
              <Pressable onPress={() => onDeleteSegment?.(segment.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove segment ${i + 1}`}>
                <Text style={styles.deleteText}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {onAddSegment && (
        <Pressable onPress={onAddSegment} style={styles.addSegmentButton} accessibilityRole="button" accessibilityLabel={`Add a segment to set ${index + 1}`}>
          <Text style={styles.addSegmentText}>+ Segment</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    minHeight: minTouchTarget,
  },
  rowSelected: {
    backgroundColor: colors.surfaceAlt,
  },
  index: {
    ...type.caption,
    ...numeric,
    color: colors.textTertiary,
    minWidth: 18,
  },
  main: {
    ...type.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  rpe: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  warmupTag: {
    ...type.small,
    color: colors.textTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
  },
  spacer: {
    flex: 1,
  },
  deleteButton: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  deleteText: {
    ...type.small,
    color: colors.textTertiary,
  },
  segmentList: {
    marginLeft: spacing.lg,
  },
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  segmentIndex: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    minWidth: 24,
  },
  segmentAdjustGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  segmentAdjustText: {
    ...type.caption,
    color: colors.textSecondary,
    paddingHorizontal: 4,
  },
  segmentMain: {
    ...type.caption,
    ...numeric,
    color: colors.text,
    minWidth: 40,
    textAlign: 'center',
  },
  segmentTimes: {
    ...type.small,
    color: colors.textTertiary,
  },
  addSegmentButton: {
    marginLeft: spacing.lg,
    paddingVertical: spacing.xs,
  },
  addSegmentText: {
    ...type.small,
    color: colors.accent,
  },
});
