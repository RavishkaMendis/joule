import { runMigrations, LATEST_SCHEMA_VERSION } from '../migrations';
import { createTestDatabase } from './testDb';
import {
  exportFullJson,
  exportTableCsv,
  exportAllCsv,
  importWeightLogCsv,
  importDayIntakeCsv,
} from '../export';
import { parseCsv } from '../../lib/csv';
import * as weightRepo from '../repositories/weightRepo';
import * as foodRepo from '../repositories/foodRepo';
import * as supplementRepo from '../repositories/supplementRepo';
import * as workoutExerciseRepo from '../repositories/workoutExerciseRepo';
import type { Database } from '../database';

async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}

describe('export', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('exportFullJson dumps every table with a schema version and timestamp', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80 });
    await foodRepo.addEntry(db, {
      id: 'e1',
      date: '2026-08-01',
      logged_at: 1000,
      name: 'Rice',
      grams: 200,
      kcal: 260,
      protein_g: 5,
      carbs_g: 56,
      fat_g: 0.6,
      source: 'manual',
      confidence: 'exact',
    });

    const dump = await exportFullJson(db, LATEST_SCHEMA_VERSION);
    expect(dump.schema_version).toBe(LATEST_SCHEMA_VERSION);
    expect(typeof dump.exported_at).toBe('string');
    expect(dump.weight_log).toHaveLength(1);
    expect(dump.food_entry).toHaveLength(1);
    expect(dump.day_intake).toHaveLength(1);
    expect(dump.day_intake[0].kcal).toBe(260);
    // Empty-but-present tables (phase-1 doesn't populate these):
    expect(dump.external_estimate).toEqual([]);
    expect(dump.supplement).toEqual([]);
    expect(dump.supplement_log).toEqual([]);
    expect(dump.workout_session).toEqual([]);
    expect(dump.workout_set).toEqual([]);
    expect(dump.workout_set_segment).toEqual([]);
    // exercise is NOT empty: schema v4's migration seeds a fixed library.
    expect(dump.exercise.length).toBeGreaterThan(0);
    // program/program_day/program_exercise are NOT empty either: schema
    // v7's migration seeds one generic starter template.
    expect(dump.program.length).toBeGreaterThan(0);
    expect(dump.program_day.length).toBeGreaterThan(0);
    expect(dump.program_exercise.length).toBeGreaterThan(0);
    expect(dump.program_substitution.length).toBeGreaterThan(0);
  });

  it('exportTableCsv round-trips through the CSV codec for weight_log', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80.4, confounder: 'travel' });
    await weightRepo.upsertWeight(db, { date: '2026-08-02', weight_kg: 80.1 });

    const csv = await exportTableCsv(db, 'weight_log');
    const parsed = parseCsv(csv);
    expect(parsed).toEqual([
      { date: '2026-08-01', weight_kg: '80.4', confounder: 'travel', source: 'manual' },
      { date: '2026-08-02', weight_kg: '80.1', confounder: '', source: 'manual' },
    ]);
  });

  it('exportAllCsv returns a CSV string for every table', async () => {
    const all = await exportAllCsv(db);
    expect(Object.keys(all).sort()).toEqual(
      [
        'day_intake',
        'external_estimate',
        'exercise',
        'food_entry',
        'pot',
        'pot_container',
        'program',
        'program_day',
        'program_exercise',
        'program_substitution',
        'saved_food',
        'supplement',
        'supplement_log',
        'user_profile',
        'weight_log',
        'workout_session',
        'workout_set',
        'workout_set_segment',
      ].sort()
    );
    // header-only for empty tables
    expect(all.weight_log.trim()).toBe('date,weight_kg,confounder,source');
  });

  it('CSV export handles a food_entry name containing a comma and one containing a quote', async () => {
    await foodRepo.addEntry(db, {
      id: 'e1',
      date: '2026-08-01',
      logged_at: 1,
      name: 'Rice, cooked',
      grams: 100,
      kcal: 130,
      protein_g: 3,
      carbs_g: 28,
      fat_g: 0.3,
      source: 'manual',
      confidence: 'exact',
    });
    await foodRepo.addEntry(db, {
      id: 'e2',
      date: '2026-08-01',
      logged_at: 2,
      name: 'Mum\'s "famous" dal',
      grams: 250,
      kcal: 400,
      protein_g: 20,
      carbs_g: 40,
      fat_g: 15,
      source: 'manual',
      confidence: 'medium',
    });

    const csv = await exportTableCsv(db, 'food_entry');
    const parsed = parseCsv(csv);
    const names = parsed.map((r) => r.name);
    expect(names).toContain('Rice, cooked');
    expect(names).toContain('Mum\'s "famous" dal');
  });

  it('CSV export includes the new supplement columns (unit/notes/is_active/created_at) and supplement_log', async () => {
    await supplementRepo.addSupplement(db, {
      id: 'sup1',
      name: 'Creatine',
      dose: '5',
      schedule: JSON.stringify({ type: 'daily' }),
      unit: 'g',
      notes: 'with water',
      created_at: 1000,
    });
    await supplementRepo.logDose(db, 'log1', 'sup1', '2026-08-01', 2000);

    const supplementCsv = await exportTableCsv(db, 'supplement');
    const parsedSupplement = parseCsv(supplementCsv);
    expect(parsedSupplement).toHaveLength(1);
    expect(Object.keys(parsedSupplement[0])).toEqual(
      expect.arrayContaining(['unit', 'notes', 'is_active', 'created_at'])
    );
    expect(parsedSupplement[0]).toMatchObject({
      id: 'sup1',
      name: 'Creatine',
      unit: 'g',
      notes: 'with water',
      is_active: '1',
      created_at: '1000',
    });

    const logCsv = await exportTableCsv(db, 'supplement_log');
    const parsedLog = parseCsv(logCsv);
    expect(parsedLog).toEqual([{ id: 'log1', supplement_id: 'sup1', date: '2026-08-01', logged_at: '2000', food_entry_id: '' }]);
  });

  it('CSV export includes strength-training tables (exercise/workout_session/workout_set)', async () => {
    await workoutExerciseRepo.addCustomExercise(db, { id: 'custom1', name: 'Sissy Squat', category: 'legs' });

    const exerciseCsv = await exportTableCsv(db, 'exercise');
    const parsedExercise = parseCsv(exerciseCsv);
    expect(parsedExercise.find((r) => r.id === 'custom1')).toMatchObject({ name: 'Sissy Squat', category: 'legs', is_custom: '1' });
    // Seeded library rows are present too.
    expect(parsedExercise.find((r) => r.id === 'seed_back_squat')).toBeTruthy();
  });
});

