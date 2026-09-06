import {
  suggestProgression,
  suggestProgressionAmrap,
  type SetForSuggestion,
  type ProgramTargetForSuggestion,
} from '../progressionSuggestion';

function set(overrides: Partial<SetForSuggestion>): SetForSuggestion {
  return { weight_kg: 60, reps: 8, rpe: null, is_warmup: false, logged_at: 1000, ...overrides };
}

describe('suggestProgression — rep_range rule', () => {
  const target: ProgramTargetForSuggestion = { prescriptionType: 'rep_range', repHigh: 10, targetRir: 2 };

  it('returns unknown when no working set has been logged this session', () => {
    expect(suggestProgression([], target).action).toBe('unknown');
    expect(suggestProgression([set({ is_warmup: true, reps: 10, rpe: 6 })], target).action).toBe('unknown');
  });

  it('returns hold when the top set did not reach the top of the rep range, regardless of RIR', () => {
    const result = suggestProgression([set({ reps: 8, rpe: 6 })], target); // RPE 6 = RIR 4, well above target 2
    expect(result.action).toBe('hold');
  });

  it('returns unknown when the rep-range top was hit but no RPE was logged', () => {
    const result = suggestProgression([set({ reps: 10, rpe: null })], target);
    expect(result.action).toBe('unknown');
  });

  it('returns unknown when the rep-range top was hit but the program has no target RIR', () => {
    const result = suggestProgression([set({ reps: 10, rpe: 8 })], { prescriptionType: 'rep_range', repHigh: 10, targetRir: null });
    expect(result.action).toBe('unknown');
  });

  it('AT target RIR + top of rep range -> increase_load', () => {
    // target RIR 2 = RPE 8. Logging RPE 8 at 10 reps is exactly at target.
    const result = suggestProgression([set({ reps: 10, rpe: 8, weight_kg: 60 })], target);
    expect(result.action).toBe('increase_load');
    expect(result.reason).toMatch(/weight/i);
  });

  it('BELOW target RIR (harder than prescribed) + top of rep range -> increase_load', () => {
    // target RIR 2 = RPE 8. RPE 9.5 = RIR 0.5, which is BELOW (harder than) target 2.
    const result = suggestProgression([set({ reps: 10, rpe: 9.5, weight_kg: 60 })], target);
    expect(result.action).toBe('increase_load');
  });

  it('ABOVE target RIR (easier than prescribed) + top of rep range -> hold, not increase', () => {
    // target RIR 2 = RPE 8. RPE 6 = RIR 4, which is ABOVE (easier than) target 2.
    const result = suggestProgression([set({ reps: 10, rpe: 6, weight_kg: 60 })], target);
    expect(result.action).toBe('hold');
  });

  it('a bodyweight/zero-weight exercise at or below target RIR still suggests increasing, with reps/external-load wording instead of "add weight"', () => {
    const result = suggestProgression([set({ reps: 10, rpe: 8, weight_kg: 0 })], target);
    expect(result.action).toBe('increase_load');
    expect(result.reason.toLowerCase()).not.toContain('add a small amount of weight');
    expect(result.reason.toLowerCase()).toMatch(/reps|external load/);
  });

  it('picks the heaviest working set among several, ignoring warm-ups', () => {
    const sets = [
      set({ weight_kg: 40, reps: 12, rpe: 5, is_warmup: true }),
      set({ weight_kg: 60, reps: 10, rpe: 8 }),
      set({ weight_kg: 55, reps: 10, rpe: 6 }),
    ];
    const result = suggestProgression(sets, target);
    // Best set is 60kg x 10 @ RPE 8 (RIR 2, at target) -> increase.
    expect(result.action).toBe('increase_load');
  });

  it('never returns an empty reason string', () => {
    const cases: [SetForSuggestion[], ProgramTargetForSuggestion][] = [
      [[], target],
      [[set({ reps: 5, rpe: 8 })], target],
      [[set({ reps: 10, rpe: null })], target],
      [[set({ reps: 10, rpe: 8 })], { prescriptionType: 'rep_range', repHigh: 10, targetRir: null }],
      [[set({ reps: 10, rpe: 8 })], target],
    ];
    for (const [sets, t] of cases) {
      expect(suggestProgression(sets, t).reason.length).toBeGreaterThan(0);
    }
  });
});

