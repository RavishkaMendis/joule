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
