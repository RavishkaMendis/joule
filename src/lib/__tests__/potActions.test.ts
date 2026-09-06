// ═══════════════════════════════════════════════════════════════════════
// POT ACTIONS — tare/container arithmetic (task brief, the user's own
// words: "I usually weigh the whole thing, sometimes with the plate
// weight and sometimes without").
//
// The single most important property this feature must have: a tared
// serving and a container serving of the SAME true food weight must
// produce IDENTICAL macros. A silently-unsubtracted 250g plate is roughly
// a 300 kcal error on a rice dish, invisible and repeated every serving —
// this is where that bug would live if `computeNetServingGrams` ever got
// the arithmetic backwards.
// ═══════════════════════════════════════════════════════════════════════

import { freshDb } from '../../db/repositories/__tests__/testHelpers';
import * as potRepo from '../../db/repositories/potRepo';
import * as intakeRepo from '../../db/repositories/intakeRepo';
import {
  computeNetServingGrams,
  logPotServing,
  pendingEntryToPotIngredient,
  potIngredientToDraftParam,
  saveContainer,
  getContainers,
  round1String,
  pendingEntryToDraftParam,
  maxConfidence,
  applyPanelToRow,
  resolveBarcodeUpgrade,
  computePotConfidenceSummary,
  potConfidenceSummary,
  formatPotConfidence,
  renameContainer,
  hasPotNudgeBeenDismissed,
  dismissPotNudge,
  resetPotNudgeForTesting,
  synthesizeIngredientBasis,
  applyIngredientGramsEdit,
  applyIngredientMacroEdit,
  createPot,
  updatePot,
  setPotCookedWeight,
  sumPotIngredientTotals,
  potIngredientTotals,
  checkFatPlausibility,
  potFatPlausibility,
  isFatPlausibilityNoteDismissed,
  dismissFatPlausibilityNote,
  resetPotFatNoteTableForTesting,
  isWeighedPot,
  finishPot,
  reopenPot,
  duplicatePotForCookAgain,
  potRemainingStatusFromFields,
  potRemainingStatus,
  type CurrentIngredientRow,
} from '../potActions';
import type { Database } from '../../db/database';
import type { PotRow } from '../../db/types';
import type { PendingEntry } from '../pendingEntry';
import type { CascadeResult } from '../foodSources/lookupCascade';
import type { PotIngredientDraftParam } from '../navigation';

describe('computeNetServingGrams', () => {
  it('tared mode: the scale reading IS the net weight, no subtraction', () => {
    const result = computeNetServingGrams('tared', 300);
    expect(result).toEqual({ ok: true, netGrams: 300 });
  });

  it('container mode: subtracts the container tare weight from the gross reading', () => {
    const result = computeNetServingGrams('container', 550, 250);
    expect(result).toEqual({ ok: true, netGrams: 300 });
  });

  it('a tared serving and a container serving of the SAME true food weight produce the identical net grams', () => {
    const tared = computeNetServingGrams('tared', 300);
    const containerized = computeNetServingGrams('container', 300 + 250, 250);
    expect(tared).toEqual({ ok: true, netGrams: 300 });
    expect(containerized).toEqual({ ok: true, netGrams: 300 });
    expect(tared).toEqual(containerized);
  });

  it('rejects a non-positive scale reading', () => {
    expect(computeNetServingGrams('tared', 0)).toEqual({ ok: false, reason: 'scale_reading_not_positive' });
    expect(computeNetServingGrams('tared', -5)).toEqual({ ok: false, reason: 'scale_reading_not_positive' });
  });

  it('rejects a container tare weight that would push net grams to zero or below (mistyped container weight)', () => {
    // Scale reads 200g, but a 250g tare was entered — net would be -50g.
    const result = computeNetServingGrams('container', 200, 250);
    expect(result).toEqual({ ok: false, reason: 'net_not_positive' });
  });

  it('container mode with tareG omitted defaults to 0 (equivalent to tared)', () => {
    expect(computeNetServingGrams('container', 300)).toEqual({ ok: true, netGrams: 300 });
  });
});

