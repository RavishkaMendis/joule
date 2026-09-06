import { computeVolume, computeVolumeByExercise, computeSessionSummary } from '../volume';

describe('computeVolume', () => {
  it('sums weight x reps across working sets', () => {
    const total = computeVolume([
      { weight_kg: 100, reps: 5 },
      { weight_kg: 80, reps: 8 },
    ]);
    expect(total).toBe(100 * 5 + 80 * 8);
  });

  it('excludes warm-up sets by default', () => {
    const total = computeVolume([
      { weight_kg: 20, reps: 10, is_warmup: true },
      { weight_kg: 100, reps: 5, is_warmup: false },
    ]);
    expect(total).toBe(500);
  });

  it('accepts is_warmup as a 0/1 integer (SQLite row shape), not just boolean', () => {
    const total = computeVolume([
      { weight_kg: 20, reps: 10, is_warmup: 1 },
      { weight_kg: 100, reps: 5, is_warmup: 0 },
    ]);
    expect(total).toBe(500);
  });

  it('includeWarmups: true counts every set', () => {
    const total = computeVolume(
      [
        { weight_kg: 20, reps: 10, is_warmup: true },
        { weight_kg: 100, reps: 5, is_warmup: false },
      ],
      { includeWarmups: true }
    );
    expect(total).toBe(200 + 500);
  });

  it('an empty session (nothing logged yet) has zero volume, not an error', () => {
    expect(computeVolume([])).toBe(0);
  });

  it('a zero-weight bodyweight set contributes zero volume, not NaN', () => {
    expect(computeVolume([{ weight_kg: 0, reps: 12 }])).toBe(0);
  });

  it('a zero-rep row contributes zero, not a phantom negative or NaN', () => {
    expect(computeVolume([{ weight_kg: 100, reps: 0 }])).toBe(0);
  });

  it('clamps negative weight/reps (data errors) to zero rather than subtracting from the total', () => {
    const total = computeVolume([
      { weight_kg: 100, reps: 5 },
      { weight_kg: -50, reps: 5 },
      { weight_kg: 50, reps: -5 },
    ]);
    expect(total).toBe(500);
  });

  it('a drop set counts every segment, not just the top weight (schema v7: high-intensity training)', () => {
    const total = computeVolume([
      {
        weight_kg: 100,
        reps: 8,
        segments: [
          { weight_kg: 80, reps: 6 },
          { weight_kg: 60, reps: 5 },
        ],
      },
    ]);
    expect(total).toBe(100 * 8 + 80 * 6 + 60 * 5);
  });

  it('a straight set with no segments is unaffected by the segments field existing at all', () => {
    expect(computeVolume([{ weight_kg: 100, reps: 8, segments: [] }])).toBe(800);
    expect(computeVolume([{ weight_kg: 100, reps: 8 }])).toBe(800);
  });

  it('a warm-up set with segments is still excluded entirely by default (segments do not override is_warmup)', () => {
    const total = computeVolume([
      { weight_kg: 20, reps: 10, is_warmup: true, segments: [{ weight_kg: 15, reps: 10 }] },
      { weight_kg: 100, reps: 5 },
    ]);
    expect(total).toBe(500);
  });

  it('a malformed segment (negative/non-finite) is clamped the same way a malformed top set is', () => {
    const total = computeVolume([
      { weight_kg: 100, reps: 8, segments: [{ weight_kg: -50, reps: 6 }, { weight_kg: 60, reps: Number.NaN }] },
    ]);
    expect(total).toBe(800);
  });

  it('non-finite weight/reps contribute zero rather than propagating NaN', () => {
    expect(computeVolume([{ weight_kg: NaN, reps: 5 }])).toBe(0);
    expect(computeVolume([{ weight_kg: 100, reps: Infinity }])).toBe(0);
  });
});

describe('computeVolumeByExercise', () => {
  it('groups volume per exercise_id', () => {
    const result = computeVolumeByExercise([
      { exercise_id: 'squat', weight_kg: 100, reps: 5 },
      { exercise_id: 'squat', weight_kg: 100, reps: 5 },
      { exercise_id: 'bench', weight_kg: 60, reps: 8 },
    ]);
    expect(result).toEqual({ squat: 1000, bench: 480 });
  });

  it('empty input returns an empty object', () => {
    expect(computeVolumeByExercise([])).toEqual({});
  });
});

describe('computeSessionSummary', () => {
  it('counts working/warmup sets and distinct exercises, and sums working-only volume', () => {
    const summary = computeSessionSummary([
      { exercise_id: 'squat', weight_kg: 20, reps: 10, is_warmup: true },
      { exercise_id: 'squat', weight_kg: 100, reps: 5, is_warmup: false },
      { exercise_id: 'bench', weight_kg: 60, reps: 8, is_warmup: false },
    ]);
    expect(summary).toEqual({
      totalVolume: 100 * 5 + 60 * 8,
      workingSetCount: 2,
      warmupSetCount: 1,
      exerciseCount: 2,
    });
  });

  it('a session with nothing logged yet is a valid zero-everything summary', () => {
    expect(computeSessionSummary([])).toEqual({
      totalVolume: 0,
      workingSetCount: 0,
      warmupSetCount: 0,
      exerciseCount: 0,
    });
  });

  it('a single set, one exercise', () => {
    const summary = computeSessionSummary([{ exercise_id: 'plank', weight_kg: 0, reps: 1, is_warmup: false }]);
    expect(summary.exerciseCount).toBe(1);
    expect(summary.workingSetCount).toBe(1);
    expect(summary.totalVolume).toBe(0);
  });
});
