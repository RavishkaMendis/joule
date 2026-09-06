// ═══════════════════════════════════════════════════════════════════════
// MealTypeSheet — reassigns an entry's (or a whole meal group's) meal
// type after the fact (PRD §10: "everything editable forever" applies to
// meal_type exactly as it does to grams or kcal).
//
// Opened via LONG-PRESS on an EntryList row, never a tap — tap is already
// spoken for (edit) and this is deliberately not on the fast path (task
// brief: "keep it cheap — this is not the fast path", and the 10-second
// test governs the tap-to-log flow, which this never touches). Picking a
// meal type here fires one callback and closes; there is no separate
// "confirm" step because unlike logging a meal, mis-tagging a meal type
// has no nutritional consequence to double-check.
// ═══════════════════════════════════════════════════════════════════════

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, radii, spacing, type } from '../lib/theme';
import { MEAL_TYPES, MEAL_TYPE_LABEL } from '../lib/mealType';
import type { MealType } from '../db/types';

type Props = {
  visible: boolean;
  /** The entry/group name shown as the sheet's title, so it's unambiguous which row is being reassigned. */
  subjectLabel: string;
  /** Null when the subject is currently Unsorted — no option renders as selected in that case. */
  currentMealType: MealType | null;
  onSelect: (mealType: MealType) => void;
  onClose: () => void;
};

export function MealTypeSheet({ visible, subjectLabel, currentMealType, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        {/* Inner press swallows taps so they don't dismiss the sheet. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.title} numberOfLines={1}>
            {subjectLabel}
          </Text>
          <Text style={styles.subtitle}>Move to…</Text>
          {MEAL_TYPES.map((mealType) => {
            const selected = mealType === currentMealType;
            return (
              <Pressable
                key={mealType}
                onPress={() => onSelect(mealType)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={MEAL_TYPE_LABEL[mealType]}
              >
                <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>
                  {MEAL_TYPE_LABEL[mealType]}
                </Text>
                {selected && <Text style={styles.check}>✓</Text>}
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
  title: {
    ...type.bodyStrong,
    color: colors.text,
    marginBottom: spacing.xs / 2,
  },
  subtitle: {
    ...type.caption,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  rowLabel: {
    ...type.body,
    color: colors.text,
  },
  rowLabelSelected: {
    color: colors.accent,
  },
  check: {
    ...type.bodyStrong,
    color: colors.accent,
  },
});
