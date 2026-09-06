import { runMigrations } from '../../migrations';
import { createTestDatabase } from '../../__tests__/testDb';
import type { Database } from '../../database';

/** Fresh, fully-migrated in-memory database for a single test. */
export async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}
