// ═══════════════════════════════════════════════════════════════════════
// TDEE ENGINE — entry point
//
// PRD §3 / §4: a pure function. Reads ONLY intake and weight data plus the
// user profile. Must not be able to accept `ExternalEstimate` — see
// src/engine/types.ts and eslint.config.js for how that's enforced at the
// type/lint level rather than by convention.
//
// ─── Formulation (deviating slightly from a literal reading of PRD §4.2) ───
//
// PRD §4.2 describes "weighted least squares over the joint series of
// (cumulative intake, Kalman-smoothed weight)". A literal cumulative-intake
// regression breaks under PRD §4.4's rule that unlogged/incomplete days
// must never be imputed: skipping a day in a *cumulative* sum either
// requires imputing (forbidden) or leaves a permanent step-discontinuity
// in the running total that corrupts every regression point after it.
//
// Instead we weight the two terms of the energy-balance equation
// independently:
//
//   w_i        = exp(-ln(2) * days_ago_i / HALF_LIFE_DAYS)      (PRD §4.2)
//   slope      = weighted least-squares slope of smoothed weight vs. day
//                index, weights w_i                              (kg/day)
//   meanIntake = weighted mean of intake over days where
//                is_complete === true, same weights w_i
//   TDEE       = meanIntake - KCAL_PER_KG * slope
//
// A gap day simply contributes zero weight to whichever term it's missing
// from, rather than poisoning a cumulative sum. This is mathematically
// equivalent to the PRD's energy-balance identity
// (TDEE ≈ mean_daily_intake + 7700 × kg_lost_per_day, where kg_lost_per_day
// = -slope) but robust to gaps, which the literal cumulative-sum reading
// is not.
// ═══════════════════════════════════════════════════════════════════════

import type { DayIntake, WeightLog, UserProfile, TDEEResult, DataQuality, KalmanParams } from './types';
import { HALF_LIFE_DAYS, KCAL_PER_KG } from './types';
import { runKalmanFilter, type KalmanRunResult, type KalmanDayResult } from './kalman';
import { dayOffset } from './date';
import { computeColdStartSeed, blendColdStart } from './coldstart';

/** Detection window for "new diet phase" damping (PRD §4.4). */
const NEW_PHASE_WINDOW_DAYS = 14;
/** Trend magnitude past which we suspect water/glycogen noise, not fat loss. */
const NEW_PHASE_TREND_THRESHOLD_KG_PER_DAY = 0.15;
/**
 * How much we shrink the measured slope's contribution when the new-phase
 * damping condition fires. 0 = ignore slope entirely, 1 = no damping. We
 * partially trust it rather than zeroing it, since some of the swing may
 * be real.
 */
const NEW_PHASE_DAMPING_FACTOR = 0.35;

/**
 * How many of the most recent readings to probe when computing the exact
 * slope standard error (see smoothedSlopeStandardError). Bounds an O(n²)
 * computation on long histories; older readings carry negligible recency
 * weight (2^-(days/14)) so their sensitivity rounds away.
 */
const SENSITIVITY_WINDOW_DAYS = 180;

export type WeightedRegressionResult = {
  intercept: number;
  slope: number;
  /**
   * Standard error of the slope implied by THIS series' own residuals.
   *
   * ⚠️ When the y series handed to this function is Kalman-smoothed, this
   * value badly understates the true uncertainty — the filter has already
   * absorbed the observation noise, so residuals about the fitted line are
   * artificially small and serially correlated (the classic "inference on
   * filtered data" pitfall). Measured on synthetic data at day 21: this
   * reports ~85 kcal where the estimator's actual spread is ~237 kcal.
   * Use `weightedSlopeStandardError` against the RAW readings for any
   * confidence interval. Retained for callers fitting unfiltered data.
   */
  slopeSE: number;
  /** Weighted Σ w·(x − x̄)². Horizontal spread; denominator of the slope SE. */
  sxx: number;
  /** Effective sample size (sum of weights, normalized). */
  effectiveN: number;
};

