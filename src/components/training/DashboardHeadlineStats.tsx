// ═══════════════════════════════════════════════════════════════════════
// DashboardHeadlineStats — total volume, total working sets, sessions,
// average volume/session, over the selected window. Task brief's
// "headline stats" bullet.
//
// Zero sessions in the window gets a full explanatory empty state (task
// brief: "state what it needs and when it appears, rather than rendering
// ... a one-bar chart that looks broken") — not a wall of zero tiles,
// which would look like a bug rather than an honest "nothing here yet."
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet, Text, View } from 'react-native';
import { colors, numeric, radii, spacing, type } from '../../lib/theme';
import type { HeadlineStats } from '../../lib/training/dashboardStats';

type Props = {
  stats: HeadlineStats;
  windowLabel: string;
};

function fmtVolume(v: number): string {
  return `${Math.round(v).toLocaleString()} kg`;
}

export function DashboardHeadlineStats({ stats, windowLabel }: Props) {
  if (stats.sessionCount === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Headline stats</Text>
        <Text style={styles.empty}>
          No sessions logged ({windowLabel}) — start a workout and this fills in with total volume, sets, and your
          average per session.
        </Text>
      </View>
    );
  }

  const tiles: { label: string; value: string }[] = [
    { label: 'Total volume', value: fmtVolume(stats.totalVolume) },
    { label: 'Working sets', value: stats.workingSetCount.toLocaleString() },
    { label: 'Sessions', value: stats.sessionCount.toLocaleString() },
    {
      label: 'Avg volume/session',
      value: stats.avgVolumePerSession !== null ? fmtVolume(stats.avgVolumePerSession) : '—',
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Headline stats</Text>
        <Text style={styles.subtitle}>{windowLabel}</Text>
      </View>
      <View style={styles.grid}>
        {tiles.map((tile) => (
          <View key={tile.label} style={styles.tile}>
            <Text style={styles.tileValue}>{tile.value}</Text>
            <Text style={styles.tileLabel}>{tile.label}</Text>
          </View>
        ))}
      </View>
      {stats.warmupSetCount > 0 && (
        <Text style={styles.footnote}>
          Volume = Σ(weight × reps) over working sets; {stats.warmupSetCount} warm-up set
          {stats.warmupSetCount === 1 ? '' : 's'} in this window {stats.warmupSetCount === 1 ? 'is' : 'are'} excluded
          from volume and this set count. Sessions with no session in a given week aren&apos;t zeros dragging the
          average down — the average is only ever over sessions that actually happened.
        </Text>
      )}
      {stats.warmupSetCount === 0 && (
        <Text style={styles.footnote}>
          Volume = Σ(weight × reps) over working sets (warm-ups excluded). The average is over sessions that
          actually happened — a week with no session isn&apos;t counted as a zero-volume week.
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  title: {
    ...type.bodyStrong,
    color: colors.text,
  },
  subtitle: {
    ...type.caption,
    color: colors.textSecondary,
  },
  empty: {
    ...type.caption,
    color: colors.textTertiary,
    lineHeight: 19,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  tileValue: {
    ...type.h2,
    ...numeric,
    color: colors.text,
  },
  tileLabel: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  footnote: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
});
