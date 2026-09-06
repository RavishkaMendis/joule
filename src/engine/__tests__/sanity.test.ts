import { KALMAN_DEFAULTS, CONFOUNDER_R_MULTIPLIER, HALF_LIFE_DAYS, KCAL_PER_KG } from '../types';
import { computeTDEE } from '../tdee';

describe('engine scaffolding sanity', () => {
  it('exposes the tuning constants from PRD §4.1/§4.2', () => {
    expect(KALMAN_DEFAULTS).toEqual({
      R: 0.6,
      Q_weight: 0.005,
      Q_trend: 0.0005,
      P0: [
        [1.0, 0],
        [0, 0.01],
      ],
    });
    expect(CONFOUNDER_R_MULTIPLIER).toBe(4);
    expect(HALF_LIFE_DAYS).toBe(14);
    expect(KCAL_PER_KG).toBe(7700);
  });

  it('computeTDEE is implemented: returns a well-typed cold-start result on empty history', () => {
    const result = computeTDEE([], [], {
      height_cm: 175,
      birth_year: 1995,
      sex: 'male',
      goal: 'cut',
      rate_kg_per_week: -0.5,
      activity_seed: 'lightly_active',
      protein_override: null,
      units: 'metric',
    });
    expect(result.dataQuality).toBe('seeding');
    expect(Number.isNaN(result.tdee)).toBe(false);
    expect(result.confidenceLow).toBeLessThanOrEqual(result.tdee);
    expect(result.confidenceHigh).toBeGreaterThanOrEqual(result.tdee);
  });
});
