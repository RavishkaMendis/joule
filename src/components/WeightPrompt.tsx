// ═══════════════════════════════════════════════════════════════════════
// WeightPrompt — the prominent morning prompt on Today when no weight
// reading exists yet for today (PRD §9.6).
// ═══════════════════════════════════════════════════════════════════════

import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, radii, spacing, type, minTouchTarget } from '../lib/theme';

type Props = {
  onPress: () => void;
};

export function WeightPrompt({ onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Log today's weight"
    >
      <View>
        <Text style={styles.title}>Log this morning&apos;s weight</Text>
        <Text style={styles.subtitle}>Takes five seconds — one number.</Text>
      </View>
      <Text style={styles.chevron}>{'>'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    // No marginTop here — TodayScreen places its own spacer above this
    // (tightSpacer), matching how the check-in/first-run banners in the
    // same "one next action" slot get their spacing purely from the
    // spacer, not a mix of spacer-plus-internal-margin.
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfaceAlt,
  },
  title: {
    ...type.bodyStrong,
    color: colors.text,
  },
  subtitle: {
    ...type.caption,
    color: colors.textTertiary,
    marginTop: 2,
  },
  chevron: {
    ...type.h2,
    color: colors.textTertiary,
  },
});
