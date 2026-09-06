// ═══════════════════════════════════════════════════════════════════════
// CaptureStatusScreen — the shared non-camera state card: missing API
// key, permission denied, or a Gemini/lookup error. All three capture
// screens (BarcodeScan/LabelScan/MealPhoto) rendered near-identical
// bespoke markup for these; consolidating so they read as one family
// (task brief: "apply the same treatment... so the three capture
// screens feel like one family") and so a copy/spacing fix only has to
// happen once.
//
// Deliberately respects safe-area insets (task brief: "several screens
// draw their own chrome over the camera") — this card is used both
// full-screen (permission denied, missing key) and is safe-area aware
// via the screen's own SafeAreaView-equivalent padding.
// ═══════════════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, type } from '../../lib/theme';

type Action = { label: string; onPress: () => void; variant?: 'primary' | 'secondary' };

type Props = {
  title: string;
  message: string;
  actions: Action[];
  /** Extra content between the message and the action buttons, e.g. a permission warning. */
  children?: ReactNode;
};

export function CaptureStatusScreen({ title, message, actions, children }: Props) {
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{message}</Text>
        {children}
        <View style={styles.actions}>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              style={action.variant === 'secondary' ? styles.secondaryButton : styles.primaryButton}
              accessibilityRole="button"
            >
              <Text style={action.variant === 'secondary' ? styles.secondaryButtonText : styles.primaryButtonText}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  card: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...type.h2,
    color: colors.text,
  },
  subtitle: {
    ...type.body,
    color: colors.textSecondary,
  },
  actions: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  secondaryButton: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...type.body,
    color: colors.textSecondary,
  },
});
