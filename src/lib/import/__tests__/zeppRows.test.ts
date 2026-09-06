import { parseZeppRow, parseZeppRows } from '../zeppRows';
import type { ColumnMapping } from '../zeppMapping';

const FULL_MAPPING: ColumnMapping = {
  date: 'Date',
  tdee_est: 'TDEE',
  active_kcal: 'Active',
  steps: 'Steps',
  sleep_minutes: 'Sleep',
  readiness: 'Readiness',
};

describe('parseZeppRow', () => {
  it('parses a fully-populated row', () => {
    const outcome = parseZeppRow(
      { Date: '2026-01-05', TDEE: '2400', Active: '350', Steps: '9000', Sleep: '420', Readiness: '80' },
      FULL_MAPPING,
      0
    );
    expect(outcome).toEqual({
      ok: true,
      row: {
        date: '2026-01-05',
        tdee_est: 2400,
        active_kcal: 350,
        steps: 9000,
        sleep_minutes: 420,
        readiness: 80,
        ambiguityNote: null,
      },
    });
  });

  it('fails when no column is mapped to date', () => {
    const outcome = parseZeppRow({ Date: '2026-01-05' }, {}, 0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.reason).toContain('no column mapped to "date"');
  });

  it('fails when the mapped date column is missing/blank on this row', () => {
    const outcome = parseZeppRow({ Date: '' }, { date: 'Date' }, 3);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.rowIndex).toBe(3);
    expect(outcome.failure.reason).toContain('missing a value');
  });

  it('fails when the date does not parse in any known format', () => {
    const outcome = parseZeppRow({ Date: 'not a date' }, { date: 'Date' }, 0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.reason).toContain('could not parse date');
  });

  it('leaves unmapped optional fields null', () => {
    const outcome = parseZeppRow({ Date: '2026-01-05' }, { date: 'Date' }, 0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row).toEqual({
      date: '2026-01-05',
      tdee_est: null,
      active_kcal: null,
      steps: null,
      sleep_minutes: null,
      readiness: null,
      ambiguityNote: null,
    });
  });

  it('treats a blank or non-numeric optional field as null rather than failing the row', () => {
    const outcome = parseZeppRow({ Date: '2026-01-05', Steps: '', TDEE: 'n/a' }, FULL_MAPPING, 0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.steps).toBeNull();
    expect(outcome.row.tdee_est).toBeNull();
  });

  it('carries an ambiguity note through when the date parse hit one', () => {
    const outcome = parseZeppRow({ Date: '03/04/2026' }, { date: 'Date' }, 0);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.row.date).toBe('2026-04-03');
    expect(outcome.row.ambiguityNote).toContain('DD/MM/YYYY');
  });
});

describe('parseZeppRows', () => {
  it('splits rows into successes and failures, preserving row index', () => {
    const raw = [
      { Date: '2026-01-01' },
      { Date: 'garbage' },
      { Date: '2026-01-03' },
    ];
    const { rows, failures } = parseZeppRows(raw, { date: 'Date' });
    expect(rows.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-03']);
    expect(failures).toHaveLength(1);
    expect(failures[0].rowIndex).toBe(1);
  });

  it('last row wins when two rows share the same date (matches upsert-by-date commit semantics)', () => {
    const raw = [
      { Date: '2026-01-01', Steps: '1000' },
      { Date: '2026-01-01', Steps: '2000' },
    ];
    const { rows } = parseZeppRows(raw, { date: 'Date', steps: 'Steps' });
    // parseZeppRows itself doesn't dedupe (that's commitZeppImport's job via
    // upsert), but both rows must parse independently and in order so the
    // caller can dedupe/upsert deterministically.
    expect(rows.map((r) => r.steps)).toEqual([1000, 2000]);
  });

  it('returns empty arrays for empty input', () => {
    expect(parseZeppRows([], { date: 'Date' })).toEqual({ rows: [], failures: [] });
  });
});
