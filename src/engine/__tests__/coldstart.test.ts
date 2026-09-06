import { computeColdStartSeed, blendColdStart } from '../coldstart';
import { computeTDEE } from '../tdee';
import { makeProfile, makeIntakeDay, makeWeightDay } from './testFixtures';
import type { DayIntake, WeightLog } from '../types';

describe('computeColdStartSeed', () => {
  test('Mifflin-St Jeor male vs female formula difference', () => {
    const maleProfile = makeProfile({ sex: 'male', birth_year: 1994, height_cm: 175 });
    const femaleProfile = makeProfile({ sex: 'female', birth_year: 1994, height_cm: 175 });
    const male = computeColdStartSeed(maleProfile, 75);
    const female = computeColdStartSeed(femaleProfile, 75);
    // Male formula adds +5, female subtracts -161: male seed must be higher
    // for identical inputs otherwise.
    expect(male.seedTDEE).toBeGreaterThan(female.seedTDEE);
  });

  test('activity factor scales the seed up monotonically', () => {
    const sedentary = computeColdStartSeed(makeProfile({ activity_seed: 'sedentary' }), 75);
    const light = computeColdStartSeed(makeProfile({ activity_seed: 'lightly_active' }), 75);
    const moderate = computeColdStartSeed(makeProfile({ activity_seed: 'moderately_active' }), 75);
    const veryActive = computeColdStartSeed(makeProfile({ activity_seed: 'very_active' }), 75);
    expect(sedentary.seedTDEE).toBeLessThan(light.seedTDEE);
    expect(light.seedTDEE).toBeLessThan(moderate.seedTDEE);
    expect(moderate.seedTDEE).toBeLessThan(veryActive.seedTDEE);
  });

  test('never returns NaN even with implausible birth years', () => {
    const seed = computeColdStartSeed(makeProfile({ birth_year: 2100 }), 75);
    expect(Number.isNaN(seed.seedTDEE)).toBe(false);
  });
});

describe('blendColdStart', () => {
  test('days 0-9 is pure seed', () => {
    const blend = blendColdStart(2000, 2600, 50, 5);
    expect(blend.tdee).toBe(2000);
  });

  test('day 22+ is pure measured', () => {
    const blend = blendColdStart(2000, 2600, 50, 25);
    expect(blend.tdee).toBe(2600);
  });

  test('days 10-21 blend between seed and measured', () => {
    const blend = blendColdStart(2000, 2600, 50, 15);
    expect(blend.tdee).toBeGreaterThan(2000);
    expect(blend.tdee).toBeLessThan(2600);
  });
});

function buildDailySeries(
  days: number,
  startWeight: number,
  kgPerDay: number,
  kcal: number
): { intake: DayIntake[]; weights: WeightLog[] } {
  const intake: DayIntake[] = [];
  const weights: WeightLog[] = [];
  const start = new Date('2024-01-01T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    weights.push(makeWeightDay(iso, startWeight - kgPerDay * i));
    intake.push(makeIntakeDay(iso, { kcal }));
  }
  return { intake, weights };
}

describe('computeTDEE data quality regime transitions (PRD §4.3)', () => {
  test('day 0 (no weight data) reports seeding', () => {
    const result = computeTDEE([], [], makeProfile());
    expect(result.dataQuality).toBe('seeding');
  });

  test('day ~9 reports seeding, day ~15 reports converging, day ~25 reports stable', () => {
    const nine = buildDailySeries(9, 85, 0.05, 2200);
    const fifteen = buildDailySeries(15, 85, 0.05, 2200);
    const twentyFive = buildDailySeries(25, 85, 0.05, 2200);

    const resultNine = computeTDEE(nine.intake, nine.weights, makeProfile());
    const resultFifteen = computeTDEE(fifteen.intake, fifteen.weights, makeProfile());
    const resultTwentyFive = computeTDEE(twentyFive.intake, twentyFive.weights, makeProfile());

    expect(resultNine.dataQuality).toBe('seeding');
    expect(resultFifteen.dataQuality).toBe('converging');
    expect(resultTwentyFive.dataQuality).toBe('stable');
  });
});
