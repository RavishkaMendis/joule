// ═══════════════════════════════════════════════════════════════════════
// BACKUP LOCATION — the single place that decides *where* snapshots go,
// split by platform. Every other module in src/lib/backup and every
// screen that touches backups goes through this file rather than
// re-deriving the platform decision itself (no scattered
// `Platform.OS === 'ios'` checks — see task brief).
//
// ─── Why two strategies exist ───────────────────────────────────────────
// app-private storage (Paths.document, Paths.cache) is exactly what an
// uninstall wipes on Android — writing backups there would be no backup
// at all, just a slower way to lose the same data. The fix on Android is
// Storage Access Framework: the user picks a real folder (Documents, a
// synced Drive folder, an SD card, wherever) via
// Directory.pickDirectoryAsync(), and the app is granted a `content://`
// URI it can keep writing to across app restarts and reinstalls, because
// the folder itself lives outside the app's private sandbox.
//
// Confirmed against the installed expo-file-system (~57.0.5, the new
// File/Directory/Paths API — see src/lib/exportActions.ts, already using
// it elsewhere in this app):
//   - node_modules/expo-file-system/build/Directory.d.ts declares
//     `static pickDirectoryAsync(initialUri?: string): Promise<Directory>`.
//   - node_modules/expo-file-system/android/src/main/java/expo/modules/
//     filesystem/FilePickerContract.kt shows the native picker calls
//     `contentResolver.takePersistableUriPermission(uri, takeFlags)`
//     itself, immediately after the user picks a folder — this is the
//     Android API that makes a SAF grant survive app/device restarts.
//     So the persistable permission is taken automatically by the
//     library; there is no separate native call this module needs to
//     make. All this module has to do is remember the returned URI and
//     reconstruct `new Directory(uri)` from it on the next launch —
//     Android will recognize the URI still carries a persisted grant.
//
// ─── iOS is different, not "the same but worse" ─────────────────────────
// node_modules/expo-file-system/build/internal/NativeFileSystem.types.d.ts
// documents it plainly on NativeFileSystemDirectory.pickDirectoryAsync:
// "On iOS, the selected directory grants temporary read and write access
// for the current app session only. After the app restarts, you must
// prompt the user again to regain access." A picked SAF-style grant on
// iOS is *session-only* — after the very next app restart the grant is
// gone, silently. There is no event this module can subscribe to that
// fires when that happens; a write simply starts failing. Before this
// module existed, that failure surfaced as "last backup" quietly going
// stale in Settings, which is the worst possible failure mode for a
// backup feature (see task brief).
//
// So on iOS we don't pick a directory at all. We write into the app's
// own documents directory (`Paths.document`, a plain `file://` URI, no
// grant to lapse) under a `joule-backups` subfolder. This looks like
// exactly the "app-private storage an uninstall wipes" trap the SAF
// detour exists to avoid on Android — except iOS is different at the OS
// level: the app's container (including Paths.document) is included in
// the user's iCloud/device/iTunes backup **by default** — no
// NSURLIsExcludedFromBackupKey / isExcludedFromBackup flag is set
// anywhere in this codebase (confirmed: no reference to that key or
// method in this module, autoBackup.ts, restore.ts, or anywhere else
// under src/). That default inclusion is exactly the protection SAF was
// providing on Android: the data survives a reinstall or a new device,
// automatically, with no folder to pick and no grant to lapse.
//
// This *does* mean an iOS user who has iCloud Backup (or "Back Up This
// iPhone" for Finder/iTunes backups) turned off entirely gets none of
// that protection — Paths.document is then exactly as fragile as
// app-private storage always is, and nothing in this codebase can detect
// or warn about that (there is no public API to ask "is device backup
// enabled"). SettingsScreen's copy is written to be honest about this
// rather than imply blanket safety.
//
// ─── Where the strategy split actually lives ────────────────────────────
// `getBackupDirectory` is the one function autoBackup.ts and the UI call.
// On Android it defers to the existing SAF-grant lookup (unchanged
// behaviour, unchanged return-null-if-nothing-granted-yet contract). On
// iOS it always resolves to the app-documents subfolder, creating it on
// first use — there is no "not set up yet" state to represent, so it
// never returns null. `getBackupSetupState` tells callers (chiefly
// SettingsScreen) which UI to show without them re-deriving the platform
// check themselves.
//
// The granted URI (Android only) plus last-run bookkeeping (both
// platforms) is stored in the same tiny additive `app_backup_prefs`
// table as before, following the exact pattern src/lib/targetsStore.ts /
// checkInHistory.ts / onboardingActions.ts already use for app-level
// state that doesn't belong in src/db/schema.ts.
// ═══════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import type { Database } from '../../db/database';

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_backup_prefs (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  folder_uri          TEXT,
  last_backup_at      INTEGER,
  last_backup_error   TEXT
);
`;

type PrefsRow = {
  id: 1;
  folder_uri: string | null;
  last_backup_at: number | null;
  last_backup_error: string | null;
};

export type BackupPrefs = {
  folderUri: string | null;
  lastBackupAt: number | null;
  lastBackupError: string | null;
};

/**
 * Which storage strategy this platform uses. Exported so tests (and, if
 * ever needed, UI) can assert against it directly instead of re-deriving
 * `Platform.OS === 'ios'` themselves.
 *   - 'saf': Android's Storage Access Framework — user picks a folder,
 *     grant persists across restarts, `folderUri` in prefs is meaningful.
 *   - 'app-documents': iOS — no picker, no grant; snapshots live under
 *     the app's own documents directory, which iOS backs up by default.
 */
export type BackupStrategyKind = 'saf' | 'app-documents';

export function getBackupStrategyKind(): BackupStrategyKind {
  return Platform.OS === 'ios' ? 'app-documents' : 'saf';
}

/** Subfolder name under Paths.document used for the iOS strategy. Kept out of the document root so we never collide with anything else the app writes there. */
const IOS_BACKUP_SUBFOLDER = 'joule-backups';

/**
 * What SettingsScreen needs to decide what to render: whether folder
 * selection is a meaningful concept on this platform at all, plus the
 * usual bookkeeping. On iOS `requiresFolderSelection` is always false —
 * there is no "please choose a folder" step, ever.
 */
export type BackupSetupState = BackupPrefs & {
  strategy: BackupStrategyKind;
  requiresFolderSelection: boolean;
};

let ensuredTable = false;

async function ensureTable(db: Database): Promise<void> {
  if (ensuredTable) return;
  await db.execAsync(ENSURE_TABLE_SQL);
  ensuredTable = true;
}

function rowToPrefs(row: PrefsRow | null): BackupPrefs {
  if (!row) return { folderUri: null, lastBackupAt: null, lastBackupError: null };
  return { folderUri: row.folder_uri, lastBackupAt: row.last_backup_at, lastBackupError: row.last_backup_error };
}

/** Read the currently-granted backup folder (if any, Android-only concept) and last-run bookkeeping (both platforms). */
export async function getBackupPrefs(db: Database): Promise<BackupPrefs> {
  await ensureTable(db);
  const row = await db.getFirstAsync<PrefsRow>('SELECT * FROM app_backup_prefs WHERE id = 1');
  return rowToPrefs(row);
}

/** Everything SettingsScreen needs in one call: prefs plus which UI mode applies. */
export async function getBackupSetupState(db: Database): Promise<BackupSetupState> {
  const prefs = await getBackupPrefs(db);
  const strategy = getBackupStrategyKind();
  return { ...prefs, strategy, requiresFolderSelection: strategy === 'saf' };
}

async function savePrefs(db: Database, prefs: BackupPrefs): Promise<void> {
  await ensureTable(db);
  await db.runAsync(
    `INSERT INTO app_backup_prefs (id, folder_uri, last_backup_at, last_backup_error)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       folder_uri = excluded.folder_uri,
       last_backup_at = excluded.last_backup_at,
       last_backup_error = excluded.last_backup_error`,
    [prefs.folderUri, prefs.lastBackupAt, prefs.lastBackupError]
  );
}

/**
 * Opens the OS folder picker (SAF on Android) and persists the chosen
 * folder's URI for future auto-backups. Returns null if the user cancels
 * the picker — callers should treat that as "no change", not an error.
 *
 * Android-only by contract: this app never calls Directory.pickDirectoryAsync()
 * on iOS (that grant would just lapse on the next restart — the exact
 * defect this module exists to avoid), so this throws if invoked on iOS
 * rather than silently doing something misleading. SettingsScreen uses
 * `getBackupSetupState().requiresFolderSelection` to decide whether to
 * ever show the button that calls this at all.
 */
export async function chooseBackupFolder(db: Database): Promise<string | null> {
  if (getBackupStrategyKind() !== 'saf') {
    throw new Error('chooseBackupFolder is not applicable on this platform — backups use the app documents directory instead.');
  }

  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    // Directory.pickDirectoryAsync rejects (PickerCancelledException) when
    // the user backs out of the picker — that's a normal outcome, not a
    // failure worth surfacing as an error.
    return null;
  }

  const prefs = await getBackupPrefs(db);
  await savePrefs(db, { ...prefs, folderUri: dir.uri, lastBackupError: null });
  return dir.uri;
}

/** Forget the granted folder (e.g. user wants to pick a different one, or revoke). Android-only concept; a no-op on iOS since there's nothing granted to forget. */
export async function clearBackupFolder(db: Database): Promise<void> {
  const prefs = await getBackupPrefs(db);
  await savePrefs(db, { ...prefs, folderUri: null });
}

/** Ensures (idempotent) and returns the iOS app-documents backup directory. Never touches SAF; never returns null. */
function getAppDocumentsBackupDirectory(): Directory {
  const dir = new Directory(Paths.document, IOS_BACKUP_SUBFOLDER);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

/**
 * Resolves the directory snapshots should be written to right now, for
 * whichever platform this is running on. This is the one function
 * autoBackup.ts and the UI call — neither needs to know the platform
 * split exists.
 *
 *   - Android ('saf'): reconstructs the granted Directory from its
 *     persisted content:// URI. Returns null if nothing has been granted
 *     yet (unchanged contract). Does not verify the grant is still valid
 *     (e.g. the user could have deleted the folder, or revoked access
 *     from Android's storage settings) — callers must handle a write
 *     throwing and treat it the same as "not currently backed up", not
 *     crash.
 *   - iOS ('app-documents'): always returns the app's own
 *     joule-backups/ subfolder under Paths.document, creating it on
 *     first call. Never null — there is no "not set up yet" state on
 *     iOS, which is the point: no user action, no grant to lapse.
 */
export async function getBackupDirectory(db: Database): Promise<Directory | null> {
  if (getBackupStrategyKind() === 'app-documents') {
    return getAppDocumentsBackupDirectory();
  }

  const prefs = await getBackupPrefs(db);
  if (!prefs.folderUri) return null;
  return new Directory(prefs.folderUri);
}

export async function recordBackupSuccess(db: Database, atMs: number): Promise<void> {
  const prefs = await getBackupPrefs(db);
  await savePrefs(db, { ...prefs, lastBackupAt: atMs, lastBackupError: null });
}

export async function recordBackupFailure(db: Database, message: string): Promise<void> {
  const prefs = await getBackupPrefs(db);
  await savePrefs(db, { ...prefs, lastBackupError: message });
}

/** Test-only: forget the "table ensured" cache. */
export function resetBackupLocationForTesting(): void {
  ensuredTable = false;
}
