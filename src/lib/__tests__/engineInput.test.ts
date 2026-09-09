// ═══════════════════════════════════════════════════════════════════════
// engineInput — unit tests for both integrity rules, their interaction,
// the must-NOT-filter case, and an integration-flavoured test proving the
// in-progress-day defect (measured: TDEE reads ~114 kcal low) no longer
// moves computeTDEE's estimate once the row is filtered out.
// ═══════════════════════════════════════════════════════════════════════

import { filterIntakeForEngine } from '../engineInput';
import { computeTDEE } from '../../engine/tdee';
import type { DayIntake, UserProfile, WeightLog } from '../../engine/types';

const PROFILE: UserProfile = {
  height_cm: 175,
  birth_year: 1990,
  sex: 'male',
  goal: 'maintain',
  rate_kg_per_week: 0,
  activity_seed: 'sedentary',
  protein_override: null,
  units: 'metric',
};

function day(overrides: Partial<DayIntake> & { date: string }): DayIntake {
  return {
    kcal: 2500,
    protein_g: 150,
    carbs_g: 250,
    fat_g: 80,
    is_complete: true,
    ...overrides,
  };
}

describe('filterIntakeForEngine', () => {
  describe('rule 1 — in progress (today)', () => {
    it("drops the row whose date is exactly `today`, even though is_complete is true", () => {
      const intake = [day({ date: '2026-09-01' }), day({ date: '2026-09-02' })];
      const result = filterIntakeForEngine(intake, '2026-09-02');
      expect(result.map((d) => d.date)).toEqual(['2026-09-01']);
    });

    it('drops a partial in-progress today even at a tiny logged total (the exact defect: one breakfast logged so far)', () => {
      const intake = [day({ date: '2026-09-02', kcal: 400, protein_g: 20, carbs_g: 40, fat_g: 10, is_complete: true })];
      const result = filterIntakeForEngine(intake, '2026-09-02');
      expect(result).toEqual([]);
    });

    it('never reads a clock itself — the exact same input filters differently for a different `today`', () => {
      const intake = [day({ date: '2026-09-02' })];
      expect(filterIntakeForEngine(intake, '2026-09-02')).toEqual([]);
      expect(filterIntakeForEngine(intake, '2026-09-03')).toEqual(intake);
    });

    it('does not affect a past date even when it is the most recent row in a truncated (historical-cutoff) slice', () => {
      // Mirrors useTrendsData's historical chart cutoffs: a slice that
      // ends at a PAST date must not have that date treated as "today".
      const intake = [day({ date: '2026-08-20' }), day({ date: '2026-08-21' })];
      const result = filterIntakeForEngine(intake, '2026-09-05'); // real today, well after the slice
      expect(result).toEqual(intake);
    });
  });

  describe('rule 2 — empty rollup', () => {
    it('drops a day where kcal, protein, carbs, and fat are all exactly zero', () => {
      const intake = [
        day({ date: '2026-09-01', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }),
        day({ date: '2026-08-31' }),
      ];
      const result = filterIntakeForEngine(intake, '2026-09-05');
      expect(result.map((d) => d.date)).toEqual(['2026-08-31']);
    });

    it('does NOT drop a day with kcal 0 but nonzero macros (a real anomaly, not this rule\'s target — left for data-health/Atwater checks, not silently dropped from the engine)', () => {
      const intake = [day({ date: '2026-08-31', kcal: 0, protein_g: 10, carbs_g: 5, fat_g: 2 })];
      const result = filterIntakeForEngine(intake, '2026-09-05');
      expect(result).toEqual(intake);
    });

    it('does NOT drop a day with nonzero kcal but zero macros (e.g. an entry missing macro data)', () => {
      const intake = [day({ date: '2026-08-31', kcal: 50, protein_g: 0, carbs_g: 0, fat_g: 0 })];
      const result = filterIntakeForEngine(intake, '2026-09-05');
      expect(result).toEqual(intake);
    });

    it('applies regardless of is_complete — an empty rollup is dropped even if marked incomplete', () => {
      const intake = [day({ date: '2026-08-31', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, is_complete: false })];
      const result = filterIntakeForEngine(intake, '2026-09-05');
      expect(result).toEqual([]);
    });
  });

  describe('interaction between the two rules', () => {
    it('drops both an empty historical day and today\'s in-progress day in the same call', () => {
      const intake = [
        day({ date: '2026-08-30' }), // real, keep
        day({ date: '2026-08-31', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), // rule 2
        day({ date: '2026-09-01', kcal: 400 }), // today, rule 1
      ];
      const result = filterIntakeForEngine(intake, '2026-09-01');
      expect(result.map((d) => d.date)).toEqual(['2026-08-30']);
    });

    it("today's row being an empty rollup is still just one dropped row (rules don't double-count / error)", () => {
      const intake = [day({ date: '2026-09-01', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })];
      const result = filterIntakeForEngine(intake, '2026-09-01');
      expect(result).toEqual([]);
    });
  });

  describe('the case that must NOT be filtered', () => {
    it('keeps a real, complete, past logged day with real macros untouched', () => {
      const realDay = day({ date: '2026-08-15', kcal: 2480, protein_g: 160, carbs_g: 240, fat_g: 75, is_complete: true });
      const result = filterIntakeForEngine([realDay], '2026-09-05');
      expect(result).toEqual([realDay]);
    });

    it('is a pure function: does not mutate its input array or the day objects within it', () => {
      const intake = [day({ date: '2026-09-01', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }), day({ date: '2026-08-31' })];
      const snapshot = JSON.parse(JSON.stringify(intake));
      filterIntakeForEngine(intake, '2026-09-01');
      expect(intake).toEqual(snapshot);
    });

    it('an empty array in yields an empty array out', () => {
      expect(filterIntakeForEngine([], '2026-09-05')).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INTEGRATION: proves the fix actually neutralizes the measured defect at
// the computeTDEE boundary, not just at the filter's own unit level.
// ═══════════════════════════════════════════════════════════════════════
describe('filterIntakeForEngine integration with computeTDEE', () => {
  function buildHistory(days: number, kcalPerDay: number, today: string): { intake: DayIntake[]; weights: WeightLog[] } {
    const intake: DayIntake[] = [];
    const weights: WeightLog[] = [];
    // Build `days` complete history days ending the day BEFORE `today`,
    // with a slow, steady weight trend consistent with kcalPerDay at a
    // ~2500 kcal/day maintenance TDEE (mirrors the task brief's 45-day/
    // 2500 kcal synthetic series).
    const todayMs = Date.parse(`${today}T00:00:00Z`);
    for (let i = days; i >= 1; i--) {
      const d = new Date(todayMs - i * 86400000).toISOString().slice(0, 10);
      intake.push({ date: d, kcal: kcalPerDay, protein_g: 150, carbs_g: 250, fat_g: 80, is_complete: true });
      weights.push({ date: d, weight_kg: 80 - i * 0.01, confounder: null });
    }
    return { intake, weights };
  }

  it("today's in-progress partial log does not move the TDEE point estimate, once filtered", () => {
    const today = '2026-09-05';
    const { intake, weights } = buildHistory(45, 2500, today);

    // Baseline: computeTDEE over the clean, complete 45-day intake
    // history (no row for `today` at all — this is what the intake
    // series looks like AFTER filtering), but WITH today's weight
    // reading present, since weigh-ins happen independently of food
    // logging and must still reach the Kalman filter either way (see
    // module header: "weight readings ... untouched"). Isolating the
    // weight-anchor effect like this means this comparison measures
    // ONLY what the intake-filtering fix changes.
    const todaysWeight: WeightLog = { date: today, weight_kg: 79.5, confounder: null };
    const allWeights = [...weights, todaysWeight];
    const baseline = computeTDEE(intake, allWeights, PROFILE);

    // Defect reproduction: the app hands the engine an UNFILTERED array
    // that includes today's just-started, technically-"complete" 400
    // kcal rollup — exactly what intakeRepo.recomputeDay produces the
    // moment the user logs breakfast.
    const unfiltered = [...intake, { date: today, kcal: 400, protein_g: 20, carbs_g: 40, fat_g: 10, is_complete: true }];
    const withDefect = computeTDEE(unfiltered, allWeights, PROFILE);

    // Fix: filter before computeTDEE, exactly as useEngine.ts/
    // WeeklyCheckInScreen.tsx/useTrendsData.ts now do.
    const filtered = filterIntakeForEngine(unfiltered, today);
    const withFix = computeTDEE(filtered, allWeights, PROFILE);

    // The unfiltered path must actually reproduce a measurable defect
    // (otherwise this test would pass for the wrong reason) ...
    expect(Math.abs(withDefect.tdee - baseline.tdee)).toBeGreaterThan(20);
    // ... and the fix must bring it back exactly in line with the
    // baseline (the filtered intake array is structurally identical to
    // the baseline's, so the results must match exactly, not just
    // approximately).
    expect(withFix.tdee).toBe(baseline.tdee);
  });

  it('a phantom zero-calorie day (all entries deleted after being marked complete) does not move the TDEE point estimate, once filtered', () => {
    const today = '2026-09-05';
    const { intake, weights } = buildHistory(45, 2500, today);

    // Baseline: the phantom day simply absent from intake entirely (what
    // filtering produces), weights untouched.
    const phantomDate = intake[10].date;
    const withoutPhantomDay = intake.filter((d) => d.date !== phantomDate);
    const baseline = computeTDEE(withoutPhantomDay, weights, PROFILE);

    // Defect reproduction: entries for one historical day were fully
    // deleted, leaving recomputeDay's all-zero, is_complete=1 rollup in
    // place rather than no row at all.
    const withPhantom = intake.map((d) => (d.date === phantomDate ? { ...d, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 } : d));
    const withDefect = computeTDEE(withPhantom, weights, PROFILE);

    const filtered = filterIntakeForEngine(withPhantom, today);
    const withFix = computeTDEE(filtered, weights, PROFILE);

    expect(Math.abs(withDefect.tdee - baseline.tdee)).toBeGreaterThan(20);
    expect(withFix.tdee).toBe(baseline.tdee);
  });
});
