// ═══════════════════════════════════════════════════════════════════════
// DayOfWeekChart — average logged intake by weekday. "Genuinely
// actionable (weekends usually differ) and computable from very little
// data" (dashboard rebuild brief).
//
// Weekdays with zero samples render as an empty slot (no bar), not a
// zero-height bar — same gap discipline as AdherenceChart. A single
// logged Tuesday is still worth showing; the chart doesn't wait for full
// coverage of all seven weekdays before rendering anything.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors, spacing, type } from '../../lib/theme';
import { chartCard } from './chartCard';
import { linearScale } from '../../lib/chartScale';
import type { DayOfWeekPoint } from '../../lib/analytics/dayOfWeekPattern';

type Props = {
  pattern: DayOfWeekPoint[];
  height?: number;
};

const CHART_PADDING = { top: 12, bottom: 16, left: 8, right: 8 };
const BAR_GAP = 6;

export function DayOfWeekChart({ pattern, height = 150 }: Props) {
  const withData = pattern.filter((p) => p.avgKcal !== null);

  if (withData.length === 0) {
    return (
      <View style={chartCard.container}>
        <Text style={chartCard.title}>By day of week</Text>
        <Text style={chartCard.empty}>Needs a few logged days spread across different weekdays to show a pattern.</Text>
      </View>
    );
  }

  const width = 320;
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const barSlotWidth = plotWidth / pattern.length;
  const barWidth = Math.max(barSlotWidth - BAR_GAP, 1);

  const maxKcal = Math.max(...withData.map((p) => p.avgKcal as number), 1);
  const yScale = linearScale([0, maxKcal * 1.15], [CHART_PADDING.top + plotHeight, CHART_PADDING.top]);

  const overallAvg = withData.reduce((sum, p) => sum + (p.avgKcal as number), 0) / withData.length;

  return (
    <View style={chartCard.container}>
      <View style={chartCard.headerRow}>
        <Text style={chartCard.title}>By day of week</Text>
        <Text style={chartCard.subtitle}>avg {Math.round(overallAvg)} kcal</Text>
      </View>
      <Svg width={width} height={height}>
        {pattern.map((day, i) => {
          if (day.avgKcal === null) return null;
          const x = CHART_PADDING.left + i * barSlotWidth + BAR_GAP / 2;
          const barHeight = Math.max(yScale(0) - yScale(day.avgKcal), 1);
          const y = yScale(day.avgKcal);
          return (
            <Rect
              key={day.label}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={colors.neutral}
              opacity={0.85}
              rx={2}
            />
          );
        })}
      </Svg>
      <View style={styles.labelRow}>
        {pattern.map((day) => (
          <Text key={day.label} style={[styles.dayLabel, { width: barSlotWidth }]}>
            {day.label}
          </Text>
        ))}
      </View>
      {withData.length < pattern.length && (
        <Text style={styles.hint}>Blank days don&apos;t have enough logged data yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
  },
  dayLabel: {
    ...type.small,
    color: colors.textTertiary,
    textAlign: 'center',
  },
  hint: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
