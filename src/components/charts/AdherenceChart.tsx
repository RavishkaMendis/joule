// ═══════════════════════════════════════════════════════════════════════
// AdherenceChart — PRD §9.2: "bars vs target; unlogged days render as
// gaps, not zeros."
//
// This is a correctness requirement, not styling (task brief): a day with
// `loggedKcal === null` (src/lib/adherenceSeries.ts's gap signal) renders
// NOTHING at that x position — no bar, no zero-height mark, no dashed
// placeholder implying "0 calories eaten". A zero-height bar would look
// visually identical to "fasted all day", which is a lie the engine
// itself is forbidden from telling (PRD §4.4) and the UI must not tell
// either (PRD §10: "no streaks, no guilt" — a missed day is data-neutral).
//
// Bars are a single neutral tone regardless of over/under target — no red
// "over budget" bar, matching colors.neutral's contract in theme.ts.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { colors, numeric, spacing, type } from '../../lib/theme';
import { linearScale, numericExtent } from '../../lib/chartScale';
import type { AdherenceDay } from '../../lib/adherenceSeries';
import { adherenceLabel } from '../../lib/checkInLogic';

type Props = {
  series: AdherenceDay[];
  height?: number;
};

const CHART_PADDING = { top: 12, bottom: 12, left: 8, right: 8 };
const BAR_GAP = 2;

export function AdherenceChart({ series, height = 140 }: Props) {
  const loggedCount = series.filter((d) => d.loggedKcal !== null).length;

  if (series.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Intake adherence</Text>
        <Text style={styles.empty}>Nothing logged in this window yet.</Text>
      </View>
    );
  }

  const width = 320;
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const barSlotWidth = plotWidth / series.length;
  const barWidth = Math.max(barSlotWidth - BAR_GAP, 1);

  const targetKcal = series.find((d) => d.targetKcal !== null)?.targetKcal ?? null;
  const extent = numericExtent(
    series.map((d) => d.loggedKcal),
    targetKcal !== null ? [targetKcal] : []
  ) ?? [0, 2500];
  const yMax = Math.max(extent[1] * 1.1, 1);
  const yScale = linearScale([0, yMax], [CHART_PADDING.top + plotHeight, CHART_PADDING.top]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Intake adherence</Text>
        <Text style={styles.subtitle}>{adherenceLabel(loggedCount, series.length)}</Text>
      </View>
      <Svg width={width} height={height}>
        {targetKcal !== null && (
          <Line
            x1={CHART_PADDING.left}
            x2={width - CHART_PADDING.right}
            y1={yScale(targetKcal)}
            y2={yScale(targetKcal)}
            stroke={colors.textTertiary}
            strokeWidth={1}
            strokeDasharray="4,4"
          />
        )}
        {series.map((day, i) => {
          // The gap contract: no logged value at all -> render nothing for
          // this day. This is the one branch that makes the "gaps, not
          // zeros" requirement true; do not add an else-bar here.
          if (day.loggedKcal === null) return null;

          const x = CHART_PADDING.left + i * barSlotWidth + BAR_GAP / 2;
          const barHeight = Math.max(yScale(0) - yScale(day.loggedKcal), 1);
          const y = yScale(day.loggedKcal);

          return (
            <Rect
              key={day.date}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={colors.neutral}
              opacity={day.isComplete ? 0.85 : 0.45}
              rx={2}
            />
          );
        })}
      </Svg>
      <Text style={styles.hint}>Gaps are unlogged days, not zero-calorie days.</Text>
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
  hint: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
