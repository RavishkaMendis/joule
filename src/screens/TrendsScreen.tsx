// ═══════════════════════════════════════════════════════════════════════
// TrendsScreen — an analytics dashboard built on PRD §9.2's three
// required charts, extended toward MacroFactor-style depth per the
// dashboard rebuild brief. Every panel below is picked for
// insight-per-pixel, not chart variety, and every one degrades honestly
// with almost no data rather than showing a wall of zeros — see each
// component's own empty-state copy.
//
// Panels, in the order they answer questions a curious user actually
// asks (most foundational first):
//   1. TDEE trend — the band narrowing over time IS the story (PRD §4.5).
//   2. Weight: raw vs trend — faint dots + solid Kalman line (PRD §9.2).
//   3. Energy balance — intake vs expenditure, gap-shaded. The single
//      most explanatory view: shows WHY weight moved, not just that it did.
//   4. Weekly summary table — avg intake/expenditure, weight change, days
//      logged, per week. A table beats a chart here.
//   5. Protein consistency — hit-rate + distribution, not just an average
//      (PRD §9.1: protein is "the macro that matters and the one most
//      often missed").
//   6. By day of week — avg intake per weekday, actionable from very
//      little data (weekends usually differ).
//   7. Intake adherence — bars vs target; unlogged days render as gaps,
//      never zeros (src/lib/adherenceSeries.ts owns that decision).
//   8. Data quality — kcal-weighted confidence/source mix, so the user
//      knows how much to trust the numbers above (PRD §10).
//
// Rejected: a dedicated "rate vs goal" chart. The weight chart's trend
// line plus the weekly table's Δ-weight column already carry that signal
// without a third weight-based visualisation competing for attention.
//
// Read-only, like Today: useTrendsData never calls computeTargets or
// writes anything. Charts use react-native-svg directly, no charting
// library (PRD §10 / task brief).
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../lib/theme';
import { useTrendsData } from '../lib/useTrendsData';
import { TDEEChart } from '../components/charts/TDEEChart';
import { WeightChart } from '../components/charts/WeightChart';
import { AdherenceChart } from '../components/charts/AdherenceChart';
import { EnergyBalanceChart } from '../components/charts/EnergyBalanceChart';
import { WeeklyRollupTable } from '../components/charts/WeeklyRollupTable';
import { DayOfWeekChart } from '../components/charts/DayOfWeekChart';
import { ProteinConsistencyChart } from '../components/charts/ProteinConsistencyChart';
import { DataQualityChart } from '../components/charts/DataQualityChart';

export function TrendsScreen() {
  const trends = useTrendsData();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  // adherenceSeries always spans the full trends window with gap entries
  // (buildAdherenceSeries fills every day, logged or not — see
  // src/lib/adherenceSeries.ts), so its length is never 0. The real "is
  // there anything to chart" signal is whether any day in that window has
  // an actual logged reading.
  const hasAnyData = trends.adherenceSeries.some((d) => d.loggedKcal !== null) || trends.weightSeries.length > 0;

  const { refresh } = trends;
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + spacing.md }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.textSecondary} />}
      >
        <Text style={styles.header}>Trends</Text>

        {trends.error && <Text style={styles.errorText}>{trends.error}</Text>}

        {!hasAnyData ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Nothing to chart yet</Text>
            <Text style={styles.emptyBody}>
              This dashboard fills in as you log — TDEE needs a couple of weeks of weigh-ins to narrow, energy
              balance needs both food and weight logged on overlapping days, and weekly/day-of-week patterns need a
              week or more. Nothing here is broken; there just isn&apos;t data yet. Check back after your first few
              days of food and morning weigh-ins.
            </Text>
          </View>
        ) : (
          <>
            <TDEEChart
              series={trends.tdeeSeries}
              latest={trends.latestTdee}
              zeppSeries={trends.zeppSeries}
              strapBias={trends.strapBias}
            />
            <WeightChart series={trends.weightSeries} />
            <EnergyBalanceChart series={trends.energyBalanceSeries} />
            <WeeklyRollupTable rows={trends.weeklyRollup} />
            <ProteinConsistencyChart summary={trends.proteinConsistency} />
            <DayOfWeekChart pattern={trends.dayOfWeekPattern} />
            <AdherenceChart series={trends.adherenceSeries} />
            <DataQualityChart summary={trends.sourceBreakdown} />

            <Text style={styles.footnote}>
              Last {trends.adherenceSeries.length} days. A missed day is just missing data — it doesn&apos;t count
              against you here or anywhere else in the app.
            </Text>
          </>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: spacing.lg,
  },
  header: {
    ...type.h1,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  errorText: {
    ...type.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  emptyState: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  emptyTitle: {
    ...type.bodyStrong,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    ...type.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  footnote: {
    ...type.caption,
    color: colors.textTertiary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  bottomPadding: {
    height: 48,
  },
});
