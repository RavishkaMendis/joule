// ═══════════════════════════════════════════════════════════════════════
// ProteinConsistencyChart — PRD §9.1: "the macro that matters and the one
// most often missed." Shows hit-rate AND a distribution histogram, not
// just an average — an average of 150g can hide "half the days at 220g,
// half at 80g," which the histogram makes visible at a glance.
//
// No colour grading by bucket (PRD §10: no red, no guilt) — every bucket
// bar is the same neutral tone regardless of whether it's above or below
// target. The hit-rate stat is framed descriptively ("hit target on N/M
// days"), not as a score or grade.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors, numeric, spacing, type } from '../../lib/theme';
import { linearScale } from '../../lib/chartScale';
import type { ProteinConsistencySummary } from '../../lib/analytics/proteinConsistency';

type Props = {
  summary: ProteinConsistencySummary;
  height?: number;
};

const CHART_PADDING = { top: 8, bottom: 20, left: 4, right: 4 };
const BAR_GAP = 6;
const MIN_LOGGED_DAYS_FOR_HISTOGRAM = 3;

export function ProteinConsistencyChart({ summary, height = 130 }: Props) {
  if (summary.loggedDays === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Protein consistency</Text>
        <Text style={styles.empty}>Log a few days of food to see how consistently you hit your protein target.</Text>
      </View>
    );
  }

  const avgLabel = summary.avgProteinG !== null ? `avg ${Math.round(summary.avgProteinG)}g/day` : '';

  const showHistogram = summary.histogram.length > 0 && summary.loggedDays >= MIN_LOGGED_DAYS_FOR_HISTOGRAM;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Protein consistency</Text>
        <Text style={styles.subtitle}>{avgLabel}</Text>
      </View>

      {summary.hitRateFraction !== null ? (
        <Text style={styles.hitRateText}>
          Hit target on {summary.daysHitTarget}/{summary.loggedDays} logged days ({Math.round(summary.hitRateFraction * 100)}%)
        </Text>
      ) : (
        <Text style={styles.hitRateText}>
          No accepted protein target yet — showing raw intake only. Complete a weekly check-in to see hit-rate.
        </Text>
      )}

      {showHistogram ? (
        <Histogram buckets={summary.histogram} height={height} />
      ) : (
        <Text style={styles.hint}>A few more logged days will unlock the distribution below.</Text>
      )}
    </View>
  );
}

function Histogram({ buckets, height }: { buckets: ProteinConsistencySummary['histogram']; height: number }) {
  const width = 320;
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const barSlotWidth = plotWidth / buckets.length;
  const barWidth = Math.max(barSlotWidth - BAR_GAP, 1);
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const yScale = linearScale([0, maxCount * 1.15], [CHART_PADDING.top + plotHeight, CHART_PADDING.top]);

  return (
    <View>
      <Svg width={width} height={height}>
        {buckets.map((bucket, i) => {
          const x = CHART_PADDING.left + i * barSlotWidth + BAR_GAP / 2;
          const barHeight = bucket.count === 0 ? 0 : Math.max(yScale(0) - yScale(bucket.count), 2);
          const y = yScale(bucket.count);
          if (bucket.count === 0) return null;
          return <Rect key={bucket.label} x={x} y={y} width={barWidth} height={barHeight} fill={colors.neutral} opacity={0.85} rx={2} />;
        })}
      </Svg>
      <View style={styles.labelRow}>
        {buckets.map((bucket) => (
          <Text key={bucket.label} style={[styles.bucketLabel, { width: barSlotWidth }]}>
            {bucket.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.xs,
  },
  title: {
    ...type.bodyStrong,
    color: colors.text,
  },
  subtitle: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  empty: {
    ...type.caption,
    color: colors.textTertiary,
  },
  hitRateText: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  hint: {
    ...type.small,
    color: colors.textTertiary,
  },
  labelRow: {
    flexDirection: 'row',
  },
  bucketLabel: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});
