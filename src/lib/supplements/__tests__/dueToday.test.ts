import { buildDueTodayList } from '../dueToday';
import { serializeSchedule } from '../schedule';
import type { SupplementRow, SupplementLogRow } from '../../../db/types';

function supplement(overrides: Partial<SupplementRow>): SupplementRow {
  return {
    id: 'supp_1',
    name: 'Vitamin D',
    dose: '1000',
    unit: 'IU',
    schedule: serializeSchedule({ type: 'daily' }),
    kcal: 0,
    protein_g: 0,
    notes: null,
    is_active: 1,
    created_at: 1000,
    ...overrides,
  };
}

function log(overrides: Partial<SupplementLogRow>): SupplementLogRow {
  return {
    id: 'log_1',
    supplement_id: 'supp_1',
    date: '2026-09-07',
    logged_at: 2000,
    food_entry_id: null,
    ...overrides,
  };
}

const MONDAY = '2026-09-07';
const TUESDAY = '2026-09-08';

describe('buildDueTodayList', () => {
  it('includes a daily supplement, not logged', () => {
    const items = buildDueTodayList([supplement({})], [], MONDAY);
    expect(items).toEqual([{ supplement: supplement({}), due: true, logged: false }]);
  });

  it('includes a daily supplement, logged', () => {
    const s = supplement({ id: 'supp_1' });
    const items = buildDueTodayList([s], [log({ supplement_id: 'supp_1', date: MONDAY })], MONDAY);
    expect(items).toEqual([{ supplement: s, due: true, logged: true }]);
  });

  it('excludes archived supplements regardless of schedule or log state', () => {
    const s = supplement({ id: 'supp_1', is_active: 0 });
    const items = buildDueTodayList([s], [log({ supplement_id: 'supp_1', date: MONDAY })], MONDAY);
    expect(items).toEqual([]);
  });

  it('excludes a days_of_week supplement on a day it is not scheduled, when not logged', () => {
    const s = supplement({
      id: 'supp_1',
      schedule: serializeSchedule({ type: 'days_of_week', days: [1] }), // Monday only
    });
    const items = buildDueTodayList([s], [], TUESDAY);
    expect(items).toEqual([]);
  });

  it('includes a days_of_week supplement on its scheduled day', () => {
    const s = supplement({
      id: 'supp_1',
      schedule: serializeSchedule({ type: 'days_of_week', days: [1] }),
    });
    const items = buildDueTodayList([s], [], MONDAY);
    expect(items).toEqual([{ supplement: s, due: true, logged: false }]);
  });

  it('excludes an as_needed supplement that has not been logged today', () => {
    const s = supplement({ id: 'supp_1', schedule: serializeSchedule({ type: 'as_needed' }) });
    const items = buildDueTodayList([s], [], MONDAY);
    expect(items).toEqual([]);
  });

  it('includes an as_needed supplement that HAS been logged today, marked due: false', () => {
    const s = supplement({ id: 'supp_1', schedule: serializeSchedule({ type: 'as_needed' }) });
    const items = buildDueTodayList([s], [log({ supplement_id: 'supp_1', date: MONDAY })], MONDAY);
    expect(items).toEqual([{ supplement: s, due: false, logged: true }]);
  });

  it('ignores a log row for a different date', () => {
    const s = supplement({ id: 'supp_1', schedule: serializeSchedule({ type: 'as_needed' }) });
    const items = buildDueTodayList([s], [log({ supplement_id: 'supp_1', date: '2026-09-01' })], MONDAY);
    expect(items).toEqual([]);
  });

  it('preserves input order and handles a mix of schedules/states', () => {
    const daily = supplement({ id: 'a', name: 'A', schedule: serializeSchedule({ type: 'daily' }) });
    const asNeededLogged = supplement({ id: 'b', name: 'B', schedule: serializeSchedule({ type: 'as_needed' }) });
    const asNeededUnlogged = supplement({ id: 'c', name: 'C', schedule: serializeSchedule({ type: 'as_needed' }) });
    const wrongDay = supplement({
      id: 'd',
      name: 'D',
      schedule: serializeSchedule({ type: 'days_of_week', days: [2] }), // Tuesday
    });
    const archived = supplement({ id: 'e', name: 'E', is_active: 0 });

    const items = buildDueTodayList(
      [daily, asNeededLogged, asNeededUnlogged, wrongDay, archived],
      [log({ supplement_id: 'b', date: MONDAY })],
      MONDAY
    );

    expect(items.map((i) => i.supplement.id)).toEqual(['a', 'b']);
  });
});