describe('logPotServing — end-to-end tare/container equivalence and bookkeeping', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
    await potRepo.createPot(db, {
      id: 'pot1',
      name: 'Rice & dal',
      created_at: 1000,
      total_weight_g: 2000,
      ingredients: [{ name: 'everything', grams: 2000, kcal: 3000, protein_g: 200, carbs_g: 300, fat_g: 60 }],
    });
    // kcal_per_g = 1.5
  });

  it('a tared serving and a container serving of the same true food weight log identical macros', async () => {
    const tared = await logPotServing(db, { potId: 'pot1', date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });
    expect(tared.ok).toBe(true);
    if (!tared.ok) return;

    // Fresh pot for the second serving so remaining_g doesn't confound the comparison.
    await potRepo.createPot(db, {
      id: 'pot2',
      name: 'Rice & dal (batch 2)',
      created_at: 1000,
      total_weight_g: 2000,
      ingredients: [{ name: 'everything', grams: 2000, kcal: 3000, protein_g: 200, carbs_g: 300, fat_g: 60 }],
    });
    const containerized = await logPotServing(db, {
      potId: 'pot2',
      date: '2026-08-01',
      mode: 'container',
      scaleReadingG: 300 + 250,
      containerTareG: 250,
    });
    expect(containerized.ok).toBe(true);
    if (!containerized.ok) return;

    expect(tared.entry.grams).toBe(containerized.entry.grams);
    expect(tared.entry.kcal).toBeCloseTo(containerized.entry.kcal, 10);
    expect(tared.entry.protein_g).toBeCloseTo(containerized.entry.protein_g, 10);
    expect(tared.entry.carbs_g).toBeCloseTo(containerized.entry.carbs_g, 10);
    expect(tared.entry.fat_g).toBeCloseTo(containerized.entry.fat_g, 10);
    expect(tared.entry.grams).toBe(300);
    expect(tared.entry.kcal).toBeCloseTo(450, 10); // 300g * 1.5 kcal/g
  });

  it('records tare_g = 0 for a tared serving and the container weight for a container serving', async () => {
    const tared = await logPotServing(db, { potId: 'pot1', date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });
    expect(tared.ok).toBe(true);
    if (tared.ok) expect(tared.entry.tare_g).toBe(0);

    await potRepo.createPot(db, {
      id: 'pot2',
      name: 'Batch 2',
      created_at: 1000,
      total_weight_g: 1000,
      ingredients: [{ name: 'x', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30 }],
    });
    const containerized = await logPotServing(db, {
      potId: 'pot2',
      date: '2026-08-01',
      mode: 'container',
      scaleReadingG: 550,
      containerTareG: 250,
    });
    expect(containerized.ok).toBe(true);
    if (containerized.ok) expect(containerized.entry.tare_g).toBe(250);
  });

  it('sets confidence to high, not exact, for a pot serving', async () => {
    const result = await logPotServing(db, { potId: 'pot1', date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.confidence).toBe('high');
  });

  it('refuses to log when the container tare weight exceeds the scale reading', async () => {
    const result = await logPotServing(db, {
      potId: 'pot1',
      date: '2026-08-01',
      mode: 'container',
      scaleReadingG: 100,
      containerTareG: 250,
    });
    expect(result).toEqual({ ok: false, reason: 'net_not_positive' });

    // Nothing was written — the pot is untouched and day_intake has no rows.
    const pot = await potRepo.getPot(db, 'pot1');
    expect(pot?.remaining_g).toBe(2000);
    const day = await intakeRepo.getDay(db, '2026-08-01');
    expect(day).toBeNull();
  });

  it('bumps a saved container use_count/last_used when a serving is logged against it', async () => {
    const container = await saveContainer(db, 'Blue bowl', 250);
    expect(container.use_count).toBe(0);

    await logPotServing(db, {
      potId: 'pot1',
      date: '2026-08-01',
      mode: 'container',
      scaleReadingG: 550,
      containerTareG: 250,
      containerId: container.id,
    });

    const containers = await getContainers(db);
    const updated = containers.find((c) => c.id === container.id);
    expect(updated?.use_count).toBe(1);
    expect(updated?.last_used).not.toBeNull();
  });
});

describe('pendingEntryToPotIngredient', () => {
  it('maps a resolved PendingEntry (photo/barcode/search) into a PotIngredient with no unit re-derivation', () => {
    const entry: PendingEntry = {
      name: 'Basmati rice (raw)',
      grams: 200,
      kcal: 720,
      protein_g: 15,
      carbs_g: 158,
      fat_g: 1.5,
      confidence: 'medium',
      source: 'meal_photo',
      per100g: { kcal: 360, protein_g: 7.5, carbs_g: 79, fat_g: 0.75 },
      assumptions: 'Estimated raw weight from the photo',
    };

    expect(pendingEntryToPotIngredient(entry)).toEqual({
      name: 'Basmati rice (raw)',
      grams: 200,
      kcal: 720,
      protein_g: 15,
      carbs_g: 158,
      fat_g: 1.5,
      confidence: 'medium',
      per100g: { kcal: 360, protein_g: 7.5, carbs_g: 79, fat_g: 0.75 },
    });
  });

  it('BUG FIX: retains per100g when the source entry has one — this was previously dropped, which is why editing grams downstream had nothing to rescale from', () => {
    const entry: PendingEntry = {
      name: 'Potato',
      grams: 700,
      kcal: 539,
      protein_g: 14,
      carbs_g: 122.5,
      fat_g: 0.7,
      confidence: 'exact',
      source: 'afcd',
      per100g: { kcal: 77, protein_g: 2, carbs_g: 17.5, fat_g: 0.1 },
    };
    expect(pendingEntryToPotIngredient(entry).per100g).toEqual({ kcal: 77, protein_g: 2, carbs_g: 17.5, fat_g: 0.1 });
  });

  it('leaves per100g undefined when the source entry never had one (e.g. an unannotated meal-photo guess)', () => {
    const entry: PendingEntry = {
      name: 'Mystery curry',
      grams: 300,
      kcal: 450,
      protein_g: 20,
      carbs_g: 40,
      fat_g: 18,
      confidence: 'low',
      source: 'meal_photo',
    };
    expect(pendingEntryToPotIngredient(entry).per100g).toBeUndefined();
  });
});

describe('round1String / pendingEntryToDraftParam — shared draft-row formatting', () => {
  it('rounds to 1 decimal place and stringifies', () => {
    expect(round1String(199.949)).toBe('199.9');
    expect(round1String(200)).toBe('200');
    expect(round1String(0.04)).toBe('0');
  });

  it('maps a resolved PendingEntry straight into an editable draft row, carrying confidence through', () => {
    const entry: PendingEntry = {
      name: 'Basmati rice (raw)',
      grams: 200,
      kcal: 720.04,
      protein_g: 15,
      carbs_g: 158,
      fat_g: 1.5,
      confidence: 'low',
      source: 'meal_photo',
    };

    expect(pendingEntryToDraftParam(entry)).toEqual({
      name: 'Basmati rice (raw)',
      gramsRaw: '200',
      kcal: '720',
      protein_g: '15',
      carbs_g: '158',
      fat_g: '1.5',
      confidence: 'low',
    });
  });
});

describe('synthesizeIngredientBasis', () => {
  it('derives a per-100g basis from grams+macros, matching a scanned panel\'s own math', () => {
    // 700g of potato worth 539 kcal / 14g protein / 122.5g carbs / 0.7g fat.
    const basis = synthesizeIngredientBasis(700, { kcal: 539, protein_g: 14, carbs_g: 122.5, fat_g: 0.7 });
    expect(basis).not.toBeNull();
    expect(basis?.kcal).toBeCloseTo(77, 5);
    expect(basis?.protein_g).toBeCloseTo(2, 5);
    expect(basis?.carbs_g).toBeCloseTo(17.5, 5);
    expect(basis?.fat_g).toBeCloseTo(0.1, 5);
  });

  it('returns null rather than dividing by zero for a non-positive grams figure', () => {
    expect(synthesizeIngredientBasis(0, { kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1 })).toBeNull();
    expect(synthesizeIngredientBasis(-5, { kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1 })).toBeNull();
  });
});

