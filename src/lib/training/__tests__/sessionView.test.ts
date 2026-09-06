import { groupSetsByExercise } from '../sessionView';

describe('groupSetsByExercise', () => {
  it('groups sets by exercise_id, preserving each exercise\'s first-appearance order', () => {
    const sets = [
      { id: '1', exercise_id: 'squat', logged_at: 1 },
      { id: '2', exercise_id: 'bench', logged_at: 2 },
      { id: '3', exercise_id: 'squat', logged_at: 3 },
      { id: '4', exercise_id: 'row', logged_at: 4 },
      { id: '5', exercise_id: 'bench', logged_at: 5 },
    ];
    const groups = groupSetsByExercise(sets);
    expect(groups.map((g) => g.exerciseId)).toEqual(['squat', 'bench', 'row']);
    expect(groups[0].sets.map((s) => s.id)).toEqual(['1', '3']);
    expect(groups[1].sets.map((s) => s.id)).toEqual(['2', '5']);
    expect(groups[2].sets.map((s) => s.id)).toEqual(['4']);
  });

  it('an empty session groups to an empty array', () => {
    expect(groupSetsByExercise([])).toEqual([]);
  });

  it('a single set produces a single group of one', () => {
    const groups = groupSetsByExercise([{ id: '1', exercise_id: 'squat', logged_at: 1 }]);
    expect(groups).toEqual([{ exerciseId: 'squat', sets: [{ id: '1', exercise_id: 'squat', logged_at: 1 }] }]);
  });
});
