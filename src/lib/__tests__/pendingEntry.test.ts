// ═══════════════════════════════════════════════════════════════════════
// PENDING ENTRY — quantity multiplier / portion fraction scaling tests.
//
// This is the pure-maths seam behind the ConfirmSheet's ×2 / ½ / ⅓ / ¾
// one-tap controls (PRD §7.4, §9.1's 10-second test). Silently wrong
// macro maths is the worst outcome here, so this file is deliberately
// exhaustive: both edit orders (multiplier-then-grams and
// grams-then-multiplier), fraction-then-multiplier composition,
// per100g-present vs per100g-absent, repeated taps (no compounding),
// and the confidence-promotion ladder.
// ═══════════════════════════════════════════════════════════════════════

import {
  applyGramsEdit,
  applyMultiplierWithPromotion,
  applyQuantityMultiplier,
  formatServingQuantity,
  getBaseline,
  initializeServingDisplay,
  pendingEntryFromQuickAdd,
  promoteConfidenceForUserQuantity,
  QUICK_ADD_PRESETS,
  rebaseQuantity,
  scaleFromPer100g,
  toggleDisplayUnit,
} from '../pendingEntry';
import type { PendingEntry } from '../pendingEntry';

function baseEntry(overrides: Partial<PendingEntry> = {}): PendingEntry {
  return {
    name: 'Grilled chicken breast',
    grams: 150,
    kcal: 300,
    protein_g: 45,
    carbs_g: 0,
    fat_g: 12,
    confidence: 'medium',
    source: 'meal_photo',
    ...overrides,
  };
}

describe('getBaseline', () => {
  it('synthesizes a baseline from current fields when none is set', () => {
    const e = baseEntry();
    expect(getBaseline(e)).toEqual({ grams: 150, kcal: 300, protein_g: 45, carbs_g: 0, fat_g: 12 });
  });

  it('returns the explicit baseline when present, ignoring current (already-scaled) fields', () => {
    const e = baseEntry({
      grams: 300,
      kcal: 600,
      protein_g: 90,
      carbs_g: 0,
      fat_g: 24,
      baseline: { grams: 150, kcal: 300, protein_g: 45, carbs_g: 0, fat_g: 12 },
    });
    expect(getBaseline(e)).toEqual({ grams: 150, kcal: 300, protein_g: 45, carbs_g: 0, fat_g: 12 });
  });
});

describe('applyQuantityMultiplier — the minimum bar', () => {
  it('×2 of a 150g/300kcal entry gives exactly 300g/600kcal (no per100g)', () => {
    const e = baseEntry();
    const scaled = applyQuantityMultiplier(e, 2);
    expect(scaled.grams).toBe(300);
    expect(scaled.kcal).toBe(600);
    expect(scaled.protein_g).toBe(90);
    expect(scaled.carbs_g).toBe(0);
    expect(scaled.fat_g).toBe(24);
    expect(scaled.quantityMultiplier).toBe(2);
  });

  it('scales every macro by the same factor, keeping kcal/macros internally consistent', () => {
    const e = baseEntry({ grams: 100, kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5 });
    const scaled = applyQuantityMultiplier(e, 3);
    expect(scaled.grams).toBe(300);
    expect(scaled.kcal).toBe(600);
    expect(scaled.protein_g).toBe(60);
    expect(scaled.carbs_g).toBe(75);
    expect(scaled.fat_g).toBe(15);
  });

  it('a multiplier of 1 is a no-op on the numbers', () => {
    const e = baseEntry();
    const scaled = applyQuantityMultiplier(e, 1);
    expect(scaled.grams).toBe(150);
    expect(scaled.kcal).toBe(300);
    expect(scaled.protein_g).toBe(45);
    expect(scaled.fat_g).toBe(12);
  });

  it('ignores non-finite or non-positive multipliers (returns entry unchanged)', () => {
    const e = baseEntry();
    expect(applyQuantityMultiplier(e, 0)).toBe(e);
    expect(applyQuantityMultiplier(e, -2)).toBe(e);
    expect(applyQuantityMultiplier(e, NaN)).toBe(e);
    expect(applyQuantityMultiplier(e, Infinity)).toBe(e);
  });

  it('pins a baseline on first use so repeated taps do not compound', () => {
    const e = baseEntry();
    const once = applyQuantityMultiplier(e, 2);
    // Applying ×2 again from the *already-scaled* `once` entry must still
    // scale from the original 150g baseline, not from once.grams (300g) —
    // i.e. re-tapping "×2" replaces the multiplier, it does not multiply
    // the multiplier.
    const twice = applyQuantityMultiplier(once, 2);
    expect(twice.grams).toBe(300); // still ×2 of 150g baseline, not ×4
    expect(twice.kcal).toBe(600);
    expect(twice.quantityMultiplier).toBe(2);
  });

  it('switching from ×2 directly to ×3 scales from the pinned baseline, not from ×2 state', () => {
    const e = baseEntry();
    const doubled = applyQuantityMultiplier(e, 2);
    expect(doubled.grams).toBe(300);
    const tripled = applyQuantityMultiplier(doubled, 3);
    expect(tripled.grams).toBe(450); // 150 * 3, not 300 * 3 = 900
    expect(tripled.kcal).toBe(900);
  });
});

