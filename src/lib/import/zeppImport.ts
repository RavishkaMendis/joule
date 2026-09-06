// ═══════════════════════════════════════════════════════════════════════
// ZEPP IMPORT — orchestration (PRD §11/§12, build order item 19).
//
// Ties together: CSV/JSON parsing (src/lib/csv.ts / zeppJson.ts), header
// auto-suggestion (zeppMapping.ts), row parsing/validation (zeppRows.ts),
// and committing to `external_estimate` via externalEstimateRepo (upsert
// by date — idempotent re-import).
//
// This is a REFERENCE-DATA importer only. It writes exclusively to
// `external_estimate`. It must never touch day_intake, weight_log, or
// anything the engine reads — see src/db/types.ts and eslint.config.js's
// engine wall for how that boundary is enforced structurally elsewhere.
// This module has no reason to import from src/engine/** at all, and
// doesn't.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import { parseCsv } from '../csv';
import { parseZeppJson } from './zeppJson';
import { suggestColumnMapping, type ColumnMapping } from './zeppMapping';
import { parseZeppRows, type ParsedZeppRow, type RowParseFailure } from './zeppRows';
import * as externalEstimateRepo from '../../db/repositories/externalEstimateRepo';

export type ZeppFileFormat = 'csv' | 'json';

export type ZeppFileParseResult = {
  format: ZeppFileFormat;
  headers: string[];
  rawRows: Record<string, string>[];
  suggestedMapping: ColumnMapping;
  /** Only set for JSON: a format we couldn't read at all (e.g. nested/grouped shape). CSV parse failures throw instead (matches parseCsv's existing contract) and are surfaced by the caller's try/catch. */
  unsupportedFormatError: string | null;
};

/**
 * Detect CSV vs JSON by content (not filename — a picker may not always
 * expose one) and parse the header row + raw rows, then auto-suggest a
 * column mapping. Never commits anything — this is the "show the user
 * their actual columns" step (task brief step 1) that must happen before
 * any DB write.
 */
export function parseZeppFile(text: string): ZeppFileParseResult {
  const trimmed = text.trimStart();
  const looksLikeJson = trimmed.startsWith('[') || trimmed.startsWith('{');

  if (looksLikeJson) {
    const result = parseZeppJson(text);
    if (!result.ok) {
      return {
        format: 'json',
        headers: [],
        rawRows: [],
        suggestedMapping: {},
        unsupportedFormatError: result.error,
      };
    }
    return {
      format: 'json',
      headers: result.headers,
      rawRows: result.rows,
      suggestedMapping: suggestColumnMapping(result.headers),
      unsupportedFormatError: null,
    };
  }

  const rows = parseCsv(text);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    format: 'csv',
    headers,
    rawRows: rows,
    suggestedMapping: suggestColumnMapping(headers),
    unsupportedFormatError: null,
  };
}

export type ZeppPreview = {
  /** First N validated rows, for the "preview before commit" step (task brief). */
  sampleRows: ParsedZeppRow[];
  /** Every ambiguity note hit within the sample, deduplicated, so the UI can show "these dates were read as DD/MM/YYYY" once rather than per-row spam. */
  sampleAmbiguityNotes: string[];
  totalParseable: number;
  totalRows: number;
};

const PREVIEW_ROW_COUNT = 5;

/** Build a preview of the first few parsed rows under the given mapping, without writing anything. */
export function previewZeppImport(rawRows: readonly Record<string, string>[], mapping: ColumnMapping): ZeppPreview {
  const sampleRaw = rawRows.slice(0, PREVIEW_ROW_COUNT);
  const { rows: sampleRows } = parseZeppRows(sampleRaw, mapping);
  const { rows: allParsed } = parseZeppRows(rawRows, mapping);

  const notes = new Set<string>();
  for (const row of sampleRows) {
    if (row.ambiguityNote) notes.add(row.ambiguityNote);
  }

  return {
    sampleRows,
    sampleAmbiguityNotes: [...notes],
    totalParseable: allParsed.length,
    totalRows: rawRows.length,
  };
}

