// ═══════════════════════════════════════════════════════════════════════
// KALMAN FILTER — PRD §4.1
//
// 2-state filter smoothing the weight signal. State x = [weight_kg, trend
// kg/day]. F = [[1,1],[0,1]] (a random walk on weight with a persistent
// drift term); H = [1,0] (we only ever observe weight directly).
//
// Not a moving average — a moving average lags by half its window. This
// recursively updates a belief and its uncertainty, so it reacts as fast
// as the noise characteristics allow rather than a fixed window length.
// ═══════════════════════════════════════════════════════════════════════

import type { WeightLog } from './types';
import { KALMAN_DEFAULTS, CONFOUNDER_R_MULTIPLIER, type KalmanParams, type Mat2x2 } from './types';
import { buildDailyAxis, dayOffset } from './date';

/** 2-vector state: [true_weight_kg, trend_kg_per_day]. */
export type KalmanState = readonly [number, number];

/** One day's output from the filter, aligned to the continuous daily axis. */
export type KalmanDayResult = {
  /** ISO yyyy-mm-dd. */
  date: string;
  /** Smoothed weight estimate (kg). */
  smoothedWeightKg: number;
  /** Smoothed trend estimate (kg/day). */
  trendKgPerDay: number;
  /** Posterior state covariance for this day. */
  covariance: Mat2x2;
  /** Whether an actual weight_log reading existed for this day. */
  hasReading: boolean;
  /** True if this day's reading (if any) had a non-null confounder. */
  confounded: boolean;
  /**
   * True if this day is the first day of a run following a gap of more
   * than 7 days with no reading (PRD §4.4 "Gap > 7 days"). The UI can use
   * this to prompt "Been a while — want to recalibrate?"
   */
  followsLongGap: boolean;
};

export type KalmanRunResult = {
  /** Per-day series, one entry per calendar day from first to last reading. */
  series: KalmanDayResult[];
  /** True if ANY gap > 7 days occurred anywhere in the series. */
  hadLongGap: boolean;
};

const GAP_RESET_THRESHOLD_DAYS = 7;
/**
 * Multiplier applied to P (both weight and trend uncertainty) when a gap
 * longer than GAP_RESET_THRESHOLD_DAYS is encountered, on top of the
 * natural growth already accrued from running prediction-only steps
 * across the gap (PRD §4.4: "Reset P upward substantially").
 */
const GAP_RESET_P_MULTIPLIER = 4;

function matAdd(a: Mat2x2, b: Mat2x2): Mat2x2 {
  return [
    [a[0][0] + b[0][0], a[0][1] + b[0][1]],
    [a[1][0] + b[1][0], a[1][1] + b[1][1]],
  ];
}

function scaleMat(a: Mat2x2, k: number): Mat2x2 {
  return [
    [a[0][0] * k, a[0][1] * k],
    [a[1][0] * k, a[1][1] * k],
  ];
}

/** Predict step: x' = F x, P' = F P Fᵀ + Q. F = [[1,1],[0,1]]. */
function predict(
  x: KalmanState,
  P: Mat2x2,
  Q: Mat2x2
): { x: KalmanState; P: Mat2x2 } {
  const weight = x[0] + x[1];
  const trend = x[1];
  const xPred: KalmanState = [weight, trend];

  // F P Fᵀ where F = [[1,1],[0,1]].
  // FP = [[P00+P10, P01+P11], [P10, P11]]
  const fp00 = P[0][0] + P[1][0];
  const fp01 = P[0][1] + P[1][1];
  const fp10 = P[1][0];
  const fp11 = P[1][1];
  // (FP) Fᵀ, Fᵀ = [[1,0],[1,1]]
  const p00 = fp00 + fp01;
  const p01 = fp01;
  const p10 = fp10 + fp11;
  const p11 = fp11;

  const FPFt: Mat2x2 = [
    [p00, p01],
    [p10, p11],
  ];

  return { x: xPred, P: matAdd(FPFt, Q) };
}

/**
 * Update step: incorporate an observed weight z with measurement noise R.
 * H = [1,0] — we only observe weight directly, never trend.
 */