describe('applyQuantityMultiplier — per100g present vs absent', () => {
  const per100g = { kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5 };

  it('when per100g is present, macros re-derive via scaleFromPer100g against effective grams', () => {
    const e = baseEntry({ grams: 100, kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5, per100g });
    const scaled = applyQuantityMultiplier(e, 2);
    const expected = scaleFromPer100g(per100g, 200);
    expect(scaled.grams).toBe(200);
    expect(scaled.kcal).toBe(expected.kcal);
    expect(scaled.protein_g).toBe(expected.protein_g);
    expect(scaled.carbs_g).toBe(expected.carbs_g);
    expect(scaled.fat_g).toBe(expected.fat_g);
  });

  it('per100g path and absolute-scaling path agree when per100g is exactly the baseline ratio', () => {
    // 100g baseline at these per100g values means "scale absolutes" and
    // "re-derive from per100g" must produce identical numbers.
    const withPer100g = baseEntry({ grams: 100, kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5, per100g });
    const withoutPer100g = baseEntry({ grams: 100, kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5 });

    const a = applyQuantityMultiplier(withPer100g, 1.5);
    const b = applyQuantityMultiplier(withoutPer100g, 1.5);

    expect(a.grams).toBe(b.grams);
    expect(a.kcal).toBeCloseTo(b.kcal, 10);
    expect(a.protein_g).toBeCloseTo(b.protein_g, 10);
    expect(a.carbs_g).toBeCloseTo(b.carbs_g, 10);
    expect(a.fat_g).toBeCloseTo(b.fat_g, 10);
  });

  it('does NOT compound a multiplier onto stale absolutes when per100g is present (the documented failure mode)', () => {
    // Simulate a barcode entry already displayed at 200g (×2 applied
    // once), then re-derive at ×2 again the wrong way (from `entry.kcal`
    // instead of from baseline) to prove our function avoids it.
    const e = baseEntry({ grams: 100, kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5, per100g });
    const doubled = applyQuantityMultiplier(e, 2); // 200g, 400kcal
    const stillDoubled = applyQuantityMultiplier(doubled, 2); // must stay 200g/400kcal, not become 400g/800kcal
    expect(stillDoubled.grams).toBe(200);
    expect(stillDoubled.kcal).toBe(400);
  });
});