describe('applyIngredientGramsEdit — BUG 1 fix ("changed the potatoes from 700g to 800g and it never changed the calories")', () => {
  const scannedRow: PotIngredientDraftParam = {
    name: 'Potato',
    gramsRaw: '700',
    kcal: '539',
    protein_g: '14',
    carbs_g: '122.5',
    fat_g: '0.7',
    confidence: 'exact',
    per100g: { kcal: 77, protein_g: 2, carbs_g: 17.5, fat_g: 0.1 },
  };

  it('the exact reported scenario: 700g -> 800g rescales every macro from the retained per-100g basis', () => {
    const edited = applyIngredientGramsEdit(scannedRow, '800');
    expect(edited.gramsRaw).toBe('800');
    expect(edited.kcal).toBe('616'); // 77 kcal/100g * 800g
    expect(edited.protein_g).toBe('16'); // 2 * 8
    expect(edited.carbs_g).toBe('140'); // 17.5 * 8
    expect(edited.fat_g).toBe('0.8'); // 0.1 * 8
    // The basis itself is untouched by the edit — a THIRD edit rescales
    // from the same origin, not from an already-rescaled number.
    expect(edited.per100g).toEqual(scannedRow.per100g);
  });

  it('a from-scratch manual row with no per100g yet synthesizes one from its prior (complete) numbers the first time grams is edited', () => {
    const manualRow: PotIngredientDraftParam = {
      name: 'Rice (typed by hand)',
      gramsRaw: '200',
      kcal: '260',
      protein_g: '5',
      carbs_g: '57',
      fat_g: '0.4',
      confidence: 'exact',
      // No per100g — this is the "legacy ingredient" shape (also produced
      // by a from-scratch manual row before this fix).
    };
    const edited = applyIngredientGramsEdit(manualRow, '400');
    expect(edited.per100g).toEqual({ kcal: 130, protein_g: 2.5, carbs_g: 28.5, fat_g: 0.2 });
    expect(edited.kcal).toBe('520');
    expect(edited.protein_g).toBe('10');
    expect(edited.carbs_g).toBe('114');
    expect(edited.fat_g).toBe('0.8');
  });

  it('LEGACY/INCOMPLETE ROW: with no basis and an incomplete prior row, a grams edit updates the text only and leaves macros untouched (documented "manually editable, no silent stale number" behaviour)', () => {
    const incompleteRow: PotIngredientDraftParam = {
      name: 'Something',
      gramsRaw: '100',
      kcal: '150',
      protein_g: '', // never filled in — nothing to synthesize a basis from
      carbs_g: '',
      fat_g: '',
      confidence: 'exact',
    };
    const edited = applyIngredientGramsEdit(incompleteRow, '250');
    expect(edited.gramsRaw).toBe('250');
    // Untouched — not silently rescaled from an incomplete basis, and not
    // left claiming a basis that doesn't exist.
    expect(edited.kcal).toBe('150');
    expect(edited.protein_g).toBe('');
    expect(edited.per100g).toBeUndefined();
  });

  it('a blank/invalid new grams value is recorded as text without touching macros or the basis', () => {
    const edited = applyIngredientGramsEdit(scannedRow, '');
    expect(edited.gramsRaw).toBe('');
    expect(edited.kcal).toBe(scannedRow.kcal);
    expect(edited.per100g).toEqual(scannedRow.per100g);
  });
});

describe('applyIngredientMacroEdit — hand-editing a macro updates the row\'s basis', () => {
  it('re-synthesizes per100g from the row\'s current (post-edit) numbers once the row is complete', () => {
    const row: PotIngredientDraftParam = {
      name: 'Potato',
      gramsRaw: '700',
      kcal: '539',
      protein_g: '14',
      carbs_g: '122.5',
      fat_g: '0.7',
      confidence: 'exact',
      per100g: { kcal: 77, protein_g: 2, carbs_g: 17.5, fat_g: 0.1 },
    };
    // User corrects the scanned kcal by hand: "actually it's 560, not 539".
    const edited = applyIngredientMacroEdit(row, 'kcal', '560');
    expect(edited.kcal).toBe('560');
    expect(edited.per100g?.kcal).toBeCloseTo(80, 5); // 560 / 7

    // A SUBSEQUENT grams edit now scales from the hand-corrected basis, not the stale scanned one.
    const rescaled = applyIngredientGramsEdit(edited, '350');
    expect(rescaled.kcal).toBe('280'); // 80 kcal/100g * 350g, not the old 77-based figure
  });

  it('does not synthesize a basis while the row is still incomplete, and leaves any existing basis untouched', () => {
    const row: PotIngredientDraftParam = {
      name: 'New thing',
      gramsRaw: '100',
      kcal: '',
      protein_g: '',
      carbs_g: '',
      fat_g: '',
      confidence: 'exact',
    };
    const edited = applyIngredientMacroEdit(row, 'kcal', '150');
    expect(edited.kcal).toBe('150');
    expect(edited.per100g).toBeUndefined(); // protein/carbs/fat still blank — nothing to derive from yet
  });
});

