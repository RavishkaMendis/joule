// ═══════════════════════════════════════════════════════════════════════
// SourceIcon — small per-row glyph so exactness is visible at a glance
// (PRD §9.1: "small source icon per row so exactness is visible at a
// glance"). Deliberately text-glyph based (no icon font/SVG dependency)
// and coloured from the `colors.confidence` ladder — never a red/green
// pass/fail signal (PRD §10).
// ═══════════════════════════════════════════════════════════════════════

import { Text, View, StyleSheet } from 'react-native';
import { colors, type } from '../lib/theme';
import type { EntryConfidence, FoodEntrySource } from '../db/types';

const SOURCE_GLYPH: Record<FoodEntrySource, string> = {
  manual: 'M',
  barcode: 'B',
  label_ocr: 'L',
  meal_photo: 'P',
  voice: 'V',
  pot: 'PT',
  afcd: 'DB',
};

const SOURCE_LABEL: Record<FoodEntrySource, string> = {
  manual: 'Manual entry',
  barcode: 'Barcode scan',
  label_ocr: 'Label scan',
  meal_photo: 'Photo estimate',
  voice: 'Voice note',
  pot: 'Pot serving',
  afcd: 'Food database',
};

type Props = {
  source: FoodEntrySource;
  confidence: EntryConfidence;
};

export function SourceIcon({ source, confidence }: Props) {
  const tint = colors.confidence[confidence];
  return (
    <View style={styles.container} accessibilityLabel={`${SOURCE_LABEL[source]}, ${confidence} confidence`}>
      <Text style={[styles.glyph, { color: tint, borderColor: tint }]}>{SOURCE_GLYPH[source]}</Text>
      {confidence !== 'exact' && <Text style={[styles.confidenceLabel, { color: tint }]}>{confidence}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    minWidth: 28,
  },
  glyph: {
    ...type.small,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  confidenceLabel: {
    fontSize: 9,
    marginTop: 2,
  },
});
