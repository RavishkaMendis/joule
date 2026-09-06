// ═══════════════════════════════════════════════════════════════════════
// ConfounderChips — PRD §9.6: "an optional one-tap confounder chip row
// (ate out / travel / ill / poor sleep / alcohol)."
//
// Framed as making the reading *more* useful, not a confession (task
// brief / PRD §9.6) — labels below are worded as plain facts about the
// night before, not admissions of guilt, and there's no visual penalty
// (red, warning icon, etc.) for tapping one.
// ═══════════════════════════════════════════════════════════════════════

import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, radii, spacing, type, minTouchTarget } from '../lib/theme';
import type { Confounder } from '../engine/types';

const CONFOUNDERS: { value: Confounder; label: string }[] = [
  { value: 'ate_out', label: 'Ate out' },
  { value: 'travel', label: 'Travel' },
  { value: 'ill', label: 'Feeling unwell' },
  { value: 'poor_sleep', label: 'Slept poorly' },
  { value: 'alcohol', label: 'Had a drink' },
];

type Props = {
  selected: Confounder | null;
  onSelect: (value: Confounder | null) => void;
};

export function ConfounderChips({ selected, onSelect }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.hint}>Anything that might make today&apos;s reading noisier? (optional)</Text>
      <View style={styles.row}>
        {CONFOUNDERS.map((c) => {
          const active = selected === c.value;
          return (
            <Pressable
              key={c.value}
              onPress={() => onSelect(active ? null : c.value)}
              style={[styles.chip, active && styles.chipActive]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.lg,
  },
  hint: {
    ...type.caption,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.accent,
  },
  chipText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.text,
  },
});
