// ═══════════════════════════════════════════════════════════════════════
// CaptureControlBar — the shared control row for all three capture
// screens (camera/barcode/label). Reported bug #3: "gallery/bottom area
// looks unpolished — two stacked text links under the shutter, cramped
// and misaligned." Reported bug #4: "camera screen layout generally
// weak."
//
// Fix: one deliberate row. Shutter is the visually dominant, centred
// control (72dp, unchanged size). Gallery sits to one side as a real
// icon-labelled button, not a floating text link; manual entry sits
// below as a single quiet, centred line — so there is exactly one
// "escape hatch" at each visual weight instead of two competing links.
// Every tappable control meets the 44dp minimum (PRD §10) even where the
// visible glyph is smaller, via `minTouchTarget` sizing/hitSlop.
// ═══════════════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, radii, spacing, type } from '../../lib/theme';

type Props = {
  /** Fires the primary capture action (shutter tap or barcode scan is passive so this is often just the shutter). */
  onShutterPress?: () => void;
  /** Hidden entirely (e.g. BarcodeScanScreen, which captures passively via onBarcodeScanned). */
  showShutter?: boolean;
  onGalleryPress: () => void;
  onManualEntryPress: () => void;
  /** Optional third slot next to the shutter (MealPhotoScreen's hold-to-record mic). Rendered opposite the gallery button so the shutter stays centred. */
  leadingAccessory?: ReactNode;
  disabled?: boolean;
};

export function CaptureControlBar({
  onShutterPress,
  showShutter = true,
  onGalleryPress,
  onManualEntryPress,
  leadingAccessory,
  disabled = false,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.sideSlot}>{leadingAccessory}</View>

        {showShutter && (
          <Pressable
            onPress={onShutterPress}
            disabled={disabled}
            style={({ pressed }) => [styles.shutterButton, pressed && styles.shutterButtonPressed, disabled && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
          >
            <View style={styles.shutterInner} />
          </Pressable>
        )}

        <View style={styles.sideSlot}>
          <Pressable
            onPress={onGalleryPress}
            disabled={disabled}
            style={({ pressed }) => [styles.galleryButton, pressed && styles.galleryButtonPressed, disabled && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Choose photo from gallery"
            hitSlop={8}
          >
            <Text style={styles.galleryIcon}>🖼️</Text>
            <Text style={styles.galleryLabel}>Gallery</Text>
          </Pressable>
        </View>
      </View>

      <Pressable onPress={onManualEntryPress} style={styles.manualEntryButton} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.manualEntryText}>Enter manually instead</Text>
      </Pressable>
    </View>
  );
}

const SIDE_SLOT_WIDTH = 72;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    alignSelf: 'stretch',
  },
  sideSlot: {
    width: SIDE_SLOT_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterButtonPressed: {
    opacity: 0.7,
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.text,
  },
  galleryButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  galleryButtonPressed: {
    opacity: 0.6,
  },
  galleryIcon: {
    fontSize: 22,
  },
  galleryLabel: {
    ...type.small,
    color: colors.textSecondary,
  },
  disabled: {
    opacity: 0.35,
  },
  manualEntryButton: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualEntryText: {
    ...type.body,
    color: colors.accent,
  },
});
