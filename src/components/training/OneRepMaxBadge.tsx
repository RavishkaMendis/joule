// ═══════════════════════════════════════════════════════════════════════
// OneRepMaxBadge — renders an estimated 1RM with its confidence made
// visible, not implied. Reuses the same confidence-as-opacity ladder the
// nutrition side uses for entry confidence (theme.colors.confidence) —
// same principle, same visual language: "an estimate from a set of 12
// must not look identical to one from a triple" (task brief), exactly
// like "a ±15% photo estimate must not look identical to a barcode scan"
// on the food side.
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet, Text, View } from 'react-native';
import { colors, numeric, spacing, type } from '../../lib/theme';
import type { OneRepMaxEstimate } from '../../lib/training/oneRepMax';

const CONFIDENCE_LABEL: Record<OneRepMaxEstimate['confidence'], string | null> = {
  high: null,
  medium: 'estimated',
  low: 'rough estimate — high rep count',
};

export function OneRepMaxBadge({ estimate }: { estimate: OneRepMaxEstimate | null }) {
  if (!estimate) return null;

  const color = colors.confidence[estimate.confidence === 'high' ? 'exact' : estimate.confidence];
  const caption = CONFIDENCE_LABEL[estimate.confidence];

  return (
    <View style={styles.container}>
      <Text style={[styles.value, { color }]}>~{Math.round(estimate.value)} kg</Text>
      <Text style={styles.unitLabel}>est. 1RM</Text>
      {caption && <Text style={styles.caption}>{caption}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  value: {
    ...type.bodyStrong,
    ...numeric,
  },
  unitLabel: {
    ...type.caption,
    color: colors.textTertiary,
  },
  caption: {
    ...type.small,
    color: colors.textTertiary,
  },
});