function update(
  x: KalmanState,
  P: Mat2x2,
  z: number,
  R: number
): { x: KalmanState; P: Mat2x2 } {
  const y = z - x[0]; // innovation (H x = weight component)
  const S = P[0][0] + R; // H P Hᵀ + R
  const K0 = P[0][0] / S; // Kalman gain, weight row
  const K1 = P[1][0] / S; // Kalman gain, trend row

  const xNew: KalmanState = [x[0] + K0 * y, x[1] + K1 * y];

  // P = (I - K H) P.  K H = [[K0, 0], [K1, 0]]
  // (I - KH) = [[1-K0, 0], [-K1, 1]]
  const p00 = (1 - K0) * P[0][0];
  const p01 = (1 - K0) * P[0][1];
  const p10 = P[1][0] - K1 * P[0][0];
  const p11 = P[1][1] - K1 * P[0][1];

  const PNew: Mat2x2 = [
    [p00, p01],
    [p10, p11],
  ];

  return { x: xNew, P: PNew };
}

/**
 * Run the 2-state Kalman filter over a weight history, producing a smoothed
 * per-day series across the continuous daily axis (first reading date to
 * last reading date, inclusive — no gaps in the output even though the
 * input may have gaps).
 *
 * @param weights Raw weight_log rows. Need not be sorted; need not be
 *   contiguous. Confounded readings are still used, just with inflated R.
 * @param params  Kalman tuning constants. Defaults to KALMAN_DEFAULTS;
 *   pass overrides for a debug screen (PRD §14).
 */
export function runKalmanFilter(
  weights: WeightLog[],
  params: KalmanParams = KALMAN_DEFAULTS
): KalmanRunResult {
  if (weights.length === 0) {
    return { series: [], hadLongGap: false };
  }

  const sorted = [...weights].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDate = new Map<string, WeightLog>();
  for (const w of sorted) {
    byDate.set(w.date, w); // last one wins if duplicate dates
  }

  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const axis = buildDailyAxis(first, last);

  const Q: Mat2x2 = [
    [params.Q_weight, 0],
    [0, params.Q_trend],
  ];

  // Initialize state at the first reading.
  let x: KalmanState = [sorted[0].weight_kg, 0];
  let P: Mat2x2 = params.P0;

  const series: KalmanDayResult[] = [];
  let hadLongGap = false;
  let daysSinceReading = 0; // consecutive missing days immediately prior to "today"

  for (let i = 0; i < axis.length; i++) {
    const date = axis[i];
    const reading = byDate.get(date);

    if (i > 0) {
      // Prediction step always runs when advancing from a previous day.
      const predicted = predict(x, P, Q);
      x = predicted.x;
      P = predicted.P;
    }

    let followsLongGap = false;
    if (reading) {
      if (daysSinceReading > GAP_RESET_THRESHOLD_DAYS) {
        // Gap > 7 days: reset P upward substantially on top of its
        // natural growth from the missed prediction-only steps.
        P = scaleMat(P, GAP_RESET_P_MULTIPLIER);
        hadLongGap = true;
        followsLongGap = true;
      }

      const confounded = reading.confounder !== null;
      const R = confounded ? params.R * CONFOUNDER_R_MULTIPLIER : params.R;
      const updated = update(x, P, reading.weight_kg, R);
      x = updated.x;
      P = updated.P;

      daysSinceReading = 0;

      series.push({
        date,
        smoothedWeightKg: x[0],
        trendKgPerDay: x[1],
        covariance: P,
        hasReading: true,
        confounded,
        followsLongGap,
      });
    } else {
      // Missing day: prediction step only, no update. P has already grown
      // above via `predict`. This is intentional — the app genuinely
      // knows less.
      daysSinceReading += 1;

      series.push({
        date,
        smoothedWeightKg: x[0],
        trendKgPerDay: x[1],
        covariance: P,
        hasReading: false,
        confounded: false,
        followsLongGap: false,
      });
    }
  }

  return { series, hadLongGap };
}

/** Convenience: day offset re-exported for callers that need alignment. */
export { dayOffset };