describe('import', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('export -> import round-trips weight_log data exactly, including a comma/quote value in confounder-like free text', async () => {
    await weightRepo.upsertWeight(db, { date: '2026-08-01', weight_kg: 80.4, confounder: 'travel' });
    await weightRepo.upsertWeight(db, { date: '2026-08-02', weight_kg: 80.1 });
    await weightRepo.upsertWeight(db, { date: '2026-08-03', weight_kg: 79.9, confounder: 'ate_out' });

    const csv = await exportTableCsv(db, 'weight_log');

    const freshTarget = await freshDb();
    const result = await importWeightLogCsv(freshTarget, csv);
    expect(result.errors).toEqual([]);
    expect(result.rowsImported).toBe(3);

    const roundTripped = await weightRepo.getAll(freshTarget);
    const original = await weightRepo.getAll(db);
    expect(roundTripped).toEqual(original);
  });

  it('importWeightLogCsv handles a value containing a comma and one containing a quote', async () => {
    const csv =
      'date,weight_kg,confounder,source\r\n' +
      '2026-08-01,80.5,"ate_out, travel",manual\r\n' +
      '2026-08-02,80.2,"say ""hi""",manual\r\n';

    const result = await importWeightLogCsv(db, csv);
    expect(result.errors).toEqual([]);
    expect(result.rowsImported).toBe(2);

    const row1 = await weightRepo.getByDate(db, '2026-08-01');
    expect(row1?.confounder).toBe('ate_out, travel');
    const row2 = await weightRepo.getByDate(db, '2026-08-02');
    expect(row2?.confounder).toBe('say "hi"');
  });

  it('importWeightLogCsv upserts (re-importing the same file is idempotent)', async () => {
    const csv = 'date,weight_kg,confounder,source\r\n2026-08-01,80,,manual\r\n';
    await importWeightLogCsv(db, csv);
    await importWeightLogCsv(db, csv);
    const all = await weightRepo.getAll(db);
    expect(all).toHaveLength(1);
  });

  it('importWeightLogCsv reports an error and skips a row with an invalid weight_kg', async () => {
    const csv = 'date,weight_kg,confounder,source\r\n2026-08-01,not-a-number,,manual\r\n2026-08-02,80,,manual\r\n';
    const result = await importWeightLogCsv(db, csv);
    expect(result.rowsImported).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(await weightRepo.getByDate(db, '2026-08-01')).toBeNull();
    expect(await weightRepo.getByDate(db, '2026-08-02')).not.toBeNull();
  });

  it('export -> import round-trips day_intake data exactly', async () => {
    await foodRepo.addEntry(db, {
      id: 'e1',
      date: '2026-08-01',
      logged_at: 1,
      name: 'Rice, cooked',
      grams: 200,
      kcal: 260,
      protein_g: 5,
      carbs_g: 56,
      fat_g: 0.6,
      source: 'manual',
      confidence: 'exact',
    });

    const csv = await exportTableCsv(db, 'day_intake');
    const freshTarget = await freshDb();
    const result = await importDayIntakeCsv(freshTarget, csv);
    expect(result.errors).toEqual([]);
    expect(result.rowsImported).toBe(1);

    const imported = await freshTarget.getAllAsync('SELECT * FROM day_intake');
    const original = await db.getAllAsync('SELECT * FROM day_intake');
    expect(imported).toEqual(original);
  });

  it('importDayIntakeCsv defaults is_complete to 1 when the column is blank', async () => {
    const csv = 'date,kcal,protein_g,carbs_g,fat_g,is_complete\r\n2026-08-01,1500,100,150,50,\r\n';
    await importDayIntakeCsv(db, csv);
    const row = await db.getFirstAsync<{ is_complete: number }>('SELECT is_complete FROM day_intake WHERE date = ?', [
      '2026-08-01',
    ]);
    expect(row?.is_complete).toBe(1);
  });
});
