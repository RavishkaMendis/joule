import { parseZeppJson } from '../zeppJson';

describe('parseZeppJson', () => {
  it('parses a flat array of records into string-keyed rows', () => {
    const text = JSON.stringify([
      { date: '2026-01-01', steps: 8000, tdee_est: 2400 },
      { date: '2026-01-02', steps: 9500, tdee_est: 2450 },
    ]);
    const result = parseZeppJson(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers.sort()).toEqual(['date', 'steps', 'tdee_est'].sort());
    expect(result.rows).toEqual([
      { date: '2026-01-01', steps: '8000', tdee_est: '2400' },
      { date: '2026-01-02', steps: '9500', tdee_est: '2450' },
    ]);
  });

  it('unions header keys across rows with differing shapes (partial exports)', () => {
    const text = JSON.stringify([{ date: '2026-01-01', steps: 8000 }, { date: '2026-01-02', sleep_minutes: 400 }]);
    const result = parseZeppJson(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers.sort()).toEqual(['date', 'sleep_minutes', 'steps'].sort());
    expect(result.rows[0].sleep_minutes).toBeUndefined();
    expect(result.rows[1].steps).toBeUndefined();
  });

  it('stringifies null/undefined as empty string, and numbers/booleans as text', () => {
    const text = JSON.stringify([{ date: '2026-01-01', steps: null, active: true, val: 0 }]);
    const result = parseZeppJson(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({ date: '2026-01-01', steps: '', active: 'true', val: '0' });
  });

  it('stringifies a nested object/array field as JSON text rather than dropping it', () => {
    const text = JSON.stringify([{ date: '2026-01-01', details: { foo: 'bar' } }]);
    const result = parseZeppJson(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].details).toBe('{"foo":"bar"}');
  });

  it('returns ok with zero rows for an empty array', () => {
    const result = parseZeppJson('[]');
    expect(result).toEqual({ ok: true, headers: [], rows: [] });
  });

  it('errors on invalid JSON', () => {
    const result = parseZeppJson('{not valid');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not valid JSON');
  });

  it('errors on a top-level object (not an array)', () => {
    const result = parseZeppJson(JSON.stringify({ days: { '2026-01-01': { steps: 8000 } } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not a flat array');
  });

  it('errors on an array containing a non-object entry', () => {
    const result = parseZeppJson(JSON.stringify([{ date: '2026-01-01' }, 'oops']));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not a plain object');
  });

  it('errors on an array containing a nested array entry', () => {
    const result = parseZeppJson(JSON.stringify([[1, 2, 3]]));
    expect(result.ok).toBe(false);
  });
});
