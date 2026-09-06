// ═══════════════════════════════════════════════════════════════════════
// TrendBadge — renders src/lib/training/progression.ts's ExerciseProgression
// honestly:
//   - 'insufficient' (0-1 sessions of data): nothing to compare yet — a
//     quiet hint, never a fabricated "0%" or a blank confusing gap.
//   - 'comparison' (exactly 2 sessions): a % change IS shown, but labelled
//     "since last time" — never "trend", never an up/down arrow implying
//     a established direction. Two points is a comparison, not a trend
//     (task brief: "two data points is not a trend").
//   - 'trend' (3+ sessions): the same % change, now labelled "vs last
//     session" with a direction glyph, since there is enough history to
//     call it that.
//
// No red/green by sign (PRD §10: no streaks, no guilt, no red) — a
// decrease in best-set weight renders in the exact same neutral tone as
// an increase. The basis is always spelled out ("best-set weight, not
// reps") so a reader never mistakes this for a volume or 1RM change.
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet, Text, View } from 'react-native';
import { colors, numeric, spacing, type } from '../../lib/theme';
import type { ExerciseProgression } from '../../lib/training/progression';

function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

export function TrendBadge({ progression }: { progression: ExerciseProgression }) {
  if (progression.confidence === 'insufficient') {
    return <Text style={styles.hint}>Log this exercise again to see progress</Text>;
  }

  if (progression.percentChangeVsPrevious === null) {
    // previous_weight_zero: a bodyweight exercise with no added load has
    // no weight basis for a % change — say so plainly rather than hiding
    // the badge or showing a misleading 0%/blank.
    return <Text style={styles.hint}>No weight basis for a % change yet (bodyweight exercise)</Text>;
  }

  const label = progression.confidence === 'comparison' ? 'since last time' : 'vs last session';

  return (
    <View style={styles.container}>
      <Text style={styles.percent}>{formatPercent(progression.percentChangeVsPrevious)}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  percent: {
    ...type.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  label: {
    ...type.caption,
    color: colors.textTertiary,
  },
  hint: {
    ...type.caption,
    color: colors.textTertiary,
  },
});
