// ═══════════════════════════════════════════════════════════════════════
// Fab — Today's floating action button.
//
// PRD §9.1: "FAB — tap for menu, hold for voice."
//
// Hold-for-voice is deliberately a direct gesture rather than a menu
// item. PRD §7.1 makes voice the PRIMARY input path, and §9.1's
// 10-second test governs this screen: "if logging a repeat meal takes
// longer than 10 seconds, the user stops within a fortnight and the
// engine starves." Routing voice through a menu would add a tap and a
// render to the most-used path in the app.
// ═══════════════════════════════════════════════════════════════════════

import { Pressable, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../lib/theme';

type Props = {
  /** Tap — opens the input-method menu. */
  onPress: () => void;
  /** Hold — jumps straight to voice capture. */
  onLongPress: () => void;
};

export function Fab({ onPress, onLongPress }: Props) {
  // Bottom offset accounts for the device's safe-area inset (gesture bar/
  // home indicator) so the FAB never sits flush against it on devices
  // that have one — spacing.lg alone (the previous fixed value) was fine
  // on a device with no inset but crowds the gesture bar on one that has
  // it.
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      // Slightly shorter than the 500ms default: this is the primary
      // logging gesture and should feel immediate, but long enough that
      // a deliberate tap doesn't trip it.
      delayLongPress={350}
      style={({ pressed }) => [styles.fab, { bottom: spacing.lg + insets.bottom }, pressed && styles.fabPressed]}
      accessibilityRole="button"
      accessibilityLabel="Log food"
      accessibilityHint="Tap to choose an input method, or hold to record a voice note"
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
