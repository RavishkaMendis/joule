// ═══════════════════════════════════════════════════════════════════════
// EXPORT/IMPORT UI ACTIONS — PRD §12: "full JSON dump + per-table CSV, via
// share sheet. Available from day one... The point of this app is
// escaping a subscription. Don't build a new prison."
//
// src/db/export.ts already builds the strings/objects (deliberately, per
// its own header comment, without touching expo-sharing/expo-file-system
// — that wiring is explicitly left to "a screens/App concern"). This
// module is that concern: writes the built JSON/CSV to a cache file, then
// hands it to the OS share sheet via expo-sharing.
// ═══════════════════════════════════════════════════════════════════════

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Database } from '../db/database';
import { exportFullJson, exportAllCsv, importWeightLogCsv, importDayIntakeCsv, type ImportResult } from '../db/export';
import { LATEST_SCHEMA_VERSION } from '../db/migrations';

async function writeAndShare(filename: string, contents: string, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
  }
  // If sharing isn't available (e.g. some Android emulators), the file
  // still exists in the cache dir — better than silently failing, though
  // the user has no direct way to retrieve it without a share sheet.
}

/** Export everything as a single JSON file, offered via the OS share sheet. */
export async function exportJsonAndShare(db: Database, timestamp: number = Date.now()): Promise<void> {
  const data = await exportFullJson(db, LATEST_SCHEMA_VERSION);
  const filename = `joule-export-${timestamp}.json`;
  await writeAndShare(filename, JSON.stringify(data, null, 2), 'application/json');
}

/** Export every table as its own CSV file, sharing them one at a time (the share sheet only takes one URI at a time via shareAsync). */
export async function exportAllCsvAndShare(db: Database, timestamp: number = Date.now()): Promise<string[]> {
  const csvByTable = await exportAllCsv(db);
  const filenames: string[] = [];
  for (const [table, csv] of Object.entries(csvByTable)) {
    const filename = `joule-${table}-${timestamp}.csv`;
    await writeAndShare(filename, csv, 'text/csv');
    filenames.push(filename);
  }
  return filenames;
}

export type ImportTarget = 'weight_log' | 'day_intake';

/** Import a CSV file's text content into weight_log or day_intake (PRD §12). */
export async function importCsvText(db: Database, target: ImportTarget, csvText: string): Promise<ImportResult> {
  if (target === 'weight_log') return importWeightLogCsv(db, csvText);
  return importDayIntakeCsv(db, csvText);
}
