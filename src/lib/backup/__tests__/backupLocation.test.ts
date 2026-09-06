// ═══════════════════════════════════════════════════════════════════════
// Tests for the DB-persisted half of backupLocation.ts, PLUS the platform
// split this file now owns: which strategy ('saf' vs 'app-documents')
// applies per Platform.OS, and that autoBackup/UI-facing behavior differs
// correctly between them.
//
// Does NOT test Directory.pickDirectoryAsync() itself — that opens a real
// native folder picker (Storage Access Framework on Android) and cannot
// be exercised meaningfully under jest-expo's mocked native module; the
// module header comment in backupLocation.ts documents, from reading the
// native FilePickerContract.kt source, that the persistable URI
// permission is taken by the library itself at pick time. What's tested
// here is everything this module controls: the persistence contract, and
// (new) the platform-strategy resolution and iOS's app-documents path,
// which IS fully exercisable — jest-expo backs File/Directory/Paths with
// a real (in-memory) mock filesystem, platform-agnostic at the mock
// level (confirmed: Paths.document/Directory.create/list all work
// identically regardless of Platform.OS, since expo-file-system's jest
// mock has no per-platform branching — only this app's own code does).
//
// Platform.OS is mocked by direct assignment (`Platform.OS = 'ios' |
// 'android'`) rather than jest.mock('react-native', ...): React Native's
// Platform.ios.js/Platform.android.js export OS as a plain writable
// property on a plain object (confirmed via
// node_modules/react-native/Libraries/Utilities/Platform.ios.js), so
// reassigning it and restoring afterwards is safe and is the standard
// pattern for this in RN test suites.
// ═══════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import { createTestDatabase } from '../../../db/__tests__/testDb';
import { runMigrations } from '../../../db/migrations';
import type { Database } from '../../../db/database';
import {
  getBackupPrefs,
  getBackupSetupState,
  getBackupStrategyKind,
  chooseBackupFolder,
  clearBackupFolder,
  getBackupDirectory,
  recordBackupSuccess,
  recordBackupFailure,
  resetBackupLocationForTesting,
} from '../backupLocation';

async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}

/**
 * Restores the real Platform.OS after a test forces it to a specific
 * value. Always awaits `fn()` before restoring — a bare try/finally
 * without the await would restore Platform.OS synchronously while the
 * async body is still pending, silently testing the wrong platform.
 */
async function withPlatform<T>(os: 'ios' | 'android', fn: () => T | Promise<T>): Promise<T> {
  const original = Platform.OS;
  Platform.OS = os;
  try {
    return await fn();
  } finally {
    Platform.OS = original;
  }
}

describe('backupLocation prefs persistence (platform-independent bookkeeping)', () => {
  beforeEach(() => {
    resetBackupLocationForTesting();
  });

  test('a brand-new DB has no granted folder and has never backed up', async () => {
    const db = await freshDb();
    const prefs = await getBackupPrefs(db);
    expect(prefs.folderUri).toBeNull();
    expect(prefs.lastBackupAt).toBeNull();
    expect(prefs.lastBackupError).toBeNull();
  });

  test('recordBackupSuccess persists the timestamp and clears any prior error', async () => {
    const db = await freshDb();
    await recordBackupFailure(db, 'disk full');
    expect((await getBackupPrefs(db)).lastBackupError).toBe('disk full');

    await recordBackupSuccess(db, 123456);
    const prefs = await getBackupPrefs(db);
    expect(prefs.lastBackupAt).toBe(123456);
    expect(prefs.lastBackupError).toBeNull();
  });

  test('recordBackupFailure persists an error message without touching lastBackupAt', async () => {
    const db = await freshDb();
    await recordBackupSuccess(db, 1000);
    await recordBackupFailure(db, 'permission revoked');

    const prefs = await getBackupPrefs(db);
    expect(prefs.lastBackupAt).toBe(1000); // unchanged
    expect(prefs.lastBackupError).toBe('permission revoked');
  });

  test('clearBackupFolder forgets the folder URI without touching backup history', async () => {
    const db = await freshDb();
    await recordBackupSuccess(db, 5000);
    // Simulate a previously-granted folder via the same persistence path
    // chooseBackupFolder uses internally (bypassing the actual native picker).
    await db.runAsync(
      `INSERT INTO app_backup_prefs (id, folder_uri, last_backup_at, last_backup_error)
       VALUES (1, 'content://tree/abc', 5000, NULL)
       ON CONFLICT(id) DO UPDATE SET folder_uri = excluded.folder_uri`
    );
    expect((await getBackupPrefs(db)).folderUri).toBe('content://tree/abc');

    await clearBackupFolder(db);
    const prefs = await getBackupPrefs(db);
    expect(prefs.folderUri).toBeNull();
    expect(prefs.lastBackupAt).toBe(5000); // history preserved
  });
});

