// ═══════════════════════════════════════════════════════════════════════
// DateHeader — Today's date switcher (task: "a calendar/date switcher so
// he can go back and log food for yesterday when he forgets").
//
// - Previous/next-day arrows step one day at a time via dateNav.ts's pure
//   `previousDay`/`nextDay` (the latter already clamps at today — see
//   that module's header for why crossing into the future must never be
//   possible: a future-dated intake row would corrupt the TDEE engine's
//   daily axis).
// - A calendar icon opens a lightweight month-grid picker (no new native
//   dependency — this app has no date-picker library installed, and
//   pulling one in for a single screen is unwarranted per this
//   codebase's existing "avoid new native modules" bias, see
//   src/lib/ids.ts's header comment for the same reasoning applied to
//   UUID generation). Tapping any future day in the grid is a no-op
//   (disabled, not silently clamped) so the guardrail is visible, not
//   just enforced.
// - "Today" is rendered as its own one-tap pill whenever the selected
//   date is NOT today, so returning to the default landing state is
//   always a single tap away (task requirement) regardless of how far
//   back the user has navigated.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, numeric, radii, spacing, type } from '../lib/theme';
import { relativeDayLabel, todayLocalISO, toLocalISO } from '../lib/localDate';
import { isNextDayDisabled, nextDay, previousDay } from '../lib/dateNav';

type Props = {
  date: string;
  onChangeDate: (date: string) => void;
};

export function DateHeader({ date, onChangeDate }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isToday = date === todayLocalISO();

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => onChangeDate(previousDay(date))}
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        hitSlop={8}
        style={styles.arrowButton}
      >
        <Text style={styles.arrowText}>‹</Text>
      </Pressable>

      <Pressable
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Choose a date"
        style={styles.dateLabelButton}
      >
        <Text style={styles.dateLabel}>{relativeDayLabel(date)}</Text>
      </Pressable>

      <Pressable
        onPress={() => onChangeDate(nextDay(date))}
        disabled={isNextDayDisabled(date)}
        accessibilityRole="button"
        accessibilityLabel="Next day"
        hitSlop={8}
        style={[styles.arrowButton, isNextDayDisabled(date) && styles.arrowButtonDisabled]}
      >
        <Text style={[styles.arrowText, isNextDayDisabled(date) && styles.arrowTextDisabled]}>›</Text>
      </Pressable>

      {!isToday && (
        <Pressable
          onPress={() => onChangeDate(todayLocalISO())}
          accessibilityRole="button"
          accessibilityLabel="Jump to today"
          style={styles.todayPill}
        >
          <Text style={styles.todayPillText}>Today</Text>
        </Pressable>
      )}

      {pickerOpen && (
        <DatePickerModal
          selected={date}
          onSelect={(d) => {
            onChangeDate(d);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </View>
  );
}

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Lightweight month-grid picker. Future days are visibly disabled, not just unreachable. */
function DatePickerModal({
  selected,
  onSelect,
  onClose,
}: {
  selected: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) {
  const [y, m] = selected.split('-').map(Number);
  const [viewYear, setViewYear] = useState(y);
  const [viewMonth, setViewMonth] = useState(m - 1); // 0-indexed

  const today = todayLocalISO();
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startWeekday = firstOfMonth.getDay();

  const cells: (string | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => toLocalISO(new Date(viewYear, viewMonth, i + 1))),
  ];

  const monthLabel = firstOfMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((yr) => yr - 1);
      setViewMonth(11);
    } else {
      setViewMonth((mo) => mo - 1);
    }
  };
  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((yr) => yr + 1);
      setViewMonth(0);
    } else {
      setViewMonth((mo) => mo + 1);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close date picker">
        <Pressable style={styles.calendarCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.calendarHeader}>
            <Pressable onPress={goPrevMonth} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.calendarNavButton}>
              <Text style={styles.calendarNavText}>‹</Text>
            </Pressable>
            <Text style={styles.calendarMonthLabel}>{monthLabel}</Text>
            <Pressable onPress={goNextMonth} accessibilityRole="button" accessibilityLabel="Next month" style={styles.calendarNavButton}>
              <Text style={styles.calendarNavText}>›</Text>
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((label, i) => (
              <Text key={`${label}-${i}`} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((cellDate, i) => {
              if (!cellDate) return <View key={`blank-${i}`} style={styles.dayCell} />;
              const isFuture = cellDate > today;
              const isSelected = cellDate === selected;
              const isTodayCell = cellDate === today;
              return (
                <Pressable
                  key={cellDate}
                  onPress={() => !isFuture && onSelect(cellDate)}
                  disabled={isFuture}
                  accessibilityRole="button"
                  accessibilityLabel={cellDate}
                  style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                >
                  <Text
                    style={[
                      styles.dayCellText,
                      isFuture && styles.dayCellTextDisabled,
                      isTodayCell && !isSelected && styles.dayCellTextToday,
                      isSelected && styles.dayCellTextSelected,
                    ]}
                  >
                    {Number(cellDate.slice(-2))}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  arrowButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowButtonDisabled: {
    opacity: 0.3,
  },
  arrowText: {
    ...type.h2,
    color: colors.textSecondary,
  },
  arrowTextDisabled: {
    color: colors.textTertiary,
  },
  dateLabelButton: {
    flex: 1,
    alignItems: 'center',
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  dateLabel: {
    ...type.bodyStrong,
    color: colors.text,
  },
  todayPill: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
  },
  todayPillText: {
    ...type.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    // Wide enough that each of the 7 day columns below (this width minus
    // the padding on both sides, divided by 7) clears minTouchTarget —
    // at the previous 320 they landed at ~39dp, under the 44dp minimum.
    width: 360,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  calendarNavButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarNavText: {
    ...type.h2,
    color: colors.textSecondary,
  },
  calendarMonthLabel: {
    ...type.bodyStrong,
    color: colors.text,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  weekdayLabel: {
    ...type.small,
    color: colors.textTertiary,
    width: `${100 / 7}%`,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellSelected: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
  },
  dayCellText: {
    ...type.body,
    ...numeric,
    color: colors.text,
  },
  dayCellTextDisabled: {
    color: colors.textTertiary,
    opacity: 0.4,
  },
  dayCellTextToday: {
    color: colors.accent,
    fontWeight: '600',
  },
  dayCellTextSelected: {
    color: colors.background,
    fontWeight: '600',
  },
});