describe('pot kcal_per_g recomputes correctly after an in-progress ingredient edit', () => {
  it('createPot reflects the RESCALED ingredient numbers, not the pre-edit ones, once a grams edit has been applied', async () => {
    const db = await freshDb();
    const scannedRow: PotIngredientDraftParam = {
      name: 'Potato',
      gramsRaw: '700',
      kcal: '539',
      protein_g: '14',
      carbs_g: '122.5',
      fat_g: '0.7',
      confidence: 'exact',
      per100g: { kcal: 77, protein_g: 2, carbs_g: 17.5, fat_g: 0.1 },
    };
    const edited = applyIngredientGramsEdit(scannedRow, '800'); // the exact reported bug scenario

    const pot = await createPot(db, {
      name: 'Test pot',
      totalWeightG: 800, // cooked weight happens to equal the single ingredient's raw grams here
      ingredients: [
        {
          name: edited.name,
          grams: Number(edited.gramsRaw),
          kcal: Number(edited.kcal),
          protein_g: Number(edited.protein_g),
          carbs_g: Number(edited.carbs_g),
          fat_g: Number(edited.fat_g),
          confidence: edited.confidence,
          per100g: edited.per100g,
        },
      ],
    });

    // 616 total kcal (77 kcal/100g * 800g) / 800g cooked weight = 0.77 kcal/g.
    expect(pot.kcal_per_g).toBeCloseTo(0.77, 5);
    // NOT the pre-edit 539/800 = 0.67375 figure a caller would get if the
    // rescale had silently failed and only gramsRaw had changed.
    expect(pot.kcal_per_g).not.toBeCloseTo(539 / 800, 3);
  });
});

describe('potIngredientToDraftParam carries per100g through (per-ingredient barcode upgrade round-trip)', () => {
  it('includes the ingredient\'s per100g basis in the resulting draft row', () => {
    const ingredient: potRepo.PotIngredient = {
      name: 'Rice',
      grams: 250,
      kcal: 900,
      protein_g: 18.75,
      carbs_g: 197.5,
      fat_g: 1.875,
      confidence: 'exact',
      per100g: { kcal: 360, protein_g: 7.5, carbs_g: 79, fat_g: 0.75 },
    };
    const draft = potIngredientToDraftParam(ingredient, 'exact');
    expect(draft.per100g).toEqual({ kcal: 360, protein_g: 7.5, carbs_g: 79, fat_g: 0.75 });
  });
});

describe('applyPanelToRow retains a per100g basis on the upgraded row (so a THEN-edited grams field can still rescale)', () => {
  it('the upgraded PotIngredient carries the scanned per100g basis forward', () => {
    const current: CurrentIngredientRow = { grams: 250, confidence: 'medium' };
    const scanned: PendingEntry = {
      name: 'SunRice Medium Grain White Rice',
      grams: 100,
      kcal: 360,
      protein_g: 7.5,
      carbs_g: 79,
      fat_g: 0.75,
      confidence: 'exact',
      source: 'barcode',
      per100g: { kcal: 360, protein_g: 7.5, carbs_g: 79, fat_g: 0.75 },
    };
    const upgraded = applyPanelToRow(current, scanned);
    expect(upgraded.per100g).toEqual({ kcal: 360, protein_g: 7.5, carbs_g: 79, fat_g: 0.75 });
  });
});

describe('maxConfidence', () => {
  it('never lets a scan downgrade an already-more-trusted row', () => {
    expect(maxConfidence('exact', 'medium')).toBe('exact');
    expect(maxConfidence('low', 'exact')).toBe('exact');
    expect(maxConfidence('high', 'high')).toBe('high');
    expect(maxConfidence('low', 'medium')).toBe('medium');
  });
});

describe('applyPanelToRow / resolveBarcodeUpgrade — per-ingredient barcode upgrade (task brief headline feature)', () => {
  const current: CurrentIngredientRow = { grams: 250, confidence: 'medium' };
  const scannedEntry: PendingEntry = {
    name: 'SunRice Medium Grain White Rice',
    grams: 100,
    kcal: 360,
    protein_g: 7.5,
    carbs_g: 79,
    fat_g: 0.75,
    confidence: 'exact',
    source: 'barcode',
    per100g: { kcal: 360, protein_g: 7.5, carbs_g: 79, fat_g: 0.75 },
    barcode: '9300633435007',
  };

  it('replaces macros from the scanned per-100g basis scaled to the EXISTING grams — grams itself never changes', () => {
    const upgraded = applyPanelToRow(current, scannedEntry);
    expect(upgraded.grams).toBe(250); // preserved, not the panel's own 100g basis
    expect(upgraded.name).toBe('SunRice Medium Grain White Rice');
    expect(upgraded.kcal).toBeCloseTo(900, 5); // 360 kcal/100g * 250g
    expect(upgraded.protein_g).toBeCloseTo(18.75, 5);
    expect(upgraded.confidence).toBe('exact');
  });

  it('raises confidence to the better of the row and the scan, never downgrades', () => {
    const alreadyExact: CurrentIngredientRow = { grams: 250, confidence: 'exact' };
    const partialPanel: PendingEntry = { ...scannedEntry, confidence: 'medium' };
    const upgraded = applyPanelToRow(alreadyExact, partialPanel);
    expect(upgraded.confidence).toBe('exact'); // not downgraded to the panel's 'medium'
  });

  it('resolveBarcodeUpgrade on a hit returns the upgraded row', () => {
    const outcome: CascadeResult = { ok: true, entry: scannedEntry, hitSource: 'open_food_facts' };
    const result = resolveBarcodeUpgrade(current, outcome);
    expect(result).toEqual({ ok: true, upgraded: applyPanelToRow(current, scannedEntry) });
  });

  it('resolveBarcodeUpgrade on a miss leaves the row untouched: returns a typed miss, never a partial/garbage upgrade', () => {
    const outcome: CascadeResult = { ok: false, reason: 'not_found' };
    const result = resolveBarcodeUpgrade(current, outcome);
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    // No `upgraded` key at all on the miss branch — nothing for a careless caller to accidentally apply.
    expect((result as { upgraded?: unknown }).upgraded).toBeUndefined();
  });

  it('the kJ trap is caught upstream, not bypassed here: a kJ-only OFF panel already converted to kcal by mapOffResponse survives the upgrade unchanged', () => {
    // Simulates a real Australian barcode hit: OFF only supplied
    // energy-kj_100g (1506 kJ/100g ≈ 360 kcal/100g) — mapOffResponse (the
    // module this app's ENTIRE barcode cascade goes through) already did
    // the kJ->kcal conversion and the 0-900 plausibility check by the time
    // lookupByBarcode ever returns an `ok: true` entry, so this upgrade
    // path inherits a correct kcal figure for free rather than re-deriving
    // (or mis-deriving) it.
    const kjDerivedEntry: PendingEntry = {
      name: 'Generic white rice',
      grams: 100,
      kcal: 359.94,
      protein_g: 7.5,
      carbs_g: 79,
      fat_g: 0.75,
      confidence: 'exact',
      source: 'barcode',
      per100g: { kcal: 359.94, protein_g: 7.5, carbs_g: 79, fat_g: 0.75 },
    };
    const outcome: CascadeResult = { ok: true, entry: kjDerivedEntry, hitSource: 'open_food_facts' };
    const result = resolveBarcodeUpgrade({ grams: 250, confidence: 'low' }, outcome);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 359.94 kcal/100g * 250g = 899.85 — nowhere near the ~4x-too-high
    // number a kJ-as-kcal bug would have produced (would be ~3,760 kcal).
    expect(result.upgraded.kcal).toBeCloseTo(899.85, 2);
    expect(result.upgraded.kcal).toBeLessThan(900 * 2.5); // sanity: within one plausible 0-900/100g rail's worth for 250g
  });
});

