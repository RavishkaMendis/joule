// ═══════════════════════════════════════════════════════════════════════
// COLD START — PRD §4.3
//
// No historical data is expected and fine at first. Seed with
// Mifflin-St Jeor × activity factor, then blend toward the measured
// (Kalman + regression) estimate as data accumulates:
//
//   Days 0–9   pure seed             dataQuality: 'seeding'
//   Days 10–21 blend seed + measured dataQuality: 'converging'
//   Day 22+    pure measured         dataQuality: 'stable'
//
// "Weighting measured progressively higher as the CI narrows" (PRD §4.3):
// we use the measured estimate's own standard error as the blend driver —
// a tighter SE (more/better data) pulls the blend toward measured faster
// than elapsed days alone would, while day count still gates the three
// regimes required by the PRD (0–9 / 10–21 / 22+).
// ═══════════════════════════════════════════════════════════════════════

import type { UserProfile } from './types';

const ACTIVITY_FACTORS: Record<UserProfile['activity_seed'], number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
};

/** Days 0–9: pure seed. */
const SEEDING_MAX_DAY = 9;
/** Days 10–21: blend. Day 22+: pure measured. */
const CONVERGING_MAX_DAY = 21;

/** Half-width (kcal) of the confidence band while pure-seeding (day 0–9). */
const SEED_BAND_HALF_WIDTH = 400;
/** Floor on the measured band half-width so it never collapses to a point. */
const MIN_BAND_HALF_WIDTH = 40;
/** z-score for a ~95% confidence band (PRD §4.5: "always a range"). */
const CONFIDENCE_Z = 1.96;

export type ColdStartSeed = {
  /** Mifflin-St Jeor BMR × activity factor. */
  seedTDEE: number;
  /** Confidence band half-width to use while pure-seeding. */
  bandWidth: number;
};

/** Age in whole years, from birth_year against the current date's year. */
function ageFromBirthYear(birthYear: number): number {
  const currentYear = new Date().getUTCFullYear();
  return Math.max(currentYear - birthYear, 0);
}

/**
 * Mifflin-St Jeor BMR, multiplied by the declared activity factor
 * (PRD §4.3). Requires a plausible weight — cold start has no measured
 * weight yet, so callers seed this from onboarding's "current weight"
 * captured into the profile at signup time. Since UserProfile (per
 * src/engine/types.ts) doesn't carry a weight field directly, callers
 * that have a first weight_log reading should prefer using that; this
 * function is exposed for the pure "zero data at all" case where only
 * profile fields are available, via `seedWeightKg`.
 */
export function computeColdStartSeed(profile: UserProfile, seedWeightKg?: number): ColdStartSeed {
  const age = ageFromBirthYear(profile.birth_year);
  // Fallback seed weight: without any weight_log data yet, Mifflin-St Jeor
  // still needs a mass term. 70kg is a neutral placeholder only used in
  // the total absence of any weight data (computeTDEE's weights.length
  // === 0 branch); as soon as a single reading exists, the caller should
  // pass it via seedWeightKg.
  const weightKg = seedWeightKg ?? 70;

  const bmr =
    profile.sex === 'male'
      ? 10 * weightKg + 6.25 * profile.height_cm - 5 * age + 5
      : 10 * weightKg + 6.25 * profile.height_cm - 5 * age - 161;

  const activityFactor = ACTIVITY_FACTORS[profile.activity_seed];
  const seedTDEE = bmr * activityFactor;

  return {
    seedTDEE: Number.isFinite(seedTDEE) ? seedTDEE : 2000,
    bandWidth: SEED_BAND_HALF_WIDTH,
  };
}

export type ColdStartBlend = {
  tdee: number;
  bandHalfWidth: number;
};

/**
 * Blend the cold-start seed and the measured TDEE estimate according to
 * the day-based regimes in PRD §4.3, with the measured weight inside the
 * "converging" window driven by how tight the measured estimate's own
 * standard error is (tighter SE -> more trust, sooner).
 */
export function blendColdStart(
  seedTDEE: number,
  measuredTDEE: number,
  measuredSE: number,
  daysOfData: number
): ColdStartBlend {
  if (daysOfData <= SEEDING_MAX_DAY) {
    return { tdee: seedTDEE, bandHalfWidth: SEED_BAND_HALF_WIDTH };
  }

  const measuredBandHalfWidth = Number.isFinite(measuredSE)
    ? Math.max(measuredSE * CONFIDENCE_Z, MIN_BAND_HALF_WIDTH)
    : SEED_BAND_HALF_WIDTH;

  if (daysOfData > CONVERGING_MAX_DAY) {
    return { tdee: measuredTDEE, bandHalfWidth: measuredBandHalfWidth };
  }

  // Converging window (days 10–21): weight measured progressively higher
  // both as elapsed days grow (dayFrac) and as the measured estimate's CI
  // narrows relative to the seed band (precisionFrac). Combine the two so
  // a fast-converging estimate (tight SE early) is trusted sooner, while
  // still respecting the day-10..21 window boundaries from the PRD.
  const dayFrac = (daysOfData - SEEDING_MAX_DAY) / (CONVERGING_MAX_DAY - SEEDING_MAX_DAY);
  const precisionFrac = Number.isFinite(measuredSE)
    ? clamp01(1 - measuredBandHalfWidth / SEED_BAND_HALF_WIDTH)
    : 0;
  const measuredWeight = clamp01(0.5 * dayFrac + 0.5 * precisionFrac);

  const tdee = (1 - measuredWeight) * seedTDEE + measuredWeight * measuredTDEE;

  // Combine the two uncertainties in QUADRATURE, not linearly. The blended
  // estimate is a weighted sum of two independent estimates, so its variance
  // is (1-m)²σ_seed² + m²σ_meas² — not (1-m)σ_seed + m·σ_meas, which is
  // always the wider of the two (|a|+|b| ≥ √(a²+b²)) and measurably
  // over-covered: it produced ~100% empirical coverage at day 21 where a
  // correctly-sized 95% band should sit near 95%. Over-covering is the safe
  // direction, but a band that claims 95% should mean 95%.
  const seedTerm = (1 - measuredWeight) * SEED_BAND_HALF_WIDTH;
  const measuredTerm = measuredWeight * measuredBandHalfWidth;
  const bandHalfWidth = Math.max(
    Math.sqrt(seedTerm * seedTerm + measuredTerm * measuredTerm),
    MIN_BAND_HALF_WIDTH
  );

  return { tdee, bandHalfWidth };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
