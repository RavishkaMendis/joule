import { createTestDatabase } from '../../../db/__tests__/testDb';
import { deleteJob, listJobs, resetCaptureJobsPersistenceForTesting, upsertJob } from '../persistence';
import type { CaptureJob } from '../types';
import type { PendingEntry } from '../../pendingEntry';

const ENTRIES: PendingEntry[] = [
  { name: 'Chicken sushi', grams: 220, kcal: 380, protein_g: 22, carbs_g: 50, fat_g: 8, confidence: 'medium', source: 'meal_photo' },
];

function job(overrides: Partial<CaptureJob> = {}): CaptureJob {
  return {
    id: 'job_1',
    date: '2026-09-05',
    input: { kind: 'meal_photo', photoUri: 'file:///photo.jpg', photoBase64: 'AAAA', textNote: 'chicken sushi' },
    status: 'processing',
    createdAt: 1000,
    updatedAt: 1000,
    attempts: 1,
    ...overrides,
  };
}

beforeEach(() => {
  resetCaptureJobsPersistenceForTesting();
});

describe('upsertJob / listJobs', () => {
  it('round-trips a processing job with no entries/error', async () => {
    const db = createTestDatabase();
    await upsertJob(db, job());

    const rows = await listJobs(db);
    expect(rows).toEqual([job()]);
  });

  it('round-trips a done job, including its entries', async () => {
    const db = createTestDatabase();
    await upsertJob(db, job({ status: 'done', entries: ENTRIES, updatedAt: 2000 }));

    const [row] = await listJobs(db);
    expect(row.status).toBe('done');
    expect(row.entries).toEqual(ENTRIES);
  });

  it('round-trips an error job with its message, and no leftover entries', async () => {
    const db = createTestDatabase();
    await upsertJob(db, job({ status: 'error', errorMessage: 'Network error', updatedAt: 2000 }));

    const [row] = await listJobs(db);
    expect(row.status).toBe('error');
    expect(row.errorMessage).toBe('Network error');
    expect(row.entries).toBeUndefined();
  });

  it('preserves each capture kind\'s exact input shape', async () => {
    const db = createTestDatabase();
    const labelJob = job({ id: 'job_2', input: { kind: 'label_ocr', photoUri: 'file:///label.jpg' } });
    const voiceJob = job({ id: 'job_3', input: { kind: 'voice', audioUri: 'file:///note.m4a', mimeType: 'audio/m4a' } });
    await upsertJob(db, labelJob);
    await upsertJob(db, voiceJob);

    const rows = await listJobs(db);
    expect(rows.find((r) => r.id === 'job_2')?.input).toEqual(labelJob.input);
    expect(rows.find((r) => r.id === 'job_3')?.input).toEqual(voiceJob.input);
  });

  it('REPLACEs an existing row on conflict rather than duplicating it', async () => {
    const db = createTestDatabase();
    await upsertJob(db, job());
    await upsertJob(db, job({ status: 'done', entries: ENTRIES, updatedAt: 2000 }));

    const rows = await listJobs(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('done');
  });

  it('supports multiple concurrent jobs side by side', async () => {
    const db = createTestDatabase();
    await upsertJob(db, job({ id: 'job_a' }));
    await upsertJob(db, job({ id: 'job_b', status: 'done', entries: ENTRIES }));
    await upsertJob(db, job({ id: 'job_c', status: 'error', errorMessage: 'boom' }));

    const rows = await listJobs(db);
    expect(rows.map((r) => r.id).sort()).toEqual(['job_a', 'job_b', 'job_c']);
  });
});

describe('attempts column', () => {
  it('round-trips a non-default attempt count', async () => {
    const db = createTestDatabase();
    await upsertJob(db, job({ status: 'error', errorMessage: 'timed out', attempts: 3 }));

    const [row] = await listJobs(db);
    expect(row.attempts).toBe(3);
  });

  // `attempts` was added to this table after it first shipped, and this
  // module isn't part of the versioned src/db/migrations.ts system (see
  // persistence.ts's header) — so an install that already created the
  // table without this column must still work: `ensureTable`'s defensive
  // `ALTER TABLE ... ADD COLUMN` has to run against a table that already
  // exists, not just a freshly-created one.
  it('back-fills attempts to 1 for a table that predates the column', async () => {
    const db = createTestDatabase();
    // Simulate a pre-existing install: create the table with the OLD
    // column set, before this test even calls into persistence.ts.
    await db.execAsync(`
      CREATE TABLE app_capture_jobs (
        id            TEXT PRIMARY KEY,
        date          TEXT NOT NULL,
        status        TEXT NOT NULL,
        input_json    TEXT NOT NULL,
        entries_json  TEXT,
        error_message TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `);
    await db.runAsync(
      `INSERT INTO app_capture_jobs (id, date, status, input_json, entries_json, error_message, created_at, updated_at)
       VALUES ('stale_job', '2026-09-03', 'error', '{"kind":"meal_photo","photoUri":"file:///old.jpg"}', NULL, 'Interrupted', 1, 1)`
    );

    const rows = await listJobs(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(1);

    // And the column keeps working normally for new writes after that.
    await upsertJob(db, job({ id: 'stale_job', status: 'error', errorMessage: 'Interrupted', attempts: 5 }));
    const [updated] = await listJobs(db);
    expect(updated.attempts).toBe(5);
  });

  // Once a process HAS run the ALTER above, a later process against that
  // same on-device database must not crash on "duplicate column name" —
  // `ensureTable`'s in-memory `ensuredTable` flag only guards re-running
  // it within one process's lifetime, not across restarts.
  it('tolerates the column already existing from an earlier run (a later app launch against the same db)', async () => {
    const db = createTestDatabase();
    await upsertJob(db, job({ id: 'job_a' })); // first "process": creates the table and adds the column
    resetCaptureJobsPersistenceForTesting(); // simulate a fresh process (in-memory ensuredTable flag forgotten) against the SAME db, which already has the column

    await expect(upsertJob(db, job({ id: 'job_b' }))).resolves.not.toThrow();
    const rows = await listJobs(db);
    expect(rows.map((r) => r.id).sort()).toEqual(['job_a', 'job_b']);
  });
});

describe('deleteJob', () => {
  it('removes exactly the named job, leaving others intact', async () => {
    const db = createTestDatabase();
    await upsertJob(db, job({ id: 'job_a' }));
    await upsertJob(db, job({ id: 'job_b' }));

    await deleteJob(db, 'job_a');

    const rows = await listJobs(db);
    expect(rows.map((r) => r.id)).toEqual(['job_b']);
  });

  it('is a harmless no-op for an id that was never persisted', async () => {
    const db = createTestDatabase();
    await expect(deleteJob(db, 'does-not-exist')).resolves.not.toThrow();
  });
});

describe('a fresh in-memory database with no jobs yet', () => {
  it('lists as empty rather than throwing', async () => {
    const db = createTestDatabase();
    expect(await listJobs(db)).toEqual([]);
  });
});
