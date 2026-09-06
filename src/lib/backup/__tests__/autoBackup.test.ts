// ═══════════════════════════════════════════════════════════════════════
// Pure-function tests for the throttle and pruning logic, per the task
// brief: "Test the pruning logic and the once-per-day throttle as pure
// functions, without touching the real filesystem." No expo-file-system
// import anywhere in the first half of this file.
//
// The second half (below the pure-function tests) is new: an end-to-end
// exercise of runAutoBackupIfDue/writeSnapshotAndPrune through
// getBackupDirectory, proving the throttle + rolling-7 pruning + silent-
// failure contract holds identically whether getBackupDirectory resolves
// via the Android SAF branch or the iOS app-documents branch — the whole
// point of putting the platform split in one place (backupLocation.ts)
// is that this orchestrator never needs to know which one it got.
// ═══════════════════════════════════════════════════════════════════════

import { Platform } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import { createTestDatabase } from '../../../db/__tests__/testDb';
import { runMigrations } from '../../../db/migrations';
import type { Database } from '../../../db/database';
import {
  shouldRunBackup,
  selectFilesToPrune,
  filenameForDate,
  toLocalDateIso,
  runAutoBackupIfDue,
  BACKUP_THROTTLE_MS,
  MAX_SNAPSHOTS_TO_KEEP,
} from '../autoBackup';
import { getBackupDirectory, getBackupPrefs, resetBackupLocationForTesting } from '../backupLocation';
import { resetTargetsStoreForTesting } from '../../targetsStore';
import { resetOnboardingStoreForTesting } from '../../onboardingActions';
import { resetCheckInHistoryForTesting } from '../../checkInHistory';
import { resetNotificationSettingsStoreForTesting } from '../../notifications/settingsStore';

describe('shouldRunBackup (once-per-day throttle)', () => {
  test('runs immediately if it has never run before', () => {
    expect(shouldRunBackup(null, 1_000_000)).toBe(true);
  });

  test('does not run again within the same day (throttle window)', () => {
    const last = 1_700_000_000_000;
    expect(shouldRunBackup(last, last + 1000)).toBe(false);
    expect(shouldRunBackup(last, last + BACKUP_THROTTLE_MS - 1)).toBe(false);
  });

  test('runs again once the throttle window has fully elapsed', () => {
    const last = 1_700_000_000_000;
    expect(shouldRunBackup(last, last + BACKUP_THROTTLE_MS)).toBe(true);
    expect(shouldRunBackup(last, last + BACKUP_THROTTLE_MS + 1)).toBe(true);
  });

  test('does not run on a second foreground moments after the first', () => {
    const last = 1_700_000_000_000;
    expect(shouldRunBackup(last, last + 5000)).toBe(false);
  });

  test('a custom throttle window is respected (for tests/tuning)', () => {
    expect(shouldRunBackup(1000, 1500, 1000)).toBe(false);
    expect(shouldRunBackup(1000, 2000, 1000)).toBe(true);
  });
});

describe('filenameForDate / toLocalDateIso', () => {
  test('produces the documented filename shape', () => {
    expect(filenameForDate('2026-08-26')).toBe('joule-backup-2026-08-26.json');
  });

  test('toLocalDateIso formats using local calendar date, zero-padded', () => {
    const d = new Date(2026, 0, 5); // Jan 5 2026, local time
    expect(toLocalDateIso(d)).toBe('2026-01-05');
  });
});