describe('suggestProgression — amrap (to-failure) rule, dispatched through the same entry point', () => {
  const amrapTarget: ProgramTargetForSuggestion = { prescriptionType: 'amrap', repHigh: null, targetRir: 0 };

  it('returns unknown with no working set logged this session', () => {
    expect(suggestProgression([], amrapTarget).action).toBe('unknown');
  });

  it('ignores rep-range-only fields (repHigh/targetRir) entirely for the amrap rule', () => {
    // No lastSessionTopSet supplied -> unknown regardless of reps/rpe on the logged set.
    const result = suggestProgression([set({ reps: 20, rpe: 10 })], amrapTarget);
    expect(result.action).toBe('unknown');
  });

  it('increase_load when more reps were done at the same weight as last session', () => {
    const result = suggestProgression([set({ weight_kg: 60, reps: 12 })], amrapTarget, { weight_kg: 60, reps: 9 });
    expect(result.action).toBe('increase_load');
  });

  it('hold when same-or-fewer reps at the same weight as last session', () => {
    const result = suggestProgression([set({ weight_kg: 60, reps: 8 })], amrapTarget, { weight_kg: 60, reps: 9 });
    expect(result.action).toBe('hold');
  });
});

describe('suggestProgressionAmrap — direct unit tests', () => {
  it('unknown when no top set logged this session', () => {
    expect(suggestProgressionAmrap(null, { weight_kg: 60, reps: 9 }).action).toBe('unknown');
  });

  it('unknown when there is no prior session to compare against', () => {
    expect(suggestProgressionAmrap({ weight_kg: 60, reps: 9 }, null).action).toBe('unknown');
  });

  it('unknown when the weight differs from last session — not comparable "at the same load"', () => {
    const result = suggestProgressionAmrap({ weight_kg: 65, reps: 8 }, { weight_kg: 60, reps: 9 });
    expect(result.action).toBe('unknown');
  });

  it('increase_load: more reps at the same weight than last session', () => {
    const result = suggestProgressionAmrap({ weight_kg: 60, reps: 11 }, { weight_kg: 60, reps: 9 });
    expect(result.action).toBe('increase_load');
    expect(result.reason).toMatch(/11/);
    expect(result.reason).toMatch(/9/);
  });

  it('hold: same reps at the same weight as last session', () => {
    expect(suggestProgressionAmrap({ weight_kg: 60, reps: 9 }, { weight_kg: 60, reps: 9 }).action).toBe('hold');
  });

  it('hold: fewer reps at the same weight than last session', () => {
    expect(suggestProgressionAmrap({ weight_kg: 60, reps: 7 }, { weight_kg: 60, reps: 9 }).action).toBe('hold');
  });

  it('a bodyweight (zero-weight) amrap exercise compares reps at 0kg exactly like any other weight', () => {
    expect(suggestProgressionAmrap({ weight_kg: 0, reps: 15 }, { weight_kg: 0, reps: 12 }).action).toBe('increase_load');
  });

  it('never returns an empty reason string', () => {
    const cases: [{ weight_kg: number; reps: number } | null, { weight_kg: number; reps: number } | null][] = [
      [null, null],
      [null, { weight_kg: 60, reps: 9 }],
      [{ weight_kg: 60, reps: 9 }, null],
      [{ weight_kg: 65, reps: 9 }, { weight_kg: 60, reps: 9 }],
      [{ weight_kg: 60, reps: 11 }, { weight_kg: 60, reps: 9 }],
      [{ weight_kg: 60, reps: 9 }, { weight_kg: 60, reps: 9 }],
    ];
    for (const [topSet, lastSet] of cases) {
      expect(suggestProgressionAmrap(topSet, lastSet).reason.length).toBeGreaterThan(0);
    }
  });
});
