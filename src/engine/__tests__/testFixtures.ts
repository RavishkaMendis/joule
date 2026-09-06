import type { UserProfile, DayIntake, WeightLog } from '../types';

export function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    height_cm: 175,
    birth_year: 1994,
    sex: 'male',
    goal: 'cut',
    // Positive = desired weekly loss magnitude (see targets.ts sign-convention note).
    rate_kg_per_week: 0.5,
    activity_seed: 'moderately_active',
    protein_override: null,
    units: 'metric',
    ...overrides,
  };
}

export function makeIntakeDay(date: string, overrides: Partial<DayIntake> = {}): DayIntake {
  return {
    date,
    kcal: 2200,
    protein_g: 160,
    carbs_g: 220,
    fat_g: 70,
    is_complete: true,
    ...overrides,
  };
}

export function makeWeightDay(
  date: string,
  weight_kg: number,
  confounder: WeightLog['confounder'] = null
): WeightLog {
  return { date, weight_kg, confounder };
}
