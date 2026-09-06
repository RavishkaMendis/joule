// ═══════════════════════════════════════════════════════════════════════
// WeightChart — PRD §9.2: "faint dots for raw readings, solid line for
// Kalman-smoothed. Seeing the noise cloud around the smooth line is
// quietly reassuring."
//
// Both series are always rendered together — the smoothed line is never
// shown alone. Raw dots use textTertiary at reduced opacity (never a
// separate hue): PRD §10 bans anything reading as good/bad, and the dots
// are diagnostic texture, not a value judgement.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors, numeric, spacing, type } from '../../lib/theme';
import { linearScale, numericExtent, padDomain } from '../../lib/chartScale';
import type { WeightChartPoint } from '../../lib/useTrendsData';

type Props = {
  series: WeightChartPoint[];
  height?: number;
};

const CHART_PADDING = { top: 12, bottom: 12, left: 8, right: 8 };

export function WeightChart({ series, height = 160 }: Props) {
  if (series.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Weight</Text>
        <Text style={styles.empty}>No weigh-ins yet — log your first this morning.</Text>
      </View>
    );
  }

  const width = 320;
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const xScale = linearScale([0, Math.max(series.length - 1, 1)], [CHART_PADDING.left, CHART_PADDING.left + plotWidth]);

  const extent = numericExtent(
    series.map((p) => p.rawKg),
    series.map((p) => p.smoothedKg)
  ) ?? [0, 1];
  const yDomain = padDomain(extent, 0.15, 1);
  const yScale = linearScale(yDomain, [CHART_PADDING.top + plotHeight, CHART_PADDING.top]);

  const smoothedPoints = series.map((p, i) => `${xScale(i)},${yScale(p.smoothedKg)}`).join(' ');

  const first = series[0];
  const last = series[series.length - 1];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Weight</Text>
        <Text style={styles.subtitle}>{last.smoothedKg.toFixed(1)} kg smoothed</Text>
      </View>
      <Svg width={width} height={height}>
        {/* Raw readings: faint dots — the "noise cloud" PRD §9.2 wants visible. */}
        {series.map((p, i) =>
          p.rawKg !== null ? (
            <Circle key={`raw-${p.date}`} cx={xScale(i)} cy={yScale(p.rawKg)} r={2} fill={colors.textTertiary} opacity={0.55} />
          ) : null
        )}
        {/* Kalman-smoothed line: solid, full-brightness. */}
        <Polyline points={smoothedPoints} fill="none" stroke={colors.accent} strokeWidth={2} />
      </Svg>
      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>{first.date}</Text>
        <Text style={styles.axisLabel}>{last.date}</Text>
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
    marginBottom: spacing.sm,
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
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  axisLabel: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
  },
});
