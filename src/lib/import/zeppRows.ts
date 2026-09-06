// ═══════════════════════════════════════════════════════════════════════
// ZEPP IMPORT — row parsing/validation (PRD §11/§12).
//
// Turns one raw CSV/JSON row (a plain string-keyed record) plus a
// ColumnMapping into either a validated ParsedZeppRow or a skip reason.
// Pure and synchronous — no I/O, no DB — so it's directly unit-testable
// and reusable for both the preview step (first N rows, before commit)
// and the actual import.
//
// This module has no knowledge of, and no import from, src/engine/** — it
// only shapes data for `external_estimate`, which is reference-only (PRD
// §3/§11) and never read by the TDEE engine.
// ═══════════════════════════════════════════════════════════════════════

import { parseZeppDate } from './zeppDates';
import type { ColumnMapping } from './zeppMapping';

export type ParsedZeppRow = {
  date: string; // ISO yyyy-mm-dd
  tdee_est: number | null;
  active_kcal: number | null;
  steps: number | null;
  sleep_minutes: number | null;
  readiness: number | null;
  /** Present when the date parse had to resolve a DD/MM vs MM/DD ambiguity. */
  ambiguityNote: string | null;
};

export type RowParseFailure = {
  rowIndex: number;
  reason: string;
};

export type RowParseOutcome =
  | { ok: true; row: ParsedZeppRow }
  | { ok: false; failure: RowParseFailure };

function parseOptionalNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse one raw row (string-keyed, as CSV rows come off `parseCsv`, or a
 * flattened JSON record) into a validated row, using `mapping` to know
 * which raw column feeds which target field. Never throws: any problem
 * (missing/unparseable date) is returned as a typed failure with a reason
 * string suitable for direct display, so the importer can report exactly
 * why a row was skipped rather than silently dropping it.
 */
export function parseZeppRow(
  raw: Record<string, string>,
  mapping: ColumnMapping,
  rowIndex: number
): RowParseOutcome {
  const dateColumn = mapping.date;
  if (!dateColumn) {
    return { ok: false, failure: { rowIndex, reason: 'no column mapped to "date" — cannot import without one' } };
  }

  const rawDate = raw[dateColumn];
  if (rawDate === undefined || rawDate.trim() === '') {
    return { ok: false, failure: { rowIndex, reason: `row missing a value in the mapped date column "${dateColumn}"` } };
  }

  const { iso, ambiguityNote } = parseZeppDate(rawDate);
  if (!iso) {
    return {
      ok: false,
      failure: { rowIndex, reason: `could not parse date "${rawDate}" (column "${dateColumn}") in any known format` },
    };
  }

  const tdee_est = mapping.tdee_est ? parseOptionalNumber(raw[mapping.tdee_est]) : null;
  const active_kcal = mapping.active_kcal ? parseOptionalNumber(raw[mapping.active_kcal]) : null;
  const steps = mapping.steps ? parseOptionalNumber(raw[mapping.steps]) : null;
  const sleep_minutes = mapping.sleep_minutes ? parseOptionalNumber(raw[mapping.sleep_minutes]) : null;
  const readiness = mapping.readiness ? parseOptionalNumber(raw[mapping.readiness]) : null;

  return {
    ok: true,
    row: { date: iso, tdee_est, active_kcal, steps, sleep_minutes, readiness, ambiguityNote },
  };
}

/**
 * Parse every raw row against a mapping. Rows that fail validation are
 * collected as failures (with a reason) rather than thrown — "never throw
 * into the UI. Report rows imported, rows skipped, and why." When two
 * parsed rows share the same date (e.g. the export has duplicate/overlapping
 * entries for one day), the LAST one in file order wins — matches the
 * upsert-by-date semantics used at commit time, so preview and commit
 * agree on what "the row for 2026-01-05" ends up being.
 */
export function parseZeppRows(
  rawRows: readonly Record<string, string>[],
  mapping: ColumnMapping
): { rows: ParsedZeppRow[]; failures: RowParseFailure[] } {
  const rows: ParsedZeppRow[] = [];
  const failures: RowParseFailure[] = [];

  rawRows.forEach((raw, i) => {
    const outcome = parseZeppRow(raw, mapping, i);
    if (outcome.ok) {
      rows.push(outcome.row);
    } else {
      failures.push(outcome.failure);
    }
  });

  return { rows, failures };
}
