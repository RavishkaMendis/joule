// ═══════════════════════════════════════════════════════════════════════
// MuscleGroupBalanceChart — "which regions get volume, which are
// neglected" (task brief: "genuinely actionable for someone returning to
// the gym"). Plain View bars (not SVG) proportional to each category's
// share of total working volume — same "stacked bar via flex" technique
// DataQualityChart already uses, not a new charting approach.
//
// Every one of the six categories always gets a row, even at zero volume
// — that's the entire point: a neglected region has to be visible as an
// explicit zero, not missing from the list. No red/warning colour on the
// neglected rows (PRD §10) — they're the same neutral tone as everything
// else, just visibly shorter/zero.
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet, Text, View } from 'react-native';
import { colors, numeric, radii, spacing, type } from '../../lib/theme';
import type { MuscleGroupVolume } from '../../lib/training/muscleGroupBalance';

type Props = {
  balance: MuscleGroupVolume[];
};

const CATEGORY_LABELS: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  legs: 'Legs',
  shoulders: 'Shoulders',
  arms: 'Arms',
  core: 'Core',
  uncategorized: 'Uncategorized',
};

function fmtVolume(v: number): string {
  return `${Math.round(v).toLocaleString()} kg`;
}

export function MuscleGroupBalanceChart({ balance }: Props) {
  const totalSets = balance.reduce((sum, b) => sum + b.setCount, 0);

  if (totalSets === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Muscle-group balance</Text>
        <Text style={styles.empty}>
          Needs at least one logged working set — this will show which regions are getting volume and which aren&apos;t,
          across chest/back/legs/shoulders/arms/core.
        </Text>
      </View>
    );
  }

  const maxVolume = Math.max(...balance.map((b) => b.volume), 1);
  const anyBodyweightOnly = balance.some((b) => b.setCount > 0 && b.volume === 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Muscle-group balance</Text>
      <View style={styles.list}>
        {balance.map((row) => {
          const widthFraction = maxVolume > 0 ? row.volume / maxVolume : 0;
          return (
            <View key={row.category} style={styles.row}>
              <Text style={styles.rowLabel}>{CATEGORY_LABELS[row.category] ?? row.category}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { flex: Math.max(widthFraction, 0.015) }]} />
                <View style={{ flex: Math.max(1 - widthFraction, 0.001) }} />
              </View>
              <View style={styles.rowValues}>
                <Text style={styles.rowVolume}>{row.volume > 0 ? fmtVolume(row.volume) : row.setCount > 0 ? '0 kg' : '—'}</Text>
                {row.fraction !== null && row.volume > 0 && (
                  <Text style={styles.rowFraction}>{Math.round(row.fraction * 100)}%</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.footnote}>
        Volume = Σ(weight × reps) over working sets only (warm-ups excluded), grouped by each exercise&apos;s muscle
        category and summed over the selected window. Bar length is each region&apos;s share of the busiest region
        shown here, not a percentage of an anatomical total.
      </Text>
      {anyBodyweightOnly && (
        <Text style={styles.footnote}>
          A region can show 0 kg but still have working sets logged (bodyweight-only work, e.g. plank/hanging leg
          raise) — that&apos;s real training with no added-load basis for a volume figure, not neglect.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    ...type.bodyStrong,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  empty: {
    ...type.caption,
    color: colors.textTertiary,
    lineHeight: 19,
  },
  list: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLabel: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    width: 84,
  },
  barTrack: {
    flex: 1,
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  barFill: {
    backgroundColor: colors.neutral,
    opacity: 0.85,
    borderRadius: 5,
  },
  rowValues: {
    width: 82,
    alignItems: 'flex-end',
  },
  rowVolume: {
    ...type.caption,
    ...numeric,
    color: colors.text,
  },
  rowFraction: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
  },
  footnote: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
});
