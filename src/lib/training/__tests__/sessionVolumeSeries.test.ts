import { buildSessionVolumeSeries } from '../sessionVolumeSeries';

describe('buildSessionVolumeSeries', () => {
  it('zero sessions returns an empty series', () => {
    expect(buildSessionVolumeSeries([], [])).toEqual([]);
  });

  it('one session, one set', () => {
    const result = buildSessionVolumeSeries(
      [{ id: 's1', date: '2026-09-01', name: 'Push' }],
      [{ sessionId: 's1', weight_kg: 100, reps: 5 }]
    );
    expect(result).toEqual([
      { sessionId: 's1', date: '2026-09-01', name: 'Push', totalVolume: 500, workingSetCount: 1 },
    ]);
  });

  it('a session with no sets logged yet is a real zero point, not omitted', () => {
    const result = buildSessionVolumeSeries([{ id: 's1', date: '2026-09-01', name: null }], []);
    expect(result).toEqual([
      { sessionId: 's1', date: '2026-09-01', name: null, totalVolume: 0, workingSetCount: 0 },
    ]);
  });

  it('a warm-up-only session has zero volume but is still a real point', () => {
    const result = buildSessionVolumeSeries(
      [{ id: 's1', date: '2026-09-01', name: null }],
      [{ sessionId: 's1', weight_kg: 20, reps: 10, is_warmup: true }]
    );
    expect(result[0].totalVolume).toBe(0);
    expect(result[0].workingSetCount).toBe(0);
  });

  it('a bodyweight (zero-weight) exercise contributes zero volume but counts the working set', () => {
    const result = buildSessionVolumeSeries(
      [{ id: 's1', date: '2026-09-01', name: null }],
      [{ sessionId: 's1', weight_kg: 0, reps: 12 }]
    );
    expect(result[0].totalVolume).toBe(0);
    expect(result[0].workingSetCount).toBe(1);
  });

  it('sorts chronologically regardless of input order', () => {
    const result = buildSessionVolumeSeries(
      [
        { id: 's2', date: '2026-09-05', name: null },
        { id: 's1', date: '2026-09-01', name: null },
      ],
      []
    );
    expect(result.map((p) => p.sessionId)).toEqual(['s1', 's2']);
  });

  it('excludes gap days entirely — no fabricated zero-volume point for a date with no session', () => {
    const result = buildSessionVolumeSeries(
      [
        { id: 's1', date: '2026-09-01', name: null },
        { id: 's2', date: '2026-09-20', name: null },
      ],
      [{ sessionId: 's1', weight_kg: 100, reps: 5 }]
    );
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-20']);
  });

  it('BUG FIX: a drop set\'s segments count toward the session point\'s totalVolume — a 100x8 -> 80x6 -> 60x5 drop set is 1580 kg, not 800, so a high-intensity session no longer reads as flat/declining on the volume-over-time chart', () => {
    const result = buildSessionVolumeSeries(
      [{ id: 's1', date: '2026-09-01', name: 'Push (drop sets)' }],
      [
        {
          sessionId: 's1',
          weight_kg: 100,
          reps: 8,
          segments: [
            { weight_kg: 80, reps: 6 },
            { weight_kg: 60, reps: 5 },
          ],
        },
      ]
    );
    expect(result[0].totalVolume).toBe(1580);
    // One set, however many segments it carries.
    expect(result[0].workingSetCount).toBe(1);
  });
});