/**
 * Weighted least squares of y on x (single predictor + intercept), with
 * per-point weights. Returns slope, intercept, and the slope's standard
 * error. Degenerates gracefully (returns zeros / Infinity SE) rather than
 * throwing when there's insufficient data to fit a line.
 */
export function weightedLinearRegression(
  x: number[],
  y: number[],
  w: number[]
): WeightedRegressionResult {
  const n = x.length;
  if (n === 0) {
    return { intercept: 0, slope: 0, slopeSE: Infinity, sxx: 0, effectiveN: 0 };
  }

  let sumW = 0;
  let sumWX = 0;
  let sumWY = 0;
  for (let i = 0; i < n; i++) {
    sumW += w[i];
    sumWX += w[i] * x[i];
    sumWY += w[i] * y[i];
  }

  if (sumW <= 0 || n < 2) {
    // Not enough weighted data to fit a slope; treat as flat.
    const meanY = sumW > 0 ? sumWY / sumW : n > 0 ? y[0] : 0;
    return { intercept: meanY, slope: 0, slopeSE: Infinity, sxx: 0, effectiveN: sumW };
  }

  const meanX = sumWX / sumW;
  const meanY = sumWY / sumW;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    sxx += w[i] * dx * dx;
    sxy += w[i] * dx * dy;
  }

  if (sxx <= 1e-12) {
    // All x values effectively identical (e.g. a single distinct day) —
    // can't estimate a slope from zero horizontal spread.
    return { intercept: meanY, slope: 0, slopeSE: Infinity, sxx: 0, effectiveN: sumW };
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  // Weighted residual variance, then slope SE = sqrt(residVar / Sxx).
  let weightedResidSq = 0;
  for (let i = 0; i < n; i++) {
    const resid = y[i] - (intercept + slope * x[i]);
    weightedResidSq += w[i] * resid * resid;
  }
  // Effective sample size accounts for unequal weights (Kish's approximation).
  let sumW2 = 0;
  for (let i = 0; i < n; i++) sumW2 += w[i] * w[i];
  const effectiveN = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;

  const dof = Math.max(effectiveN - 2, 1);
  const residVar = ((weightedResidSq / sumW) * effectiveN) / dof; // scaled weighted MSE
  const slopeSE = Math.sqrt(Math.max(residVar, 0) / sxx);

  return { intercept, slope, slopeSE, sxx, effectiveN };
}

/**
 * Honest standard error of a fitted slope, computed from the scatter of the
 * ACTUAL OBSERVATIONS about that fitted line.
 *
 * This exists because the slope point estimate is (correctly) fitted to the
 * Kalman-smoothed series — smoothing genuinely improves the estimate — but
 * the *uncertainty* of that estimate must come from the raw readings. The
 * smoothed curve has had its noise removed by construction, so its residuals
 * describe how well a line fits a curve we already drew, not how much the
 * underlying data could have moved the answer.
 *
 * Only days with a real reading may be passed in: a day with no weight entry
 * carries no information and must not shrink the interval (PRD §4.4 — missing
 * data is never imputed, and that applies to uncertainty too).
 *
 * @param x         Day indices for days that have an actual reading.
 * @param yObserved Raw (unsmoothed) weight readings for those same days.
 * @param w         Recency weights for those same days.
 * @param intercept Intercept of the line fitted to the smoothed series.
 * @param slope     Slope of the line fitted to the smoothed series.
 * @returns Estimated observation noise SD in kg, or null if not estimable.
 */
