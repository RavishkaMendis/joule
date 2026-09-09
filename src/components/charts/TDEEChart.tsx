// ═══════════════════════════════════════════════════════════════════════
// TDEEChart — PRD §9.2: "solid measured line with confidence band; dashed
// grey Zepp line; 'Strap bias: +19%' stat once 30 days exist."
//
// Phase 4 (build order item 19) adds the dashed Zepp/external-estimate
// line on top of Phase 1's solid measured line + band. The Zepp series is
// READ-ONLY reference data (src/db/repositories/externalEstimateRepo.ts,
// via useTrendsData) — this component only renders it, never blends it
// into `series`/`latest`, and never imports anything from src/engine's
// input types for it. The measured line stays visually primary: full
// opacity + solid stroke + the accent colour; Zepp renders dashed, grey,
// and thinner, so it can never be mistaken for the authoritative number
// (task brief: "must never look like the authoritative number").
//
// The band is always drawn — PRD §4.5 "always report a range, never a
// bare number" applies to the chart just as much as the Today headline.
// When dataQuality is 'seeding', an explicit label replaces the implied
// precision of a narrow band.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { colors, numeric, spacing, type } from '../../lib/theme';
import { chartCard } from './chartCard';
import { linearScale, numericExtent, padDomain } from '../../lib/chartScale';
import { dayOffset } from '../../engine/date';
import type { TDEEChartPoint, ZeppChartPoint } from '../../lib/useTrendsData';
import type { StrapBiasResult } from '../../lib/analytics/strapBias';
import type { TDEEResult } from '../../engine/types';

type Props = {
  series: TDEEChartPoint[];
  latest: TDEEResult | null;
  /** Reference-only Zepp series (PRD §11) — dashed subordinate line, never affects the measured line/band above. */
  zeppSeries?: ZeppChartPoint[];
  strapBias?: StrapBiasResult;
  height?: number;
};

const CHART_PADDING = { top: 12, bottom: 12, left: 8, right: 8 };

function qualityLabel(quality: TDEEResult['dataQuality']): string {
  if (quality === 'seeding') return 'Estimated — collecting data';
  if (quality === 'converging') return 'Converging';
  return 'Stable';
}

/**
 * Strap-bias footnote (PRD §9.2: "'Strap bias: +19%' stat once 30 days
 * exist"). Below the 30-overlapping-day gate, state what's needed rather
 * than showing a premature number — never a confident-looking figure built
 * on too little (or entirely seeded) data.
 */
function strapBiasLabel(bias: StrapBiasResult | undefined): string | null {
  if (!bias) return null;
  if (!bias.available) {
    if (bias.overlapDays === 0) return null; // no Zepp data imported at all — nothing to say yet
    return `Strap bias: need ${bias.daysNeeded} more day${bias.daysNeeded === 1 ? '' : 's'} of overlap with measured TDEE (${bias.overlapDays}/30 so far).`;
  }
  const sign = bias.biasPercent > 0 ? '+' : '';
  return `Strap bias: ${sign}${bias.biasPercent}% (avg over ${bias.overlapDays} measured days)`;
}

export function TDEEChart({ series, latest, zeppSeries = [], strapBias, height = 160 }: Props) {
  if (series.length === 0 || !latest) {
    return (
      <View style={chartCard.container}>
        <Text style={chartCard.title}>TDEE</Text>
        <Text style={chartCard.empty}>Log intake and weight for a few days to start estimating.</Text>
      </View>
    );
  }

  const width = 320;
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const xScale = linearScale([0, Math.max(series.length - 1, 1)], [CHART_PADDING.left, CHART_PADDING.left + plotWidth]);

  // Zepp points are plotted by day-offset from the measured series' first
  // date, not by index — the Zepp series can have a different density/date
  // range than the bounded ~20 measured cutoffs, so index alignment would
  // misplace them. Points outside the measured series' date span are
  // dropped rather than extrapolated onto an invented x position.
  const firstDate = series[0].date;
  const lastIndex = series.length - 1;
  const zeppWithNonNull = zeppSeries.filter((p): p is ZeppChartPoint & { tdee_est: number } => p.tdee_est !== null);
  const zeppPositioned = zeppWithNonNull
    .map((p) => ({ ...p, index: dayOffset(firstDate, p.date) }))
    .filter((p) => p.index >= 0 && p.index <= lastIndex)
    .sort((a, b) => a.index - b.index);

  const extent = numericExtent(
    series.map((p) => p.confidenceLow),
    series.map((p) => p.confidenceHigh),
    zeppPositioned.map((p) => p.tdee_est)
  ) ?? [latest.tdee - 200, latest.tdee + 200];
  const yDomain = padDomain(extent, 0.1, 50);
  const yScale = linearScale(yDomain, [CHART_PADDING.top + plotHeight, CHART_PADDING.top]);

  const linePoints = series.map((p, i) => `${xScale(i)},${yScale(p.tdee)}`).join(' ');
  const zeppLinePoints = zeppPositioned.map((p) => `${xScale(p.index)},${yScale(p.tdee_est)}`).join(' ');

  // Confidence band as a closed polygon: upper bound left-to-right, then
  // lower bound right-to-left back to the start.
  const upperPoints = series.map((p, i) => `${xScale(i)},${yScale(p.confidenceHigh)}`);
  const lowerPoints = [...series].reverse().map((p, i) => {
    const idx = series.length - 1 - i;
    return `${xScale(idx)},${yScale(p.confidenceLow)}`;
  });
  const bandPoints = [...upperPoints, ...lowerPoints].join(' ');

  const bandHalfWidth = Math.round((latest.confidenceHigh - latest.confidenceLow) / 2);
  const biasLabel = strapBiasLabel(strapBias);

  return (
    <View style={chartCard.container}>
      <View style={chartCard.headerRow}>
        <Text style={chartCard.title}>TDEE</Text>
        <Text style={chartCard.subtitle}>
          {Math.round(latest.tdee)} ±{bandHalfWidth} kcal
        </Text>
      </View>
      <Svg width={width} height={height}>
        <Polygon points={bandPoints} fill={colors.accent} opacity={0.15} />
        {/* Zepp reference line: dashed, grey, thinner — visually subordinate
            to the measured line below. Reference-only (PRD §11); never
            drawn with the accent colour so it can't be mistaken for the
            authoritative estimate. */}
        {zeppPositioned.length > 1 && (
          <Polyline
            points={zeppLinePoints}
            fill="none"
            stroke={colors.confidence.medium}
            strokeWidth={1.5}
            strokeDasharray="4,4"
            opacity={0.8}
          />
        )}
        <Polyline points={linePoints} fill="none" stroke={colors.accent} strokeWidth={2} />
      </Svg>
      <Text style={styles.qualityLabel}>{qualityLabel(latest.dataQuality)}</Text>
      {biasLabel && <Text style={styles.biasLabel}>{biasLabel}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  qualityLabel: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  biasLabel: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