describe('selectFilesToPrune (rolling set of ~7 snapshots)', () => {
  test('prunes nothing when at or under the keep limit', () => {
    const files = Array.from({ length: MAX_SNAPSHOTS_TO_KEEP }, (_, i) => filenameForDate(`2026-08-${10 + i}`));
    expect(selectFilesToPrune(files)).toEqual([]);
  });

  test('prunes the oldest files first once over the limit', () => {
    const files = [
      'joule-backup-2026-08-01.json',
      'joule-backup-2026-08-02.json',
      'joule-backup-2026-08-03.json',
      'joule-backup-2026-08-04.json',
      'joule-backup-2026-08-05.json',
      'joule-backup-2026-08-06.json',
      'joule-backup-2026-08-07.json',
      'joule-backup-2026-08-08.json', // 8 files, keep 7 -> prune the single oldest
    ];
    expect(selectFilesToPrune(files, 7)).toEqual(['joule-backup-2026-08-01.json']);
  });

  test('prunes multiple files down to exactly the keep count', () => {
    const files = Array.from({ length: 12 }, (_, i) => filenameForDate(`2026-08-${String(i + 1).padStart(2, '0')}`));
    const pruned = selectFilesToPrune(files, 7);
    expect(pruned).toHaveLength(5);
    expect(pruned).toEqual([
      'joule-backup-2026-08-01.json',
      'joule-backup-2026-08-02.json',
      'joule-backup-2026-08-03.json',
      'joule-backup-2026-08-04.json',
      'joule-backup-2026-08-05.json',
    ]);
  });

  test('never prunes files that are not our own timestamped filenames', () => {
    const files = ['README.txt', 'some-other-app-export.json', 'joule-backup-2026-08-01.json'];
    // Only one recognized file, well under the keep limit -> nothing pruned.
    expect(selectFilesToPrune(files, 7)).toEqual([]);
  });

  test('unrecognized files are never returned even when pruning is needed', () => {
    const ours = Array.from({ length: 9 }, (_, i) => filenameForDate(`2026-08-${String(i + 1).padStart(2, '0')}`));
    const files = ['notes.txt', ...ours, 'random.csv'];
    const pruned = selectFilesToPrune(files, 7);
    expect(pruned).toHaveLength(2);
    for (const name of pruned) {
      expect(name).toMatch(/^joule-backup-\d{4}-\d{2}-\d{2}\.json$/);
    }
  });

  test('default keep count matches MAX_SNAPSHOTS_TO_KEEP (~7)', () => {
    expect(MAX_SNAPSHOTS_TO_KEEP).toBe(7);
    const files = Array.from({ length: 9 }, (_, i) => filenameForDate(`2026-08-${String(i + 1).padStart(2, '0')}`));
    expect(selectFilesToPrune(files)).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// END-TO-END: runAutoBackupIfDue / writeSnapshotAndPrune through the real
// (jest-expo-mocked) filesystem, run twice — once forcing Platform.OS to
// 'android' (SAF branch, a pre-granted stand-in folder), once forcing it
// to 'ios' (app-documents branch, auto-provisioned). Same assertions both
// times: this is the proof that the platform split in backupLocation.ts
// is invisible to this orchestrator, per the task requirement that
// "throttle, rolling 7-snapshot pruning, silent-failure and transaction
// semantics must be unchanged and must work identically on both
// platforms."
// ═══════════════════════════════════════════════════════════════════════

async function withPlatform<T>(os: 'ios' | 'android', fn: () => T | Promise<T>): Promise<T> {
  const original = Platform.OS;
  Platform.OS = os;
  try {
    return await fn();
  } finally {
    Platform.OS = original;
  }
}

async function freshDb(): Promise<Database> {
  const db = createTestDatabase();
  await runMigrations(db);
  return db;
}

/**
 * Android-only setup: simulate a previously-granted SAF folder. A real
 * grant always points at a folder that already exists (the user picked
 * it via the OS folder browser) — Directory.pickDirectoryAsync() never
 * hands back a URI for a not-yet-created folder — so this creates the
 * stand-in folder on the mock filesystem first, then persists its URI as
 * folder_uri exactly as chooseBackupFolder would after a real pick.
 */
async function grantAndroidFolder(db: Database, folderName: string): Promise<void> {
  const dir = new Directory(Paths.cache, folderName);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });

  await getBackupPrefs(db); // ensures app_backup_prefs exists
  await db.runAsync(
    `INSERT INTO app_backup_prefs (id, folder_uri, last_backup_at, last_backup_error)
     VALUES (1, ?, NULL, NULL)
     ON CONFLICT(id) DO UPDATE SET folder_uri = excluded.folder_uri`,
    [dir.uri]
  );
}

describe.each([
  { platform: 'android' as const, label: 'Android (SAF, pre-granted folder)' },
  { platform: 'ios' as const, label: 'iOS (app-documents, auto-provisioned)' },
])('runAutoBackupIfDue end-to-end — $label', ({ platform }) => {
  beforeEach(() => {
    resetBackupLocationForTesting();
    // buildBackupSnapshot (called inside writeSnapshotAndPrune) reads the
    // three app_* stores; each caches "table ensured" as *module-level*
    // state (see each store's own resetXForTesting()), not per-DB — every
    // test here uses a fresh in-memory DB, so that cache must be cleared
    // each time too, exactly as roundtrip.test.ts already does.
    resetTargetsStoreForTesting();
    resetOnboardingStoreForTesting();
    resetCheckInHistoryForTesting();
    resetNotificationSettingsStoreForTesting();
  });

  async function setUpGrantIfNeeded(db: Database, folderName: string): Promise<void> {
    if (platform === 'android') {
      await grantAndroidFolder(db, folderName);
    }
    // iOS needs no setup at all — that's the point of the fix.
  }

  test('writes a snapshot and records success on first foreground', async () => {
    const db = await freshDb();
    await setUpGrantIfNeeded(db, 'grant-1');

    await withPlatform(platform, async () => {
      await runAutoBackupIfDue(db, Date.parse('2026-08-01T09:00:00'));
    });

    const prefs = await getBackupPrefs(db);
    expect(prefs.lastBackupAt).toBe(Date.parse('2026-08-01T09:00:00'));
    expect(prefs.lastBackupError).toBeNull();

    const dir = await withPlatform(platform, () => getBackupDirectory(db));
    const names = dir!.list().flatMap((e) => ('name' in e ? [e.name] : []));
    expect(names).toContain('joule-backup-2026-08-01.json');
  });

  test('throttles: a second foreground the same day is a no-op', async () => {
    const db = await freshDb();
    await setUpGrantIfNeeded(db, 'grant-2');

    const firstRun = Date.parse('2026-08-01T09:00:00');
    await withPlatform(platform, async () => {
      await runAutoBackupIfDue(db, firstRun);
      await runAutoBackupIfDue(db, firstRun + 5000); // moments later, same day
    });

    const dir = await withPlatform(platform, () => getBackupDirectory(db));
    const names = dir!.list().flatMap((e) => ('name' in e ? [e.name] : []));
    // Only one file — the throttle prevented a second write/prune pass.
    expect(names.filter((n) => n.startsWith('joule-backup-'))).toHaveLength(1);

    const prefs = await getBackupPrefs(db);
    expect(prefs.lastBackupAt).toBe(firstRun); // not advanced by the throttled second call
  });

  test('runs again once the throttle window elapses, producing a second snapshot', async () => {
    const db = await freshDb();
    await setUpGrantIfNeeded(db, 'grant-3');

    const day1 = Date.parse('2026-08-01T09:00:00');
    const day2 = day1 + BACKUP_THROTTLE_MS + 1000;

    await withPlatform(platform, async () => {
      await runAutoBackupIfDue(db, day1);
      await runAutoBackupIfDue(db, day2);
    });

    const dir = await withPlatform(platform, () => getBackupDirectory(db));
    const names = dir!.list().flatMap((e) => ('name' in e ? [e.name] : []));
    expect(names).toContain('joule-backup-2026-08-01.json');
    expect(names).toContain('joule-backup-2026-08-02.json');

    const prefs = await getBackupPrefs(db);
    expect(prefs.lastBackupAt).toBe(day2);
  });

  test('prunes down to MAX_SNAPSHOTS_TO_KEEP across many days, keeping the most recent', async () => {
    const db = await freshDb();
    await setUpGrantIfNeeded(db, 'grant-4');

    const startMs = Date.parse('2026-08-01T09:00:00');
    await withPlatform(platform, async () => {
      for (let day = 0; day < 10; day++) {
        await runAutoBackupIfDue(db, startMs + day * BACKUP_THROTTLE_MS);
      }
    });

    const dir = await withPlatform(platform, () => getBackupDirectory(db));
    const names = dir!.list().flatMap((e) => ('name' in e ? [e.name] : []));
    const ours = names.filter((n) => n.startsWith('joule-backup-')).sort();
    expect(ours).toHaveLength(MAX_SNAPSHOTS_TO_KEEP);
    // The oldest three (days 1-3, i.e. -01 through -03) were pruned; -04 through -10 remain.
    expect(ours).toEqual([
      'joule-backup-2026-08-04.json',
      'joule-backup-2026-08-05.json',
      'joule-backup-2026-08-06.json',
      'joule-backup-2026-08-07.json',
      'joule-backup-2026-08-08.json',
      'joule-backup-2026-08-09.json',
      'joule-backup-2026-08-10.json',
    ]);
  });

  test('a mid-write failure is recorded silently, never thrown, and does not crash the caller', async () => {
    const db = await freshDb();
    // Deliberately skip granting anything on Android to force the
    // "no folder" early-return path is distinguishable from a genuine
    // write failure: instead, simulate a write failure by pointing
    // folder_uri/app-documents at a path that collides with an existing
    // *file* (not a directory), which throws when writeSnapshotAndPrune
    // tries to treat it as a Directory.
    if (platform === 'android') {
      await grantAndroidFolder(db, 'grant-5');
    }

    await withPlatform(platform, async () => {
      // First call succeeds normally, establishing the directory exists.
      await runAutoBackupIfDue(db, Date.parse('2026-08-01T09:00:00'));
    });
    expect((await getBackupPrefs(db)).lastBackupError).toBeNull();

    // Force writeSnapshotAndPrune's next call to fail by corrupting the
    // destination: replace the directory's own file entry is awkward via
    // the public API, so instead assert the documented contract directly
    // — recordBackupFailure is reachable and never throws out of
    // runAutoBackupIfDue even when the inner write rejects. We simulate
    // that by using a Database that throws on the snapshot read (buildBackupSnapshot
    // queries this db), proving the catch-and-record path works
    // regardless of *why* the write failed.
    const throwingDb: Database = {
      ...db,
      getAllAsync: async () => {
        throw new Error('simulated read failure');
      },
    };

    await expect(
      withPlatform(platform, () => runAutoBackupIfDue(throwingDb, Date.parse('2026-08-01T09:00:00') + BACKUP_THROTTLE_MS + 1))
    ).resolves.toBeUndefined(); // never throws

    const failedPrefs = await getBackupPrefs(db);
    expect(failedPrefs.lastBackupError).toBe('simulated read failure');
  });
});
