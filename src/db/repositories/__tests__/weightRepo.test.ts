import * as weightRepo from '../weightRepo';
import { freshDb } from './testHelpers';
import type { Database } from '../../database';

describe('weightRepo', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('upserts by date: one reading per day', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80.5 });
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80.9 });

    const row = await weightRepo.getByDate(db, '2026-08-01');
    expect(row?.weight_kg).toBe(80.9);

    const all = await weightRepo.getAll(db);
    expect(all).toHaveLength(1);
  });

  it('defaults source to manual and confounder to null', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80 });
    const row = await weightRepo.getByDate(db, '2026-08-01');
    expect(row?.source).toBe('manual');
    expect(row?.confounder).toBeNull();
  });

  it('reads a date range inclusive and ascending', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80 });
    await weightRepo.upsertWeight(db, { date: '2026-08-03', weight_kg: 79.5 });
    await weightRepo.upsertWeight(db, { date: '2026-08-02', weight_kg: 79.8 });
    await weightRepo.upsertWeight(db, { date: '2026-08-10', weight_kg: 78 });

    const range = await weightRepo.getRange(db, '2026-08-01', '2026-08-03');
    expect(range.map((r) => r.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('deletes a reading', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80 });
    await weightRepo.deleteWeight(db, '2026-08-01');
    expect(await weightRepo.getByDate(db, '2026-08-01')).toBeNull();
  });

  it('sets and clears a confounder', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80 });
    await weightRepo.setConfounder(db, '2026-08-01', 'alcohol');
    expect((await weightRepo.getByDate(db, '2026-08-01'))?.confounder).toBe('alcohol');

    await weightRepo.clearConfounder(db, '2026-08-01');
    expect((await weightRepo.getByDate(db, '2026-08-01'))?.confounder).toBeNull();
  });

  it('editing a 3-week-old reading updates it in place (PRD §10)', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80, confounder: 'travel' });
    // three weeks later, correct the value
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80.2, confounder: null });

    const row = await weightRepo.getByDate(db, '2026-08-01');
    expect(row?.weight_kg).toBe(80.2);
    expect(row?.confounder).toBeNull();
  });
});