describe('portion fraction is the same mechanism as a multiplier', () => {
  it('½ portion halves grams and every macro', () => {
    const e = baseEntry({ grams: 200, kcal: 400, protein_g: 40, carbs_g: 50, fat_g: 10 });
    const half = applyQuantityMultiplier(e, 0.5);
    expect(half.grams).toBe(100);
    expect(half.kcal).toBe(200);
    expect(half.protein_g).toBe(20);
    expect(half.carbs_g).toBe(25);
    expect(half.fat_g).toBe(5);
  });

  it('⅓ portion scales by exactly 1/3', () => {
    const e = baseEntry({ grams: 300, kcal: 900, protein_g: 60, carbs_g: 90, fat_g: 30 });
    const third = applyQuantityMultiplier(e, 1 / 3);
    expect(third.grams).toBeCloseTo(100, 10);
    expect(third.kcal).toBeCloseTo(300, 10);
    expect(third.protein_g).toBeCloseTo(20, 10);
  });

  it('fraction then multiplier both scale from the same pinned baseline, not from each other', () => {
    const e = baseEntry({ grams: 200, kcal: 400, protein_g: 40, carbs_g: 50, fat_g: 10 });
    const half = applyQuantityMultiplier(e, 0.5);
    expect(half.grams).toBe(100);
    // Tapping ×2 next means "2x the identified quantity", i.e. baseline
    // (200g) × 2 = 400g — it does NOT mean "undo the ½ I just tapped"
    // (which would only coincidentally look like 200g). Every tap is
    // relative to the original baseline, never to the last tap's result,
    // which is exactly what prevents compounding.
    const doubled = applyQuantityMultiplier(half, 2);
    expect(doubled.grams).toBe(400);
    expect(doubled.kcal).toBe(800);
    expect(doubled.protein_g).toBe(80);
  });

  it('¾ then ×3 multiplies from the same original baseline, not from the ¾ result', () => {
    const e = baseEntry({ grams: 100, kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5 });
    const threeQuarters = applyQuantityMultiplier(e, 0.75);
    expect(threeQuarters.grams).toBe(75);
    const tripled = applyQuantityMultiplier(threeQuarters, 3);
    expect(tripled.grams).toBe(300); // 100 * 3, not 75 * 3 = 225
    expect(tripled.kcal).toBe(600);
  });
});

describe('rebaseQuantity — grams-edit interaction (both orders)', () => {
  it('multiplier then manual grams edit: editing grams directly should not be silently overwritten by the old multiplier', () => {
    const e = baseEntry({ grams: 150, kcal: 300, protein_g: 45, carbs_g: 0, fat_g: 12 });
    const doubled = applyQuantityMultiplier(e, 2); // 300g baseline pinned at 150g
    // User now manually types 250g into the grams field. The UI applies
    // this as a direct edit (e.g. via scaleFromPer100g or proportional
    // scaling elsewhere) and then rebases so the multiplier no longer
    // silently reasserts the old baseline.
    const manuallyEdited: PendingEntry = { ...doubled, grams: 250, kcal: 500, protein_g: 75, carbs_g: 0, fat_g: 20 };
    const rebased = rebaseQuantity(manuallyEdited);
    expect(rebased.quantityMultiplier).toBe(1);
    expect(rebased.baseline).toEqual({ grams: 250, kcal: 500, protein_g: 75, carbs_g: 0, fat_g: 20 });

    // A subsequent ×2 now scales from the manual edit, not the pre-edit baseline.
    const redoubled = applyQuantityMultiplier(rebased, 2);
    expect(redoubled.grams).toBe(500);
    expect(redoubled.kcal).toBe(1000);
  });

  it('manual grams edit then multiplier: ×2 applied after a fresh grams edit scales from that edit', () => {
    const e = baseEntry({ grams: 150, kcal: 300, protein_g: 45, carbs_g: 0, fat_g: 12 });
    // Direct grams edit to 200g happens first (simulating rescaleForGrams
    // in ConfirmSheet), then rebased so it becomes the new baseline.
    const edited: PendingEntry = { ...e, grams: 200, kcal: 400, protein_g: 60, carbs_g: 0, fat_g: 16 };
    const rebased = rebaseQuantity(edited);
    const doubled = applyQuantityMultiplier(rebased, 2);
    expect(doubled.grams).toBe(400);
    expect(doubled.kcal).toBe(800);
    expect(doubled.protein_g).toBe(120);
  });
});

