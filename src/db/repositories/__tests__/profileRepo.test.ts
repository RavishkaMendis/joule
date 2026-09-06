import * as profileRepo from '../profileRepo';
import { freshDb } from './testHelpers';
import type { Database } from '../../database';

describe('profileRepo', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('returns null before onboarding', async () => {
    expect(await profileRepo.getProfile(db)).toBeNull();
  });

  it('upserts the singleton row, always id=1', async () => {
    const row = await profileRepo.upsertProfile(db, {
      height_cm: 178,
      birth_year: 1990,
      sex: 'male',
      goal: 'cut',
      rate_kg_per_week: -0.5,
      activity_seed: 'lightly_active',
      protein_override: null,
      units: 'metric',
    });
    expect(row.id).toBe(1);

    const updated = await profileRepo.upsertProfile(db, {
      height_cm: 178,
      birth_year: 1990,
      sex: 'male',
      goal: 'maintain',
      rate_kg_per_week: 0,
      activity_seed: 'moderately_active',
      protein_override: 180,
      units: 'metric',
    });
    expect(updated.goal).toBe('maintain');
    expect(updated.protein_override).toBe(180);

    // still exactly one row
    const all = await db.getAllAsync('SELECT * FROM user_profile');
    expect(all).toHaveLength(1);
  });
});
