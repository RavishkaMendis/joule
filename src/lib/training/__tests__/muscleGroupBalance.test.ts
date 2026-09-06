import { computeMuscleGroupBalance } from '../muscleGroupBalance';

describe('computeMuscleGroupBalance', () => {
  it('zero sessions: all six categories present at zero volume, fraction null', () => {
    const result = computeMuscleGroupBalance([]);
    expect(result).toHaveLength(6);
    expect(result.every((r) => r.volume === 0 && r.setCount === 0 && r.fraction === null)).toBe(true);
    expect(result.map((r) => r.category).sort()).toEqual(['arms', 'back', 'chest', 'core', 'legs', 'shoulders']);
  });

  it('a single logged set puts its category on top with fraction 1, the rest at zero', () => {
    const result = computeMuscleGroupBalance([{ category: 'legs', weight_kg: 100, reps: 5 }]);
    expect(result[0]).toEqual({ category: 'legs', volume: 500, setCount: 1, fraction: 1 });
    const legs = result.find((r) => r.category === 'legs')!;
    expect(legs.fraction).toBe(1);
    const untouched = result.filter((r) => r.category !== 'legs');
    expect(untouched.every((r) => r.volume === 0 && r.fraction === 0)).toBe(true);
  });

  it('an untouched category is explicitly zero, not absent from the list — this is what makes "neglected" visible', () => {
    const result = computeMuscleGroupBalance([{ category: 'chest', weight_kg: 60, reps: 8 }]);
    const back = result.find((r) => r.category === 'back');
    expect(back).toBeDefined();
    expect(back!.volume).toBe(0);
  });

  it('an all-bodyweight category has setCount > 0 but volume 0 — real training, not neglect', () => {
    const result = computeMuscleGroupBalance([{ category: 'core', weight_kg: 0, reps: 20 }]);
    const core = result.find((r) => r.category === 'core')!;
    expect(core.volume).toBe(0);
    expect(core.setCount).toBe(1);
  });

  it('warm-up sets are excluded from every category total', () => {
    const result = computeMuscleGroupBalance([
      { category: 'chest', weight_kg: 20, reps: 10, is_warmup: true },
      { category: 'chest', weight_kg: 80, reps: 8, is_warmup: false },
    ]);
    const chest = result.find((r) => r.category === 'chest')!;
    expect(chest.volume).toBe(640);
    expect(chest.setCount).toBe(1);
  });

  it('a custom exercise with no category buckets into uncategorized, additively to the six fixed categories', () => {
    const result = computeMuscleGroupBalance([
      { category: null, weight_kg: 40, reps: 10 },
      { category: 'back', weight_kg: 60, reps: 10 },
    ]);
    expect(result).toHaveLength(7);
    const uncategorized = result.find((r) => r.category === 'uncategorized')!;
    expect(uncategorized.volume).toBe(400);
  });

  it('sorted descending by volume, busiest region first', () => {
    const result = computeMuscleGroupBalance([
      { category: 'legs', weight_kg: 100, reps: 10 },
      { category: 'arms', weight_kg: 10, reps: 10 },
    ]);
    expect(result[0].category).toBe('legs');
  });

  it('BUG FIX: a drop set\'s segments count toward its category\'s volume — a 100x8 -> 80x6 -> 60x5 drop set on legs is 1580 kg, not the parent-only 800, so a region trained hard with drop sets is not misreported as neglected relative to one trained with straight sets', () => {
    const result = computeMuscleGroupBalance([
      {
        category: 'legs',
        weight_kg: 100,
        reps: 8,
        segments: [
          { weight_kg: 80, reps: 6 },
          { weight_kg: 60, reps: 5 },
        ],
      },
    ]);
    const legs = result.find((r) => r.category === 'legs')!;
    expect(legs.volume).toBe(1580);
    // One set, however many segments it carries.
    expect(legs.setCount).toBe(1);
    expect(legs.fraction).toBe(1);
  });

  it('a warm-up set with segments is still excluded entirely from its category — segments never override is_warmup', () => {
    const result = computeMuscleGroupBalance([
      { category: 'chest', weight_kg: 20, reps: 10, is_warmup: true, segments: [{ weight_kg: 15, reps: 10 }] },
    ]);
    const chest = result.find((r) => r.category === 'chest')!;
    expect(chest.volume).toBe(0);
    expect(chest.setCount).toBe(0);
  });
});