describe('pendingEntryFromQuickAdd — cooking oil/ghee presets', () => {
  it('1 tbsp oil (~14g) derives kcal from its per100g basis, not a hardcoded number', () => {
    const preset = QUICK_ADD_PRESETS.find((p) => p.id === 'oil_tbsp')!;
    const entry = pendingEntryFromQuickAdd(preset);
    expect(entry.grams).toBe(14);
    expect(entry.kcal).toBeCloseTo((884 * 14) / 100, 5);
    expect(entry.fat_g).toBeCloseTo(14, 5);
    expect(entry.per100g).toEqual(preset.per100g);
  });

  it('marks quick-added oil/ghee as high confidence, not low — a stated quantity beats a model guess', () => {
    for (const preset of QUICK_ADD_PRESETS) {
      const entry = pendingEntryFromQuickAdd(preset);
      expect(entry.confidence).toBe('high');
      expect(entry.confidence).not.toBe('exact'); // exact stays reserved for barcode/label data
    }
  });

  it('a quick-added preset can subsequently take a multiplier like any other row (e.g. 2 tbsp oil)', () => {
    const preset = QUICK_ADD_PRESETS.find((p) => p.id === 'oil_tbsp')!;
    const entry = pendingEntryFromQuickAdd(preset);
    const doubled = applyQuantityMultiplier(entry, 2);
    expect(doubled.grams).toBe(28);
    expect(doubled.kcal).toBeCloseTo((884 * 28) / 100, 5);
  });
});

describe('applyGramsEdit — confidence anchoring across repeated keystrokes', () => {
  it('typing a multi-digit grams value one keystroke at a time promotes only once, not per keystroke', () => {
    // Regression test for a bug caught during implementation: promoting
    // from the entry's own (already-mutated) confidence on every
    // keystroke would take `low` all the way to `high` after typing just
    // two characters of "100", when the correct behaviour is a single
    // rung of promotion for the one logical edit.
    let entry = baseEntry({ confidence: 'low' });
    const original = entry.confidence;

    entry = applyGramsEdit(entry, 1, original);
    expect(entry.confidence).toBe('medium');

    entry = applyGramsEdit(entry, 10, original);
    expect(entry.confidence).toBe('medium'); // still one rung up, not two

    entry = applyGramsEdit(entry, 100, original);
    expect(entry.confidence).toBe('medium'); // still one rung up, not three
  });

  it('rebases so a multiplier tapped after a manual grams edit scales from the edited value', () => {
    const entry = baseEntry({ grams: 150, kcal: 300, protein_g: 45, carbs_g: 0, fat_g: 12 });
    const edited = applyGramsEdit(entry, 250, entry.confidence);
    expect(edited.baseline).toEqual({ grams: 250, kcal: 500, protein_g: 75, carbs_g: 0, fat_g: 20 });
    expect(edited.quantityMultiplier).toBe(1);

    const thenDoubled = applyQuantityMultiplier(edited, 2);
    expect(thenDoubled.grams).toBe(500); // 250 * 2, not 150 * 2
    expect(thenDoubled.kcal).toBe(1000);
  });

  it('re-derives via per100g when present rather than scaling stale absolutes', () => {
    const per100g = { kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5 };
    const entry = baseEntry({ grams: 100, kcal: 200, protein_g: 20, carbs_g: 25, fat_g: 5, per100g });
    const edited = applyGramsEdit(entry, 250, entry.confidence);
    const expected = scaleFromPer100g(per100g, 250);
    expect(edited.kcal).toBe(expected.kcal);
    expect(edited.protein_g).toBe(expected.protein_g);
  });
});

