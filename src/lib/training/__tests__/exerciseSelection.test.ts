import { selectTopExercises } from '../exerciseSelection';

describe('selectTopExercises', () => {
  it('zero sets returns an empty selection', () => {
    expect(selectTopExercises([])).toEqual([]);
  });

  it('one set selects that one exercise', () => {
    expect(selectTopExercises([{ exerciseId: 'squat', sessionId: 's1' }])).toEqual(['squat']);
  });

  it('ranks by distinct session count, not raw set count', () => {
    const sets = [
      // 'squat': 3 sets in ONE session
      { exerciseId: 'squat', sessionId: 's1' },
      { exerciseId: 'squat', sessionId: 's1' },
      { exerciseId: 'squat', sessionId: 's1' },
      // 'bench': 1 set each across TWO sessions
      { exerciseId: 'bench', sessionId: 's1' },
      { exerciseId: 'bench', sessionId: 's2' },
    ];
    expect(selectTopExercises(sets)).toEqual(['bench', 'squat']);
  });

  it('excludes warm-up sets from the ranking entirely', () => {
    const sets = [
      { exerciseId: 'squat', sessionId: 's1', is_warmup: true },
      { exerciseId: 'squat', sessionId: 's2', is_warmup: true },
      { exerciseId: 'bench', sessionId: 's1', is_warmup: false },
    ];
    expect(selectTopExercises(sets)).toEqual(['bench']);
  });

  it('caps to the requested limit', () => {
    const sets = ['a', 'b', 'c', 'd'].map((id) => ({ exerciseId: id, sessionId: `s-${id}` }));
    expect(selectTopExercises(sets, 2)).toHaveLength(2);
  });

  it('tie-breaks stably by exerciseId when session and set counts match', () => {
    const sets = [
      { exerciseId: 'zeta', sessionId: 's1' },
      { exerciseId: 'alpha', sessionId: 's1' },
    ];
    expect(selectTopExercises(sets)).toEqual(['alpha', 'zeta']);
  });
});
