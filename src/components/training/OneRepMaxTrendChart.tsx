// ═══════════════════════════════════════════════════════════════════════
// OneRepMaxTrendChart — estimated 1RM across sessions for one exercise,
// each point carrying oneRepMax.ts's own rep-count confidence (task
// brief: "an estimate from 12 reps must not render like one from 3").
//
// Reuses BestSetForSession.estimatedOneRepMax from computeExerciseProgression
// directly — no 1RM math lives here, only layout. Confidence is encoded
// with the SAME colors.confidence ladder OneRepMaxBadge already uses
// (never a new hue), applied per-point instead of to a single badge, so a
// line that dips from a confident triple into a rough 15-rep set visibly
// fades rather than reading as a clean, equally-certain trend.
//
// Rendered only when history.length >= 2 — a single point has no "over
// time" to show; the caller falls back to a plain OneRepMaxBadge for that
// case instead of a one-dot "chart" that would look broken.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors, numeric, spacing, type } from '../../lib/theme';
import { linearScale, numericExtent, padDomain } from '../../lib/chartScale';
import type { BestSetForSession } from '../../lib/training/progression';
import type { OneRepMaxConfidence } from '../../lib/training/oneRepMax';

type Props = {
  history: BestSetForSession[];
  height?: number;
};

const CHART_PADDING = { top: 10, bottom: 4, left: 6, right: 6 };

/** Same mapping OneRepMaxBadge uses: 'high' confidence reads as the exact/full-brightness tone, never a distinct new colour. */
function confidenceColor(confidence: OneRepMaxConfidence): string {
  return colors.confidence[confidence === 'high' ? 'exact' : confidence];
}

export function OneRepMaxTrendChart({ history, height = 90 }: Props) {
  const withEstimate = history.filter((h) => h.estimatedOneRepMax !== null);
  if (withEstimate.length < 2) return null;

  const width = 280;
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const xScale = linearScale([0, Math.max(withEstimate.length - 1, 1)], [CHART_PADDING.left, CHART_PADDING.left + plotWidth]);
  const extent = numericExtent(withEstimate.map((h) => h.estimatedOneRepMax!.value)) ?? [0, 1];
  const yDomain = padDomain(extent, 0.2, 1);
  const yScale = linearScale(yDomain, [CHART_PADDING.top + plotHeight, CHART_PADDING.top]);

  const points = withEstimate.map((h, i) => `${xScale(i)},${yScale(h.estimatedOneRepMax!.value)}`).join(' ');
  const latest = withEstimate[withEstimate.length - 1];
  const anyLowConfidence = withEstimate.some((h) => h.estimatedOneRepMax!.confidence === 'low');

  return (
    <View style={styles.container}>
      <Svg width={width} height={height}>
        <Polyline points={points} fill="none" stroke={colors.textTertiary} strokeWidth={1.5} opacity={0.6} />
        {withEstimate.map((h, i) => (
          <Circle
            key={h.sessionId}
            cx={xScale(i)}
            cy={yScale(h.estimatedOneRepMax!.value)}
            r={3.5}
            fill={confidenceColor(h.estimatedOneRepMax!.confidence)}
          />
        ))}
      </Svg>
      <Text style={styles.caption}>
        ~{Math.round(latest.estimatedOneRepMax!.value)} kg est. 1RM latest
        {anyLowConfidence ? ' · faint dots are high-rep, less reliable estimates' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.xs,
  },
  caption: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    marginTop: 2,
  },
});