export function estimateObservationNoiseSD(
  x: number[],
  yObserved: number[],
  w: number[],
  intercept: number,
  slope: number
): number | null {
  const n = x.length;
  if (n < 3) {
    // Fewer than 3 observations cannot support a residual-variance estimate
    // with 2 parameters already spent on the fit.
    return null;
  }

  let sumW = 0;
  let sumW2 = 0;
  let weightedResidSq = 0;
  for (let i = 0; i < n; i++) {
    sumW += w[i];
    sumW2 += w[i] * w[i];
    const resid = yObserved[i] - (intercept + slope * x[i]);
    weightedResidSq += w[i] * resid * resid;
  }
  if (sumW <= 0) return null;

  const effectiveN = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  const dof = Math.max(effectiveN - 2, 1);
  // Weighted MSE with a degrees-of-freedom correction for the 2 parameters
  // already spent fitting the line.
  const residVar = ((weightedResidSq / sumW) * effectiveN) / dof;

  const sd = Math.sqrt(Math.max(residVar, 0));
  return Number.isFinite(sd) && sd > 0 ? sd : null;
}

/**
 * Run the full point-estimate pipeline: Kalman-smooth the readings, then
 * fit a recency-weighted line to the smoothed series. Factored out so the
 * exact same pipeline can be re-run under perturbation to measure how
 * sensitive the fitted slope is to each individual reading.
 */
function fitSmoothedSlope(
  weights: WeightLog[],
  params?: KalmanParams
): { slope: number; intercept: number; series: KalmanDayResult[] } {
  const kalman = runKalmanFilter(weights, params);
  const series = kalman.series;
  if (series.length === 0) {
    return { slope: 0, intercept: 0, series };
  }
  const anchorDate = series[series.length - 1].date;

  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  for (const day of series) {
    const daysAgo = dayOffset(day.date, anchorDate);
    xs.push(-daysAgo);
    ys.push(day.smoothedWeightKg);
    ws.push(recencyWeight(daysAgo));
  }
  const reg = weightedLinearRegression(xs, ys, ws);
  return { slope: reg.slope, intercept: reg.intercept, series };
}

/**
 * Exact standard error of the fitted slope, via impulse sensitivities.
 *
 * Why not a closed-form regression SE: the slope we report is fitted to the
 * Kalman-SMOOTHED series, not to the raw readings. That makes both textbook
 * formulas wrong in opposite directions —
 *
 *   - Residuals of the smoothed series about the line understate the SE
 *     (~3x too small, measured): the filter already removed the noise.
 *   - A recency-weighted OLS SE on the raw readings overstates it (~1.7x too
 *     big at day 45, measured): it assumes only the recency-weighted points
 *     carry information, but the filter propagates older observations forward
 *     into recent smoothed values, so the estimator actually uses more data
 *     than those weights imply.
 *
 * The Kalman filter (with fixed Q/R) and the weighted regression are both
 * strictly LINEAR in the observations, so the composed estimator is linear:
 * slope = Σ_j s_j · z_j + const. Under iid observation noise of SD σ,
 *
 *     Var(slope) = σ² · Σ_j s_j²
 *
 * exactly. We recover each sensitivity s_j by pushing a unit impulse through
 * the real pipeline (exact, not a finite-difference approximation, precisely
 * because the pipeline is linear). This self-calibrates to whatever Q/R a
 * debug screen sets (PRD §14) with no hand-tuned fudge factor.
 *
 * Confounded readings are handled for free: their inflated R gives them
 * smaller sensitivities, so they contribute less to the variance, exactly
 * as they contribute less to the estimate.
 *
 * Cost is O(n²) Kalman steps. To keep that bounded on long histories we only
 * probe the most recent SENSITIVITY_WINDOW_DAYS readings: with a 14-day
 * half-life, a reading 90 days old carries a recency weight of 2^-6.4 ≈ 0.01,
 * so its sensitivity is negligible and omitting it changes the SE in the
 * far decimals. This caps the work at a fixed budget no matter how many
 * years of history exist, while staying exact for the readings that matter.
 *
 * @param weights Raw readings (all of them; dates define the axis).
 * @param sigmaKg Estimated observation noise SD in kg.
 * @param params  Kalman tuning overrides, passed through unchanged.
 */
