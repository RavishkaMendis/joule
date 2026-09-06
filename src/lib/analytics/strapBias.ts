// ═══════════════════════════════════════════════════════════════════════
// STRAP BIAS — PRD §9.2: "'Strap bias: +19%' stat once 30 days exist."
//
// Compares the wearable's (Zepp) daily TDEE estimate against Joule's own
// measured TDEE, so the user can calibrate their strap against ground
// truth ("your strap runs 19% high"). This is the one place in the app
// that legitimately looks at both numbers side by side for *display* —
// crucially, it never feeds either number back into the other, and it is
// NOT part of src/engine/** (which must never see ExternalEstimate at
// all, PRD §3).
//
// The honesty rule this module exists to enforce: only compare Zepp
// against a MEASURED Joule TDEE, never a Mifflin-St Jeor cold-start seed
// (dataQuality === 'seeding'). Comparing Zepp against Joule's own
// formula-based seed would be comparing one formula's guess to another's
// — meaningless, and it would make the "bias" stat swing wildly during
// the first ~3 weeks for reasons that have nothing to do with the strap.
// Seeded days are excluded from the overlap entirely: they don't count
// toward the 30-day gate and don't contribute to the average.
// ═══════════════════════════════════════════════════════════════════════

import type { DataQuality } from '../../engine/types';

/** Minimum number of overlapping (Zepp + measured Joule TDEE) days required before a bias stat is shown at all (PRD §9.2). */
export const STRAP_BIAS_MIN_OVERLAP_DAYS = 30;

export type JouleTdeeDay = {
  date: string;
  tdee: number;
  dataQuality: DataQuality;
};

export type ZeppTdeeDay = {
  date: string;
  /** null if this day's Zepp row has no tdee_est (partial import — e.g. only steps/sleep were mapped). */
  tdee_est: number | null;
};

export type StrapBiasResult =
  | {
      /** Enough qualifying overlap to report a stat. */
      available: true;
      /** Fractional bias: (avg zepp - avg joule) / avg joule. +0.19 means the strap reads 19% high. */
      biasFraction: number;
      /** Rounded percentage for display, signed (e.g. +19, -8). */
      biasPercent: number;
      overlapDays: number;
      avgZeppTdee: number;
      avgJouleTdee: number;
    }
  | {
      available: false;
      overlapDays: number;
      daysNeeded: number;
    };

/**
 * Compute the strap-bias stat from paired daily series. Only days present
 * in BOTH series, with a non-null Zepp `tdee_est`, AND a Joule `dataQuality`
 * of 'converging' or 'stable' (never 'seeding') count as "overlap." Below
 * `STRAP_BIAS_MIN_OVERLAP_DAYS` qualifying days, returns `available: false`
 * with how many more days are needed — the caller shows that instead of a
 * premature number (PRD §10: never a confident-looking figure built on too
 * little data).
 */
export function computeStrapBias(joule: readonly JouleTdeeDay[], zepp: readonly ZeppTdeeDay[]): StrapBiasResult {
  const jouleByDate = new Map(joule.map((d) => [d.date, d]));

  let sumZepp = 0;
  let sumJoule = 0;
  let overlapDays = 0;

  for (const z of zepp) {
    if (z.tdee_est === null) continue;
    const j = jouleByDate.get(z.date);
    if (!j) continue;
    if (j.dataQuality === 'seeding') continue; // never compare against a cold-start formula guess

    sumZepp += z.tdee_est;
    sumJoule += j.tdee;
    overlapDays += 1;
  }

  if (overlapDays < STRAP_BIAS_MIN_OVERLAP_DAYS) {
    return {
      available: false,
      overlapDays,
      daysNeeded: STRAP_BIAS_MIN_OVERLAP_DAYS - overlapDays,
    };
  }

  const avgZeppTdee = sumZepp / overlapDays;
  const avgJouleTdee = sumJoule / overlapDays;
  const biasFraction = avgJouleTdee === 0 ? 0 : (avgZeppTdee - avgJouleTdee) / avgJouleTdee;

  return {
    available: true,
    biasFraction,
    biasPercent: Math.round(biasFraction * 100),
    overlapDays,
    avgZeppTdee,
    avgJouleTdee,
  };
}
