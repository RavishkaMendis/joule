// ═══════════════════════════════════════════════════════════════════════
// BAND CALIBRATION — the real acceptance gate for this engine.
//
// The PRD Appendix originally asked for "±100 kcal by day 21". That gate
// is not statistically achievable and has been annotated as such in the
// PRD. With σ≈0.7 kg daily scale noise, the OLS slope standard error over
// 21 daily points is 0.7/√770 ≈ 0.0252 kg/day, i.e. 7700 × 0.0252 ≈ 194
// kcal of TDEE standard error. ±100 kcal is therefore ~0.5σ and lands
// roughly 40% of the time no matter how Q/R are tuned. A 20× sweep over
// Q_weight, Q_trend, R and half-life found nothing better, so
// KALMAN_DEFAULTS stay at the PRD §4.1 values.
//
// What replaces it, and what this file enforces:
//
//   1. The point estimate is UNBIASED — errors centre near zero.
//   2. The reported band is HONEST — the true TDEE falls inside
//      [confidenceLow, confidenceHigh] about as often as ~95% claims.
//   3. The band is not gamed in either direction — neither narrow enough
//      to lie, nor so wide it buys coverage by saying nothing.
//
// (3) is why coverage alone is insufficient: an engine returning ±5000
// would score 100% coverage and be useless. Both rails are asserted.
//
// PRD §4.5 — "Always report a range, never a bare number." A calibrated
// ±190 at day 21 is a good result. A confident ±50 at day 21 is the
// engine lying, and that is the failure mode worth catching here.
// ═══════════════════════════════════════════════════════════════════════

import { computeTDEE } from '../tdee';
import { computeColdStartSeed } from '../coldstart';
import { makeProfile } from './testFixtures';
import { mulberry32, gaussian } from './prng';
import { KCAL_PER_KG } from '../types';
import type { DayIntake, WeightLog } from '../types';

const SEED_WEIGHT_KG = 85;
const SCALE_NOISE_SD = 0.7; // PRD Appendix
const N_SEEDS = 200;

type Trial = { signedError: number; covered: boolean; halfWidth: number };

/**
 * One synthetic run: a known true TDEE, a fixed intake, the weight
 * trajectory that energy balance implies, plus Gaussian scale noise and a
 * few water-weight spikes.
 *
 * Spike sign and placement are randomised across the whole window. Fixed
 * all-positive spikes early in the series would tilt the fitted slope
 * systematically and show up as estimator bias that isn't real.
 */
function runTrial(seed: number, days: number): Trial {
  const profile = makeProfile();
  const rng = mulberry32(seed);

  // Centre the true TDEE on the Mifflin seed so the cold-start prior is
  // unbiased ON AVERAGE. This is the crux of the whole file: without it,
  // days 10–21 show ~+100 kcal of apparent bias that is really just the
  // §4.3 blend correctly pulling toward its prior. That is prior
  // mismatch, not estimator bias, and conflating the two would send a
  // future reader hunting a bug that does not exist.
  const seedTDEE = computeColdStartSeed(profile, SEED_WEIGHT_KG).seedTDEE;
  const trueTDEE = seedTDEE + (rng() - 0.5) * 700;
  const intakeKcal = trueTDEE - 500; // steady ~500 kcal deficit

  const spikes = new Map<number, number>();
  for (let s = 0; s < 3; s++) {
    const day = Math.floor(rng() * days);
    spikes.set(day, (rng() < 0.5 ? -1 : 1) * (0.8 + rng() * 1.2));
  }

  const intake: DayIntake[] = [];
  const weights: WeightLog[] = [];
  const start = Date.UTC(2024, 0, 1);
  let trueWeight = SEED_WEIGHT_KG;

  for (let i = 0; i < days; i++) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    intake.push({
      date,
      kcal: intakeKcal,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 1,
      is_complete: true,
    });
    weights.push({
      date,
      weight_kg: trueWeight + gaussian(rng, 0, SCALE_NOISE_SD) + (spikes.get(i) ?? 0),
      confounder: null,
    });
    trueWeight += (intakeKcal - trueTDEE) / KCAL_PER_KG;
  }

  const r = computeTDEE(intake, weights, profile);
  return {
    signedError: r.tdee - trueTDEE,
    covered: trueTDEE >= r.confidenceLow && trueTDEE <= r.confidenceHigh,
    halfWidth: (r.confidenceHigh - r.confidenceLow) / 2,
  };
}

// Each measure() is 200 computeTDEE runs, so memoise — the horizons are
// reused across the bias, coverage and narrowing assertions and there is
// no reason to pay for them more than once.
const measureCache = new Map<number, ReturnType<typeof measureUncached>>();
function measure(days: number) {
  let m = measureCache.get(days);
  if (!m) {
    m = measureUncached(days);
    measureCache.set(days, m);
  }
  return m;
}

function measureUncached(days: number) {
  const trials: Trial[] = [];
  for (let seed = 1; seed <= N_SEEDS; seed++) trials.push(runTrial(seed * 7919, days));

  const n = trials.length;
  const meanSigned = trials.reduce((a, t) => a + t.signedError, 0) / n;
  const empiricalSD = Math.sqrt(
    trials.reduce((a, t) => a + (t.signedError - meanSigned) ** 2, 0) / n
  );
  return {
    meanSigned,
    empiricalSD,
    coverage: trials.filter((t) => t.covered).length / n,
    meanHalfWidth: trials.reduce((a, t) => a + t.halfWidth, 0) / n,
  };
}

// Measured at time of writing (200 seeds, prior centred):
//   day 21 — meanSigned +35, coverage 96%, halfWidth 356, empiricalSD 174
//   day 45 — meanSigned +22, coverage 94%, halfWidth 162, empiricalSD  77
// A small positive bias (peaking ~+53 around day 30) is real but is ~2%
// of TDEE, sits well inside the reported band, and decays to ~+7 by day
// 60. The ±60 bar below accommodates it deliberately rather than
// pretending it is zero.
describe.each([21, 45])('calibration at day %i', (days) => {
  const m = measure(days);

  test('point estimate is unbiased — errors centre near zero', () => {
    expect(Math.abs(m.meanSigned)).toBeLessThan(60);
  });

  test('reported band is honest — empirical coverage matches the ~95% claim', () => {
    expect(m.coverage).toBeGreaterThanOrEqual(0.9);
    expect(m.coverage).toBeLessThanOrEqual(0.99);
  });

  test('band is not narrower than the true spread (would be lying)', () => {
    // 1.96σ is the width a 95% band actually needs. Allow a little slack
    // below it; anything far under means the CI understates uncertainty.
    expect(m.meanHalfWidth).toBeGreaterThan(1.5 * m.empiricalSD);
  });

  test('band does not buy coverage by being uselessly wide', () => {
    // Guards the opposite failure: returning ±5000 would score 100%
    // coverage and tell the user nothing.
    expect(m.meanHalfWidth).toBeLessThan(4 * m.empiricalSD);
  });
});

test('confidence band narrows materially as data accumulates', () => {
  const early = measure(21);
  const late = measure(45);
  expect(late.meanHalfWidth).toBeLessThan(early.meanHalfWidth);
  // PRD §4.5: the visible narrowing is what builds trust, so require a
  // real reduction rather than a rounding-error improvement.
  expect(late.meanHalfWidth).toBeLessThan(0.75 * early.meanHalfWidth);
});
