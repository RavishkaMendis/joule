// ═══════════════════════════════════════════════════════════════════════
// DataQualityChart — PRD §10: "A ±15% photo estimate must not look
// identical to a barcode scan." Shows how much of logged intake (by kcal,
// not entry count) came from each confidence tier, so the user knows how
// much to trust their own numbers.
//
// Uses colors.confidence's fading-opacity ladder (same hue throughout,
// per theme.ts) rather than a red/amber/green trust signal — this is
// information, not a grade. No entry is ever framed as "wrong."
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import { colors, numeric, spacing, type } from '../../lib/theme';
import { chartCard } from './chartCard';
import type { SourceBreakdownSummary } from '../../lib/analytics/sourceBreakdown';

type Props = {
  summary: SourceBreakdownSummary;
};

const CONFIDENCE_LABELS: Record<string, string> = {
  exact: 'Exact (barcode/label)',
  high: 'High (recognised match)',
  medium: 'Medium (voice/estimate)',
  low: 'Low (photo estimate)',
};

export function DataQualityChart({ summary }: Props) {
  if (summary.totalEntries === 0) {
    return (
      <View style={chartCard.container}>
        <Text style={chartCard.title}>Data quality</Text>
        <Text style={[chartCard.empty, styles.empty]}>
          Once you&apos;ve logged some food, this shows how much of it was exact (barcode/label) vs. estimated
          (photo/voice) — so you know how much to trust the numbers above.
        </Text>
      </View>
    );
  }

  const nonZero = summary.byConfidence.filter((c) => c.kcal > 0);

  return (
    <View style={chartCard.container}>
      <View style={chartCard.headerRow}>
        <Text style={chartCard.title}>Data quality</Text>
        {summary.trustedFraction !== null && (
          <Text style={chartCard.subtitle}>{Math.round(summary.trustedFraction * 100)}% exact/high confidence</Text>
        )}
      </View>

      {/* Stacked horizontal bar, one segment per confidence tier present. */}
      <View style={styles.stackBar}>
        {nonZero.map((c) => (
          <View
            key={c.confidence}
            style={{
              flex: c.fraction ?? 0,
              backgroundColor: colors.confidence[c.confidence],
              height: '100%',
            }}
          />
        ))}
      </View>

      <View style={styles.legend}>
        {nonZero.map((c) => (
          <View key={c.confidence} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: colors.confidence[c.confidence] }]} />
            <Text style={styles.legendLabel}>{CONFIDENCE_LABELS[c.confidence] ?? c.confidence}</Text>
            <Text style={styles.legendValue}>{Math.round((c.fraction ?? 0) * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // chartCard.empty has no lineHeight (a one-line empty state everywhere
  // else) — this one wraps to multiple lines, so it needs one added back.
  empty: {
    lineHeight: 19,
  },
  stackBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    marginBottom: spacing.sm,
  },
  legend: {
    gap: 4,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    ...type.small,
    color: colors.textSecondary,
    flex: 1,
  },
  legendValue: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
  },
});
