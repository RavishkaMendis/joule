import { freshDb } from '../../../db/repositories/__tests__/testHelpers';
import type { Database } from '../../../db/database';
import * as externalEstimateRepo from '../../../db/repositories/externalEstimateRepo';
import { parseZeppFile, previewZeppImport, planZeppImport, commitZeppImport } from '../zeppImport';

const CSV_TEXT = `Date,Steps,TDEE,Sleep Minutes\n2026-01-01,8000,2400,420\n2026-01-02,9500,2450,390\n`;

describe('parseZeppFile', () => {
  it('detects and parses CSV, suggesting a column mapping', () => {
    const result = parseZeppFile(CSV_TEXT);
    expect(result.format).toBe('csv');
    expect(result.headers).toEqual(['Date', 'Steps', 'TDEE', 'Sleep Minutes']);
    expect(result.rawRows).toHaveLength(2);
    expect(result.suggestedMapping.date).toBe('Date');
    expect(result.suggestedMapping.steps).toBe('Steps');
    expect(result.unsupportedFormatError).toBeNull();
  });

  it('detects and parses a flat JSON array', () => {
    const text = JSON.stringify([{ date: '2026-01-01', steps: 8000 }]);
    const result = parseZeppFile(text);
    expect(result.format).toBe('json');
    expect(result.headers).toEqual(['date', 'steps']);
    expect(result.rawRows).toEqual([{ date: '2026-01-01', steps: '8000' }]);
    expect(result.unsupportedFormatError).toBeNull();
  });

  it('surfaces an explicit error for unsupported (nested) JSON, without throwing', () => {
    const text = JSON.stringify({ days: { '2026-01-01': { steps: 8000 } } });
    const result = parseZeppFile(text);
    expect(result.format).toBe('json');
    expect(result.unsupportedFormatError).not.toBeNull();
    expect(result.rawRows).toEqual([]);
  });

  it('handles leading whitespace before JSON content', () => {
    const text = '   \n' + JSON.stringify([{ date: '2026-01-01' }]);
    const result = parseZeppFile(text);
    expect(result.format).toBe('json');
  });
});

describe('previewZeppImport', () => {
  it('returns a sample, total counts, and dedupes ambiguity notes', () => {
    const csv = parseZeppFile(CSV_TEXT);
    const preview = previewZeppImport(csv.rawRows, csv.suggestedMapping);
    expect(preview.totalRows).toBe(2);
    expect(preview.totalParseable).toBe(2);
    expect(preview.sampleRows).toHaveLength(2);
  });
});

describe('planZeppImport', () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  it('reports total/parseable/skipped counts and the inclusive date range', async () => {
    const csv = parseZeppFile(CSV_TEXT);
    const plan = await planZeppImport(db, csv.rawRows, csv.suggestedMapping);
    expect(plan.totalRows).toBe(2);
    expect(plan.totalParseable).toBe(2);
    expect(plan.totalSkipped).toBe(0);
    expect(plan.dateRangeStart).toBe('2026-01-01');
    expect(plan.dateRangeEnd).toBe('2026-01-02');
    expect(plan.conflictDates).toEqual([]);
  });

  it('flags dates that already have an external_estimate row as conflicts', async () => {
    await externalEstimateRepo.upsertEstimate(db, {
      date: '2026-01-01',
      source: 'zepp',
      tdee_est: 2000,
      active_kcal: null,
      steps: null,
      sleep_minutes: null,
      readiness: null,
    });

    const csv = parseZeppFile(CSV_TEXT);
    const plan = await planZeppImport(db, csv.rawRows, csv.suggestedMapping);
    expect(plan.conflictDates).toEqual(['2026-01-01']);
  });

  it('reports skipped rows and their reasons', async () => {
    const rawRows = [{ Date: '2026-01-01' }, { Date: 'not a date' }];
    const plan = await planZeppImport(db, rawRows, { date: 'Date' });
    expect(plan.totalRows).toBe(2);
    expect(plan.totalParseable).toBe(1);
    expect(plan.totalSkipped).toBe(1);
    expect(plan.skipReasons[0]).toContain('row 2');
  });

  it('has a null date range when nothing parses', async () => {
    const plan = await planZeppImport(db, [{ Date: 'garbage' }], { date: 'Date' });
    expect(plan.dateRangeStart).toBeNull();
    expect(plan.dateRangeEnd).toBeNull();
    expect(plan.conflictDates).toEqual([]);
  });

  it('surfaces ambiguity notes across ALL parsed rows, not just the 5-row sample', async () => {
    const rawRows = Array.from({ length: 6 }, (_, i) => ({ Date: '03/04/2026', Steps: String(i) }));
    const plan = await planZeppImport(db, rawRows, { date: 'Date', steps: 'Steps' });
    expect(plan.ambiguityNotes.length).toBeGreaterThan(0);
    expect(plan.ambiguityNotes[0]).toContain('DD/MM/YYYY');
  });
});

describe('commitZeppImport', () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
  });

  it('writes valid rows to external_estimate and reports counts', async () => {
    const csv = parseZeppFile(CSV_TEXT);
    const result = await commitZeppImport(db, csv.rawRows, csv.suggestedMapping);
    expect(result.rowsImported).toBe(2);
    expect(result.rowsSkipped).toBe(0);

    const rows = await externalEstimateRepo.getAll(db);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.date === '2026-01-01')?.steps).toBe(8000);
  });

  it('is idempotent — re-importing the same file upserts rather than duplicating', async () => {
    const csv = parseZeppFile(CSV_TEXT);
    await commitZeppImport(db, csv.rawRows, csv.suggestedMapping);
    await commitZeppImport(db, csv.rawRows, csv.suggestedMapping);

    const rows = await externalEstimateRepo.getAll(db);
    expect(rows).toHaveLength(2);
  });

  it('never throws for row-level problems — bad rows are reported, not fatal', async () => {
    const rawRows: Record<string, string>[] = [{ Date: '2026-01-01', Steps: '100' }, { Date: 'garbage' }];
    const result = await commitZeppImport(db, rawRows, { date: 'Date', steps: 'Steps' });
    expect(result.rowsImported).toBe(1);
    expect(result.rowsSkipped).toBe(1);
    expect(result.skipReasons).toHaveLength(1);
  });

  it('defaults source to "zepp" but accepts an override', async () => {
    const rawRows = [{ Date: '2026-01-01' }];
    await commitZeppImport(db, rawRows, { date: 'Date' }, 'other-app');
    const row = await externalEstimateRepo.getByDate(db, '2026-01-01');
    expect(row?.source).toBe('other-app');
  });

  it('overwrites an existing row for the same date rather than duplicating (conflict resolution = last import wins)', async () => {
    await externalEstimateRepo.upsertEstimate(db, {
      date: '2026-01-01',
      source: 'zepp',
      tdee_est: 1111,
      active_kcal: null,
      steps: 1,
      sleep_minutes: null,
      readiness: null,
    });

    await commitZeppImport(db, [{ Date: '2026-01-01', Steps: '9999' }], { date: 'Date', steps: 'Steps' });

    const row = await externalEstimateRepo.getByDate(db, '2026-01-01');
    expect(row?.steps).toBe(9999);
    expect(row?.tdee_est).toBeNull(); // unmapped field on the new import overwrites, not merges
  });
});
