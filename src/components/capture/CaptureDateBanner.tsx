// ═══════════════════════════════════════════════════════════════════════
// CaptureDateBanner — "Logging to Tue 26 Aug" line for the four capture
// routes (barcode/label/photo/voice) when the user opened them while
// browsing a PAST day on Today (task fix: these routes used to always
// call todayLocalISO(), silently logging a backfilled photo/voice capture
// against today even when the user was clearly browsing yesterday).
//
// Deliberately silent (renders nothing) when `date` is today — PRD §10's
// "confidence always visible" spirit applies here too: the abnormal case
// (logging to a non-today date) must be visible, but the normal case
// (logging to today, the overwhelming majority of captures) must stay
// exactly as quiet as it always was. No banner ever means "today", full
// stop — never omitted-but-actually-past.
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet, Text } from 'react-native';
import { colors, radii, spacing, type } from '../../lib/theme';
import { formatDayLabel, isToday } from '../../lib/localDate';

export function CaptureDateBanner({ date }: { date: string }) {
  if (isToday(date)) return null;
  return (
    <Text style={styles.banner} accessibilityLabel={`Logging to ${formatDayLabel(date)}, not today`}>
      Logging to {formatDayLabel(date)}
    </Text>
  );
}

const styles = StyleSheet.create({
  banner: {
    ...type.caption,
    color: colors.accent,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    textAlign: 'center',
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
});