export function smoothedSlopeStandardError(
  weights: WeightLog[],
  sigmaKg: number,
  params?: KalmanParams
): number {
  const n = weights.length;
  if (n < 3 || !Number.isFinite(sigmaKg) || sigmaKg <= 0) {
    return Infinity;
  }

  const base = fitSmoothedSlope(weights, params);
  // Probe only the recent tail; older readings have negligible sensitivity.
  const firstProbed = Math.max(0, n - SENSITIVITY_WINDOW_DAYS);

  let sumSqSensitivity = 0;
  for (let j = firstProbed; j < n; j++) {
    // Unit impulse on reading j. Exact because the pipeline is linear.
    const perturbed = weights.map((w, k) =>
      k === j ? { ...w, weight_kg: w.weight_kg + 1 } : w
    );
    const sensitivity = fitSmoothedSlope(perturbed, params).slope - base.slope;
    sumSqSensitivity += sensitivity * sensitivity;
  }

  const se = sigmaKg * Math.sqrt(sumSqSensitivity);
  return Number.isFinite(se) && se > 0 ? se : Infinity;
}

export type WeightedMeanResult = {
  mean: number;
  /** Standard error of the weighted mean. */
  se: number;
  effectiveN: number;
};

/** Weighted mean and its standard error, degenerating gracefully on empty input. */
export function weightedMean(values: number[], w: number[]): WeightedMeanResult {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, se: Infinity, effectiveN: 0 };
  }

  let sumW = 0;
  let sumWV = 0;
  for (let i = 0; i < n; i++) {
    sumW += w[i];
    sumWV += w[i] * values[i];
  }

  if (sumW <= 0) {
    // Fall back to an unweighted mean so we still return a finite number.
    const mean = values.reduce((a, b) => a + b, 0) / n;
    return { mean, se: Infinity, effectiveN: 0 };
  }

  const mean = sumWV / sumW;

  let weightedVarSum = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    weightedVarSum += w[i] * d * d;
  }
  let sumW2 = 0;
  for (let i = 0; i < n; i++) sumW2 += w[i] * w[i];
  const effectiveN = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;

  if (effectiveN <= 1) {
    // Can't estimate spread from a single effective observation.
    return { mean, se: Infinity, effectiveN };
  }

  const weightedVar = weightedVarSum / sumW;
  const se = Math.sqrt(weightedVar / effectiveN);

  return { mean, se, effectiveN };
}

/** Exponential recency weight, PRD §4.2: exp(-ln(2) * days_ago / HALF_LIFE). */
export function recencyWeight(daysAgo: number, halfLifeDays: number = HALF_LIFE_DAYS): number {
  return Math.exp((-Math.LN2 * daysAgo) / halfLifeDays);
}

/**
 * Result of the "new diet phase" detector (PRD §4.4). Exposed so callers
 * / tests can inspect why damping fired.
 */
export type PhaseDampingInfo = {
  active: boolean;
  rawTrendKgPerDay: number;
};

/**
 * Detect whether we're in the first two weeks of data AND the most recent
 * measured trend is implausibly large (>0.15 kg/day) — almost certainly
 * glycogen/water, not fat mass. When active, the caller should damp the
 * slope's contribution to the TDEE estimate.
 */
export function detectNewPhaseDamping(
  daysOfData: number,
  latestTrendKgPerDay: number
): PhaseDampingInfo {
  const active =
    daysOfData <= NEW_PHASE_WINDOW_DAYS && Math.abs(latestTrendKgPerDay) > NEW_PHASE_TREND_THRESHOLD_KG_PER_DAY;
  return { active, rawTrendKgPerDay: latestTrendKgPerDay };
}

/** True if a gap of more than 7 days occurred anywhere in the weight history. */
export function hasLongGap(kalman: KalmanRunResult): boolean {
  return kalman.hadLongGap;
}

function classifyDataQuality(daysOfData: number): DataQuality {
  if (daysOfData < 10) return 'seeding';
  if (daysOfData < 22) return 'converging';
  return 'stable';
}

