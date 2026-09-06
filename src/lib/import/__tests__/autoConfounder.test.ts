import { suggestConfounders, SHORT_SLEEP_THRESHOLD_MINUTES } from '../autoConfounder';
import type { ExternalEstimateRow, WeightLogRow } from '../../../db/types';

// `sleep_minutes: null` is a real state a partial import can leave in the
// DB despite ExternalEstimateRow's declared (slightly inaccurate) type —
// see autoConfounder.ts's comment. Widen it here rather than in the
// shared type, which is out of this feature's ownership.
function estimate(
  overrides: Omit<Partial<ExternalEstimateRow>, 'sleep_minutes'> & { sleep_minutes?: number | null }
): ExternalEstimateRow {
  return {
    date: '2026-09-05',
    source: 'zepp',
    tdee_est: 2400,
    active_kcal: 300,
    steps: 8000,
    sleep_minutes: 200,
    readiness: 60,
    ...overrides,
  } as ExternalEstimateRow;
}

function weight(overrides: Partial<WeightLogRow>): WeightLogRow {
  return { date: '2026-09-05', weight_kg: 80, confounder: null, source: 'manual', ...overrides };
}

describe('suggestConfounders', () => {
  it('suggests poor_sleep when sleep is below the threshold and a weight reading exists with no confounder', () => {
    const suggestions = suggestConfounders([estimate({ sleep_minutes: 180 })], [weight({})]);
    expect(suggestions).toEqual([
      { date: '2026-09-05', suggested: 'poor_sleep', reason: expect.stringContaining('3.0h sleep') },
    ]);
  });

  it('does not suggest at or above the 4-hour threshold', () => {
    const suggestions = suggestConfounders([estimate({ sleep_minutes: SHORT_SLEEP_THRESHOLD_MINUTES })], [weight({})]);
    expect(suggestions).toEqual([]);
  });

  it('does not suggest just below the threshold is included (239 minutes)', () => {
    const suggestions = suggestConfounders([estimate({ sleep_minutes: 239 })], [weight({})]);
    expect(suggestions).toHaveLength(1);
  });

  it('does not suggest anything for a date with no weight_log reading', () => {
    const suggestions = suggestConfounders([estimate({ sleep_minutes: 100, date: '2026-09-06' })], [weight({ date: '2026-09-05' })]);
    expect(suggestions).toEqual([]);
  });

  it('never suggests overwriting an existing confounder', () => {
    const suggestions = suggestConfounders(
      [estimate({ sleep_minutes: 100 })],
      [weight({ confounder: 'travel' })]
    );
    expect(suggestions).toEqual([]);
  });

  it('ignores rows with null sleep_minutes', () => {
    const suggestions = suggestConfounders([estimate({ sleep_minutes: null })], [weight({})]);
    expect(suggestions).toEqual([]);
  });

  it('returns suggestions sorted by date ascending', () => {
    const suggestions = suggestConfounders(
      [
        estimate({ date: '2026-09-10', sleep_minutes: 100 }),
        estimate({ date: '2026-09-01', sleep_minutes: 100 }),
      ],
      [weight({ date: '2026-09-10' }), weight({ date: '2026-09-01' })]
    );
    expect(suggestions.map((s) => s.date)).toEqual(['2026-09-01', '2026-09-10']);
  });

  it('handles multiple qualifying dates independently', () => {
    const suggestions = suggestConfounders(
      [
        estimate({ date: '2026-09-01', sleep_minutes: 100 }),
        estimate({ date: '2026-09-02', sleep_minutes: 300 }), // above threshold
        estimate({ date: '2026-09-03', sleep_minutes: 50 }),
      ],
      [weight({ date: '2026-09-01' }), weight({ date: '2026-09-02' }), weight({ date: '2026-09-03' })]
    );
    expect(suggestions.map((s) => s.date)).toEqual(['2026-09-01', '2026-09-03']);
  });
});
