import { planSessionFromProgramDay, resolveSlotExerciseId, type ProgramExerciseLike } from '../programSession';

function pe(overrides: Partial<ProgramExerciseLike> & { id: string; exercise_id: string; order_index: number }): ProgramExerciseLike {
  return {
    target_sets: 3,
    prescription_type: 'rep_range',
    rep_low: 8,
    rep_high: 10,
    target_rir: 2,
    rest_seconds: 90,
    cues: null,
    demo_url: null,
    ...overrides,
  };
}

describe('planSessionFromProgramDay — session-from-program-day construction', () => {
  it('maps each program_exercise row to a target, preserving all fields', () => {
    const rows: ProgramExerciseLike[] = [
      pe({ id: 'pe1', exercise_id: 'seed_bench_press', order_index: 0, target_sets: 4, rep_low: 6, rep_high: 8, target_rir: 2, rest_seconds: 150, cues: 'Brace core.', demo_url: 'https://example.com/bench' }),
    ];

    const plan = planSessionFromProgramDay(rows);

    expect(plan).toEqual([
      {
        programExerciseId: 'pe1',
        exerciseId: 'seed_bench_press',
        orderIndex: 0,
        targetSets: 4,
        prescriptionType: 'rep_range',
        repLow: 6,
        repHigh: 8,
        targetRir: 2,
        restSeconds: 150,
        cues: 'Brace core.',
        demoUrl: 'https://example.com/bench',
      },
    ]);
  });

  it('sorts by order_index regardless of input order', () => {
    const rows: ProgramExerciseLike[] = [
      pe({ id: 'pe-c', exercise_id: 'c', order_index: 2 }),
      pe({ id: 'pe-a', exercise_id: 'a', order_index: 0 }),
      pe({ id: 'pe-b', exercise_id: 'b', order_index: 1 }),
    ];

    const plan = planSessionFromProgramDay(rows);
    expect(plan.map((p) => p.exerciseId)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty plan for an empty day', () => {
    expect(planSessionFromProgramDay([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const rows: ProgramExerciseLike[] = [
      pe({ id: 'pe-b', exercise_id: 'b', order_index: 1 }),
      pe({ id: 'pe-a', exercise_id: 'a', order_index: 0 }),
    ];
    const original = [...rows];
    planSessionFromProgramDay(rows);
    expect(rows).toEqual(original);
  });

  it('maps an amrap (to-failure) prescription with null rep_low/rep_high through unchanged', () => {
    const rows: ProgramExerciseLike[] = [
      pe({ id: 'pe1', exercise_id: 'seed_incline_db_press', order_index: 0, prescription_type: 'amrap', rep_low: null, rep_high: null, target_rir: 0 }),
    ];
    const plan = planSessionFromProgramDay(rows);
    expect(plan[0].prescriptionType).toBe('amrap');
    expect(plan[0].repLow).toBeNull();
    expect(plan[0].repHigh).toBeNull();
    expect(plan[0].targetRir).toBe(0);
  });

  it('preserves a null target_rir/rest_seconds/cues/demo_url rather than defaulting them', () => {
    const rows: ProgramExerciseLike[] = [pe({ id: 'pe1', exercise_id: 'x', order_index: 0, target_rir: null, rest_seconds: null, cues: null, demo_url: null })];
    const plan = planSessionFromProgramDay(rows);
    expect(plan[0].targetRir).toBeNull();
    expect(plan[0].restSeconds).toBeNull();
    expect(plan[0].cues).toBeNull();
    expect(plan[0].demoUrl).toBeNull();
  });
});

describe('resolveSlotExerciseId — substitution resolution', () => {
  const slot = { exerciseId: 'bench_press' };
  const substitutes = ['incline_db_press', 'db_shoulder_press'];

  it('resolves to the program default when nothing has been logged and no pending swap exists', () => {
    expect(resolveSlotExerciseId(slot, substitutes, [], null)).toBe('bench_press');
  });

  it('resolves to a pending (not-yet-logged) swap choice when nothing has been logged yet', () => {
    expect(resolveSlotExerciseId(slot, substitutes, [], 'incline_db_press')).toBe('incline_db_press');
  });

  it('ignores a pending swap choice that is not in the substitute catalog', () => {
    expect(resolveSlotExerciseId(slot, substitutes, [], 'some_other_exercise')).toBe('bench_press');
  });

  it('a real logged set for the default exercise wins over everything, including a pending swap', () => {
    expect(resolveSlotExerciseId(slot, substitutes, ['bench_press'], 'incline_db_press')).toBe('bench_press');
  });

  it('a real logged set for a substitute wins over the program default and any pending swap', () => {
    expect(resolveSlotExerciseId(slot, substitutes, ['incline_db_press'], null)).toBe('incline_db_press');
    expect(resolveSlotExerciseId(slot, substitutes, ['db_shoulder_press'], 'incline_db_press')).toBe('db_shoulder_press');
  });

  it('a logged set for an unrelated exercise (different slot/ad-hoc addition) is ignored', () => {
    expect(resolveSlotExerciseId(slot, substitutes, ['some_unrelated_exercise'], null)).toBe('bench_press');
  });

  it('with no substitutes at all, still resolves to the default with no pending swap', () => {
    expect(resolveSlotExerciseId(slot, [], [], null)).toBe('bench_press');
  });
});
