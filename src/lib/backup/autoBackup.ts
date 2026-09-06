// ═══════════════════════════════════════════════════════════════════════
// AUTOMATIC SNAPSHOTS — on-foreground, throttled, rolling backup set.
//
// Task brief: "Write a full JSON snapshot on app foreground, throttled to
// at most once per day... Keep a rolling set of the last ~7 snapshots...
// pruning older ones... Never block the UI or app start. Failures must be
// silent-but-recorded, never a crash or a modal. If no folder has been
// granted, do nothing at all."
//
// This file is split deliberately into pure functions (shouldRunBackup,
// filenameForDate, selectFilesToPrune) that touch neither the filesystem
// nor the clock's ambient Date.now(), and an impure orchestrator
// (runAutoBackupIfDue) that does. The pure half is what
// src/lib/backup/__tests__/autoBackup.test.ts exercises directly — no
// mocking expo-file-system needed to prove the throttle/pruning logic is
// correct.
// ═══════════════════════════════════════════════════════════════════════

import { Directory, File } from 'expo-file-system';
import type { Database } from '../../db/database';
import { buildBackupSnapshot, serializeSnapshot } from './snapshot';
import { getBackupDirectory, getBackupPrefs, recordBackupSuccess, recordBackupFailure } from './backupLocation';

/** Once per day, not once per launch — repeated foregrounds within the same day are no-ops. */
export const BACKUP_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** "A single overwritten file is not a backup" — keep this many timestamped snapshots before pruning. */
export const MAX_SNAPSHOTS_TO_KEEP = 7;

const FILENAME_PREFIX = 'joule-backup-';
const FILENAME_SUFFIX = '.json';
// Matches joule-backup-YYYY-MM-DD.json, capturing the date for sorting.
const FILENAME_PATTERN = /^joule-backup-(\d{4}-\d{2}-\d{2})\.json$/;

/** Pure: should a backup run right now, given when the last one happened? `lastRunAtMs` null means "never". */
export function shouldRunBackup(lastRunAtMs: number | null, nowMs: number, throttleMs: number = BACKUP_THROTTLE_MS): boolean {
  if (lastRunAtMs === null) return true;
  return nowMs - lastRunAtMs >= throttleMs;
}

/** Pure: the YYYY-MM-DD-stamped filename for a snapshot taken at `dateIso` (local calendar date). */
export function filenameForDate(dateIso: string): string {
  return `${FILENAME_PREFIX}${dateIso}${FILENAME_SUFFIX}`;
}

/** Pure: local yyyy-mm-dd for a given instant, matching the engine's date convention (local time, not UTC). */
export function toLocalDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Pure: given the current filenames present in the backup folder, return
 * the subset that should be deleted to keep at most `keep` of our own
 * timestamped snapshots. Non-matching filenames (anything the user or
 * another app put in that folder) are left alone entirely — this module
 * only ever touches files it recognizes as its own. Oldest-by-date-in-
 * filename are pruned first; ties (shouldn't happen in practice, since
 * the throttle limits us to one per day) are broken by string order.
 */
export function selectFilesToPrune(existingFilenames: string[], keep: number = MAX_SNAPSHOTS_TO_KEEP): string[] {
  const ours = existingFilenames
    .map((name) => ({ name, match: FILENAME_PATTERN.exec(name) }))
    .filter((x): x is { name: string; match: RegExpExecArray } => x.match !== null)
    .map((x) => ({ name: x.name, date: x.match[1] }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));

  if (ours.length <= keep) return [];
  return ours.slice(0, ours.length - keep).map((x) => x.name);
}

/**
 * Impure orchestrator: call on every app-foreground event. Silently does
 * nothing if no folder has been granted (Android, before first grant —
 * on iOS getBackupDirectory never returns null, see backupLocation.ts),
 * or if the throttle says it's too soon. Every failure (permission
 * revoked, folder deleted, disk full, write error) is caught and
 * recorded via recordBackupFailure rather than thrown — this must never
 * crash the app or interrupt startup, per the task brief. Never awaited
 * by a caller that needs it to block startup; callers should
 * fire-and-forget this from a foreground listener.
 */
export async function runAutoBackupIfDue(db: Database, nowMs: number = Date.now()): Promise<void> {
  try {
    const dir = await getBackupDirectory(db);
    if (!dir) return; // No folder granted yet (Android-only state) — do nothing at all, per brief.

    const prefs = await getBackupPrefs(db);
    if (!shouldRunBackup(prefs.lastBackupAt, nowMs)) return;

    await writeSnapshotAndPrune(db, dir, nowMs);
    await recordBackupSuccess(db, nowMs);
  } catch (e) {
    // Silent-but-recorded: never throw out of here. The failure is
    // visible in Settings (last-backup timestamp stops advancing, and/or
    // an error string is shown) but never a modal or a crash.
    try {
      await recordBackupFailure(db, e instanceof Error ? e.message : String(e));
    } catch {
      // If even recording the failure fails (e.g. DB itself is in a bad
      // state), there's nothing further this function can safely do —
      // swallow rather than throw, matching "never a crash".
    }
  }
}

/** Writes one snapshot file into `dir` and prunes older ones beyond MAX_SNAPSHOTS_TO_KEEP. Exported for direct testing/reuse by "Back up now". */
export async function writeSnapshotAndPrune(db: Database, dir: Directory, atMs: number = Date.now()): Promise<void> {
  const snapshot = await buildBackupSnapshot(db);
  const filename = filenameForDate(toLocalDateIso(new Date(atMs)));
  const json = serializeSnapshot(snapshot);

  const file = new File(dir, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(json);

  const existingNames = dir.list().flatMap((entry) => ('name' in entry ? [entry.name] : []));
  const toDelete = selectFilesToPrune(existingNames);
  for (const name of toDelete) {
    try {
      new File(dir, name).delete();
    } catch {
      // Best-effort pruning — a file that can't be deleted this run just
      // gets picked up again next run; it must not fail the backup that
      // just succeeded.
    }
  }
}
