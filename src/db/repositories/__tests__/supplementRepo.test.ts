import { freshDb } from './testHelpers';
import type { Database } from '../../database';
import * as supplementRepo from '../supplementRepo';
import { serializeSchedule } from '../../../lib/supplements/schedule';

describe('supplementRepo', () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  test('addSupplement writes and reads back every field, defaulting is_active to 1', async () => {
    const row = await supplementRepo.addSupplement(db, {
      id: 's1',
      name: 'Vitamin D3',
      dose: '2000',
      unit: 'IU',
      schedule: serializeSchedule({ type: 'daily' }),
      kcal: 0,
      protein_g: 0,
      notes: 'Take with food',
      created_at: 1000,
    });

    expect(row).toMatchObject({
      id: 's1',
      name: 'Vitamin D3',
      dose: '2000',
      unit: 'IU',
      kcal: 0,
      protein_g: 0,
      notes: 'Take with food',
      is_active: 1,
      created_at: 1000,
    });
  });

  test('addSupplement defaults kcal/protein_g/unit/notes when omitted', async () => {
    const row = await supplementRepo.addSupplement(db, {
      id: 's1',
      name: 'Custom peptide',
      dose: '250',
      schedule: serializeSchedule({ type: 'as_needed' }),
      created_at: 1000,
    });
    expect(row.kcal).toBe(0);
    expect(row.protein_g).toBe(0);
    expect(row.unit).toBeNull();
    expect(row.notes).toBeNull();
  });

  test('updateSupplement patches only provided fields', async () => {
    await supplementRepo.addSupplement(db, {
      id: 's1',
      name: 'Creatine',
      dose: '5',
      unit: 'g',
      schedule: serializeSchedule({ type: 'daily' }),
      kcal: 0,
      protein_g: 0,
      created_at: 1000,
    });

    const updated = await supplementRepo.updateSupplement(db, 's1', { dose: '10', notes: 'doubled up' });
    expect(updated.dose).toBe('10');
    expect(updated.notes).toBe('doubled up');
    expect(updated.name).toBe('Creatine');
    expect(updated.unit).toBe('g');
  });

  test('updateSupplement throws for an unknown id', async () => {
    await expect(supplementRepo.updateSupplement(db, 'nope', { dose: '1' })).rejects.toThrow();
  });

  test('setActive archives and reactivates', async () => {
    await supplementRepo.addSupplement(db, {
      id: 's1',
      name: 'Fish oil',
      dose: '1000',
      unit: 'mg',
      schedule: serializeSchedule({ type: 'daily' }),
      created_at: 1000,
    });

    await supplementRepo.setActive(db, 's1', false);
    expect((await supplementRepo.getSupplement(db, 's1'))?.is_active).toBe(0);

    await supplementRepo.setActive(db, 's1', true);
    expect((await supplementRepo.getSupplement(db, 's1'))?.is_active).toBe(1);
  });

  test('listActive excludes archived supplements; listAll includes everything', async () => {
    await supplementRepo.addSupplement(db, {
      id: 'a',
      name: 'A',
      dose: '1',
      schedule: serializeSchedule({ type: 'daily' }),
      created_at: 1,
    });
    await supplementRepo.addSupplement(db, {
      id: 'b',
      name: 'B',
      dose: '1',
      schedule: serializeSchedule({ type: 'daily' }),
      created_at: 2,
    });
    await supplementRepo.setActive(db, 'b', false);

    const active = await supplementRepo.listActive(db);
    expect(active.map((s) => s.id)).toEqual(['a']);

    const all = await supplementRepo.listAll(db);
    expect(all.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });

  test('deleteSupplement removes the supplement AND its log rows', async () => {
    await supplementRepo.addSupplement(db, {
      id: 's1',
      name: 'X',
      dose: '1',
      schedule: serializeSchedule({ type: 'daily' }),
      created_at: 1,
    });
    await supplementRepo.logDose(db, 'log1', 's1', '2026-09-01', 1000);

    await supplementRepo.deleteSupplement(db, 's1');

    expect(await supplementRepo.getSupplement(db, 's1')).toBeNull();
    expect(await supplementRepo.getLog(db, 's1', '2026-09-01')).toBeNull();
  });

  describe('supplement_log adherence', () => {
    beforeEach(async () => {
      await supplementRepo.addSupplement(db, {
        id: 's1',
        name: 'Magnesium',
        dose: '400',
        unit: 'mg',
        schedule: serializeSchedule({ type: 'daily' }),
        created_at: 1,
      });
    });

    test('logDose creates a row; getLog reads it back', async () => {
      await supplementRepo.logDose(db, 'log1', 's1', '2026-09-05', 5000);
      const row = await supplementRepo.getLog(db, 's1', '2026-09-05');
      expect(row).toMatchObject({ id: 'log1', supplement_id: 's1', date: '2026-09-05', logged_at: 5000, food_entry_id: null });
    });

    test('logDose is idempotent per (supplement_id, date) — a second call updates logged_at rather than duplicating', async () => {
      await supplementRepo.logDose(db, 'log1', 's1', '2026-09-05', 1000);
      await supplementRepo.logDose(db, 'log2', 's1', '2026-09-05', 2000);

      const rows = await supplementRepo.getLogsForDate(db, '2026-09-05');
      expect(rows).toHaveLength(1);
      expect(rows[0].logged_at).toBe(2000);
    });

    test('unlogDose removes the row; is a no-op if nothing was logged', async () => {
      await supplementRepo.logDose(db, 'log1', 's1', '2026-09-05', 1000);
      await supplementRepo.unlogDose(db, 's1', '2026-09-05');
      expect(await supplementRepo.getLog(db, 's1', '2026-09-05')).toBeNull();

      await expect(supplementRepo.unlogDose(db, 's1', '2026-09-06')).resolves.toBeUndefined();
    });

    test('getLogsForDate returns rows across multiple supplements for one date', async () => {
      await supplementRepo.addSupplement(db, {
        id: 's2',
        name: 'Zinc',
        dose: '15',
        unit: 'mg',
        schedule: serializeSchedule({ type: 'daily' }),
        created_at: 2,
      });
      await supplementRepo.logDose(db, 'log1', 's1', '2026-09-05', 1000);
      await supplementRepo.logDose(db, 'log2', 's2', '2026-09-05', 1000);
      await supplementRepo.logDose(db, 'log3', 's1', '2026-09-06', 1000);

      const rows = await supplementRepo.getLogsForDate(db, '2026-09-05');
      expect(rows.map((r) => r.supplement_id).sort()).toEqual(['s1', 's2']);
    });

    test('getLogsForSupplement filters by date range, ascending', async () => {
      await supplementRepo.logDose(db, 'log1', 's1', '2026-09-01', 1000);
      await supplementRepo.logDose(db, 'log2', 's1', '2026-09-05', 1000);
      await supplementRepo.logDose(db, 'log3', 's1', '2026-09-10', 1000);

      const rows = await supplementRepo.getLogsForSupplement(db, 's1', '2026-09-02', '2026-09-06');
      expect(rows.map((r) => r.date)).toEqual(['2026-09-05']);
    });

    test('attachFoodEntry links a food_entry id onto an existing log row', async () => {
      await supplementRepo.logDose(db, 'log1', 's1', '2026-09-05', 1000);
      await supplementRepo.attachFoodEntry(db, 's1', '2026-09-05', 'entry_abc');

      const row = await supplementRepo.getLog(db, 's1', '2026-09-05');
      expect(row?.food_entry_id).toBe('entry_abc');
    });
  });
});
