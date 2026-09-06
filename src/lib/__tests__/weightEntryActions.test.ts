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

import { logWeight } from '../weightEntryActions';

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
});