describe('getBackupStrategyKind (the one place the platform split lives)', () => {
  test('resolves to "saf" on Android', async () => {
    await withPlatform('android', () => {
      expect(getBackupStrategyKind()).toBe('saf');
    });
  });

  test('resolves to "app-documents" on iOS', async () => {
    await withPlatform('ios', () => {
      expect(getBackupStrategyKind()).toBe('app-documents');
    });
  });
});

describe('getBackupDirectory — Android (SAF) branch, unchanged behaviour', () => {
  beforeEach(() => {
    resetBackupLocationForTesting();
  });

  test('returns null when nothing has been granted yet', async () => {
    const db = await freshDb();
    await withPlatform('android', async () => {
      expect(await getBackupDirectory(db)).toBeNull();
    });
  });

  test('reconstructs a Directory from the persisted content:// URI once granted', async () => {
    const db = await freshDb();
    await getBackupPrefs(db); // ensures app_backup_prefs exists before the raw INSERT below
    await db.runAsync(
      `INSERT INTO app_backup_prefs (id, folder_uri, last_backup_at, last_backup_error)
       VALUES (1, 'content://com.android.externalstorage.documents/tree/primary%3ABackups', NULL, NULL)`
    );

    await withPlatform('android', async () => {
      const dir = await getBackupDirectory(db);
      expect(dir).toBeInstanceOf(Directory);
      expect(dir?.uri).toContain('content://');
    });
  });

  test('chooseBackupFolder is the only way to populate folderUri (no auto-provisioning on Android)', async () => {
    const db = await freshDb();
    await withPlatform('android', async () => {
      expect(await getBackupDirectory(db)).toBeNull();
      const state = await getBackupSetupState(db);
      expect(state.requiresFolderSelection).toBe(true);
      expect(state.folderUri).toBeNull();
    });
  });
});

describe('getBackupDirectory — iOS (app-documents) branch, the new behaviour', () => {
  beforeEach(() => {
    resetBackupLocationForTesting();
  });

  test('never returns null, even with no prior grant and an untouched app_backup_prefs row', async () => {
    const db = await freshDb();
    await withPlatform('ios', async () => {
      const dir = await getBackupDirectory(db);
      expect(dir).toBeInstanceOf(Directory);
      expect(dir).not.toBeNull();
    });
  });

  test('resolves under Paths.document, not a content:// SAF URI', async () => {
    const db = await freshDb();
    await withPlatform('ios', async () => {
      const dir = await getBackupDirectory(db);
      expect(dir?.uri.startsWith(Paths.document.uri)).toBe(true);
      expect(dir?.uri).not.toContain('content://');
    });
  });

  test('the directory exists after resolution (auto-created, no user action)', async () => {
    const db = await freshDb();
    await withPlatform('ios', async () => {
      const dir = await getBackupDirectory(db);
      expect(dir?.exists).toBe(true);
    });
  });

  test('getBackupSetupState reports requiresFolderSelection: false on iOS regardless of folderUri', async () => {
    const db = await freshDb();
    await withPlatform('ios', async () => {
      const state = await getBackupSetupState(db);
      expect(state.requiresFolderSelection).toBe(false);
      expect(state.strategy).toBe('app-documents');
    });
  });

  test('chooseBackupFolder throws on iOS rather than silently doing nothing useful', async () => {
    const db = await freshDb();
    await withPlatform('ios', async () => {
      await expect(chooseBackupFolder(db)).rejects.toThrow();
    });
  });

  test('calling getBackupDirectory repeatedly is idempotent (does not throw on an already-existing directory)', async () => {
    const db = await freshDb();
    await withPlatform('ios', async () => {
      const first = await getBackupDirectory(db);
      const second = await getBackupDirectory(db);
      expect(first?.uri).toBe(second?.uri);
      expect(second?.exists).toBe(true);
    });
  });
});
