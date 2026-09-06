// ═══════════════════════════════════════════════════════════════════════
// EnergyBalanceChart — "the single most explanatory view in the app: it
// shows *why* weight is moving" (dashboard rebuild brief). Intake and
// expenditure drawn as two lines with the gap between them shaded — a
// surplus and a deficit render in the same neutral tone (no red/green
// good/bad framing, PRD §10), just different fill directions.
//
// Gap discipline: a day with no logged intake renders NEITHER a line
// segment NOR a shaded gap through that day — see the `null` handling in
// buildSegments below. A missing value must never interpolate through as
// if it were known.
//
// Honesty defect fix — the more serious half of the bug: while
// expenditure is a Mifflin-St Jeor cold-start seed (PRD §4.3), the shaded
// gap between it and logged intake is "your intake vs. a formula's
// guess," not evidence of a real surplus/deficit. Shading it identically
// to a gap built from a converged/stable estimate is the most misleading
// thing on this screen — it visually asserts a measured result that
// isn't one yet.
//
// Chosen treatment (neutral, not a warning):
//   - The expenditure line over 'seeding' days renders further dimmed
//     (via `colors.confidence.low` instead of `colors.textSecondary`),
//     on top of the dashing it already had — a second, independent signal
//     that this segment is less certain, same hue family throughout.
//   - The shaded gap fill is SUPPRESSED entirely over 'seeding' days.
//     Any gap fill already implies "this area under the curve is a real
//     quantity"; over a seeded segment that quantity is arithmetic, not
//     observation, so no fill is drawn rather than a fainter version of
//     the same claim. A once-per-chart footnote explains why days near
//     the start of a data set show no shading, so the absence doesn't
//     read as a rendering bug.
// No red/amber introduced — only the existing confidence-ladder opacity
// steps and the dashing the expenditure line already used.
// ═══════════════════════════════════════════════════════════════════════

import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Polygon } from 'react-native-svg';
import { colors, numeric, spacing, type } from '../../lib/theme';
import { linearScale, numericExtent, padDomain } from '../../lib/chartScale';
import type { EnergyBalancePoint } from '../../lib/analytics/energyBalance';

type Props = {
  series: EnergyBalancePoint[];
  height?: number;
};

const CHART_PADDING = { top: 12, bottom: 12, left: 8, right: 8 };
const MIN_POINTS_TO_RENDER = 3;

