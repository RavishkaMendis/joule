import { bestSetInSession, computeExerciseProgression, type TrainingSet } from '../progression';

function set(overrides: Partial<TrainingSet>): TrainingSet {
  return {
    session_id: 's1',
    date: '2026-01-01',
    weight_kg: 100,
    reps: 5,
    is_warmup: false,
    logged_at: 1000,
    ...overrides,
  };
}

describe('bestSetInSession', () => {
  it('picks the heaviest working set', () => {
    const best = bestSetInSession([
      set({ weight_kg: 80, reps: 8, logged_at: 1 }),
      set({ weight_kg: 100, reps: 5, logged_at: 2 }),
      set({ weight_kg: 90, reps: 6, logged_at: 3 }),
    ]);
    expect(best?.weight_kg).toBe(100);
  });

  it('excludes warm-up sets even if heaviest', () => {
    const best = bestSetInSession([
      set({ weight_kg: 140, reps: 3, is_warmup: true, logged_at: 1 }),
      set({ weight_kg: 100, reps: 5, is_warmup: false, logged_at: 2 }),
    ]);
    expect(best?.weight_kg).toBe(100);
  });

  it('a warm-up-only session has no best set', () => {
    expect(bestSetInSession([set({ is_warmup: true })])).toBeNull();
  });

  it('an empty set list has no best set', () => {
    expect(bestSetInSession([])).toBeNull();
  });

  it('excludes zero/negative-rep rows (never performed, carries no signal)', () => {
    const best = bestSetInSession([
      set({ weight_kg: 200, reps: 0, logged_at: 1 }),
      set({ weight_kg: 100, reps: 5, logged_at: 2 }),
    ]);
    expect(best?.weight_kg).toBe(100);
  });

  it('ties on weight break by more reps', () => {
    const best = bestSetInSession([
      set({ weight_kg: 100, reps: 5, logged_at: 1 }),
      set({ weight_kg: 100, reps: 8, logged_at: 2 }),
    ]);
    expect(best?.reps).toBe(8);
  });
});