describe('computePotConfidenceSummary / potConfidenceSummary — pot-level mixed-confidence measure', () => {
  it('computes the energy (kcal) share contributed by exact-confidence ingredients', () => {
    const ingredients: potRepo.PotIngredient[] = [
      { name: 'rice (scanned)', grams: 200, kcal: 720, protein_g: 15, carbs_g: 158, fat_g: 1.5, confidence: 'exact' },
      { name: 'coriander (guessed)', grams: 5, kcal: 1, protein_g: 0.1, carbs_g: 0.2, fat_g: 0, confidence: 'low' },
    ];
    const summary = computePotConfidenceSummary(ingredients);
    expect(summary.totalKcal).toBeCloseTo(721, 5);
    expect(summary.exactEnergyFraction).toBeCloseTo(720 / 721, 5);
  });

  it('a pot that is ALL exact scores 100%, not a fabricated worst-of penalty for having multiple ingredients', () => {
    const ingredients: potRepo.PotIngredient[] = [
      { name: 'a', grams: 100, kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, confidence: 'exact' },
      { name: 'b', grams: 100, kcal: 200, protein_g: 1, carbs_g: 1, fat_g: 1, confidence: 'exact' },
    ];
    expect(computePotConfidenceSummary(ingredients).exactEnergyFraction).toBe(1);
  });

  it('a pot with zero total kcal reports 0 rather than NaN/dividing by zero', () => {
    const ingredients: potRepo.PotIngredient[] = [{ name: 'water', grams: 500, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, confidence: 'exact' }];
    expect(computePotConfidenceSummary(ingredients)).toEqual({ totalKcal: 0, exactEnergyFraction: 0 });
  });

  it('ingredients missing a confidence value (legacy pots, pre-dating this field) are never silently counted as exact', () => {
    const ingredients: potRepo.PotIngredient[] = [{ name: 'legacy', grams: 100, kcal: 500, protein_g: 10, carbs_g: 10, fat_g: 10 }];
    expect(computePotConfidenceSummary(ingredients).exactEnergyFraction).toBe(0);
  });

  it('potConfidenceSummary parses a PotRow.ingredients JSON blob', () => {
    const ingredients: potRepo.PotIngredient[] = [
      { name: 'rice', grams: 200, kcal: 720, protein_g: 15, carbs_g: 158, fat_g: 1.5, confidence: 'exact' },
    ];
    const pot = { ingredients: JSON.stringify(ingredients) } as PotRow;
    expect(potConfidenceSummary(pot).exactEnergyFraction).toBe(1);
  });

  it('potConfidenceSummary never throws on malformed JSON — falls back to "no data"', () => {
    const pot = { ingredients: 'not json' } as PotRow;
    expect(potConfidenceSummary(pot)).toEqual({ totalKcal: 0, exactEnergyFraction: 0 });
  });
});

describe('formatPotConfidence', () => {
  it('formats a real, honest percentage — never a letter grade or invented score', () => {
    expect(formatPotConfidence({ totalKcal: 1000, exactEnergyFraction: 0.827 })).toBe(
      "83% of this pot's calories came from a scanned barcode or database match"
    );
  });
});

describe('renameContainer', () => {
  let db2: Database;
  beforeEach(async () => {
    db2 = await freshDb();
  });

  it('renames a saved container without touching its tare/use stats', async () => {
    const container = await saveContainer(db2, 'Blue bowl', 250);
    await renameContainer(db2, container.id, 'Big blue bowl');
    const containers = await getContainers(db2);
    const updated = containers.find((c) => c.id === container.id);
    expect(updated?.name).toBe('Big blue bowl');
    expect(updated?.tare_g).toBe(250);
  });
});

