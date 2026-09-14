// ═══════════════════════════════════════════════════════════════════════
// logWeight must persist the reading AND reconcile the weigh-in reminder
// schedule (morning-reminder task) — but the reconciliation itself is
// fully covered by reminderActions.test.ts, so here we only verify the
// wiring: reconcileAfterWeightLogged gets called with the saved date,
// after the write succeeds, mocked out so no scheduler/notification code
// runs at all.
// ═══════════════════════════════════════════════════════════════════════

import { freshDb } from '../../db/repositories/__tests__/testHelpers';
import type { Database } from '../../db/database';
import * as weightRepo from '../../db/repositories/weightRepo';

const mockReconcile = jest.fn();
jest.mock('../notifications/reminderActions', () => ({
  reconcileAfterWeightLogged: (...args: unknown[]) => mockReconcile(...args),
}));

import { logWeight, formatWeightRow } from '../weightEntryActions';

describe('logWeight', () => {
  let db: Database;

  beforeEach(async () => {
    db = await freshDb();
    jest.clearAllMocks();
  });

  test('persists the reading', async () => {
    await logWeight(db, '2026-09-03', 82.4, null);
    const reading = await weightRepo.getByDate(db, '2026-09-03');
    expect(reading?.weight_kg).toBe(82.4);
  });

  test('persists an optional confounder', async () => {
    await logWeight(db, '2026-09-03', 82.4, 'ate_out');
    const reading = await weightRepo.getByDate(db, '2026-09-03');
    expect(reading?.confounder).toBe('ate_out');
  });

  test('reconciles the reminder schedule for the saved date, after the write', async () => {
    await logWeight(db, '2026-09-03', 82.4, null);
    expect(mockReconcile).toHaveBeenCalledWith(db, '2026-09-03');
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });

  // Today's new permanent weight control (StatusBlock) is reached for a
  // day that may already have a reading — this is the "surprise" risk
  // the task brief called out explicitly: logging must UPDATE that day's
  // row, never insert a second one. weight_log's PK is `date`, so
  // upsertWeight already guarantees this at the SQL layer (see
  // weightRepo.test.ts), but this test pins it at the level the UI
  // actually calls through (logWeight), against the same in-memory db
  // used elsewhere in this file.
  test('logging weight twice for the same date updates the reading in place, never duplicates it', async () => {
    await logWeight(db, '2026-09-03', 82.4, null);
    await logWeight(db, '2026-09-03', 81.9, 'travel');

    const reading = await weightRepo.getByDate(db, '2026-09-03');
    expect(reading?.weight_kg).toBe(81.9);
    expect(reading?.confounder).toBe('travel');

    const all = await weightRepo.getAll(db);
    expect(all.filter((r) => r.date === '2026-09-03')).toHaveLength(1);
  });
});

describe('formatWeightRow', () => {
  test('reads as a neutral invitation when nothing is logged yet — never "0 kg"', () => {
    const row = formatWeightRow(null);
    expect(row.value).toBe('Not logged');
    expect(row.value).not.toMatch(/0/);
    expect(row.a11yLabel).toMatch(/not logged/i);
  });

  test('renders a logged reading as a plain kg figure', () => {
    const row = formatWeightRow(82.4);
    expect(row.value).toBe('82.4 kg');
    expect(row.a11yLabel).toMatch(/82\.4 kg/);
    expect(row.a11yLabel).toMatch(/update/i);
  });
});