describe('applyMultiplierWithPromotion — confidence anchoring across chip switches', () => {
  it('switching chips (×2 then ×3 then ½) promotes once from the original rating, never compounding', () => {
    const original = 'low' as const;
    let entry = baseEntry({ confidence: original });

    entry = applyMultiplierWithPromotion(entry, 2, original);
    expect(entry.confidence).toBe('medium');

    entry = applyMultiplierWithPromotion(entry, 3, original);
    expect(entry.confidence).toBe('medium'); // still one rung, not two

    entry = applyMultiplierWithPromotion(entry, 0.5, original);
    expect(entry.confidence).toBe('medium'); // still one rung, not three
  });

  it('tapping ×1 restores originalConfidence rather than promoting (quiet default, not an assertion)', () => {
    const original = 'low' as const;
    let entry = baseEntry({ confidence: original });

    entry = applyMultiplierWithPromotion(entry, 2, original);
    expect(entry.confidence).toBe('medium');

    entry = applyMultiplierWithPromotion(entry, 1, original);
    expect(entry.confidence).toBe('low');
    expect(entry.grams).toBe(150); // back to the baseline amount too
  });

  it('never promotes past high — exact stays reserved for barcode/label data', () => {
    const entry = baseEntry({ confidence: 'high' });
    const scaled = applyMultiplierWithPromotion(entry, 2, 'high');
    expect(scaled.confidence).toBe('high');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REGRESSION — "Low confidence in the sheet, high on Today after saving"
// (device report). PRD §10: a rough photo estimate must never look like a
// scanned label; confidence must not climb two rungs between what the
// sheet displays and what gets written to food_entry.
//
// Audited: ConfirmSheet anchors BOTH `rescaleForGrams` (a grams-field
// edit) and `applyMultiplierToRow` (a x2/x3/1-2/1-3 chip tap) to the same
// fixed `row.originalConfidence` — the confidence the row had when the
// sheet first mounted it, captured once in `toDraft` and never mutated
// afterwards by either operation. This is what prevents the combination
// named in the task brief (grams edit, THEN a multiplier tap, on the same
// row) from compounding past a single rung. These tests exercise that
// combination directly through the two exported pure functions
// ConfirmSheet actually calls (`applyGramsEdit`, `applyMultiplierWithPromotion`)
// anchored to one fixed originalConfidence, exactly as ConfirmSheet does.
// ═══════════════════════════════════════════════════════════════════════
describe('regression: grams edit + multiplier on the same row never compounds past one rung', () => {
  it('low -> grams edit -> medium -> x2 tap -> still medium (not high)', () => {
    const original = 'low' as const;
    let entry: PendingEntry = {
      name: 'Sushi rice', grams: 100, kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3,
      confidence: original, source: 'meal_photo',
    };

    // ConfirmSheet's rescaleForGrams: applyGramsEdit(row, grams, row.originalConfidence)
    entry = { ...entry, ...applyGramsEdit(entry, 250, original) };
    expect(entry.confidence).toBe('medium');

    // ConfirmSheet's applyMultiplierToRow: applyMultiplierWithPromotion(row, m, row.originalConfidence)
    entry = { ...entry, ...applyMultiplierWithPromotion(entry, 2, original) };
    expect(entry.confidence).toBe('medium'); // must NOT reach 'high'
    expect(entry.grams).toBe(500); // 250 baseline x2, numbers stay correct too
  });

  it('low -> x2 tap -> medium -> grams edit -> still medium (reverse order, same cap)', () => {
    const original = 'low' as const;
    let entry: PendingEntry = {
      name: 'Chicken filling', grams: 90, kcal: 149, protein_g: 27.9, carbs_g: 0, fat_g: 3.6,
      confidence: original, source: 'meal_photo',
    };

    entry = { ...entry, ...applyMultiplierWithPromotion(entry, 2, original) };
    expect(entry.confidence).toBe('medium');

    entry = { ...entry, ...applyGramsEdit(entry, 200, original) };
    expect(entry.confidence).toBe('medium'); // must NOT reach 'high'
  });

  it('medium -> grams edit -> high -> x3 tap -> still high (never reaches exact)', () => {
    const original = 'medium' as const;
    let entry: PendingEntry = {
      name: 'Avocado', grams: 50, kcal: 80, protein_g: 1, carbs_g: 4.3, fat_g: 7.4,
      confidence: original, source: 'meal_photo',
    };

    entry = { ...entry, ...applyGramsEdit(entry, 70, original) };
    expect(entry.confidence).toBe('high');

    entry = { ...entry, ...applyMultiplierWithPromotion(entry, 3, original) };
    expect(entry.confidence).toBe('high'); // capped — 'exact' is barcode/label-only
  });

  it('many repeated grams edits (simulating keystroke-by-keystroke typing) promote only once', () => {
    const original = 'low' as const;
    let entry: PendingEntry = {
      name: 'Nori', grams: 5, kcal: 15, protein_g: 1.5, carbs_g: 2, fat_g: 0.1,
      confidence: original, source: 'meal_photo',
    };

    for (const grams of [1, 10, 100, 100.5, 100]) {
      entry = { ...entry, ...applyGramsEdit(entry, grams, original) };
    }
    expect(entry.confidence).toBe('medium'); // one rung for the whole edit session, not five
  });
});

describe('promoteConfidenceForUserQuantity — the confidence rule', () => {
  it('promotes low to medium', () => {
    expect(promoteConfidenceForUserQuantity('low')).toBe('medium');
  });

  it('promotes medium to high', () => {
    expect(promoteConfidenceForUserQuantity('medium')).toBe('high');
  });

  it('leaves high unchanged (does not promote to exact)', () => {
    expect(promoteConfidenceForUserQuantity('high')).toBe('high');
  });

  it('leaves exact unchanged', () => {
    expect(promoteConfidenceForUserQuantity('exact')).toBe('exact');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SAVE-TO-MY-FOODS × MULTIPLIER
//
// The write-back in ConfirmSheet stores a per-100g basis plus a
// default_grams that seeds future quick-add chips. These two behave
// DIFFERENTLY under a multiplier, and conflating them silently corrupts
// the saved foods library — which then propagates into every future
// one-tap log of that food.
// ═══════════════════════════════════════════════════════════════════════

describe('saving a multiplied entry to my foods', () => {
  const base: PendingEntry = {
    name: 'Ayam Tuna Mayonnaise',
    grams: 150,
    kcal: 300,
    protein_g: 24,
    carbs_g: 6,
    fat_g: 20,
    confidence: 'exact',
    source: 'barcode',
  };

  // Mirrors ConfirmSheet's scaleTo100 — kept here so the invariant is
  // asserted against the same arithmetic the sheet performs.
  function scaleTo100(e: Pick<PendingEntry, 'grams' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>) {
    const s = 100 / e.grams;
    return { kcal: e.kcal * s, protein_g: e.protein_g * s, carbs_g: e.carbs_g * s, fat_g: e.fat_g * s };
  }

  it('per-100g basis is INVARIANT under a multiplier', () => {
    const doubled = applyQuantityMultiplier(base, 2);
    expect(doubled.grams).toBe(300);
    expect(doubled.kcal).toBe(600);

    const from1x = scaleTo100(base);
    const from2x = scaleTo100(doubled);
    expect(from2x.kcal).toBeCloseTo(from1x.kcal, 6);
    expect(from2x.protein_g).toBeCloseTo(from1x.protein_g, 6);
    expect(from2x.carbs_g).toBeCloseTo(from1x.carbs_g, 6);
    expect(from2x.fat_g).toBeCloseTo(from1x.fat_g, 6);
    // 300 kcal / 150 g = 200 kcal per 100 g, whatever the multiplier.
    expect(from2x.kcal).toBeCloseTo(200, 6);
  });

  it('per-100g basis is invariant under a FRACTION too', () => {
    const half = applyQuantityMultiplier(base, 0.5);
    expect(half.grams).toBe(75);
    expect(scaleTo100(half).kcal).toBeCloseTo(200, 6);
  });

  it('default_grams must come from the BASELINE, not the multiplied grams', () => {
    const doubled = applyQuantityMultiplier(base, 2);
    // The bug this guards: saving while ×2 is active would store 300g as
    // the default, making every future one-tap quick-add of this food
    // double the real serving.
    expect(getBaseline(doubled).grams).toBe(150);
    expect(doubled.grams).toBe(300);
    expect(getBaseline(doubled).grams).not.toBe(doubled.grams);
  });

  it('baseline survives repeated multiplier changes', () => {
    const doubled = applyQuantityMultiplier(base, 2);
    const tripled = applyQuantityMultiplier(doubled, 3);
    const halved = applyQuantityMultiplier(tripled, 0.5);
    expect(getBaseline(halved).grams).toBe(150);
    expect(halved.grams).toBe(75);
    expect(halved.kcal).toBeCloseTo(150, 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SERVING SIZE DISPLAY — "It logs grams, not serving size, and there's no
// way to change it" (task brief complaint #1). These tests are the
// numerical guarantee behind the unit toggle: a serving-mode ×2 and a
// manual grams edit to the identical gram amount must produce IDENTICAL
// macros — the task brief calls divergence there "silent corruption".
// ═══════════════════════════════════════════════════════════════════════

describe('initializeServingDisplay', () => {
  const per100g = { kcal: 250, protein_g: 8, carbs_g: 33, fat_g: 5 };

  it('defaults to serving mode and resolves grams when servingBasis exists', () => {
    const entry = baseEntry({
      grams: 100,
      kcal: 250,
      protein_g: 8,
      carbs_g: 33,
      fat_g: 5,
      per100g,
      servingBasis: { gramsPerServing: 30, label: '2 slices' },
    });

    const initialized = initializeServingDisplay(entry);
    expect(initialized.displayUnit).toBe('serving');
    expect(initialized.grams).toBe(30);
    expect(initialized.baseline).toEqual({ grams: 30, ...scaleFromPer100g(per100g, 30) });
    expect(initialized.quantityMultiplier).toBe(1);
    // The resolved grams must never be opaque — it's the entry's own `grams` field.
    expect(initialized.kcal).toBeCloseTo((250 * 30) / 100, 6);
  });

  it('defaults to grams mode when no servingBasis is present (every existing caller)', () => {
    const entry = baseEntry({ per100g });
    const initialized = initializeServingDisplay(entry);
    expect(initialized.displayUnit).toBe('grams');
    // Untouched otherwise — existing grams/macros unchanged.
    expect(initialized.grams).toBe(entry.grams);
    expect(initialized.kcal).toBe(entry.kcal);
  });

  it('defaults to grams mode when servingBasis has a non-positive/garbled gram figure', () => {
    const entry = baseEntry({ servingBasis: { gramsPerServing: 0 } });
    expect(initializeServingDisplay(entry).displayUnit).toBe('grams');

    const entryNaN = baseEntry({ servingBasis: { gramsPerServing: NaN } });
    expect(initializeServingDisplay(entryNaN).displayUnit).toBe('grams');
  });

  it('falls back to proportional scaling when servingBasis exists but per100g does not', () => {
    const entry = baseEntry({ grams: 150, kcal: 300, protein_g: 45, carbs_g: 0, fat_g: 12, servingBasis: { gramsPerServing: 75 } });
    const initialized = initializeServingDisplay(entry);
    expect(initialized.grams).toBe(75);
    expect(initialized.kcal).toBe(150);
    expect(initialized.protein_g).toBe(22.5);
  });

  it('a serving-mode ×2 and a manual grams edit to the same amount produce identical macros', () => {
    // This is the specific invariant the task brief calls out: divergence
    // between the two paths is silent corruption.
    const entry = baseEntry({
      grams: 100,
      kcal: 250,
      protein_g: 8,
      carbs_g: 33,
      fat_g: 5,
      per100g,
      servingBasis: { gramsPerServing: 30 },
    });

    const initialized = initializeServingDisplay(entry); // 1 serving = 30g
    const viaServingMultiplier = applyQuantityMultiplier(initialized, 2); // "×2 servings" = 60g

    // A manual grams edit to 60g on the ORIGINAL (un-serving-scaled) entry,
    // going through the existing grams-edit machinery.
    const viaGramsEdit = applyGramsEdit(entry, 60, entry.confidence);

    expect(viaServingMultiplier.grams).toBe(60);
    expect(viaGramsEdit.grams).toBe(60);
    expect(viaServingMultiplier.kcal).toBeCloseTo(viaGramsEdit.kcal, 9);
    expect(viaServingMultiplier.protein_g).toBeCloseTo(viaGramsEdit.protein_g, 9);
    expect(viaServingMultiplier.carbs_g).toBeCloseTo(viaGramsEdit.carbs_g, 9);
    expect(viaServingMultiplier.fat_g).toBeCloseTo(viaGramsEdit.fat_g, 9);
  });

  it('serving-mode ×3 matches scaleFromPer100g at 3 servings worth of grams exactly', () => {
    const entry = baseEntry({ per100g, servingBasis: { gramsPerServing: 40 } });
    const initialized = initializeServingDisplay(entry);
    const tripled = applyQuantityMultiplier(initialized, 3);
    const expected = scaleFromPer100g(per100g, 120);
    expect(tripled.grams).toBe(120);
    expect(tripled.kcal).toBeCloseTo(expected.kcal, 9);
    expect(tripled.protein_g).toBeCloseTo(expected.protein_g, 9);
  });
});

describe('toggleDisplayUnit', () => {
  it('flips grams -> serving -> grams when servingBasis exists', () => {
    const entry = baseEntry({ servingBasis: { gramsPerServing: 30 }, displayUnit: 'grams' });
    const toggled = toggleDisplayUnit(entry);
    expect(toggled.displayUnit).toBe('serving');
    const toggledBack = toggleDisplayUnit(toggled);
    expect(toggledBack.displayUnit).toBe('grams');
  });

  it('does not change grams/macros — it is a pure display-state flip', () => {
    const entry = baseEntry({ grams: 60, kcal: 150, servingBasis: { gramsPerServing: 30 }, displayUnit: 'serving' });
    const toggled = toggleDisplayUnit(entry);
    expect(toggled.grams).toBe(60);
    expect(toggled.kcal).toBe(150);
  });

  it('is a no-op when the entry has no servingBasis', () => {
    const entry = baseEntry();
    expect(toggleDisplayUnit(entry)).toBe(entry);
  });

  it('does not alter confidence — a unit change must never affect the confidence ladder', () => {
    const entry = baseEntry({ confidence: 'exact', servingBasis: { gramsPerServing: 30 } });
    const toggled = toggleDisplayUnit(entry);
    expect(toggled.confidence).toBe('exact');
  });
});

describe('formatServingQuantity', () => {
  it('formats a single serving with its gram equivalent', () => {
    expect(formatServingQuantity(1, 30)).toBe('1 serving · 30 g');
  });

  it('formats multiple whole servings', () => {
    expect(formatServingQuantity(2, 60)).toBe('2 servings · 60 g');
  });

  it('includes the human label when supplied, alongside the gram figure', () => {
    expect(formatServingQuantity(2, 60, '2 slices')).toBe('2 servings (2 slices) · 60 g');
  });

  it('formats a fractional serving count without a trailing zero', () => {
    expect(formatServingQuantity(0.5, 15)).toBe('0.5 servings · 15 g');
  });

  it('rounds the gram readout to the nearest whole gram', () => {
    expect(formatServingQuantity(1, 29.6)).toBe('1 serving · 30 g');
  });
});
