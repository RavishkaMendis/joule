// ═══════════════════════════════════════════════════════════════════════
// TARGETS — PRD §5
//
// Pure function computing calorie + macro targets from a TDEEResult and
// UserProfile. Recalculated only at the weekly check-in (PRD §5, §9.3) —
// this module itself doesn't enforce *when* it's called, that's a caller
// concern (the weekly check-in screen), but it never mutates or reads
// anything beyond its two inputs.
// ═══════════════════════════════════════════════════════════════════════

import type { TDEEResult, UserProfile } from './types';

// ─── Sign convention for UserProfile.rate_kg_per_week (ambiguous in PRD §5) ───
//
// PRD §5 gives the formula `target_kcal = TDEE − (rate_kg_per_week × 7700/7)`
// but never states the sign convention for rate_kg_per_week, and the
// engine's own TDEEResult.trendKgPerWeek uses the opposite convention
// (negative = losing weight — see PRD §4.5 and PRD §9.3's example
// "Weight trend −0.42 kg/wk"). Taking trendKgPerWeek's convention
// literally into this formula would mean a cut (negative rate) *raises*
// the target, which is backwards.
//
// Resolved as: rate_kg_per_week is signed the way a user states a goal —
// positive = desired weekly *loss* magnitude when cutting, negative =
// desired weekly gain when bulking, 0 at maintenance. This makes the PRD
// formula correct as literally written once "losing" is a positive
// deficit: target_kcal = TDEE − (rate_kg_per_week × 7700/7).
// This mirrors onboarding UX in comparable apps ("how many kg would you
// like to lose per week?" as a positive number) and keeps the literal
// formula intact rather than reinterpreting its sign.
/** kcal per kg of body-mass change (same constant as the TDEE solver). */
const KCAL_PER_KG_PER_WEEK_DIVISOR = 7700 / 7; // kcal/day per kg/week of target rate

/** Deficit safety rail: never more than this fraction of TDEE. */
const MAX_DEFICIT_FRACTION = 0.25;

/** Absolute calorie floors (PRD §5). */
const ABSOLUTE_FLOOR_KCAL: Record<UserProfile['sex'], number> = {
  male: 1500,
  female: 1200,
};

/** Protein target range, g/kg of smoothed body weight (PRD §5). */
const PROTEIN_G_PER_KG_MAINTAIN_GAIN = 1.6;
const PROTEIN_G_PER_KG_CUT = 2.2;

/** Fat floor, g/kg of smoothed body weight (PRD §5, hormonal health). */
const FAT_FLOOR_G_PER_KG = 0.8;

/** kcal per gram for each macro. */
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARB = 4;
const KCAL_PER_G_FAT = 9;

export type RailReason =
  | { rail: 'deficit_cap'; requestedKcal: number; cappedKcal: number; maxDeficitFraction: number }
  | { rail: 'absolute_floor'; requestedKcal: number; cappedKcal: number; floorKcal: number };

export type TargetResult = {
  targetKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /**
   * Populated when a safety rail bound and clamped the requested target.
   * The UI should surface this plainly rather than silently showing a
   * different number than the user's stated rate would imply.
   */
  railReason: RailReason | null;
};

/**
 * Compute calorie + macro targets from the current TDEE estimate and the
 * user's profile (goal rate, sex, protein override).
 */
export function computeTargets(tdeeResult: TDEEResult, profile: UserProfile): TargetResult {
  const { tdee } = tdeeResult;
  const smoothedWeightKg = tdeeResult.smoothedWeightKg;

  const requestedDeltaKcal = profile.rate_kg_per_week * KCAL_PER_KG_PER_WEEK_DIVISOR;
  const requestedKcal = tdee - requestedDeltaKcal;

  // ─── Safety rails ───
  // Deficit cap: the requested deficit (positive when cutting) must not
  // exceed MAX_DEFICIT_FRACTION of TDEE. A surplus (gaining) never trips
  // this rail — it only bounds how aggressive a cut can be.
  const requestedDeficit = tdee - requestedKcal;
  const maxDeficitKcal = tdee * MAX_DEFICIT_FRACTION;

  let cappedKcal = requestedKcal;
  let railReason: RailReason | null = null;

  if (requestedDeficit > maxDeficitKcal) {
    cappedKcal = tdee - maxDeficitKcal;
    railReason = {
      rail: 'deficit_cap',
      requestedKcal,
      cappedKcal,
      maxDeficitFraction: MAX_DEFICIT_FRACTION,
    };
  }

  const floorKcal = ABSOLUTE_FLOOR_KCAL[profile.sex];
  if (cappedKcal < floorKcal) {
    const preFloorRequested = railReason ? railReason.requestedKcal : requestedKcal;
    cappedKcal = floorKcal;
    railReason = {
      rail: 'absolute_floor',
      requestedKcal: preFloorRequested,
      cappedKcal,
      floorKcal,
    };
  }

  const targetKcal = cappedKcal;

  // ─── Macro allocation, in order (PRD §5) ───
  // 1. Protein: 1.6 g/kg (maintain/gain) to 2.2 g/kg (cut), off smoothed
  //    weight, honouring a manual override.
  const proteinGPerKg = profile.goal === 'cut' ? PROTEIN_G_PER_KG_CUT : PROTEIN_G_PER_KG_MAINTAIN_GAIN;
  const proteinG = profile.protein_override ?? proteinGPerKg * smoothedWeightKg;

  // 2. Fat floor.
  const fatFloorG = FAT_FLOOR_G_PER_KG * smoothedWeightKg;

  // 3. Carbs absorb the remainder, after protein + fat floor are funded.
  const kcalAfterProtein = targetKcal - proteinG * KCAL_PER_G_PROTEIN;
  const kcalAfterFatFloor = kcalAfterProtein - fatFloorG * KCAL_PER_G_FAT;

  let fatG = fatFloorG;
  let carbsG: number;

  if (kcalAfterFatFloor >= 0) {
    // Remaining calories after protein + fat floor all go to carbs.
    carbsG = kcalAfterFatFloor / KCAL_PER_G_CARB;
  } else {
    // Target is so low that protein + fat floor alone exceed it. Keep
    // protein fixed (it's the priority macro), zero out carbs, and let
    // fat absorb whatever's left above protein — never negative.
    carbsG = 0;
    const kcalForFat = Math.max(kcalAfterProtein, 0);
    fatG = kcalForFat / KCAL_PER_G_FAT;
  }

  return {
    targetKcal: safeNumber(targetKcal),
    proteinG: safeNumber(proteinG),
    fatG: safeNumber(fatG),
    carbsG: safeNumber(carbsG),
    railReason,
  };
}

function safeNumber(v: number): number {
  return Number.isFinite(v) ? v : 0;
}