export type ZeppImportPlan = {
  totalRows: number;
  totalParseable: number;
  totalSkipped: number;
  /** Inclusive ISO date range spanned by every successfully-parsed row (not just the sample) — null if zero rows parsed. */
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  /**
   * Dates within [dateRangeStart, dateRangeEnd] that already have an
   * `external_estimate` row (any source, including a prior Zepp import) —
   * committing this file will OVERWRITE those rows (upsert-by-date, see
   * commitZeppImport). Sorted ascending. Empty means every parsed date is
   * new.
   */
  conflictDates: string[];
  /** First few parsed rows, for a literal "here's what a row looks like" preview. */
  sampleRows: ParsedZeppRow[];
  /** Every ambiguity note across ALL parsed rows (not just the sample) — the commit step can hit dates never shown in the sample. */
  ambiguityNotes: string[];
  /** Every skip reason, one per unparseable row — full list, caller caps display. */
  skipReasons: string[];
};

/**
 * Build the full "what will happen if I commit this" picture the import
 * screen shows before the user confirms (task brief: "preview what will
 * be imported — row count, date range, conflicts with existing rows").
 * Parses every row (not just a sample) so the date range and conflict
 * check are exact, then queries `external_estimate` for the existing rows
 * that overlap that range. Read-only — never writes anything.
 */
export async function planZeppImport(
  db: Database,
  rawRows: readonly Record<string, string>[],
  mapping: ColumnMapping
): Promise<ZeppImportPlan> {
  const { rows, failures } = parseZeppRows(rawRows, mapping);

  const parsedDates = rows.map((r) => r.date).sort();
  const dateRangeStart = parsedDates.length > 0 ? parsedDates[0] : null;
  const dateRangeEnd = parsedDates.length > 0 ? parsedDates[parsedDates.length - 1] : null;

  let conflictDates: string[] = [];
  if (dateRangeStart && dateRangeEnd) {
    const existing = await externalEstimateRepo.getRange(db, dateRangeStart, dateRangeEnd);
    const parsedDateSet = new Set(rows.map((r) => r.date));
    conflictDates = existing
      .map((e) => e.date)
      .filter((d) => parsedDateSet.has(d))
      .sort();
  }

  const ambiguityNotes = new Set<string>();
  for (const row of rows) {
    if (row.ambiguityNote) ambiguityNotes.add(row.ambiguityNote);
  }

  return {
    totalRows: rawRows.length,
    totalParseable: rows.length,
    totalSkipped: failures.length,
    dateRangeStart,
    dateRangeEnd,
    conflictDates,
    sampleRows: rows.slice(0, PREVIEW_ROW_COUNT),
    ambiguityNotes: [...ambiguityNotes],
    skipReasons: failures.map(failureToMessage),
  };
}

export type ZeppImportResult = {
  rowsImported: number;
  rowsSkipped: number;
  /** Human-readable reasons rows were skipped, one per failed row (capped for display by the caller — full list returned here). */
  skipReasons: string[];
  /** Distinct ambiguity notes hit across the whole file (e.g. "03/04/2026 read as DD/MM/YYYY"), deduplicated by message. */
  ambiguityNotes: string[];
};

function failureToMessage(f: RowParseFailure): string {
  return `row ${f.rowIndex + 1}: ${f.reason}`;
}

/**
 * Commit an import: parse+validate every row under `mapping`, then upsert
 * each valid row into `external_estimate` by date (idempotent — re-running
 * this on the same file, or an overlapping later export, overwrites
 * same-day values rather than duplicating rows since `date` is the primary
 * key). Never throws for row-level problems — every bad row is reported in
 * `skipReasons` instead (task brief: "never throw into the UI"). A thrown
 * error here would only come from an actual DB failure, which the caller
 * (SettingsScreen) already wraps in a try/catch same as every other import
 * action in this app.
 */
export async function commitZeppImport(
  db: Database,
  rawRows: readonly Record<string, string>[],
  mapping: ColumnMapping,
  source: string = 'zepp'
): Promise<ZeppImportResult> {
  const { rows, failures } = parseZeppRows(rawRows, mapping);

  await externalEstimateRepo.upsertMany(
    db,
    rows.map((r) => ({
      date: r.date,
      source,
      tdee_est: r.tdee_est,
      active_kcal: r.active_kcal,
      steps: r.steps,
      sleep_minutes: r.sleep_minutes,
      readiness: r.readiness,
    }))
  );

  const ambiguityNotes = new Set<string>();
  for (const row of rows) {
    if (row.ambiguityNote) ambiguityNotes.add(row.ambiguityNote);
  }

  return {
    rowsImported: rows.length,
    rowsSkipped: failures.length,
    skipReasons: failures.map(failureToMessage),
    ambiguityNotes: [...ambiguityNotes],
  };
}
