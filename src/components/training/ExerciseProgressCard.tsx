// ═══════════════════════════════════════════════════════════════════════
// ExerciseProgressCard — one exercise's progression: first vs latest
// best set (weight × reps, a proportional bar), the existing TrendBadge
// for % change, and an estimated-1RM trend underneath. Combines the task
// brief's "per-exercise progression" and "estimated 1RM over time" bullets
// into one card per exercise (rather than two separately-selected panels)
// because they share the exact same input — `ExerciseProgression.history`
// from computeExerciseProgression — and picking exercises for each
// separately would just duplicate exerciseSelection.ts's ranking with a
// chance of the two lists silently drifting apart.
//
// Two DIFFERENT, individually-honest comparisons appear on this card and
// are labelled as such rather than merged:
//   - The FIRST-VS-LATEST bars: your very first logged session for this
//     exercise vs. your most recent one — spans the whole history.
//   - The % badge (TrendBadge, unmodified/reused): computeExerciseProgression's
//     percentChangeVsPrevious, which is ALWAYS latest vs the immediately
//     PRIOR session, per that module's own doc. At exactly 2 sessions
//     these are the same comparison; at 3+ they can disagree (e.g. bars
//     show a big first-to-latest gain while the badge shows a small dip
//     since last time) — a footnote says so rather than presenting one
//     merged, misleading number.
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet, Text, View } from 'react-native';
import { colors, numeric, radii, spacing, type } from '../../lib/theme';
import type { ExerciseProgression } from '../../lib/training/progression';
import { TrendBadge } from './TrendBadge';
import { OneRepMaxBadge } from './OneRepMaxBadge';
import { OneRepMaxTrendChart } from './OneRepMaxTrendChart';

type Props = {
  exerciseName: string;
  progression: ExerciseProgression;
};

function fmtSet(weightKg: number, reps: number): string {
  return `${weightKg}kg × ${reps}`;
}

export function ExerciseProgressCard({ exerciseName, progression }: Props) {
  const { history } = progression;
  if (history.length === 0) return null;

  const first = history[0];
  const latest = history[history.length - 1];
  const hasComparison = history.length >= 2;
  const maxWeight = Math.max(first.weightKg, latest.weightKg, 0.0001);

  return (
    <View style={styles.card}>
      <Text style={styles.exerciseName}>{exerciseName}</Text>

      {hasComparison ? (
        <View style={styles.barsBlock}>
          {[
            { label: 'First', point: first },
            { label: 'Latest', point: latest },
          ].map(({ label, point }) => (
            <View key={label} style={styles.barRow}>
              <Text style={styles.barRowLabel}>{label}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { flex: Math.max(point.weightKg / maxWeight, 0.02) }]} />
                <View style={{ flex: Math.max(1 - point.weightKg / maxWeight, 0.001) }} />
              </View>
              <Text style={styles.barRowValue}>{fmtSet(point.weightKg, point.reps)}</Text>
            </View>
          ))}
          <Text style={styles.dateRange}>
            {first.date} → {latest.date}
          </Text>
        </View>
      ) : (
        <Text style={styles.single}>
          One session logged: {fmtSet(first.weightKg, first.reps)} on {first.date}
        </Text>
      )}

      <View style={styles.badgeRow}>
        <TrendBadge progression={progression} />
      </View>

      {history.length >= 2 ? (
        <OneRepMaxTrendChart history={history} />
      ) : (
        first.estimatedOneRepMax && <OneRepMaxBadge estimate={first.estimatedOneRepMax} />
      )}

      {history.length >= 3 && (
        <Text style={styles.footnote}>
          Bars compare your first-ever and most recent logged sessions; the badge above compares only the most
          recent two — they can point different ways over a longer history.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  exerciseName: {
    ...type.bodyStrong,
    color: colors.text,
  },
  single: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  barsBlock: {
    gap: 4,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  barRowLabel: {
    ...type.small,
    color: colors.textTertiary,
    width: 34,
  },
  barTrack: {
    flex: 1,
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  barFill: {
    backgroundColor: colors.neutral,
    opacity: 0.85,
    borderRadius: 4,
  },
  barRowValue: {
    ...type.small,
    ...numeric,
    color: colors.textSecondary,
    width: 74,
    textAlign: 'right',
  },
  dateRange: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  badgeRow: {
    marginTop: 2,
  },
  footnote: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: 2,
    lineHeight: 14,
  },
});
