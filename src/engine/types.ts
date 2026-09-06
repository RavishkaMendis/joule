// ═══════════════════════════════════════════════════════════════════════
// TDEE ENGINE — INPUT/OUTPUT CONTRACTS
//
// PRD §3 (architectural rule, non-negotiable):
//   "The TDEE engine is a pure function ... It cannot accept
//   `ExternalEstimate`. Enforce this at the type level so it's a compile
//   error, not a discipline problem."
//
// This module intentionally does NOT declare or import `ExternalEstimate`.
// That type lives only in `src/db/types.ts`, a module the engine never
// imports. See the ESLint rule in eslint.config.js (no-restricted-imports
// zone on src/engine/**) which makes it a lint/compile-time failure for
// any file in this directory to reach into src/db, src/screens, or any
// React Native / Expo module.
//
// This file must have ZERO React Native / SQLite / Expo imports. It is
// plain TypeScript, testable in a Node environment with no mocks.
// ═══════════════════════════════════════════════════════════════════════

/** One-off events that degrade the reliability of a single weight reading. */
export type Confounder =
  | 'ate_out'
  | 'travel'
  | 'ill'
  | 'poor_sleep'
  | 'alcohol';

/** How much the engine currently trusts its own TDEE estimate. */
export type DataQuality = 'seeding' | 'converging' | 'stable';

/**
 * One day's logged nutrition. Mirrors the `day_intake` table (PRD §3),
 * which — together with `weight_log` — is one of only two tables the
 * engine may read.
 */
export type DayIntake = {
  /** ISO yyyy-mm-dd, local time. */
  date: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** false = user flagged "didn't log everything" for this day. */
  is_complete: boolean;
};

/**
 * One morning's weight reading. Mirrors the `weight_log` table (PRD §3).
 */
export type WeightLog = {
  /** ISO yyyy-mm-dd, local time. */
  date: string;
  weight_kg: number;
  confounder: Confounder | null;
};

/** Onboarding + settings data. Mirrors the `user_profile` table (PRD §3). */
export type UserProfile = {
  height_cm: number;
  birth_year: number;
  sex: 'male' | 'female';
  goal: 'cut' | 'maintain' | 'gain';
  rate_kg_per_week: number;
  /** Cold-start-only activity multiplier basis (PRD §4.3). */
  activity_seed:
    | 'sedentary'
    | 'lightly_active'
    | 'moderately_active'
    | 'very_active';
  /** Manual override of protein target in g/day; null = auto (PRD §5). */
  protein_override: number | null;
  units: 'metric' | 'imperial';
};

/**
 * The engine's sole output (PRD §4.5). Always a range, never a bare
 * number — the visibly narrowing confidence band is what builds trust.
 */
export type TDEEResult = {
  /** kcal/day. */
  tdee: number;
  confidenceLow: number;
  confidenceHigh: number;
  trendKgPerWeek: number;
  smoothedWeightKg: number;
  dataQuality: DataQuality;
  daysOfData: number;
  loggedDaysInWindow: number;
};

// ═══════════════════════════════════════════════════════════════════════
// TUNING CONSTANTS (PRD §4.1, §4.2)
//
// PRD §14 flags these as needing empirical tuning once real data exists.
// They are exported, overridable parameters — never inline magic numbers
// in the engine implementation. A future debug screen should be able to
// pass overrides straight through to computeTDEE.
// ═══════════════════════════════════════════════════════════════════════

/** 2x2 covariance matrix, row-major: [[p00, p01], [p10, p11]]. */
export type Mat2x2 = readonly [readonly [number, number], readonly [number, number]];

export type KalmanParams = {
  /** Measurement noise (kg²). Daily scale noise. Higher = trust readings less. */
  R: number;
  /** Process noise on weight. */
  Q_weight: number;
  /** Process noise on trend. Lower = smoother, slower to react. */
  Q_trend: number;
  /** Initial state covariance. */
  P0: Mat2x2;
};

/** Kalman filter starting tuning constants (PRD §4.1). Provisional — see PRD §14. */
export const KALMAN_DEFAULTS: KalmanParams = {
  R: 0.6,
  Q_weight: 0.005,
  Q_trend: 0.0005,
  P0: [
    [1.0, 0],
    [0, 0.01],
  ],
};

/**
 * Multiplier applied to `R` for a single observation when that day's
 * weight_log has a non-null confounder (PRD §4.1 "Confounder handling").
 */
export const CONFOUNDER_R_MULTIPLIER = 4;

/** Half-life (days) for the exponentially weighted regression (PRD §4.2). */
export const HALF_LIFE_DAYS = 14;

/** Approximate energy density of body tissue change, kcal per kg (PRD §4.2). */
export const KCAL_PER_KG = 7700;