describe('pot nudge dismissal', () => {
  let db2: Database;
  beforeEach(async () => {
    db2 = await freshDb();
    resetPotNudgeForTesting();
  });

  it('defaults to not dismissed', async () => {
    expect(await hasPotNudgeBeenDismissed(db2)).toBe(false);
  });

  it('is dismissed after dismissPotNudge and stays dismissed', async () => {
    await dismissPotNudge(db2, 12345);
    expect(await hasPotNudgeBeenDismissed(db2)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TASK BRIEF #1 — cooked weight is optional at creation, capturable later.
// "A pot with no cooked weight yet should display its total kcal and
// macros honestly, and say servings can't be valued until it's weighed.
// Never show a fabricated or zero kcal/g."
// ═══════════════════════════════════════════════════════════════════════

describe('creating a pot without a cooked weight', () => {
  it('allows totalWeightG: null and reports a real total kcal with no kcal_per_g', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Chicken curry',
      totalWeightG: null,
      ingredients: [
        { name: 'chicken', grams: 800, kcal: 1320, protein_g: 248, carbs_g: 0, fat_g: 28, confidence: 'exact' },
        { name: 'coconut milk', grams: 400, kcal: 880, protein_g: 8, carbs_g: 24, fat_g: 92, confidence: 'exact' },
      ],
    });

    expect(pot.total_weight_g).toBeNull();
    expect(pot.remaining_g).toBeNull();
    expect(pot.kcal_per_g).toBeNull();
    expect(pot.protein_per_g).toBeNull();
    expect(pot.carbs_per_g).toBeNull();
    expect(pot.fat_per_g).toBeNull();
    expect(pot.is_active).toBe(1); // still usable — just not yet valuable per-gram

    const totals = potIngredientTotals(pot);
    expect(totals.kcal).toBe(2200);
    expect(totals.protein_g).toBe(256);
    expect(totals.fat_g).toBe(120);
    expect(isWeighedPot(pot)).toBe(false);
  });

  it('refuses to log a serving from an unweighed pot (needs_cooked_weight), and leaves it untouched', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Dal',
      totalWeightG: null,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    const result = await logPotServing(db, { potId: pot.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });
    expect(result).toEqual({ ok: false, reason: 'needs_cooked_weight' });

    // Nothing written: pot unchanged, no food_entry, no day_intake row.
    const reread = await potRepo.getPot(db, pot.id);
    expect(reread?.remaining_g).toBeNull();
    const day = await intakeRepo.getDay(db, '2026-08-01');
    expect(day).toBeNull();
  });

  it('setPotCookedWeight fills in kcal_per_g/remaining_g from the SAME ingredients, keeping name/ingredients untouched', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Dal',
      totalWeightG: null,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    const weighed = await setPotCookedWeight(db, pot.id, 1000);
    expect(weighed.total_weight_g).toBe(1000);
    expect(weighed.remaining_g).toBe(1000); // nothing served yet
    expect(weighed.kcal_per_g).toBeCloseTo(1.5, 5);
    expect(weighed.name).toBe('Dal');
    expect(JSON.parse(weighed.ingredients)).toHaveLength(1);

    // And now a serving can actually be logged.
    const result = await logPotServing(db, { potId: pot.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.kcal).toBeCloseTo(450, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TASK BRIEF #4 — editing an existing pot.
// ═══════════════════════════════════════════════════════════════════════

describe('updatePot', () => {
  it('recomputes kcal_per_g from the edited ingredients/cooked weight', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Rice & dal',
      totalWeightG: 1000,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });
    expect(pot.kcal_per_g).toBeCloseTo(1.5, 5);

    const updated = await updatePot(db, {
      id: pot.id,
      name: 'Rice & dal (corrected)',
      totalWeightG: 1000,
      ingredients: [
        { name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' },
        { name: 'ghee I forgot', grams: 40, kcal: 360, protein_g: 0, carbs_g: 0, fat_g: 40, confidence: 'exact' },
      ],
    });

    expect(updated.name).toBe('Rice & dal (corrected)');
    expect(updated.kcal_per_g).toBeCloseTo(1.86, 5); // (1500+360)/1000
  });

  it('does NOT alter an already-logged food_entry row — only future servings see the new figure', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Rice & dal',
      totalWeightG: 1000,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    const first = await logPotServing(db, { potId: pot.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entry.kcal).toBeCloseTo(450, 5); // 300g * 1.5 kcal/g

    // Fix a forgotten ghee ingredient — kcal_per_g roughly doubles.
    await updatePot(db, {
      id: pot.id,
      name: pot.name,
      totalWeightG: 1000,
      ingredients: [
        { name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' },
        { name: 'ghee I forgot', grams: 40, kcal: 360, protein_g: 0, carbs_g: 0, fat_g: 40, confidence: 'exact' },
      ],
    });

    // The FIRST serving's food_entry row is untouched — it recorded what
    // was logged at the time (PRD §10 applies to the pot, not to
    // rewriting the log).
    const reread = await db.getFirstAsync<{ kcal: number }>('SELECT kcal FROM food_entry WHERE id = ?', [first.entry.id]);
    expect(reread?.kcal).toBeCloseTo(450, 5);

    // A NEW serving after the edit uses the corrected figure.
    const second = await logPotServing(db, { potId: pot.id, date: '2026-08-02', mode: 'tared', scaleReadingG: 300 });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.entry.kcal).toBeCloseTo(300 * 1.86, 1);
  });

  it('remaining_g: preserves the amount already served when the cooked weight is corrected upward', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });
    await logPotServing(db, { potId: pot.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });
    // servedSoFar = 1000 - 700 = 300

    const updated = await updatePot(db, {
      id: pot.id,
      name: pot.name,
      totalWeightG: 1200, // "oh, it was actually 1200g cooked, not 1000g"
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    expect(updated.total_weight_g).toBe(1200);
    expect(updated.remaining_g).toBe(900); // 1200 - 300 served, NOT the old 700
    expect(updated.is_active).toBe(1);
  });

  // REWORK ("the pots going to zero thing"): is_active is never re-derived
  // from a recomputed remaining_g, including here — an edit that happens
  // to bring the computed remainder to zero must not silently re-archive
  // a pot the user never said was finished. See potRepo.updatePot's own
  // doc; finishing is exclusively `finishPot`/`archivePot` now.
  it('remaining_g: clamps to 0 (never re-archives) when the corrected cooked weight is below what was already served', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });
    await logPotServing(db, { potId: pot.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 700 });
    // servedSoFar = 1000 - 300 = 700

    const updated = await updatePot(db, {
      id: pot.id,
      name: pot.name,
      totalWeightG: 500, // corrected DOWN below what's already been served
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    expect(updated.remaining_g).toBe(0);
    expect(updated.is_active).toBe(1); // preserved, not inferred from the new remainder
  });

  // Symmetric case: an edit must not silently REOPEN an explicitly-finished
  // pot either, just because the recomputed remainder is positive again.
  it('remaining_g: an explicitly-finished pot stays finished across a cooked-weight edit that raises the remainder back above 0', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });
    await logPotServing(db, { potId: pot.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });
    await finishPot(db, pot.id);

    const updated = await updatePot(db, {
      id: pot.id,
      name: pot.name,
      totalWeightG: 1200, // corrected UP — would recompute a positive remainder
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    expect(updated.remaining_g).toBe(900);
    expect(updated.is_active).toBe(0); // still finished — reopenPot is the only way back
  });

  it('remaining_g: setting a cooked weight for the first time via edit (no prior servings possible) starts fresh at the new total', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Unweighed batch',
      totalWeightG: null,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    const updated = await updatePot(db, {
      id: pot.id,
      name: pot.name,
      totalWeightG: 1000,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    expect(updated.remaining_g).toBe(1000);
    expect(updated.kcal_per_g).toBeCloseTo(1.5, 5);
  });

  it('can un-set the cooked weight (totalWeightG: null), going back to "not yet weighed"', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'everything', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    const updated = await updatePot(db, { id: pot.id, name: pot.name, totalWeightG: null, ingredients: JSON.parse(pot.ingredients) });
    expect(updated.total_weight_g).toBeNull();
    expect(updated.remaining_g).toBeNull();
    expect(updated.kcal_per_g).toBeNull();
    expect(updated.is_active).toBe(1); // an unweighed pot is still "in progress", not archived
  });
});

// ═══════════════════════════════════════════════════════════════════════
// "ALSO" SECTION — fat-plausibility note.
// ═══════════════════════════════════════════════════════════════════════

describe('checkFatPlausibility', () => {
  it('flags a low kcal/g pot with essentially no fat ingredient (the reported 307g/377kcal chicken curry scenario)', () => {
    // A curry-shaped ingredient list with NO oil/coconut milk/ghee entered
    // — only the trace fat naturally in lean chicken breast.
    const totals = sumPotIngredientTotals([
      { name: 'chicken', grams: 250, kcal: 350, protein_g: 66, carbs_g: 0, fat_g: 3, confidence: 'exact' },
      { name: 'onion/tomato/spices', grams: 100, kcal: 27, protein_g: 1, carbs_g: 6, fat_g: 0.2, confidence: 'low' },
    ]);
    const check = checkFatPlausibility(totals, 1.23); // matches the reported real serving's kcal/g
    expect(check.flagged).toBe(true);
    expect(check.fatKcalShare).toBeLessThan(0.08);
  });

  it('does not flag a pot with a real cooking-fat ingredient present', () => {
    const totals = sumPotIngredientTotals([
      { name: 'chicken', grams: 800, kcal: 880, protein_g: 176, carbs_g: 0, fat_g: 16, confidence: 'exact' },
      { name: 'coconut milk', grams: 400, kcal: 880, protein_g: 8, carbs_g: 24, fat_g: 92, confidence: 'exact' },
    ]);
    const check = checkFatPlausibility(totals, 2.2);
    expect(check.flagged).toBe(false);
  });

  it('does not flag a low-fat pot whose kcal/g is not implausibly low', () => {
    // Dense but genuinely low-fat (e.g. mostly rice) — high kcal/g rules
    // out "the fat was probably forgotten".
    const totals = sumPotIngredientTotals([{ name: 'rice', grams: 500, kcal: 1800, protein_g: 33, carbs_g: 396, fat_g: 3, confidence: 'exact' }]);
    const check = checkFatPlausibility(totals, 3.6);
    expect(check.flagged).toBe(false);
  });

  it('never flags when there is no kcal/g yet (unweighed pot) or no ingredients', () => {
    expect(checkFatPlausibility({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, null).flagged).toBe(false);
    expect(checkFatPlausibility({ kcal: 500, protein_g: 10, carbs_g: 50, fat_g: 0 }, null).flagged).toBe(false);
  });

  it('potFatPlausibility reads the same check off a stored PotRow', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Chicken curry',
      totalWeightG: 307,
      ingredients: [
        { name: 'chicken', grams: 250, kcal: 350, protein_g: 66, carbs_g: 0, fat_g: 3, confidence: 'exact' },
        { name: 'onion/tomato/spices', grams: 100, kcal: 27, protein_g: 1, carbs_g: 6, fat_g: 0.2, confidence: 'low' },
      ],
    });
    // 377 total kcal / 307g cooked = 1.228 kcal/g — matches the reported real serving almost exactly.
    expect(pot.kcal_per_g).toBeCloseTo(1.228, 2);
    expect(potFatPlausibility(pot).flagged).toBe(true);
  });
});

