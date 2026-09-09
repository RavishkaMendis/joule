// ═══════════════════════════════════════════════════════════════════════
// useTrendsData — the one seam between TrendsScreen and the engine/db for
// chart/dashboard data, mirroring how useEngine.ts is the one seam for
// Today.
//
// Assembles chart-ready series and dashboard panel data:
//   - weight: raw readings + Kalman-smoothed line (PRD §9.2)
//   - tdee: a rolling TDEEResult computed at each day in the window, so the
//     chart can show how the estimate (and its band) evolved over time —
//     NOT just today's single point. This re-runs computeTDEE once per
//     chart point, which is cheap/pure per the engine's own docs, but
//     bounded to a reasonable chart resolution (MAX_TDEE_CHART_POINTS = 20,
//     src/lib/trendsChartMath.ts) so a long history doesn't mean dozens of
//     evaluations of an O(n^2)-ish sensitivity routine more than necessary.
//   - adherence: gap-aware daily kcal-vs-target series (src/lib/adherenceSeries.ts)
//   - energyBalance: intake vs expenditure per day, expenditure interpolated
//     from the same bounded TDEE cutoffs (src/lib/analytics/energyBalance.ts)
//   - weeklyRollup: per-week avg intake/expenditure/weight-change/days-logged
//     (src/lib/analytics/weeklyRollup.ts)
//   - dayOfWeekPattern: avg logged kcal per weekday (src/lib/analytics/dayOfWeekPattern.ts)
//   - proteinConsistency: hit-rate + distribution vs the accepted protein
//     target (src/lib/analytics/proteinConsistency.ts)
//   - sourceBreakdown: kcal-weighted confidence/source mix from food_entry
//     rows (src/lib/analytics/sourceBreakdown.ts)
//
// None of the analytics/** modules re-derive engine maths — they only
// reshape data the engine (or this hook) already computed. This hook
// itself never calls computeTargets or writes anything, matching
// useEngine's contract for every screen except the weekly check-in.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import type { Database } from '../db/database';
import * as intakeRepo from '../db/repositories/intakeRepo';
import * as weightRepo from '../db/repositories/weightRepo';
import * as profileRepo from '../db/repositories/profileRepo';
import * as foodRepo from '../db/repositories/foodRepo';
import * as externalEstimateRepo from '../db/repositories/externalEstimateRepo';
import { computeTDEE } from '../engine/tdee';
import { runKalmanFilter } from '../engine/kalman';
import type { DataQuality, DayIntake, TDEEResult, UserProfile, WeightLog } from '../engine/types';
import { addDaysISO, buildDailyAxis, dayOffset } from '../engine/date';
import { getAcceptedTargets, type StoredTargets } from './targetsStore';
import { buildAdherenceSeries, type AdherenceDay } from './adherenceSeries';
import { getDatabase } from './db';
import { todayLocalISO } from './localDate';
import { pickChartDayOffsets, MAX_TDEE_CHART_POINTS } from './trendsChartMath';
import {
  buildEnergyBalanceSeries,
  interpolateExpenditure,
  type EnergyBalancePoint,
  type ExpenditureEstimate,
} from './analytics/energyBalance';
import { buildWeeklyRollup, type WeeklyRollupRow } from './analytics/weeklyRollup';
import { buildDayOfWeekPattern, type DayOfWeekPoint } from './analytics/dayOfWeekPattern';
import { summarizeProteinConsistency, type ProteinConsistencySummary } from './analytics/proteinConsistency';
import { summarizeSourceBreakdown, type SourceBreakdownSummary } from './analytics/sourceBreakdown';
import { computeStrapBias, type StrapBiasResult } from './analytics/strapBias';
import { filterIntakeForEngine } from './engineInput';

const TRENDS_WINDOW_DAYS = 60;

const DEFAULT_PROFILE: UserProfile = {
  height_cm: 170,
  birth_year: 1995,
  sex: 'male',
  goal: 'maintain',
  rate_kg_per_week: 0,
  activity_seed: 'sedentary',
  protein_override: null,
  units: 'metric',
};

function toDayIntake(row: {
  date: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  is_complete: number;
}): DayIntake {
  return {
    date: row.date,
    kcal: row.kcal ?? 0,
    protein_g: row.protein_g ?? 0,
    carbs_g: row.carbs_g ?? 0,
    fat_g: row.fat_g ?? 0,
    is_complete: row.is_complete !== 0,
  };
}

