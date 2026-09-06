import { suggestColumnMapping, ZEPP_TARGET_FIELDS } from '../zeppMapping';

describe('suggestColumnMapping', () => {
  it('maps an exact/close header set case-insensitively', () => {
    const headers = ['Date', 'Total Calories', 'Active Calories', 'Steps', 'Sleep Minutes', 'Readiness'];
    const mapping = suggestColumnMapping(headers);
    expect(mapping.date).toBe('Date');
    expect(mapping.tdee_est).toBe('Total Calories');
    expect(mapping.active_kcal).toBe('Active Calories');
    expect(mapping.steps).toBe('Steps');
    expect(mapping.sleep_minutes).toBe('Sleep Minutes');
    expect(mapping.readiness).toBe('Readiness');
  });

  it('leaves unmatched fields unmapped rather than guessing', () => {
    const headers = ['day', 'step_count'];
    const mapping = suggestColumnMapping(headers);
    expect(mapping.date).toBe('day');
    expect(mapping.steps).toBe('step_count');
    expect(mapping.tdee_est).toBeUndefined();
    expect(mapping.active_kcal).toBeUndefined();
    expect(mapping.sleep_minutes).toBeUndefined();
    expect(mapping.readiness).toBeUndefined();
  });

  it('never assigns the same header to two target fields', () => {
    // "date" substring could plausibly collide with nothing else here, but
    // this guards the "each header used at most once" contract generally:
    // a header matching multiple patterns only satisfies the first field
    // (in ZEPP_TARGET_FIELDS order) it matches.
    const headers = ['sleep score']; // matches 'sleep' (sleep_minutes) — not readiness's 'recovery'/'pai' patterns
    const mapping = suggestColumnMapping(headers);
    expect(mapping.sleep_minutes).toBe('sleep score');
    expect(mapping.readiness).toBeUndefined();
  });

  it('picks the first matching header in file order when multiple headers could match one field', () => {
    const headers = ['steps (manual)', 'steps (total)'];
    const mapping = suggestColumnMapping(headers);
    expect(mapping.steps).toBe('steps (manual)');
  });

  it('recognises readiness synonyms (recovery, PAI, body reading)', () => {
    expect(suggestColumnMapping(['Recovery Score']).readiness).toBe('Recovery Score');
    expect(suggestColumnMapping(['PAI']).readiness).toBe('PAI');
    expect(suggestColumnMapping(['Body Reading']).readiness).toBe('Body Reading');
  });

  it('returns an empty mapping for headers matching nothing', () => {
    const mapping = suggestColumnMapping(['foo', 'bar', 'baz']);
    for (const field of ZEPP_TARGET_FIELDS) {
      expect(mapping[field]).toBeUndefined();
    }
  });

  it('returns an empty mapping for an empty header list', () => {
    expect(suggestColumnMapping([])).toEqual({});
  });
});
