// ═══════════════════════════════════════════════════════════════════════
// chartCard — shared card chrome for every Trends panel (TDEEChart,
// WeightChart, EnergyBalanceChart, WeeklyRollupTable, DayOfWeekChart,
// ProteinConsistencyChart, DataQualityChart, AdherenceChart).
//
// Extracted so "a card should look like a card everywhere" (UI polish
// pass) is enforced by one definition instead of eight near-identical
// copies that could silently drift. The eight callers previously each
// hardcoded `borderRadius: 12` locally — a value that matched neither
// `radii.md` (10, used by every other card on Today: WeightPrompt, the
// check-in/first-run banners) nor `radii.lg` (16, used by sheets/modals).
// Standardised on `radii.md` here so every card-shaped surface in the
// app, Trends panel or Today banner, reads as the same kind of object.
//
// Each chart keeps its own chart-specific styles (legend rows, axis
// labels, hints, the SVG itself) locally — only the chrome every panel
// shares (outer card, header row, title, subtitle, empty-state text)
// lives here.
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet } from 'react-native';
import { colors, numeric, radii, spacing, type } from '../../lib/theme';

export const chartCard = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  title: {
    ...type.bodyStrong,
    color: colors.text,
  },
  subtitle: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  empty: {
    ...type.caption,
    color: colors.textTertiary,
  },
});