function toWeightLog(row: { date: string; weight_kg: number; confounder: WeightLog['confounder'] }): WeightLog {
  return { date: row.date, weight_kg: row.weight_kg, confounder: row.confounder };
}

function toUserProfile(row: {
  height_cm: number;
  birth_year: number;
  sex: string;
  goal: string;
  rate_kg_per_week: number;
  activity_seed: string;
  protein_override: number | null;
  units: string;
}): UserProfile {
  return {
    height_cm: row.height_cm,
    birth_year: row.birth_year,
    sex: row.sex as UserProfile['sex'],
    goal: row.goal as UserProfile['goal'],
    rate_kg_per_week: row.rate_kg_per_week,
    activity_seed: row.activity_seed as UserProfile['activity_seed'],
    protein_override: row.protein_override,
    units: row.units as UserProfile['units'],
  };
}

export type WeightChartPoint = {
  date: string;
  rawKg: number | null;
  smoothedKg: number;
};

export type TDEEChartPoint = {
  date: string;
  tdee: number;
  confidenceLow: number;
  confidenceHigh: number;
  /**
   * Carried straight through from this cutoff's `computeTDEE` result.
   * Before this field existed, every downstream panel (weekly table,
   * energy-balance chart) discarded quality entirely and rendered a
   * Mifflin-St Jeor cold-start seed identically to a measured estimate —
   * see PRD §4.3 and the analytics-layer honesty-defect fix.
   */
  dataQuality: DataQuality;
};

/**
 * One day's Zepp (or other 'source') reference TDEE, for the dashed
 * subordinate line on the TDEE chart (PRD §9.2). REFERENCE ONLY — this
 * type mirrors external_estimate.tdee_est and is only ever read from
 * src/db/repositories/externalEstimateRepo.ts, never fed into computeTDEE.
 */
export type ZeppChartPoint = {
  date: string;
  tdee_est: number | null;
};

export type TrendsData = {
  loading: boolean;
  error: string | null;
  weightSeries: WeightChartPoint[];
  tdeeSeries: TDEEChartPoint[];
  zeppSeries: ZeppChartPoint[];
  strapBias: StrapBiasResult;
  adherenceSeries: AdherenceDay[];
  latestTdee: TDEEResult | null;
  targets: StoredTargets | null;
  energyBalanceSeries: EnergyBalancePoint[];
  weeklyRollup: WeeklyRollupRow[];
  dayOfWeekPattern: DayOfWeekPoint[];
  proteinConsistency: ProteinConsistencySummary;
  sourceBreakdown: SourceBreakdownSummary;
  refresh: () => Promise<void>;
};

const EMPTY_PROTEIN_CONSISTENCY: ProteinConsistencySummary = {
  loggedDays: 0,
  daysHitTarget: 0,
  hitRateFraction: null,
  avgProteinG: null,
  medianProteinG: null,
  histogram: [],
};

const EMPTY_SOURCE_BREAKDOWN: SourceBreakdownSummary = {
  totalKcal: 0,
  totalEntries: 0,
  byConfidence: [],
  trustedFraction: null,
};

