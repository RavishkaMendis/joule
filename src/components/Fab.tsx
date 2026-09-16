// ═══════════════════════════════════════════════════════════════════════
// Fab — Today's floating action button.
//
// PRD §9.1 originally specified "tap for menu, hold for voice," with
// hold-for-voice as a direct gesture bypassing the menu entirely (voice
// was the PRIMARY input path, and the 10-second test — "if logging a
// repeat meal takes longer than 10 seconds, the user stops within a
// fortnight" — meant routing it through a menu tap would have cost too
// much). Voice logging has since been removed (the owner didn't use it),
// so the hold gesture no longer has anywhere to go — this is now a plain
// tap-for-menu button. See InputMethodMenu.tsx for the remaining paths.
// ═══════════════════════════════════════════════════════════════════════

import { Pressable, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../lib/theme';

type Props = {
  /** Tap — opens the input-method menu. */
  onPress: () => void;
};

export function Fab({ onPress }: Props) {
  // Bottom offset accounts for the device's safe-area inset (gesture bar/
  // home indicator) so the FAB never sits flush against it on devices
  // that have one — spacing.lg alone (the previous fixed value) was fine
  // on a device with no inset but crowds the gesture bar on one that has
  // it.
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.fab, { bottom: spacing.lg + insets.bottom }, pressed && styles.fabPressed]}
      accessibilityRole="button"
      accessibilityLabel="Log food"
      accessibilityHint="Tap to choose an input method"
    >
      <Text style={styles.plus}>+</Text>
    </Pressable>
  );
}

const SIZE = 56;

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: SIZE,
    height: SIZE,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPressed: {
    opacity: 0.8,
  },
  plus: {
    fontSize: 32,
    lineHeight: 36,
    color: colors.background,
  },
});
