// ═══════════════════════════════════════════════════════════════════════
// WeeklyRollupTable — "a table beats a chart here" (dashboard rebuild
// brief). One row per calendar week: avg intake, avg expenditure, weight
// change, days logged. Most recent week first.
//
// Every cell independently renders "—" when its underlying value is null
// (a week with 0 logged days, or fewer than 2 weight readings) rather
// than a 0 that would misread as "ate/weighed nothing." Weight change is
// shown with a sign but no colour — same neutral tone whether up or down
// (PRD §10: no red, no guilt).
//
// Honesty defect fix: a real user saw "Intake 1,399 / Expend. 2,343"
// after two days of logging and asked how there could already be an
// expenditure figure — 2,343 was a Mifflin-St Jeor cold-start seed (PRD
// §4.3), pure arithmetic from height/weight/age/activity with zero
// information from actual logging, rendered as a bare number identical to
// genuinely measured intake. The Expend. column now dims non-'stable'
// weeks via the existing `colors.confidence` ladder and prefixes them
// with "~" — no new colour, per PRD §10's no-red rule and theme.ts's
// deliberate absence of a warning swatch. A footnote explains why.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import { colors, numeric, spacing, type } from '../../lib/theme';
import { chartCard } from './chartCard';
import type { WeeklyRollupRow } from '../../lib/analytics/weeklyRollup';
import type { DataQuality } from '../../engine/types';

type Props = {
  rows: WeeklyRollupRow[];
};

function fmtKcal(v: number | null): string {
  return v === null ? '—' : Math.round(v).toLocaleString();
}

/**
 * Expenditure gets its own formatter (vs `fmtKcal` for intake) because,
 * unlike intake, it is frequently not a measurement — see module header.
 * A '~' prefix appears for anything less than 'stable' so the number
 * itself signals "estimate" even before the colour does.
 */
function fmtExpenditure(v: number | null, quality: DataQuality | null): string {
  if (v === null) return '—';
  const rounded = Math.round(v).toLocaleString();
  return quality !== null && quality !== 'stable' ? `~${rounded}` : rounded;
}

/** Maps engine DataQuality onto the existing confidence-ladder colours — never a new hue. */
function expenditureColor(quality: DataQuality | null): string {
  if (quality === 'seeding') return colors.confidence.low;
  if (quality === 'converging') return colors.confidence.medium;
  return colors.text;
}

function fmtWeightChange(v: number | null): string {
  if (v === null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)} kg`;
}

/** True if any displayed row's expenditure is not yet 'stable' — gates the explanatory footnote. */
function hasEstimatedExpenditure(rows: WeeklyRollupRow[]): boolean {
  return rows.some((r) => r.expenditureQuality !== null && r.expenditureQuality !== 'stable');
}

export function WeeklyRollupTable({ rows }: Props) {
  // Most recent week first; drop weeks with zero logged days AND no
  // weight data at all — nothing to show, and an all-dash row is just
  // noise. Still keep at least one row so the panel doesn't disappear
  // entirely the moment there's any data.
  const withData = rows.filter((r) => r.daysLogged > 0 || r.weightChangeKg !== null);
  const displayRows = [...(withData.length > 0 ? withData : rows)].reverse();

  if (displayRows.length === 0) {
    return (
      <View style={chartCard.container}>
        <Text style={[chartCard.title, styles.title]}>Weekly summary</Text>
        <Text style={chartCard.empty}>Log for a week to see your first weekly summary here.</Text>
      </View>
    );
  }

  return (
    <View style={chartCard.container}>
      <Text style={[chartCard.title, styles.title]}>Weekly summary</Text>
      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, styles.weekCol]}>Week</Text>
        <Text style={[styles.headerCell, styles.numCol]}>Intake</Text>
        <Text style={[styles.headerCell, styles.numCol]}>Expend.</Text>
        <Text style={[styles.headerCell, styles.numCol]}>Δ Weight</Text>
        <Text style={[styles.headerCell, styles.daysCol]}>Logged</Text>
      </View>
      {displayRows.map((row) => (
        <View key={row.weekStart} style={styles.dataRow}>
          <Text style={[styles.cell, styles.weekCol]}>{row.label}</Text>
          <Text style={[styles.cell, styles.numCol]}>{fmtKcal(row.avgIntakeKcal)}</Text>
          <Text style={[styles.cell, styles.numCol, { color: expenditureColor(row.expenditureQuality) }]}>
            {fmtExpenditure(row.avgExpenditureKcal, row.expenditureQuality)}
          </Text>
          <Text style={[styles.cell, styles.numCol]}>{fmtWeightChange(row.weightChangeKg)}</Text>
          <Text style={[styles.cell, styles.daysCol]}>
            {row.daysLogged}/{row.daysInWeek}
          </Text>
        </View>
      ))}
      {hasEstimatedExpenditure(displayRows) && (
        <Text style={styles.footnote}>
          ~ Expenditure is estimated from height/weight/age until roughly two weeks of logging exist, then blends
          toward a measured value (PRD §4.3).
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // chartCard.title has no bottom margin (in every other chart it sits
  // inline inside a headerRow) — this title stands alone on its own line
  // above the table, so it needs one added back.
  title: {
    marginBottom: spacing.sm,
  },
  footnote: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerCell: {
    ...type.sectionLabel,
    color: colors.textTertiary,
  },
  dataRow: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cell: {
    ...type.caption,
    ...numeric,
    color: colors.text,
  },
  weekCol: {
    flex: 1.1,
  },
  numCol: {
    flex: 1,
    textAlign: 'right',
  },
  daysCol: {
    flex: 0.8,
    textAlign: 'right',
  },
});
