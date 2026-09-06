// ═══════════════════════════════════════════════════════════════════════
// WindowSelector — 3-way pill control for the training dashboard's time
// window (4 weeks / 12 weeks / all time). The selected pill uses
// colors.accent, matching theme.ts's own stated use case for the accent
// colour ("current selection") — no new colour introduced.
// ═══════════════════════════════════════════════════════════════════════

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, numeric, radii, spacing, type, minTouchTarget } from '../../lib/theme';
import { DASHBOARD_WINDOW_OPTIONS, type DashboardWindow } from '../../lib/training/dashboardWindow';

type Props = {
  value: DashboardWindow;
  onChange: (value: DashboardWindow) => void;
};

export function WindowSelector({ value, onChange }: Props) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {DASHBOARD_WINDOW_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.pill, active && styles.pillActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minHeight: minTouchTarget * 0.6,
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pillText: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.background,
    fontWeight: '600',
  },
});
