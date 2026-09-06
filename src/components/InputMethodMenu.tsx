// ═══════════════════════════════════════════════════════════════════════
// InputMethodMenu — the FAB's tap target (PRD §9.1 "tap for menu").
//
// Surfaces the five input paths from PRD §7. Every one of them converges
// on the same shared ConfirmSheet, so this menu only picks HOW the
// PendingEntry gets populated — it never writes to the log itself.
//
// Ordering is deliberate and follows the PRD's own priorities rather
// than alphabetical or "most technically impressive":
//   1. Voice      — §7.1 calls it the primary path
//   2. Meal prep  — §7.5, highest-VALUE path for someone who bulk-preps
//                   and owns a scale (task brief: "the highest-value
//                   accuracy work in the app" — a pot serving is a scale
//                   reading against a computed kcal/g, not a guess).
//                   Placed second, ahead of barcode/label/photo, so it is
//                   never buried behind a Foods-tab sub-tab again.
//   3. Barcode    — §7.2, fastest when it hits
//   4. Label OCR  — §7.3 "the workhorse in AU", always available
//   5. Meal photo — §7.4, honestly the least accurate (±25-40%)
//   6. Manual     — always works, never network-dependent
//
// AI-backed paths are marked when no Gemini key is configured rather
// than hidden, so the user can see the capability exists and what
// unlocks it. Barcode and manual never depend on a key.
// ═══════════════════════════════════════════════════════════════════════

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, minTouchTarget, radii, spacing, type } from '../lib/theme';
import { hasGeminiApiKey } from '../lib/ai/apiKey';

export type InputMethod = 'voice' | 'pot' | 'barcode' | 'label' | 'photo' | 'manual';

type Props = {
  visible: boolean;
  onSelect: (method: InputMethod) => void;
  onClose: () => void;
};

type Option = {
  method: InputMethod;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  /** Needs a Gemini key to function (PRD §8). */
  needsAi: boolean;
};

const OPTIONS: Option[] = [
  { method: 'voice', icon: 'mic-outline', label: 'Voice', hint: 'Say what you ate', needsAi: true },
  {
    method: 'pot',
    icon: 'restaurant-outline',
    label: 'Meal prep',
    hint: 'Log a serving from a batch, or start one',
    needsAi: false,
  },
  { method: 'barcode', icon: 'barcode-outline', label: 'Barcode', hint: 'Scan a packet', needsAi: false },
  { method: 'label', icon: 'document-text-outline', label: 'Nutrition label', hint: 'Photo of the panel', needsAi: true },
  { method: 'photo', icon: 'camera-outline', label: 'Meal photo', hint: 'Estimate from a plate', needsAi: true },
  { method: 'manual', icon: 'create-outline', label: 'Manual', hint: 'Search or type it in', needsAi: false },
];

export function InputMethodMenu({ visible, onSelect, onClose }: Props) {
  const aiReady = hasGeminiApiKey();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        {/* Inner press swallows taps so they don't dismiss the sheet. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          {OPTIONS.map((opt) => {
            const disabled = opt.needsAi && !aiReady;
            return (
              <Pressable
                key={opt.method}
                onPress={() => onSelect(opt.method)}
                disabled={disabled}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && styles.rowDisabled]}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                accessibilityLabel={opt.label}
                accessibilityHint={disabled ? 'Needs a Gemini API key' : opt.hint}
              >
                <Ionicons name={opt.icon} size={22} color={disabled ? colors.textTertiary : colors.text} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, disabled && styles.dimmed]}>{opt.label}</Text>
                  <Text style={styles.rowHint}>{disabled ? 'Add a Gemini API key to enable' : opt.hint}</Text>
                </View>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  rowDisabled: {
    opacity: 0.55,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    ...type.body,
    color: colors.text,
  },
  dimmed: {
    color: colors.textSecondary,
  },
  rowHint: {
    ...type.small,
    color: colors.textTertiary,
  },
});