describe('computeExerciseProgression', () => {
  it('one session, one set: insufficient confidence, no % change (not enough data, not a false 0%)', () => {
    const progression = computeExerciseProgression([set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 5 })]);
    expect(progression.history).toHaveLength(1);
    expect(progression.confidence).toBe('insufficient');
    expect(progression.percentChangeVsPrevious).toBeNull();
    expect(progression.percentChangeUnavailableReason).toBe('insufficient_data');
  });

  it('two sessions: comparison confidence (not "trend") with a computed % change', () => {
    const progression = computeExerciseProgression([
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 5, logged_at: 1 }),
      set({ session_id: 's2', date: '2026-01-08', weight_kg: 110, reps: 5, logged_at: 2 }),
    ]);
    expect(progression.history).toHaveLength(2);
    expect(progression.confidence).toBe('comparison');
    expect(progression.percentChangeVsPrevious).toBeCloseTo(10);
    expect(progression.percentChangeBasis).toBe('best_set_weight');
  });

  it('three or more sessions: trend confidence', () => {
    const progression = computeExerciseProgression([
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 5 }),
      set({ session_id: 's2', date: '2026-01-08', weight_kg: 105, reps: 5 }),
      set({ session_id: 's3', date: '2026-01-15', weight_kg: 110, reps: 5 }),
    ]);
    expect(progression.confidence).toBe('trend');
    expect(progression.history.map((h) => h.weightKg)).toEqual([100, 105, 110]);
  });

  it('% change compares best-set WEIGHT, not reps or volume — a rep increase at the same weight is 0% change', () => {
    const progression = computeExerciseProgression([
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 5 }),
      set({ session_id: 's2', date: '2026-01-08', weight_kg: 100, reps: 10 }),
    ]);
    expect(progression.percentChangeVsPrevious).toBe(0);
  });

  it('a decrease in best-set weight is a negative % change, rendered same-tone (caller\'s job), not clamped or hidden', () => {
    const progression = computeExerciseProgression([
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 5 }),
      set({ session_id: 's2', date: '2026-01-08', weight_kg: 90, reps: 5 }),
    ]);
    expect(progression.percentChangeVsPrevious).toBeCloseTo(-10);
  });

  it('previous best-set weight of 0 (bodyweight exercise) cannot compute a % change — division by zero is refused, not silently 0/Infinity', () => {
    const progression = computeExerciseProgression([
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 0, reps: 12 }),
      set({ session_id: 's2', date: '2026-01-08', weight_kg: 0, reps: 15 }),
    ]);
    expect(progression.percentChangeVsPrevious).toBeNull();
    expect(progression.percentChangeUnavailableReason).toBe('previous_weight_zero');
  });

  it('a session with only a warm-up for this exercise contributes no history entry', () => {
    const progression = computeExerciseProgression([
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 5 }),
      set({ session_id: 's2', date: '2026-01-08', weight_kg: 40, reps: 10, is_warmup: true }),
      set({ session_id: 's3', date: '2026-01-15', weight_kg: 105, reps: 5 }),
    ]);
    expect(progression.history.map((h) => h.sessionId)).toEqual(['s1', 's3']);
    // Comparing s1 -> s3 directly, s2 having contributed nothing.
    expect(progression.confidence).toBe('comparison');
  });

  it('history is sorted chronologically regardless of input order', () => {
    const progression = computeExerciseProgression([
      set({ session_id: 's3', date: '2026-01-15', weight_kg: 110, reps: 5 }),
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 5 }),
      set({ session_id: 's2', date: '2026-01-08', weight_kg: 105, reps: 5 }),
    ]);
    expect(progression.history.map((h) => h.sessionId)).toEqual(['s1', 's2', 's3']);
  });

  it('multiple sets within one session collapse to a single best-set history entry', () => {
    const progression = computeExerciseProgression([
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 20, reps: 10, is_warmup: true, logged_at: 1 }),
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 5, logged_at: 2 }),
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 4, logged_at: 3 }),
    ]);
    expect(progression.history).toHaveLength(1);
    expect(progression.history[0].reps).toBe(5);
  });

  it('empty input: insufficient confidence, no crash', () => {
    const progression = computeExerciseProgression([]);
    expect(progression.history).toHaveLength(0);
    expect(progression.confidence).toBe('insufficient');
    expect(progression.percentChangeVsPrevious).toBeNull();
  });

  it('each history entry carries its own 1RM estimate', () => {
    const progression = computeExerciseProgression([set({ weight_kg: 100, reps: 5 })]);
    expect(progression.history[0].estimatedOneRepMax).not.toBeNull();
    expect(progression.history[0].estimatedOneRepMax?.confidence).toBe('high');
  });

  it('BUG-FIX GUARD: a drop set\'s lighter later segment must never be mistaken for the session\'s best set / 1RM basis. TrainingSet has no `segments` field at all (the parent row IS the top weight, unchanged meaning per volume.ts\'s file header), so even if a caller mistakenly flattened a drop set\'s segments into extra same-session rows, the heaviest row still wins and the estimate is still weight/reps of that top set, never diluted toward the drops.', () => {
    // Models a 100x8 -> 80x6 -> 60x5 drop set as three same-session rows —
    // i.e. the worst case where a future refactor accidentally flattened
    // segments into TrainingSet-shaped rows instead of keeping them off to
    // the side the way workoutRepo.getSegmentsFor* does.
    const progression = computeExerciseProgression([
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 100, reps: 8, logged_at: 1 }),
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 80, reps: 6, logged_at: 2 }),
      set({ session_id: 's1', date: '2026-01-01', weight_kg: 60, reps: 5, logged_at: 3 }),
    ]);
    expect(progression.history).toHaveLength(1);
    expect(progression.history[0].weightKg).toBe(100);
    expect(progression.history[0].reps).toBe(8);
    // Epley off the TOP weight/reps only — 100 * (1 + 8/30), not something
    // averaged/blended with the 80kg or 60kg segments.
    expect(progression.history[0].estimatedOneRepMax?.value).toBeCloseTo(100 * (1 + 8 / 30));
  });
});