/** A TDEEResult with every numeric field guaranteed finite (never NaN). */
function sanitizeResult(result: TDEEResult): TDEEResult {
  const safe = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);
  return {
    tdee: safe(result.tdee, 0),
    confidenceLow: safe(result.confidenceLow, safe(result.tdee, 0)),
    confidenceHigh: safe(result.confidenceHigh, safe(result.tdee, 0)),
    trendKgPerWeek: safe(result.trendKgPerWeek, 0),
    smoothedWeightKg: safe(result.smoothedWeightKg, 0),
    dataQuality: result.dataQuality,
    daysOfData: safe(result.daysOfData, 0),
    loggedDaysInWindow: safe(result.loggedDaysInWindow, 0),
  };
}

/**
 * Compute the adaptive TDEE estimate from logged intake and weight
 * history. Pure function — no I/O, no side effects, no access to
 * external/wearable data.
 *
 * @param intake  Daily logged nutrition (`day_intake` rows only).
 * @param weights Daily weight readings (`weight_log` rows only).
 * @param profile Onboarding/settings data (height, sex, goal, etc).
 */
export function computeTDEE(
  intake: DayIntake[],
  weights: WeightLog[],
  profile: UserProfile
): TDEEResult {
  if (weights.length === 0) {
    // No weight history at all: pure cold start, day 0. Mifflin-St Jeor
    // needs a mass term but we have no reading yet — computeColdStartSeed
    // falls back to a neutral placeholder in this case only.
    const seed = computeColdStartSeed(profile);
    return sanitizeResult({
      tdee: seed.seedTDEE,
      confidenceLow: seed.seedTDEE - seed.bandWidth,
      confidenceHigh: seed.seedTDEE + seed.bandWidth,
      trendKgPerWeek: 0,
      smoothedWeightKg: 0,
      dataQuality: 'seeding',
      daysOfData: 0,
      loggedDaysInWindow: 0,
    });
  }

  const kalman = runKalmanFilter(weights);
  const series = kalman.series;
  const lastDay = series[series.length - 1];
  const daysOfData = series.length;
  const anchorDate = lastDay.date;
  const seed = computeColdStartSeed(profile, series[0].smoothedWeightKg);

  // ─── Weighted regression of smoothed weight vs. day index ───
  // The POINT ESTIMATE is fitted to the Kalman-smoothed series (smoothing
  // genuinely improves it). The UNCERTAINTY is derived separately, below,
  // from the raw readings — see weightedSlopeStandardError for why.
  const rawByDate = new Map<string, WeightLog>();
  for (const w of weights) rawByDate.set(w.date, w);

  const xs: number[] = [];
  const ys: number[] = [];
  const wsWeight: number[] = [];
  // Parallel arrays covering ONLY days with a real reading, for the SE.
  const obsXs: number[] = [];
  const obsRawYs: number[] = [];
  const obsWs: number[] = [];
  for (const day of series) {
    const daysAgo = dayOffset(day.date, anchorDate);
    const dayIndex = -daysAgo; // increasing forward in time
    const weight = recencyWeight(daysAgo);
    xs.push(dayIndex);
    ys.push(day.smoothedWeightKg);
    wsWeight.push(weight);

    const raw = rawByDate.get(day.date);
    if (raw) {
      obsXs.push(dayIndex);
      obsRawYs.push(raw.weight_kg);
      obsWs.push(weight);
    }
  }
  const regression = weightedLinearRegression(xs, ys, wsWeight);

  // Honest slope SE, in two steps:
  //   1. Estimate the observation noise SD from how far the RAW readings
  //      scatter about the fitted line (the smoothed series can't tell us
  //      this — its noise has already been filtered out).
  //   2. Propagate that noise through the actual estimator via exact
  //      impulse sensitivities.
  // Using regression.slopeSE here instead would understate the interval by
  // roughly 3x (measured) — a confidently wrong narrow band, the exact
  // failure mode PRD §4.5 warns against.
  const sigmaKg = estimateObservationNoiseSD(
    obsXs,
    obsRawYs,
    obsWs,
    regression.intercept,
    regression.slope
  );
  const honestSlopeSE =
    sigmaKg === null ? Infinity : smoothedSlopeStandardError(weights, sigmaKg);

  // ─── Weighted mean of intake, complete days only ───
  const intakeByDate = new Map<string, DayIntake>();
  for (const d of intake) intakeByDate.set(d.date, d);

  const intakeValues: number[] = [];
  const intakeWeights: number[] = [];
  let loggedDaysInWindow = 0;
  for (const day of series) {
    const rec = intakeByDate.get(day.date);
    if (rec && rec.is_complete) {
      const daysAgo = dayOffset(day.date, anchorDate);
      intakeValues.push(rec.kcal);
      intakeWeights.push(recencyWeight(daysAgo));
      loggedDaysInWindow += 1;
    }
    // Unlogged or partial (is_complete === false) days: excluded entirely
    // from the intake series (PRD §4.4). Their weight reading, if any,
    // still contributed to the regression above.
  }
  const intakeStats = weightedMean(intakeValues, intakeWeights);

  // ─── New-phase damping (PRD §4.4) ───
  const phaseInfo = detectNewPhaseDamping(daysOfData, lastDay.trendKgPerDay);
  const effectiveSlope = phaseInfo.active ? regression.slope * NEW_PHASE_DAMPING_FACTOR : regression.slope;
  // NB: damping shrinks the point estimate toward zero but must NOT shrink
  // the interval — a damped estimate is a less certain one, not a more
  // certain one. The SE is carried through undamped.
  const effectiveSlopeSE = honestSlopeSE;

  // ─── Energy balance ───
  // Losing weight -> slope negative -> -KCAL_PER_KG * slope positive ->
  // TDEE exceeds mean intake. Gaining weight -> slope positive -> TDEE
  // is below mean intake. This is the sign convention asserted in tests.
  const measuredTDEE = intakeStats.mean - KCAL_PER_KG * effectiveSlope;

  // Propagate slope SE and intake-mean SE into a TDEE standard error.
  // TDEE = meanIntake - KCAL_PER_KG * slope, and the two terms are
  // estimated from independent (if overlapping-in-time) data sources, so
  // treat their variances as additive.
  const slopeContribVar =
    Number.isFinite(effectiveSlopeSE) ? Math.pow(KCAL_PER_KG * effectiveSlopeSE, 2) : Math.pow(seed.bandWidth, 2);
  const intakeContribVar = Number.isFinite(intakeStats.se) ? Math.pow(intakeStats.se, 2) : Math.pow(seed.bandWidth, 2);
  const tdeeSE = Math.sqrt(slopeContribVar + intakeContribVar);

  const hasEnoughForMeasured = loggedDaysInWindow >= 2 && regression.effectiveN >= 2 && Number.isFinite(measuredTDEE);

  let tdee: number;
  let bandHalfWidth: number;
  let dataQuality: DataQuality;

  if (!hasEnoughForMeasured) {
    // Degenerate case (e.g. all days incomplete, or a single weight
    // reading): can't form a measured estimate yet. Fall back to the
    // cold-start seed rather than emitting NaN/garbage.
    tdee = seed.seedTDEE;
    bandHalfWidth = seed.bandWidth;
    dataQuality = 'seeding';
  } else {
    const blend = blendColdStart(seed.seedTDEE, measuredTDEE, tdeeSE, daysOfData);
    tdee = blend.tdee;
    bandHalfWidth = blend.bandHalfWidth;
    dataQuality = classifyDataQuality(daysOfData);
  }

  const trendKgPerWeek = lastDay.trendKgPerDay * 7;

  return sanitizeResult({
    tdee,
    confidenceLow: tdee - bandHalfWidth,
    confidenceHigh: tdee + bandHalfWidth,
    trendKgPerWeek,
    smoothedWeightKg: lastDay.smoothedWeightKg,
    dataQuality,
    daysOfData,
    loggedDaysInWindow,
  });
}