export function useTrendsData(db?: Database): TrendsData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weightSeries, setWeightSeries] = useState<WeightChartPoint[]>([]);
  const [tdeeSeries, setTdeeSeries] = useState<TDEEChartPoint[]>([]);
  const [zeppSeries, setZeppSeries] = useState<ZeppChartPoint[]>([]);
  const [strapBias, setStrapBias] = useState<StrapBiasResult>({
    available: false,
    overlapDays: 0,
    daysNeeded: 30,
  });
  const [adherenceSeries, setAdherenceSeries] = useState<AdherenceDay[]>([]);
  const [latestTdee, setLatestTdee] = useState<TDEEResult | null>(null);
  const [targets, setTargets] = useState<StoredTargets | null>(null);
  const [energyBalanceSeries, setEnergyBalanceSeries] = useState<EnergyBalancePoint[]>([]);
  const [weeklyRollup, setWeeklyRollup] = useState<WeeklyRollupRow[]>([]);
  const [dayOfWeekPattern, setDayOfWeekPattern] = useState<DayOfWeekPoint[]>([]);
  const [proteinConsistency, setProteinConsistency] = useState<ProteinConsistencySummary>(EMPTY_PROTEIN_CONSISTENCY);
  const [sourceBreakdown, setSourceBreakdown] = useState<SourceBreakdownSummary>(EMPTY_SOURCE_BREAKDOWN);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const database = db ?? (await getDatabase());

      const today = todayLocalISO();
      const startDate = addDaysISO(today, -TRENDS_WINDOW_DAYS);

      const [intakeRows, weightRows, profileRow, storedTargets, foodEntryRows, externalEstimateRows] = await Promise.all([
        intakeRepo.getRange(database, startDate, today),
        weightRepo.getRange(database, startDate, today),
        profileRepo.getProfile(database),
        getAcceptedTargets(database),
        foodRepo.getEntriesInRange(database, startDate, today),
        externalEstimateRepo.getRange(database, startDate, today),
      ]);

      const profile = profileRow ? toUserProfile(profileRow) : DEFAULT_PROFILE;
      const intake = intakeRows.map(toDayIntake);
      const weights = weightRows.map(toWeightLog);
      // See src/lib/engineInput.ts. Only the copy fed to computeTDEE is
      // filtered — `intake`/`intakeRows` themselves stay raw for
      // adherence/energy-balance/weekly-rollup below, which legitimately
      // want to show today's in-progress log and a genuine zero day as
      // real data, not hide them.
      const engineIntake = filterIntakeForEngine(intake, today);

      // ─── Weight chart: raw dots + Kalman-smoothed line ───
      const rawByDate = new Map(weights.map((w) => [w.date, w.weight_kg]));
      const kalman = runKalmanFilter(weights);
      const weightPoints: WeightChartPoint[] = kalman.series.map((day) => ({
        date: day.date,
        rawKg: rawByDate.get(day.date) ?? null,
        smoothedKg: day.smoothedWeightKg,
      }));
      setWeightSeries(weightPoints);

      // ─── TDEE history: re-run computeTDEE at a bounded set of historical
      // cutoffs so the chart shows the estimate narrowing over time, not
      // just today's single point (PRD §9.2: "solid measured line with
      // confidence band"). Each cutoff only sees data up to that day —
      // this must NOT peek at future data or the "narrowing over time"
      // shape would be fabricated.
      let tdeePoints: TDEEChartPoint[] = [];
      if (weights.length > 0) {
        const firstDate = kalman.series[0]?.date ?? today;
        const totalDays = dayOffset(firstDate, today);
        const offsets = pickChartDayOffsets(totalDays, MAX_TDEE_CHART_POINTS);

        tdeePoints = offsets.map((offset) => {
          const cutoff = addDaysISO(firstDate, offset);
          // Filtering by `today` (not `cutoff`) before slicing is
          // deliberate: it only ever drops the row dated exactly `today`
          // (rule 1), which only shows up in this slice when `cutoff`
          // itself equals `today` — a historical cutoff's "current day"
          // was a genuinely completed observation and must not be
          // dropped. Rule 2 (empty rollup) is cutoff-independent.
          const intakeUpToCutoff = engineIntake.filter((d) => d.date <= cutoff);
          const weightsUpToCutoff = weights.filter((w) => w.date <= cutoff);
          const result = computeTDEE(intakeUpToCutoff, weightsUpToCutoff, profile);
          return {
            date: cutoff,
            tdee: result.tdee,
            confidenceLow: result.confidenceLow,
            confidenceHigh: result.confidenceHigh,
            dataQuality: result.dataQuality,
          };
        });
      }
      setTdeeSeries(tdeePoints);

      const overall = computeTDEE(engineIntake, weights, profile);
      setLatestTdee(overall);
      setTargets(storedTargets);

      // ─── Zepp reference series: dashed subordinate line on the TDEE
      // chart (PRD §9.2). REFERENCE ONLY — read straight from
      // external_estimate for display, never blended with `overall`/
      // `tdeePoints` above and never passed to computeTDEE.
      const zeppPoints: ZeppChartPoint[] = externalEstimateRows.map((row) => ({
        date: row.date,
        tdee_est: row.tdee_est ?? null,
      }));
      setZeppSeries(zeppPoints);

      // ─── Adherence: gap-aware daily kcal vs target ───
      const adherence = buildAdherenceSeries(startDate, today, intakeRows, storedTargets?.targetKcal ?? null);
      setAdherenceSeries(adherence);

      // ─── Energy balance: intake vs expenditure per day, gap-aware ───
      // Expenditure is only known exactly at the bounded TDEE cutoffs
      // above; interpolate between them (never extrapolate past the first
      // or last known cutoff) so the chart gets a continuous expenditure
      // line without calling computeTDEE any more times than the TDEE
      // chart already does.
      const fullAxis = buildDailyAxis(startDate, today);
      const expenditureByDate = new Map<string, ExpenditureEstimate>(
        tdeePoints.map((p) => [p.date, { value: p.tdee, quality: p.dataQuality }])
      );
      const interpolatedExpenditure = interpolateExpenditure(fullAxis, expenditureByDate);

      // ─── Strap bias (PRD §9.2): compare Zepp's daily tdee_est against
      // Joule's own daily (interpolated) TDEE, but ONLY on days where
      // Joule's figure is measured (dataQuality 'converging'/'stable'),
      // never a Mifflin-St Jeor cold-start seed — see strapBias.ts's
      // header for why blending against a seed would be meaningless.
      // interpolatedExpenditure already carries per-day quality for
      // exactly this reason (the energy-balance chart's honesty fix).
      setStrapBias(
        computeStrapBias(
          fullAxis
            .filter((date) => interpolatedExpenditure.has(date))
            .map((date) => {
              const e = interpolatedExpenditure.get(date)!;
              return { date, tdee: e.value, dataQuality: e.quality };
            }),
          zeppPoints
        )
      );

      setEnergyBalanceSeries(
        buildEnergyBalanceSeries(
          fullAxis,
          adherence.map((d) => ({ date: d.date, loggedKcal: d.loggedKcal })),
          interpolatedExpenditure
        )
      );

      // ─── Weekly rollup: avg intake/expenditure, weight change, days logged ───
      const smoothedByDate = weightPoints.map((p) => ({ date: p.date, smoothedKg: p.smoothedKg }));
      setWeeklyRollup(
        buildWeeklyRollup(
          startDate,
          today,
          adherence.map((d) => ({ date: d.date, loggedKcal: d.loggedKcal })),
          interpolatedExpenditure,
          smoothedByDate
        )
      );

      // ─── Day-of-week pattern: avg logged kcal per weekday ───
      setDayOfWeekPattern(buildDayOfWeekPattern(adherence.map((d) => ({ date: d.date, loggedKcal: d.loggedKcal }))));

      // ─── Protein consistency: hit-rate + distribution vs accepted target ───
      // Only intake days with an actual day_intake row count as "logged" —
      // reuse the same gap signal as adherence (loggedKcal !== null) so a
      // day with no food_entry rows at all is excluded, not counted as 0g.
      const loggedDatesSet = new Set(adherence.filter((d) => d.loggedKcal !== null).map((d) => d.date));
      const proteinDays = intakeRows.map((row) => ({
        date: row.date,
        proteinG: loggedDatesSet.has(row.date) && row.is_complete !== 0 ? row.protein_g : null,
        isComplete: row.is_complete !== 0,
      }));
      // Ensure every day in the window is represented (including true gaps
      // with no day_intake row at all) so callers can distinguish "0 logged
      // days" from "some logged days, all under target" — both cases must
      // never collapse proteinG to 0.
      const proteinByDate = new Map(proteinDays.map((d) => [d.date, d]));
      const fullProteinAxis = fullAxis.map((date) => proteinByDate.get(date) ?? { date, proteinG: null, isComplete: true });
      setProteinConsistency(summarizeProteinConsistency(fullProteinAxis, storedTargets?.proteinG ?? null));

      // ─── Source/confidence breakdown: kcal-weighted trust mix ───
      setSourceBreakdown(
        summarizeSourceBreakdown(
          foodEntryRows.map((row) => ({ kcal: row.kcal, confidence: row.confidence, source: row.source }))
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    loading,
    error,
    weightSeries,
    tdeeSeries,
    zeppSeries,
    strapBias,
    adherenceSeries,
    latestTdee,
    targets,
    energyBalanceSeries,
    weeklyRollup,
    dayOfWeekPattern,
    proteinConsistency,
    sourceBreakdown,
    refresh,
  };
}
