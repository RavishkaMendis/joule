// ═══════════════════════════════════════════════════════════════════════
// Minimal RFC 4180-ish CSV codec.
//
// Deliberately hand-rolled (no dependency) but NOT a naive `split(',')` /
// `join(',')`. Handles:
//  - fields containing commas, double quotes, and newlines (quoted +
//    doubled-quote escaping, per RFC 4180)
//  - `\r\n` and `\n` line endings on parse
//  - `null`/`undefined` values serialized as empty fields, parsed back
//    as empty string (callers coerce per-column as needed — this module
//    only knows about strings)
//
// Used by src/db/export.ts for per-table CSV export and CSV import of
// weight_log / day_intake (PRD §12).
// ═══════════════════════════════════════════════════════════════════════

export type CsvRow = Record<string, string>;

function needsQuoting(field: string): boolean {
  return field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r');
}

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (!needsQuoting(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

/** Serialize an array of plain objects to CSV text, using `columns` as the header/row order. */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>, columns: readonly string[]): string {
  const header = columns.map(escapeField).join(',');
  const lines = rows.map((row) => columns.map((col) => escapeField(row[col])).join(','));
  return [header, ...lines].join('\r\n') + (rows.length > 0 ? '\r\n' : '');
}

/**
 * Parse CSV text into an array of row objects keyed by the header row.
 * Handles quoted fields containing commas, quotes (as `""`), and embedded
 * newlines. Throws on a malformed quoted field (unterminated quote).
 */
export function parseCsv(text: string): CsvRow[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  return dataRows
    .filter((row) => !(row.length === 1 && row[0] === ''))
    .map((row) => {
      const obj: CsvRow = {};
      header.forEach((col, i) => {
        obj[col] = row[i] ?? '';
      });
      return obj;
    });
}

/** Parse raw CSV text into an array of string arrays (no header interpretation). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  // Normalize CRLF/CR to LF up front is unsafe inside quoted fields (would
  // alter data), so we scan character-by-character instead.
  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Treat \r\n or lone \r as one line break.
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      if (text[i] === '\n') i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw new Error('parseCsv: unterminated quoted field');
  }

  // Flush the final field/row if the text didn't end with a line break.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
