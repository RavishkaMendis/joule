import { buildWeeklyRollup, formatWeekRange } from '../weeklyRollup';

describe('buildWeeklyRollup', () => {
  test('empty window returns no rows', () => {
    const rows = buildWeeklyRollup('2026-01-05', '2026-01-04', [], new Map(), []);
    expect(rows).toEqual([]);
  });

  test('single day produces a single (partial) week with that day only', () => {
    const rows = buildWeeklyRollup(
      '2026-01-05', // Monday
      '2026-01-05',
      [{ date: '2026-01-05', loggedKcal: 2000 }],
      new Map([['2026-01-05', { value: 2400, quality: 'stable' }]]),
      [{ date: '2026-01-05', smoothedKg: 80 }]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].avgIntakeKcal).toBe(2000);
    expect(rows[0].avgExpenditureKcal).toBe(2400);
    expect(rows[0].daysLogged).toBe(1);
    expect(rows[0].daysInWeek).toBe(1);
    // Only one weight reading in the week -> no change computable.
    expect(rows[0].weightChangeKg).toBeNull();
  });

  test('gap days are excluded from avgIntakeKcal, not averaged in as zero', () => {
    const rows = buildWeeklyRollup(
      '2026-01-05', // Monday
      '2026-01-11', // Sunday — one full week
      [
        { date: '2026-01-05', loggedKcal: 2000 },
        { date: '2026-01-06', loggedKcal: null }, // gap
        { date: '2026-01-07', loggedKcal: 2200 },
        { date: '2026-01-08', loggedKcal: null }, // gap
        { date: '2026-01-09', loggedKcal: null }, // gap
        { date: '2026-01-10', loggedKcal: null }, // gap
        { date: '2026-01-11', loggedKcal: null }, // gap
      ],
      new Map(),
      []
    );
    expect(rows).toHaveLength(1);
    // Average of ONLY the two logged days: (2000+2200)/2 = 2100, not /7.
    expect(rows[0].avgIntakeKcal).toBe(2100);
    expect(rows[0].daysLogged).toBe(2);
    expect(rows[0].daysInWeek).toBe(7);
  });

  test('a week with zero logged days reports null average, never 0 or NaN', () => {
    const rows = buildWeeklyRollup('2026-01-05', '2026-01-11', [], new Map(), []);
    expect(rows[0].avgIntakeKcal).toBeNull();
    expect(rows[0].avgExpenditureKcal).toBeNull();
    expect(rows[0].daysLogged).toBe(0);
    // No contributing days -> null, not a fabricated 'stable' or 'seeding'.
    expect(rows[0].expenditureQuality).toBeNull();
  });

  test('weight change is first-vs-last smoothed reading within the week when 2+ readings exist', () => {
    const rows = buildWeeklyRollup(
      '2026-01-05',
      '2026-01-11',
      [],
      new Map(),
      [
        { date: '2026-01-05', smoothedKg: 80.5 },
        { date: '2026-01-08', smoothedKg: 80.2 },
        { date: '2026-01-11', smoothedKg: 79.9 },
      ]
    );
    expect(rows[0].weightChangeKg).toBeCloseTo(-0.6, 5);
  });

  test('spans multiple weeks and buckets dates by Monday-start week', () => {
    const rows = buildWeeklyRollup(
      '2026-01-01', // Thursday
      '2026-01-12', // Monday of week after next
      [],
      new Map(),
      []
    );
    // Jan 1 (Thu) .. Jan 4 (Sun) = partial week 1 (4 days)
    // Jan 5 (Mon) .. Jan 11 (Sun) = full week 2 (7 days)
    // Jan 12 (Mon) = partial week 3 (1 day)
    expect(rows.map((r) => r.daysInWeek)).toEqual([4, 7, 1]);
  });

  test('partial log days (is_complete=false at the caller level) are represented via loggedKcal, still counted as logged', () => {
    const rows = buildWeeklyRollup('2026-01-05', '2026-01-05', [{ date: '2026-01-05', loggedKcal: 900 }], new Map(), []);
    expect(rows[0].avgIntakeKcal).toBe(900);
    expect(rows[0].daysLogged).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════
  // HONESTY DEFECT — weekly expenditureQuality is the weakest contributor.
  //
  // "WeeklyRollupRow should expose expenditureQuality (the weakest
  // quality among the days contributing to that week's average — a week
  // is only as trustworthy as its worst input)" (task brief). This
  // guards the exact scenario a real user hit: a week mixing a seeded
  // cold-start day with later stable days must not average its way to
  // looking more trustworthy than its worst day.
  // ═══════════════════════════════════════════════════════════════════
  test('a week of entirely stable expenditure days reports stable', () => {
    const rows = buildWeeklyRollup(
      '2026-01-05',
      '2026-01-06',
      [],
      new Map([
        ['2026-01-05', { value: 2400, quality: 'stable' }],
        ['2026-01-06', { value: 2420, quality: 'stable' }],
      ]),
      []
    );
    expect(rows[0].expenditureQuality).toBe('stable');
  });

  test('a week mixing a seeded day and stable days is reported as seeding, the weaker quality', () => {
    const rows = buildWeeklyRollup(
      '2026-01-05',
      '2026-01-07',
      [],
      new Map([
        ['2026-01-05', { value: 2343, quality: 'seeding' }], // the reported bug's exact figure
        ['2026-01-06', { value: 2400, quality: 'stable' }],
        ['2026-01-07', { value: 2410, quality: 'stable' }],
      ]),
      []
    );
    expect(rows[0].expenditureQuality).toBe('seeding');
    // The averaged number itself is unaffected — only its reported trust level is.
    expect(rows[0].avgExpenditureKcal).toBeCloseTo((2343 + 2400 + 2410) / 3, 5);
  });

  test('a week mixing converging and stable days is reported as converging', () => {
    const rows = buildWeeklyRollup(
      '2026-01-05',
      '2026-01-06',
      [],
      new Map([
        ['2026-01-05', { value: 2400, quality: 'converging' }],
        ['2026-01-06', { value: 2410, quality: 'stable' }],
      ]),
      []
    );
    expect(rows[0].expenditureQuality).toBe('converging');
  });

  test('a single seeded day alone reports seeding', () => {
    const rows = buildWeeklyRollup('2026-01-05', '2026-01-05', [], new Map([['2026-01-05', { value: 2343, quality: 'seeding' }]]), []);
    expect(rows[0].expenditureQuality).toBe('seeding');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// WEEK LABELS
//
// Regression guard for real user confusion on 2026-08-28: the weekly
// summary showed a row labelled "Aug 24" and the user asked why there was
// "an entry on Aug 24th". It was the row for the week of the 24th-30th,
// labelled with only its Monday. In a table full of dates, a single date
// reads as a day. Both ends must always be shown.
// ═══════════════════════════════════════════════════════════════════════

describe('formatWeekRange', () => {
  it('shows both ends so a week cannot be read as a single day', () => {
    // The exact case the user hit: Mon 24 Aug 2026 -> Sun 30 Aug 2026.
    expect(formatWeekRange('2026-08-24', '2026-08-30')).toBe('24–30 Aug');
  });

  it('repeats the month only when the week straddles two', () => {
    // "Sept" (not "Sep") is en-AU's correct short form. The app is
    // Australian-first throughout (AFCD food data, kJ handling), so the
    // locale is deliberate, not an inconsistency to normalise away.
    expect(formatWeekRange('2026-08-31', '2026-09-06')).toBe('31 Aug – 6 Sept');
  });

  it('collapses to one date only when the range genuinely is one day', () => {
    // A partial week at the edge of the window — still unambiguous,
    // because it really is a single day.
    expect(formatWeekRange('2026-08-24', '2026-08-24')).toBe('24 Aug');
  });

  it('handles a partial week that ends mid-week', () => {
    expect(formatWeekRange('2026-08-24', '2026-08-27')).toBe('24–27 Aug');
  });

  it('is applied to rollup rows, not just available as a helper', () => {
    const rows = buildWeeklyRollup('2026-08-24', '2026-08-30', [], new Map(), []);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('24–30 Aug');
    // The bare-Monday format that caused the confusion must not return.
    expect(rows[0].label).not.toBe('Aug 24');
  });
});
