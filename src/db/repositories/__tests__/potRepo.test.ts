import * as potRepo from '../potRepo';
import * as intakeRepo from '../intakeRepo';
import { freshDb } from './testHelpers';
import type { Database } from '../../database';

describe('potRepo', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('computes kcal_per_g etc. from ingredient totals over cooked weight', async () => {
    // Dal: rice + lentils + ghee, cooked weight 1000g total.
    const pot = await potRepo.createPot(db, {
      id: 'pot1',
      name: 'Rice & dal',
      created_at: 1000,
      total_weight_g: 1000,
      ingredients: [
        { name: 'rice (raw)', grams: 200, kcal: 720, protein_g: 15, carbs_g: 158, fat_g: 1.5 },
        { name: 'lentils (raw)', grams: 150, kcal: 520, protein_g: 36, carbs_g: 90, fat_g: 2 },
        { name: 'ghee', grams: 40, kcal: 360, protein_g: 0, carbs_g: 0, fat_g: 40 },
      ],
    });

    // total kcal = 720+520+360 = 1600, over 1000g cooked -> 1.6 kcal/g
    expect(pot.kcal_per_g).toBeCloseTo(1.6, 5);
    expect(pot.protein_per_g).toBeCloseTo(0.051, 3);
    expect(pot.remaining_g).toBe(1000);
    expect(pot.is_active).toBe(1);
    expect(JSON.parse(pot.ingredients)).toHaveLength(3);
  });

  it('rejects a zero/negative cooked weight', async () => {
    await expect(
      potRepo.createPot(db, {
        id: 'bad',
        name: 'bad pot',
        created_at: 1,
        total_weight_g: 0,
        ingredients: [{ name: 'x', grams: 100, kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1 }],
      })
    ).rejects.toThrow();
  });

  it('logServing decrements remaining_g and writes a food_entry, and recomputes day_intake', async () => {
    await potRepo.createPot(db, {
      id: 'pot1',
      name: 'Rice & dal',
      created_at: 1000,
      total_weight_g: 1000,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 }],
    });

    const { entry, pot } = await potRepo.logServing(db, {
      potId: 'pot1',
      grams: 300,
      entryId: 'serve1',
      date: '2026-08-01',
      loggedAt: 2000,
    });

    expect(pot.remaining_g).toBe(700);
    expect(entry.kcal).toBeCloseTo(450, 5); // 300g * 1.5 kcal/g
    expect(entry.source).toBe('pot');
    expect(entry.pot_id).toBe('pot1');

    const day = await intakeRepo.getDay(db, '2026-08-01');
    expect(day?.kcal).toBeCloseTo(450, 5);
  });

  // REWORK ("the pots going to zero thing"): reaching zero remaining is a
  // STATE, not a cliff — a pot stays active/reachable, and only an
  // explicit archivePot() call ever sets is_active = 0. See potRepo.ts's
  // own header for the full reasoning.
  it('floors remaining_g at 0 when a serving empties it exactly, without archiving the pot', async () => {
    await potRepo.createPot(db, {
      id: 'pot1',
      name: 'Small batch',
      created_at: 1000,
      total_weight_g: 300,
      ingredients: [{ name: 'x', grams: 300, kcal: 450, protein_g: 30, carbs_g: 45, fat_g: 9 }],
    });

    const { pot } = await potRepo.logServing(db, {
      potId: 'pot1',
      grams: 300,
      entryId: 'serve1',
      date: '2026-08-01',
      loggedAt: 2000,
    });

    expect(pot.remaining_g).toBe(0);
    expect(pot.is_active).toBe(1);

    const active = await potRepo.getActivePots(db);
    expect(active).toHaveLength(1);
  });

  // OVERRUN FIX (task brief: "serving more than the computed remainder is
  // entirely normal... never a refusal to log food the user actually
  // ate"). The scale reading — what was actually weighed — now logs in
  // full; only the pot's own (computed, not measured) remaining_g estimate
  // floors at 0 rather than going negative. This used to silently clamp
  // entry.grams to 200, under-logging 300g of real food with no error.
  it('logs the full serving even when it exceeds the computed remainder, flooring remaining_g at 0 without archiving', async () => {
    await potRepo.createPot(db, {
      id: 'pot1',
      name: 'Small batch',
      created_at: 1000,
      total_weight_g: 200,
      ingredients: [{ name: 'x', grams: 200, kcal: 300, protein_g: 20, carbs_g: 30, fat_g: 6 }],
    });

    const { entry, pot } = await potRepo.logServing(db, {
      potId: 'pot1',
      grams: 500, // more than the computed remainder — the batch was plainly bigger
      entryId: 'serve1',
      date: '2026-08-01',
      loggedAt: 2000,
    });

    expect(pot.remaining_g).toBe(0); // never negative
    expect(pot.is_active).toBe(1); // overrun never finishes the pot on its own
    expect(entry.grams).toBe(500); // the full weighed amount, not clamped
    expect(entry.kcal).toBeCloseTo(500 * 1.5, 5); // 500g * 300kcal/200g
  });

  it('refuses to log a serving from an archived pot', async () => {
    await potRepo.createPot(db, {
      id: 'pot1',
      name: 'Batch',
      created_at: 1000,
      total_weight_g: 100,
      ingredients: [{ name: 'x', grams: 100, kcal: 100, protein_g: 10, carbs_g: 10, fat_g: 2 }],
    });
    await potRepo.archivePot(db, 'pot1');

    await expect(
      potRepo.logServing(db, { potId: 'pot1', grams: 10, entryId: 'e', date: '2026-08-01', loggedAt: 1 })
    ).rejects.toThrow();
  });

  describe('archivePot / reopenPot / getArchivedPots', () => {
    it('archivePot is the ONLY thing that moves a pot from active to archived, and is idempotent', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Batch',
        created_at: 1000,
        total_weight_g: 100,
        ingredients: [{ name: 'x', grams: 100, kcal: 100, protein_g: 10, carbs_g: 10, fat_g: 2 }],
      });

      const archived = await potRepo.archivePot(db, 'pot1');
      expect(archived.is_active).toBe(0);
      expect(await potRepo.getActivePots(db)).toHaveLength(0);
      expect(await potRepo.getArchivedPots(db)).toHaveLength(1);

      // Idempotent — archiving an already-archived pot is a no-op, not an error.
      const archivedAgain = await potRepo.archivePot(db, 'pot1');
      expect(archivedAgain.is_active).toBe(0);
    });

    it('reopenPot is the exact reverse, also idempotent, and never touches remaining_g', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Batch',
        created_at: 1000,
        total_weight_g: 100,
        ingredients: [{ name: 'x', grams: 100, kcal: 100, protein_g: 10, carbs_g: 10, fat_g: 2 }],
      });
      await potRepo.logServing(db, { potId: 'pot1', grams: 40, entryId: 'e1', date: '2026-08-01', loggedAt: 1 });
      await potRepo.archivePot(db, 'pot1');

      const reopened = await potRepo.reopenPot(db, 'pot1');
      expect(reopened.is_active).toBe(1);
      expect(reopened.remaining_g).toBe(60); // untouched by archive/reopen

      const reopenedAgain = await potRepo.reopenPot(db, 'pot1');
      expect(reopenedAgain.is_active).toBe(1);

      expect(await potRepo.getActivePots(db)).toHaveLength(1);
      expect(await potRepo.getArchivedPots(db)).toHaveLength(0);
    });

    it('archivePot throws for an unknown pot id', async () => {
      await expect(potRepo.archivePot(db, 'nope')).rejects.toThrow();
    });
  });

  // Task brief #1: "The total weight is not needed... because I add the
  // ingredients and anything else is water" — true for the batch total,
  // not for valuing a serving. createPot must allow total_weight_g: null.
  it('creates a pot with total_weight_g: null — kcal_per_g/remaining_g stay null, nothing throws', async () => {
    const pot = await potRepo.createPot(db, {
      id: 'pot1',
      name: 'Unweighed batch',
      created_at: 1000,
      total_weight_g: null,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 }],
    });

    expect(pot.total_weight_g).toBeNull();
    expect(pot.remaining_g).toBeNull();
    expect(pot.kcal_per_g).toBeNull();
    expect(pot.protein_per_g).toBeNull();
    expect(pot.carbs_per_g).toBeNull();
    expect(pot.fat_per_g).toBeNull();
    expect(pot.is_active).toBe(1);
  });

  it('logServing throws for a pot with no cooked weight yet (potActions.logPotServing is the layer that turns this into a typed result before ever reaching here)', async () => {
    await potRepo.createPot(db, {
      id: 'pot1',
      name: 'Unweighed batch',
      created_at: 1000,
      total_weight_g: null,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 }],
    });

    await expect(
      potRepo.logServing(db, { potId: 'pot1', grams: 300, entryId: 'e', date: '2026-08-01', loggedAt: 1 })
    ).rejects.toThrow();
  });

  describe('updatePot', () => {
    it('recomputes kcal_per_g from the edited ingredients over the (possibly new) cooked weight', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Rice & dal',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 }],
      });

      const updated = await potRepo.updatePot(db, {
        id: 'pot1',
        name: 'Rice & dal (fixed)',
        total_weight_g: 1000,
        ingredients: [
          { name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 },
          { name: 'ghee', grams: 40, kcal: 360, protein_g: 0, carbs_g: 0, fat_g: 40 },
        ],
      });

      expect(updated.name).toBe('Rice & dal (fixed)');
      expect(updated.kcal_per_g).toBeCloseTo(1.86, 5);
      expect(JSON.parse(updated.ingredients)).toHaveLength(2);
    });

    it('rejects a zero/negative cooked weight, same as createPot', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Batch',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'x', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 }],
      });

      await expect(
        potRepo.updatePot(db, { id: 'pot1', name: 'Batch', total_weight_g: 0, ingredients: [{ name: 'x', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 }] })
      ).rejects.toThrow();
    });

    it('throws for an unknown pot id', async () => {
      await expect(
        potRepo.updatePot(db, { id: 'nope', name: 'x', total_weight_g: 100, ingredients: [] })
      ).rejects.toThrow();
    });
  });

  // Task brief, the owner's own words: "can you make sure I have the
  // option to remove pots?" — and the constraint that matters most:
  // deleting a pot must never rewrite the user's eating history. This is
  // the load-bearing test in this whole feature: it proves (not just
  // documents) that potRepo.deletePot leaves every already-logged
  // food_entry row, its macros, and the day_intake rollup completely
  // untouched.
  describe('deletePot / countPotServings', () => {
    it('removes the pot row but leaves every food_entry already logged from it completely untouched, including the day_intake rollup', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Chicken curry',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 }],
      });

      const { entry: entry1 } = await potRepo.logServing(db, {
        potId: 'pot1',
        grams: 300,
        entryId: 'serve1',
        date: '2026-08-01',
        loggedAt: 2000,
      });
      const { entry: entry2 } = await potRepo.logServing(db, {
        potId: 'pot1',
        grams: 200,
        entryId: 'serve2',
        date: '2026-08-02',
        loggedAt: 3000,
      });

      expect(await potRepo.countPotServings(db, 'pot1')).toBe(2);

      const dayBefore1 = await intakeRepo.getDay(db, '2026-08-01');
      const dayBefore2 = await intakeRepo.getDay(db, '2026-08-02');

      await potRepo.deletePot(db, 'pot1');

      // The pot itself is gone.
      expect(await potRepo.getPot(db, 'pot1')).toBeNull();
      expect(await potRepo.getActivePots(db)).toHaveLength(0);
      expect(await potRepo.getArchivedPots(db)).toHaveLength(0);

      // Every food_entry row logged from it is byte-for-byte unchanged —
      // this is the actual behaviour under test, not just a doc comment.
      const survivingEntry1 = await db.getFirstAsync<typeof entry1>('SELECT * FROM food_entry WHERE id = ?', ['serve1']);
      const survivingEntry2 = await db.getFirstAsync<typeof entry2>('SELECT * FROM food_entry WHERE id = ?', ['serve2']);
      expect(survivingEntry1).toEqual(entry1);
      expect(survivingEntry2).toEqual(entry2);
      // The dangling pot_id is left exactly as it was — never cleared to
      // NULL, never rewritten — same soft-link convention documented on
      // deletePot itself (and on schema.ts's SCHEMA_V5_SQL for
      // supplement_log.supplement_id).
      expect(survivingEntry1?.pot_id).toBe('pot1');
      expect(survivingEntry2?.pot_id).toBe('pot1');

      // The day_intake rollup for both dates is unaffected — the TDEE
      // engine's input is exactly as it was before the pot was deleted.
      const dayAfter1 = await intakeRepo.getDay(db, '2026-08-01');
      const dayAfter2 = await intakeRepo.getDay(db, '2026-08-02');
      expect(dayAfter1).toEqual(dayBefore1);
      expect(dayAfter2).toEqual(dayBefore2);
      expect(dayAfter1?.kcal).toBeCloseTo(450, 5); // 300g * 1.5 kcal/g
      expect(dayAfter2?.kcal).toBeCloseTo(300, 5); // 200g * 1.5 kcal/g
    });

    it('countPotServings only counts source=pot rows for that specific pot, ignoring other pots and non-pot entries', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Pot one',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'x', grams: 1000, kcal: 1000, protein_g: 10, carbs_g: 10, fat_g: 10 }],
      });
      await potRepo.createPot(db, {
        id: 'pot2',
        name: 'Pot two',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'y', grams: 1000, kcal: 1000, protein_g: 10, carbs_g: 10, fat_g: 10 }],
      });
      await potRepo.logServing(db, { potId: 'pot1', grams: 100, entryId: 'p1a', date: '2026-08-01', loggedAt: 1 });
      await potRepo.logServing(db, { potId: 'pot1', grams: 100, entryId: 'p1b', date: '2026-08-02', loggedAt: 2 });
      await potRepo.logServing(db, { potId: 'pot2', grams: 100, entryId: 'p2a', date: '2026-08-01', loggedAt: 3 });
      // A plain manual entry that happens to share no pot at all.
      await db.runAsync(
        `INSERT INTO food_entry (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence)
         VALUES ('manual1', '2026-08-01', 4, 'toast', 50, 120, 3, 20, 2, 'manual', 'exact')`
      );

      expect(await potRepo.countPotServings(db, 'pot1')).toBe(2);
      expect(await potRepo.countPotServings(db, 'pot2')).toBe(1);
    });

    it('countPotServings returns 0 for a pot with no logged servings', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Fresh pot',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'x', grams: 1000, kcal: 1000, protein_g: 10, carbs_g: 10, fat_g: 10 }],
      });
      expect(await potRepo.countPotServings(db, 'pot1')).toBe(0);
    });

    it('deleting a pot with no logged servings leaves nothing behind and is idempotent', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Never served',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'x', grams: 1000, kcal: 1000, protein_g: 10, carbs_g: 10, fat_g: 10 }],
      });

      await potRepo.deletePot(db, 'pot1');
      expect(await potRepo.getPot(db, 'pot1')).toBeNull();

      // Deleting an already-deleted (or never-existed) pot id is a no-op,
      // not an error — matches archivePot/reopenPot's idempotency.
      await expect(potRepo.deletePot(db, 'pot1')).resolves.toBeUndefined();
      await expect(potRepo.deletePot(db, 'never-existed')).resolves.toBeUndefined();
    });

    it('deleting a finished (archived) pot works the same way — delete is not gated on pot state', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Finished batch',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'x', grams: 1000, kcal: 1000, protein_g: 10, carbs_g: 10, fat_g: 10 }],
      });
      await potRepo.logServing(db, { potId: 'pot1', grams: 500, entryId: 'e1', date: '2026-08-01', loggedAt: 1 });
      await potRepo.archivePot(db, 'pot1');

      await potRepo.deletePot(db, 'pot1');

      expect(await potRepo.getPot(db, 'pot1')).toBeNull();
      const entry = await db.getFirstAsync<{ id: string }>('SELECT id FROM food_entry WHERE id = ?', ['e1']);
      expect(entry).not.toBeNull();
    });

    it('leaves pot_container rows completely alone — containers are never owned by a specific pot', async () => {
      await potRepo.createPot(db, {
        id: 'pot1',
        name: 'Batch',
        created_at: 1000,
        total_weight_g: 1000,
        ingredients: [{ name: 'x', grams: 1000, kcal: 1000, protein_g: 10, carbs_g: 10, fat_g: 10 }],
      });
      await potRepo.saveContainer(db, { id: 'c1', name: 'Blue bowl', tareG: 250 });

      await potRepo.deletePot(db, 'pot1');

      const containers = await potRepo.getContainers(db);
      expect(containers).toHaveLength(1);
      expect(containers[0].id).toBe('c1');
    });
  });
});
