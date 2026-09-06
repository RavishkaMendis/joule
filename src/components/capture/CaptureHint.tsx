// ═══════════════════════════════════════════════════════════════════════
// CaptureHint — the small pill of guidance text overlaid on a live
// camera view ("Frame the per-100g nutrition column", "Point the camera
// at a barcode"). Pulled out so all three capture screens render this
// identically instead of three near-duplicate inline <Text> styles.
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet, Text } from 'react-native';
import { colors, radii, spacing, type } from '../../lib/theme';

export function CaptureHint({ children }: { children: string }) {
  return <Text style={styles.hint}>{children}</Text>;
}

const styles = StyleSheet.create({
  hint: {
    ...type.body,
    color: colors.text,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    textAlign: 'center',
    overflow: 'hidden',
  },
});
