// ═══════════════════════════════════════════════════════════════════════
// SessionVolumeChart — per-session total volume, chronological. "The
// clearest 'am I doing more work' signal" (task brief).
//
// Bars are a single neutral colour, not coloured by session type/category
// — see sessionVolumeSeries.ts's header for why (no session-type field in
// the schema, no categorical palette in theme.ts). Muscle-group balance
// gets its own dedicated, text-labelled panel instead.
//
// Degrades honestly at low counts: zero sessions gets a full explanatory
// empty state; 1-2 sessions still render the real bar(s) (hiding real data
// isn't "graceful," per the task brief's "make it genuinely useful, not a
// skeleton") but adds a caption saying it becomes more useful with more
// history, rather than presenting a single bar as if it were already a
// meaningful picture.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { colors, numeric, radii, spacing, type } from '../../lib/theme';
import { linearScale } from '../../lib/chartScale';
import type { SessionVolumePoint } from '../../lib/training/sessionVolumeSeries';

type Props = {
  series: SessionVolumePoint[];
  height?: number;
};

const CHART_PADDING = { top: 12, bottom: 16, left: 8, right: 8 };
const BAR_GAP = 3;
const SPARSE_THRESHOLD = 3;

export function SessionVolumeChart({ series, height = 160 }: Props) {
  if (series.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Volume over time</Text>
        <Text style={styles.empty}>
          Needs at least one logged session — each bar will be one session&apos;s total working volume, in order.
        </Text>
      </View>
    );
  }

  const width = 320;
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const barSlotWidth = plotWidth / series.length;
  const barWidth = Math.max(barSlotWidth - BAR_GAP, 2);

  const maxVolume = Math.max(...series.map((p) => p.totalVolume), 1);
  const yScale = linearScale([0, maxVolume * 1.1], [CHART_PADDING.top + plotHeight, CHART_PADDING.top]);

  const totalVolume = series.reduce((sum, p) => sum + p.totalVolume, 0);
  const avgVolume = totalVolume / series.length;

  const first = series[0];
  const last = series[series.length - 1];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Volume over time</Text>
        <Text style={styles.subtitle}>avg {Math.round(avgVolume).toLocaleString()} kg/session</Text>
      </View>
      <Svg width={width} height={height}>
        {series.map((point, i) => {
          const x = CHART_PADDING.left + i * barSlotWidth + BAR_GAP / 2;
          const barHeight = Math.max(yScale(0) - yScale(point.totalVolume), point.totalVolume > 0 ? 2 : 1);
          const y = yScale(0) - barHeight;
          return (
            <Rect
              key={point.sessionId}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={colors.neutral}
              opacity={point.totalVolume > 0 ? 0.85 : 0.25}
              rx={1.5}
            />
          );
        })}
      </Svg>
      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>{first.date}</Text>
        {series.length > 1 && <Text style={styles.axisLabel}>{last.date}</Text>}
      </View>
      <Text style={styles.hint}>
        Volume = Σ(weight × reps) over working sets only; warm-ups don&apos;t count. One bar per session, in order —
        a week with no session simply has no bar, it isn&apos;t drawn as zero.
      </Text>
      {series.length < SPARSE_THRESHOLD && (
        <Text style={styles.hint}>
          Only {series.length} session{series.length === 1 ? '' : 's'} so far — this becomes a genuinely useful
          picture after a few more.
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
    ...numeric,
    color: colors.textSecondary,
  },
  empty: {
    ...type.caption,
    color: colors.textTertiary,
    lineHeight: 19,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  axisLabel: {
    ...type.small,
    color: colors.textTertiary,
  },
  hint: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.xs,
    lineHeight: 15,
  },
});