/** Split a series into contiguous runs where both values are known, so lines/fills never bridge a gap. */
function contiguousRuns<T>(series: T[], isKnown: (item: T) => boolean): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  series.forEach((item, i) => {
    if (isKnown(item)) {
      current.push(i);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  });
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Further split contiguous runs at seeding/non-seeding boundaries, so a
 * run that starts seeded and later converges gets separate polyline/fill
 * treatment for each stretch instead of one run painted uniformly. Index
 * order and contiguity within each sub-run are preserved.
 */
function splitBySeeding(run: number[], series: EnergyBalancePoint[]): { indices: number[]; seeded: boolean }[] {
  const groups: { indices: number[]; seeded: boolean }[] = [];
  for (const i of run) {
    const seeded = series[i].expenditureQuality === 'seeding';
    const last = groups[groups.length - 1];
    if (last && last.seeded === seeded) {
      last.indices.push(i);
    } else {
      groups.push({ indices: [i], seeded });
    }
  }
  return groups;
}

export function EnergyBalanceChart({ series, height = 170 }: Props) {
  const knownDaysCount = series.filter((p) => p.intakeKcal !== null && p.expenditureKcal !== null).length;

  if (series.length === 0 || knownDaysCount < MIN_POINTS_TO_RENDER) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Energy balance</Text>
        <Text style={styles.empty}>
          Needs a few days of both logged intake and an expenditure estimate — this fills in as you log food and
          weigh in.
        </Text>
      </View>
    );
  }

  const width = 320;
  const plotWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  const xScale = linearScale([0, Math.max(series.length - 1, 1)], [CHART_PADDING.left, CHART_PADDING.left + plotWidth]);

  const extent = numericExtent(
    series.map((p) => p.intakeKcal),
    series.map((p) => p.expenditureKcal)
  ) ?? [1500, 2500];
  const yDomain = padDomain(extent, 0.12, 50);
  const yScale = linearScale(yDomain, [CHART_PADDING.top + plotHeight, CHART_PADDING.top]);

  const bothKnown = (p: EnergyBalancePoint) => p.intakeKcal !== null && p.expenditureKcal !== null;
  const runs = contiguousRuns(series, bothKnown);
  const seedingSubRuns = runs.flatMap((run) => splitBySeeding(run, series));
  const anySeeding = series.some((p) => bothKnown(p) && p.expenditureQuality === 'seeding');

  const intakePolylines = runs.map((run) =>
    run.map((i) => `${xScale(i)},${yScale(series[i].intakeKcal as number)}`).join(' ')
  );
  // Expenditure line split at seeding boundaries so seeded stretches can
  // render further dimmed than the usual "estimated" dashed grey.
  const expenditureSegments = seedingSubRuns.map((group) => ({
    points: group.indices.map((i) => `${xScale(i)},${yScale(series[i].expenditureKcal as number)}`).join(' '),
    seeded: group.seeded,
  }));
  // Shaded gap polygon per seeding sub-run: intake line forward,
  // expenditure line back. Seeded sub-runs are still computed (so the
  // outline can be drawn faintly) but rendered with fill suppressed below
  // — the gap over a seeded estimate is "intake vs. a formula's guess,"
  // not a measured surplus/deficit, and should not visually assert one.
  const gapSegments = seedingSubRuns.map((group) => {
    const forward = group.indices.map((i) => `${xScale(i)},${yScale(series[i].intakeKcal as number)}`);
    const backward = [...group.indices].reverse().map((i) => `${xScale(i)},${yScale(series[i].expenditureKcal as number)}`);
    return { points: [...forward, ...backward].join(' '), seeded: group.seeded };
  });

  const latest = [...series].reverse().find(bothKnown);
  const avgBalance = (() => {
    const balances = series.map((p) => p.balanceKcal).filter((b): b is number => b !== null);
    if (balances.length === 0) return null;
    return balances.reduce((a, b) => a + b, 0) / balances.length;
  })();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Energy balance</Text>
        {avgBalance !== null && (
          <Text style={styles.subtitle}>
            avg {avgBalance >= 0 ? '+' : ''}
            {Math.round(avgBalance)} kcal/day
          </Text>
        )}
      </View>
      <Svg width={width} height={height}>
        {gapSegments.map(
          (seg, i) =>
            // Fill suppressed over seeded days — see module header. The
            // shaded area is meant to read as a measured surplus/deficit;
            // over a cold-start seed it would be shading arithmetic.
            !seg.seeded && <Polygon key={`gap-${i}`} points={seg.points} fill={colors.accent} opacity={0.1} />
        )}
        {expenditureSegments.map((seg, i) => (
          <Polyline
            key={`exp-${i}`}
            points={seg.points}
            fill="none"
            stroke={seg.seeded ? colors.confidence.low : colors.textSecondary}
            strokeWidth={2}
            strokeDasharray="4,3"
          />
        ))}
        {intakePolylines.map((points, i) => (
          <Polyline key={`intake-${i}`} points={points} fill="none" stroke={colors.accent} strokeWidth={2} />
        ))}
      </Svg>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: colors.accent }]} />
          <Text style={styles.legendText}>Intake (logged)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.legendSwatchDashed]} />
          <Text style={styles.legendText}>Expenditure (estimated)</Text>
        </View>
        {anySeeding && (
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, styles.legendSwatchSeeded]} />
            <Text style={styles.legendText}>Expenditure (seeded)</Text>
          </View>
        )}
      </View>
      <Text style={styles.hint}>
        {latest
          ? `Shaded gap is the day's surplus or deficit — it's the same neutral tone either direction.`
          : ''}
      </Text>
      {anySeeding && (
        <Text style={styles.hint}>
          Faint dashed segments with no shading are days before roughly two weeks of data exist — expenditure there
          is a height/weight/age estimate, not yet a measurement, so no surplus/deficit is shaded.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
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
  legendRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 2,
    borderRadius: 1,
  },
  legendSwatchDashed: {
    backgroundColor: colors.textSecondary,
  },
  legendSwatchSeeded: {
    backgroundColor: colors.confidence.low,
  },
  legendText: {
    ...type.small,
    color: colors.textTertiary,
  },
  hint: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
