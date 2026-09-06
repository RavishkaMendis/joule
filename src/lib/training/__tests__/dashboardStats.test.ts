import { computeHeadlineStats } from '../dashboardStats';

describe('computeHeadlineStats', () => {
  it('zero sessions: every count is zero and avgVolumePerSession is null, not NaN or zero', () => {
    const stats = computeHeadlineStats([], [], null, '2026-09-05');
    expect(stats).toEqual({
      totalVolume: 0,
      workingSetCount: 0,
      warmupSetCount: 0,
      sessionCount: 0,
      avgVolumePerSession: null,
    });
  });

  it('one session, one set', () => {
    const sessions = [{ id: 's1', date: '2026-09-01' }];
    const sets = [{ sessionId: 's1', weight_kg: 100, reps: 5 }];
    const stats = computeHeadlineStats(sets, sessions, null, '2026-09-05');
    expect(stats.sessionCount).toBe(1);
    expect(stats.totalVolume).toBe(500);
    expect(stats.avgVolumePerSession).toBe(500);
  });

  it('a warm-up-only session is a real session with zero working volume, not excluded', () => {
    const sessions = [{ id: 's1', date: '2026-09-01' }];
    const sets = [{ sessionId: 's1', weight_kg: 20, reps: 10, is_warmup: true }];
    const stats = computeHeadlineStats(sets, sessions, null, '2026-09-05');
    expect(stats.sessionCount).toBe(1);
    expect(stats.workingSetCount).toBe(0);
    expect(stats.warmupSetCount).toBe(1);
    expect(stats.totalVolume).toBe(0);
    // A session that happened with zero working volume is a real zero average, not null.
    expect(stats.avgVolumePerSession).toBe(0);
  });

  it('a bodyweight (zero-weight) exercise contributes zero volume but a real working set', () => {
    const sessions = [{ id: 's1', date: '2026-09-01' }];
    const sets = [{ sessionId: 's1', weight_kg: 0, reps: 12 }];
    const stats = computeHeadlineStats(sets, sessions, null, '2026-09-05');
    expect(stats.workingSetCount).toBe(1);
    expect(stats.totalVolume).toBe(0);
  });

  it('a gap week between two sessions does not dilute the average — only real sessions are the denominator', () => {
    const sessions = [
      { id: 's1', date: '2026-08-01' },
      { id: 's2', date: '2026-08-22' }, // 3 weeks later, nothing in between
    ];
    const sets = [
      { sessionId: 's1', weight_kg: 100, reps: 10 }, // 1000
      { sessionId: 's2', weight_kg: 100, reps: 10 }, // 1000
    ];
    const stats = computeHeadlineStats(sets, sessions, null, '2026-09-05');
    expect(stats.sessionCount).toBe(2);
    expect(stats.totalVolume).toBe(2000);
    // Not divided by ~5 weeks or ~35 days — divided by the 2 sessions that actually happened.
    expect(stats.avgVolumePerSession).toBe(1000);
  });

  it('window excludes sessions/sets outside [windowStart, windowEnd]', () => {
    const sessions = [
      { id: 'old', date: '2026-01-01' },
      { id: 'recent', date: '2026-09-01' },
    ];
    const sets = [
      { sessionId: 'old', weight_kg: 999, reps: 10 },
      { sessionId: 'recent', weight_kg: 100, reps: 5 },
    ];
    const stats = computeHeadlineStats(sets, sessions, '2026-08-01', '2026-09-05');
    expect(stats.sessionCount).toBe(1);
    expect(stats.totalVolume).toBe(500);
  });

  it('warm-up sets are excluded from totalVolume even alongside working sets in the same session', () => {
    const sessions = [{ id: 's1', date: '2026-09-01' }];
    const sets = [
      { sessionId: 's1', weight_kg: 20, reps: 10, is_warmup: true },
      { sessionId: 's1', weight_kg: 100, reps: 5, is_warmup: false },
    ];
    const stats = computeHeadlineStats(sets, sessions, null, '2026-09-05');
    expect(stats.totalVolume).toBe(500);
    expect(stats.workingSetCount).toBe(1);
    expect(stats.warmupSetCount).toBe(1);
  });

  it('BUG FIX: a drop set\'s segments count toward totalVolume (100x8 -> 80x6 -> 60x5 = 800 + 480 + 300 = 1580, not just the parent\'s 800) while workingSetCount still counts it as ONE set — the trip to failure, not one entry per segment', () => {
    const sessions = [{ id: 's1', date: '2026-09-01' }];
    const sets = [
      {
        sessionId: 's1',
        weight_kg: 100,
        reps: 8,
        is_warmup: false,
        segments: [
          { weight_kg: 80, reps: 6 },
          { weight_kg: 60, reps: 5 },
        ],
      },
    ];
    const stats = computeHeadlineStats(sets, sessions, null, '2026-09-05');
    expect(stats.totalVolume).toBe(1580);
    expect(stats.workingSetCount).toBe(1);
    expect(stats.avgVolumePerSession).toBe(1580);
  });

  it('a warm-up set that somehow carries segments is still excluded entirely — segments never override is_warmup', () => {
    const sessions = [{ id: 's1', date: '2026-09-01' }];
    const sets = [
      {
        sessionId: 's1',
        weight_kg: 20,
        reps: 10,
        is_warmup: true,
        segments: [{ weight_kg: 15, reps: 10 }],
      },
    ];
    const stats = computeHeadlineStats(sets, sessions, null, '2026-09-05');
    expect(stats.totalVolume).toBe(0);
    expect(stats.workingSetCount).toBe(0);
    expect(stats.warmupSetCount).toBe(1);
  });
});