describe('fat-plausibility note dismissal (per-pot, persisted)', () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
    resetPotFatNoteTableForTesting();
  });

  it('defaults to not dismissed', async () => {
    expect(await isFatPlausibilityNoteDismissed(db, 'pot1')).toBe(false);
  });

  it('is dismissed after dismissFatPlausibilityNote and stays dismissed', async () => {
    await dismissFatPlausibilityNote(db, 'pot1', 12345);
    expect(await isFatPlausibilityNoteDismissed(db, 'pot1')).toBe(true);
  });

  it('dismissal is per-pot — dismissing one pot does not affect another', async () => {
    await dismissFatPlausibilityNote(db, 'pot1');
    expect(await isFatPlausibilityNoteDismissed(db, 'pot1')).toBe(true);
    expect(await isFatPlausibilityNoteDismissed(db, 'pot2')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FINISH / REOPEN / COOK AGAIN — the rework of "the pots going to zero
// thing" (task brief). Three failure modes fixed together:
//   1. remaining_g hitting/being floored at zero no longer locks the user
//      out of a pot with food plainly still in it (see potRepo.ts tests
//      for the logServing/updatePot side of this).
//   2. "Finished" is now an explicit action (finishPot/reopenPot), never
//      an inferred arithmetic threshold.
//   3. An archived pot is a recipe — duplicatePotForCookAgain turns any
//      pot (finished or not) into a fresh, independent one ready for a
//      new cooked weight, without touching the original or its history.
// ═══════════════════════════════════════════════════════════════════════
describe('finishPot / reopenPot', () => {
  it('finishPot archives the pot without touching remaining_g/ingredients', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'x', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });
    await logPotServing(db, { potId: pot.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });

    const finished = await finishPot(db, pot.id);
    expect(finished.is_active).toBe(0);
    expect(finished.remaining_g).toBe(700); // untouched by finishing

    expect(await potRepo.getActivePots(db)).toHaveLength(0);
    expect(await potRepo.getArchivedPots(db)).toHaveLength(1);
  });

  it('finishPot works even with food plainly still left — finishing is never blocked by a positive remainder', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'x', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });

    const finished = await finishPot(db, pot.id);
    expect(finished.is_active).toBe(0);
    expect(finished.remaining_g).toBe(1000);
  });

  it('reopenPot is the exact reverse — active list and numbers both restored', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'x', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });
    await finishPot(db, pot.id);

    const reopened = await reopenPot(db, pot.id);
    expect(reopened.is_active).toBe(1);
    expect(reopened.remaining_g).toBe(1000);
    expect(await potRepo.getActivePots(db)).toHaveLength(1);
    expect(await potRepo.getArchivedPots(db)).toHaveLength(0);
  });

  it('a reopened pot can immediately log a new serving', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'x', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });
    await finishPot(db, pot.id);
    await reopenPot(db, pot.id);

    const result = await logPotServing(db, { potId: pot.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 200 });
    expect(result.ok).toBe(true);
  });
});

