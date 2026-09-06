import { createTestDatabase } from '../../db/__tests__/testDb';
import { runMigrations } from '../../db/migrations';
import { getLastCheckIn, recordCheckIn, resetCheckInHistoryForTesting } from '../checkInHistory';
import type { TDEEResult } from '../../engine/types';

function makeTDEEResult(overrides: Partial<TDEEResult> = {}): TDEEResult {
  return {
    tdee: 2470,
    confidenceLow: 2380,
    confidenceHigh: 2560,
    trendKgPerWeek: -0.42,
    smoothedWeightKg: 80,
    dataQuality: 'stable',
    daysOfData: 35,
    loggedDaysInWindow: 30,
    ...overrides,
  };
}

describe('checkInHistory', () => {
  beforeEach(() => {
    resetCheckInHistoryForTesting();
  });

  test('getLastCheckIn returns null before any check-in has been recorded', async () => {
    const db = createTestDatabase();
    await runMigrations(db);
    expect(await getLastCheckIn(db)).toBeNull();
  });

  test('recordCheckIn persists the exact TDEEResult, readable back unchanged', async () => {
    const db = createTestDatabase();
    await runMigrations(db);
    const tdee = makeTDEEResult({ tdee: 2470, trendKgPerWeek: -0.42 });

    await recordCheckIn(db, tdee, 0.5, 1000);
    const entry = await getLastCheckIn(db);

    expect(entry).not.toBeNull();
    expect(entry?.tdee).toEqual(tdee);
    expect(entry?.goalRateKgPerWeek).toBe(0.5);
    expect(entry?.recordedAt).toBe(1000);
  });

  test('a second recordCheckIn overwrites the first (only the latest matters for next week\'s comparison)', async () => {
    const db = createTestDatabase();
    await runMigrations(db);

    await recordCheckIn(db, makeTDEEResult({ tdee: 2470 }), 0.5, 1000);
    await recordCheckIn(db, makeTDEEResult({ tdee: 2510 }), 0.3, 2000);

    const entry = await getLastCheckIn(db);
    expect(entry?.tdee.tdee).toBe(2510);
    expect(entry?.goalRateKgPerWeek).toBe(0.3);
    expect(entry?.recordedAt).toBe(2000);
  });

  test('this history survives a rate change — the correctness bug it exists to prevent', async () => {
    // Scenario: week 1 check-in at rate 0.5 records TDEE 2470. Between
    // week 1 and week 2, the user adjusts their rate to 0.2 via "Adjust
    // rate". Week 2's comparison must still see TDEE 2470 as "previous",
    // NOT a value reconstructed from (old target, NEW rate 0.2), which
    // would silently misattribute the target's movement to the wrong
    // cause.
    const db = createTestDatabase();
    await runMigrations(db);

    await recordCheckIn(db, makeTDEEResult({ tdee: 2470 }), 0.5, 1000);
    // Simulate "Adjust rate" changing the goal rate without a new TDEE
    // measurement yet — recordCheckIn is called with the SAME tdee but a
    // new rate, mirroring WeeklyCheckInScreen's handleAdjustRate.
    await recordCheckIn(db, makeTDEEResult({ tdee: 2470 }), 0.2, 1500);

    const entry = await getLastCheckIn(db);
    expect(entry?.tdee.tdee).toBe(2470); // TDEE itself unaffected by the rate change
    expect(entry?.goalRateKgPerWeek).toBe(0.2); // but the rate on record is the new one
  });
});
