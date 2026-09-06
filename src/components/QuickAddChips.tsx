// ═══════════════════════════════════════════════════════════════════════
// QuickAddChips — PRD §9.1: "4-6 most frequent foods ... one tap each.
// Highest value-per-line-of-code element in the app."
//
// The 10-second test (PRD §9.1) is enforced here structurally: onPress
// calls straight through to logQuickAdd with no confirmation dialog, no
// intermediate screen. Whatever component renders this is responsible for
// giving lightweight, non-blocking feedback (e.g. a toast) — never a
// modal "are you sure?" that would cost the tap its point.
// ═══════════════════════════════════════════════════════════════════════

import { Pressable, ScrollView, Text, StyleSheet } from 'react-native';
import { colors, numeric, radii, spacing, type, minTouchTarget } from '../lib/theme';
import type { SavedFoodRow } from '../db/types';

type Props = {
  candidates: SavedFoodRow[];
  onTap: (food: SavedFoodRow) => void;
  disabled?: boolean;
};

export function QuickAddChips({ candidates, onTap, disabled }: Props) {
  if (candidates.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.container}
    >
      {candidates.map((food) => (
        <Pressable
          key={food.id}
          onPress={() => onTap(food)}
          disabled={disabled}
          style={({ pressed }) => [styles.chip, pressed && !disabled && styles.chipPressed, disabled && styles.chipDisabled]}
          accessibilityRole="button"
          accessibilityLabel={`Quick add ${food.name}, ${Math.round(food.default_grams)} grams`}
          accessibilityState={{ disabled: !!disabled }}
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {food.name}
          </Text>
          <Text style={styles.chipSubtext}>{Math.round(food.default_grams)}g</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  row: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: 160,
  },
  chipPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipText: {
    ...type.body,
    color: colors.text,
  },
  chipSubtext: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
  },
});