describe('duplicatePotForCookAgain', () => {
  it('creates an independent new pot with the same name/ingredients and no cooked weight yet', async () => {
    const db = await freshDb();
    const original = await createPot(db, {
      name: 'Chicken curry',
      totalWeightG: 1000,
      ingredients: [
        { name: 'chicken', grams: 500, kcal: 800, protein_g: 90, carbs_g: 0, fat_g: 48, confidence: 'exact' },
        { name: 'coconut milk', grams: 200, kcal: 400, protein_g: 4, carbs_g: 8, fat_g: 40, confidence: 'high' },
      ],
    });
    await logPotServing(db, { potId: original.id, date: '2026-08-01', mode: 'tared', scaleReadingG: 300 });

    const copy = await duplicatePotForCookAgain(db, original.id, 5000);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Chicken curry');
    expect(copy.total_weight_g).toBeNull(); // ready for a fresh cooked weight
    expect(copy.remaining_g).toBeNull();
    expect(copy.kcal_per_g).toBeNull();
    expect(copy.is_active).toBe(1);
    expect(JSON.parse(copy.ingredients)).toEqual(JSON.parse(original.ingredients));

    // The original is completely untouched — same weight/remaining as
    // before, same ingredients, same is_active.
    const rereadOriginal = await potRepo.getPot(db, original.id);
    expect(rereadOriginal?.total_weight_g).toBe(1000);
    expect(rereadOriginal?.remaining_g).toBe(700);
    expect(rereadOriginal?.is_active).toBe(1);

    // The original's already-logged serving is untouched.
    const entries = await db.getAllAsync<{ pot_id: string; grams: number }>('SELECT pot_id, grams FROM food_entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ pot_id: original.id, grams: 300 });
  });

  it('works on a finished pot — "cook this again" is the whole point of a finished pot being a recipe', async () => {
    const db = await freshDb();
    const original = await createPot(db, {
      name: 'Dal',
      totalWeightG: 500,
      ingredients: [{ name: 'lentils', grams: 500, kcal: 600, protein_g: 40, carbs_g: 90, fat_g: 4, confidence: 'exact' }],
    });
    await finishPot(db, original.id);

    const copy = await duplicatePotForCookAgain(db, original.id);
    expect(copy.is_active).toBe(1); // the copy starts fresh, not finished
    expect(copy.total_weight_g).toBeNull();

    const rereadOriginal = await potRepo.getPot(db, original.id);
    expect(rereadOriginal?.is_active).toBe(0); // the original stays finished
  });

  it('throws for an unknown source pot id', async () => {
    const db = await freshDb();
    await expect(duplicatePotForCookAgain(db, 'nope')).rejects.toThrow();
  });
});

describe('potRemainingStatus', () => {
  it('reports "Not yet weighed" for a null remaining_g', () => {
    expect(potRemainingStatusFromFields(null, null)).toEqual({ label: 'Not yet weighed', low: false });
  });

  it('reports "About empty" (and low: true) at exactly zero — never a bare "0g left"', () => {
    expect(potRemainingStatusFromFields(0, 1000)).toEqual({ label: 'About empty', low: true });
  });

  it('reports a plain "Xg left" for a comfortably large remainder', () => {
    expect(potRemainingStatusFromFields(500, 1000)).toEqual({ label: '500g left', low: false });
  });

  it('flags "running low" below the absolute floor even for a small original batch', () => {
    const status = potRemainingStatusFromFields(40, 100);
    expect(status.low).toBe(true);
    expect(status.label).toBe('40g left · running low');
  });

  it('flags "running low" by fraction of the original batch even above the absolute floor', () => {
    // 200g of a 3000g batch is comfortably above the absolute floor but a
    // small fraction of a large batch — still worth calling out.
    const status = potRemainingStatusFromFields(200, 3000);
    expect(status.low).toBe(true);
  });

  it('does not flag "running low" for a healthy remainder of an unknown-size batch (total_weight_g null)', () => {
    // Can happen after totalWeightG is unset via an edit while remaining_g
    // from before the unset lingers in a stale local copy — defensive.
    const status = potRemainingStatusFromFields(500, null);
    expect(status.low).toBe(false);
  });

  it('potRemainingStatus reads directly off a PotRow', async () => {
    const db = await freshDb();
    const pot = await createPot(db, {
      name: 'Batch',
      totalWeightG: 1000,
      ingredients: [{ name: 'x', grams: 1000, kcal: 1500, protein_g: 100, carbs_g: 150, fat_g: 30, confidence: 'exact' }],
    });
    expect(potRemainingStatus(pot)).toEqual({ label: '1000g left', low: false });
  });
});
