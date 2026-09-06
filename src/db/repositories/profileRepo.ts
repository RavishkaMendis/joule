// ═══════════════════════════════════════════════════════════════════════
// profileRepo — the `user_profile` singleton (PRD §3, §9.5).
//
// Only ever one row, id = 1, enforced by the CHECK constraint in schema.ts.
// "Upsert" here means: insert if absent, else update every column.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../database';
import type { UserProfileRow } from '../types';

export async function getProfile(db: Database): Promise<UserProfileRow | null> {
  return db.getFirstAsync<UserProfileRow>('SELECT * FROM user_profile WHERE id = 1');
}

export type ProfileInput = Omit<UserProfileRow, 'id'>;

export async function upsertProfile(db: Database, profile: ProfileInput): Promise<UserProfileRow> {
  await db.runAsync(
    `INSERT INTO user_profile
       (id, height_cm, birth_year, sex, goal, rate_kg_per_week, activity_seed, protein_override, units)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       height_cm = excluded.height_cm,
       birth_year = excluded.birth_year,
       sex = excluded.sex,
       goal = excluded.goal,
       rate_kg_per_week = excluded.rate_kg_per_week,
       activity_seed = excluded.activity_seed,
       protein_override = excluded.protein_override,
       units = excluded.units`,
    [
      profile.height_cm,
      profile.birth_year,
      profile.sex,
      profile.goal,
      profile.rate_kg_per_week,
      profile.activity_seed,
      profile.protein_override,
      profile.units,
    ]
  );

  const row = await getProfile(db);
  if (!row) throw new Error('upsertProfile: failed to read back user_profile');
  return row;
}
