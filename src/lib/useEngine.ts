// ═══════════════════════════════════════════════════════════════════════
// useEngine — the single place computeTDEE gets called from.
//
// computeTDEE and computeTargets are pure and cheap (per task brief), but
// that doesn't mean every component should call them independently — this
// hook is the one seam between the pure engine and the app's screens, so
// there is exactly one code path assembling DayIntake[]/WeightLog[]/
// UserProfile and invoking computeTDEE.
//
// ⚠️ Targets are NOT recomputed here. computeTargets exists (imported by
// the weekly check-in screen elsewhere), but this hook deliberately never
// calls it — it only reads the last-*accepted* snapshot via
// src/lib/targetsStore.ts. That's what keeps "targets change only at the
// weekly check-in" true: Today (and anything else built on this hook)
// gets a read-only view of stored targets alongside a live TDEE estimate.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import type { Database } from '../db/database';
import * as intakeRepo from '../db/repositories/intakeRepo';
import * as weightRepo from '../db/repositories/weightRepo';
import * as profileRepo from '../db/repositories/profileRepo';
import { computeTDEE } from '../engine/tdee';
import type { DayIntake, TDEEResult, UserProfile, WeightLog } from '../engine/types';
import { addDaysISO } from '../engine/date';
import { getAcceptedTargets, type StoredTargets } from './targetsStore';
import { getDatabase } from './db';
import { todayLocalISO } from './localDate';

/** How much history to pull for the TDEE computation. Generous but bounded. */
const HISTORY_WINDOW_DAYS = 120;

function toDayIntake(row: { date: string; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; is_complete: number }): DayIntake {
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

/** Fallback profile used only if onboarding (next wave) hasn't written one yet. */
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

export type EngineState = {
  loading: boolean;
  error: string | null;
  tdee: TDEEResult | null;
  targets: StoredTargets | null;
  profile: UserProfile | null;
  hasWeightToday: boolean;
  refresh: () => Promise<void>;
};

/**
 * Loads intake/weight/profile history, computes the current TDEE estimate,
 * and reads the last-accepted target snapshot. Call `refresh()` after any
 * mutation (new food entry, new weight reading) to recompute the TDEE
 * display — this recomputes computeTDEE (cheap, pure), never targets.
 */
export function useEngine(db?: Database): EngineState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tdee, setTdee] = useState<TDEEResult | null>(null);
  const [targets, setTargets] = useState<StoredTargets | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [hasWeightToday, setHasWeightToday] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const database = db ?? (await getDatabase());

      const today = todayLocalISO();
      const startDate = addDaysISO(today, -HISTORY_WINDOW_DAYS);

      const [intakeRows, weightRows, profileRow, todayWeight, storedTargets] = await Promise.all([
        intakeRepo.getRange(database, startDate, today),
        weightRepo.getRange(database, startDate, today),
        profileRepo.getProfile(database),
        weightRepo.getByDate(database, today),
        getAcceptedTargets(database),
      ]);

      const resolvedProfile = profileRow ? toUserProfile(profileRow) : DEFAULT_PROFILE;
      const intake = intakeRows.map(toDayIntake);
      const weights = weightRows.map(toWeightLog);

      const result = computeTDEE(intake, weights, resolvedProfile);

      setProfile(resolvedProfile);
      setTdee(result);
      setTargets(storedTargets);
      setHasWeightToday(todayWeight !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { loading, error, tdee, targets, profile, hasWeightToday, refresh };
}
