import { freshDb } from '../../../db/repositories/__tests__/testHelpers';
import type { Database } from '../../../db/database';
import * as supplementRepo from '../../../db/repositories/supplementRepo';
import * as foodRepo from '../../../db/repositories/foodRepo';
import * as intakeRepo from '../../../db/repositories/intakeRepo';
import {
  createSupplement,
  updateSupplement,
  archiveSupplement,
  reactivateSupplement,
  deleteSupplement,
  toggleDose,
  logDoseAndFood,
} from '../supplementActions';

describe('supplementActions', () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  test('createSupplement serializes the schedule and defaults kcal/protein_g', async () => {
    const s = await createSupplement(db, {
      name: 'Vitamin D3',
      dose: '2000',
      unit: 'IU',
      schedule: { type: 'daily' },
    });
    expect(s.name).toBe('Vitamin D3');
    expect(s.kcal).toBe(0);
    expect(s.protein_g).toBe(0);
    expect(JSON.parse(s.schedule)).toEqual({ type: 'daily' });
  });

  test('updateSupplement re-serializes a new schedule when provided', async () => {
    const s = await createSupplement(db, { name: 'Zinc', dose: '15', schedule: { type: 'daily' } });
    const updated = await updateSupplement(db, s.id, { schedule: { type: 'days_of_week', days: [1, 3, 5] } });
    expect(JSON.parse(updated.schedule)).toEqual({ type: 'days_of_week', days: [1, 3, 5] });
  });

  test('archiveSupplement / reactivateSupplement toggle is_active', async () => {
    const s = await createSupplement(db, { name: 'Fish oil', dose: '1', schedule: { type: 'daily' } });
    await archiveSupplement(db, s.id);
    expect((await supplementRepo.getSupplement(db, s.id))?.is_active).toBe(0);
    await reactivateSupplement(db, s.id);
    expect((await supplementRepo.getSupplement(db, s.id))?.is_active).toBe(1);
  });

  test('deleteSupplement removes it via the repo (and its logs)', async () => {
    const s = await createSupplement(db, { name: 'X', dose: '1', schedule: { type: 'daily' } });
    await toggleDose(db, s.id, '2026-09-05');
    await deleteSupplement(db, s.id);
    expect(await supplementRepo.getSupplement(db, s.id)).toBeNull();
    expect(await supplementRepo.getLog(db, s.id, '2026-09-05')).toBeNull();
  });

  describe('toggleDose', () => {
    test('logs on first tap, un-logs on second tap', async () => {
      const s = await createSupplement(db, { name: 'Magnesium', dose: '400', schedule: { type: 'daily' } });

      const first = await toggleDose(db, s.id, '2026-09-05', 1000);
      expect(first.logged).toBe(true);
      expect(await supplementRepo.getLog(db, s.id, '2026-09-05')).not.toBeNull();

      const second = await toggleDose(db, s.id, '2026-09-05', 2000);
      expect(second.logged).toBe(false);
      expect(await supplementRepo.getLog(db, s.id, '2026-09-05')).toBeNull();
    });

    test('never writes to food_entry, even for a supplement with macros', async () => {
      const s = await createSupplement(db, {
        name: 'Protein shake scoop',
        dose: '1',
        unit: 'scoop',
        schedule: { type: 'daily' },
        kcal: 120,
        protein_g: 24,
      });

      await toggleDose(db, s.id, '2026-09-05', 1000);

      const entries = await foodRepo.getEntriesForDate(db, '2026-09-05');
      expect(entries).toHaveLength(0);
    });
  });

  describe('logDoseAndFood — the ONLY path from a supplement into food_entry, and only on explicit call', () => {
    test('writes exactly one food_entry with the supplement macros, source manual, confidence exact', async () => {
      const s = await createSupplement(db, {
        name: 'Protein shake scoop',
        dose: '1',
        unit: 'scoop',
        schedule: { type: 'daily' },
        kcal: 120,
        protein_g: 24,
      });

      const { entry } = await logDoseAndFood(db, s, '2026-09-05', 1000);

      expect(entry.name).toBe('Protein shake scoop');
      expect(entry.kcal).toBe(120);
      expect(entry.protein_g).toBe(24);
      expect(entry.carbs_g).toBe(0);
      expect(entry.fat_g).toBe(0);
      expect(entry.source).toBe('manual');
      expect(entry.confidence).toBe('exact');

      const entries = await foodRepo.getEntriesForDate(db, '2026-09-05');
      expect(entries).toHaveLength(1);
    });

    test('rolls the macros into day_intake for that date (via the normal foodEntryActions/intakeRepo path)', async () => {
      const s = await createSupplement(db, {
        name: 'Creatine',
        dose: '5',
        unit: 'g',
        schedule: { type: 'daily' },
        kcal: 20,
        protein_g: 0,
      });

      await logDoseAndFood(db, s, '2026-09-05', 1000);

      const day = await intakeRepo.getDay(db, '2026-09-05');
      expect(day?.kcal).toBe(20);
    });

    test('creates a supplement_log row and links food_entry_id onto it', async () => {
      const s = await createSupplement(db, {
        name: 'Protein shake scoop',
        dose: '1',
        schedule: { type: 'daily' },
        kcal: 120,
        protein_g: 24,
      });

      const { log, entry } = await logDoseAndFood(db, s, '2026-09-05', 1000);
      expect(log.food_entry_id).toBeNull(); // returned log reflects state BEFORE the attach

      const persisted = await supplementRepo.getLog(db, s.id, '2026-09-05');
      expect(persisted?.food_entry_id).toBe(entry.id);
    });

    test('reuses an existing dose log for the day rather than creating a duplicate', async () => {
      const s = await createSupplement(db, {
        name: 'Protein shake scoop',
        dose: '1',
        schedule: { type: 'daily' },
        kcal: 120,
        protein_g: 24,
      });

      await toggleDose(db, s.id, '2026-09-05', 500); // dose already logged
      await logDoseAndFood(db, s, '2026-09-05', 1000);

      // Still exactly one supplement_log row for this (supplement, date).
      const rows = await supplementRepo.getLogsForDate(db, '2026-09-05');
      expect(rows).toHaveLength(1);
    });

    test('a supplement with zero macros still logs a (zero-value) food_entry when explicitly called — no implicit gate here, the screen decides when to offer this', async () => {
      const s = await createSupplement(db, { name: 'Vitamin D3', dose: '2000', unit: 'IU', schedule: { type: 'daily' } });
      const { entry } = await logDoseAndFood(db, s, '2026-09-05', 1000);
      expect(entry.kcal).toBe(0);
      expect(entry.protein_g).toBe(0);
    });
  });
});
