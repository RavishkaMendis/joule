// ═══════════════════════════════════════════════════════════════════════
// ATWATER CROSS-CHECK — macro-vs-energy consistency, PRD §6/§7.
//
// The bug that motivated this module: a real logged Open Food Facts entry
// ("H2coco Lychee Coconut Water", 1000g, 0P/67C/0F) claimed 64 kcal. 67g
// of carbohydrate alone is 268 kcal (4 kcal/g). The entry was
// arithmetically impossible, and NOTHING in this codebase caught it,
// because the only existing rail — `isPlausibleKcalPer100g` (0-900) in
// pendingEntry.ts — is one-directional: it exists to catch a value read
// ~4x too HIGH (kJ misread as kcal). A value ~4x too LOW (this bug: a kJ
// default applied to what was actually a kcal figure) sails straight
// through it, because 6.4 kcal/100g is a perfectly "plausible" number for
// SOME food, just not for one that's 6.7% carbohydrate by weight.
//
// The fix at the source (openFoodFacts.ts's `resolveKcalPer100g`) closes
// the one known cause. This module is the SYSTEMIC fix: a macro-vs-energy
// consistency check applied at every point nutrition data enters the app,
// so the next unit bug — in label OCR, a Gemini estimate, an AFCD row
// typo, a hand-typed entry, a pot ingredient — gets caught the same way,
// regardless of which of the five input paths it came through.
//
//   expectedKcal = 4·protein_g + 4·carbs_g + 9·fat_g
//
// These are the same Atwater general factors nutrition panels themselves
// are built from (4 kcal/g for protein and carbohydrate, 9 kcal/g for
// fat) — not a stricter or looser standard than the one the food industry
// already uses to justify its own printed numbers.
//
// ── TOLERANCE — chosen to be realistic, not merely convenient ──────────
//
// Percentage: 20% of the macro-derived (expected) kcal figure.
//
//   Why 20%, not something tighter: the FDA's own nutrition-labeling
//   compliance rule (21 CFR 101.9) allows a food's LABELLED calorie count
//   to differ from an independent lab measurement by up to 20% before
//   it's considered out of compliance. This app is not a lab and isn't
//   trying to be one — reusing the tolerance regulators already accept
//   from real manufacturers is a defensible, externally-anchored choice
//   rather than an arbitrary number tuned to make tests pass. Real,
//   honest panels legitimately drift by close to this much because:
//     - Fibre is counted at 0-2 kcal/g on many panels (it's not fully
//       metabolised) but this check's plain Atwater formula has no
//       separate fibre term, so a high-fibre food (legumes, bran) looks
//       "over-energy" by design, not by error.
//     - Sugar alcohols run ~2.4 kcal/g, not the 4 kcal/g this formula
//       uses for all carbohydrate — a sugar-free product can look
//       "under-energy" for the same structural reason.
//     - Panel-level rounding (to the nearest 1, 5, or even 10 kcal, and
//       to the nearest 1g per macro) compounds across three multiplied
//       terms.
//   Why not looser than 20%: the bug this module exists to catch is a
//   ~4x (300%+) unit error. A tolerance an order of magnitude tighter
//   than that error still leaves an enormous margin to avoid crying wolf
//   on genuinely honest panels, so there is no accuracy reason to widen
//   past the externally-anchored 20% figure.
//
// Absolute floor: 50 kcal.
//
//   A pure percentage rule misfires on small entries: a splash of milk in
//   coffee at "6 kcal, 0P/1C/0F" is nominally "50% off" (4 expected vs 6
//   stated) but is obviously fine — nobody should see a disagreement
//   flagged over 2 kcal. 50 kcal is large enough to silence that noise
//   (a typical rounding/estimation spread on a small item) while staying
//   far too small to mask the bug class this exists to catch: even a
//   modest 100g portion carrying a 4x energy error is off by hundreds of
//   kcal, not tens.
//
// Both are combined as `max(0.20 * expectedKcal, 50)`, evaluated against
// whatever quantity is actually about to be logged (the entry's current
// absolute kcal/macros, not a fixed per-100g basis) — see each call site
// for why: checking at the logged quantity is what makes the coconut
// water case (which only becomes a large ABSOLUTE discrepancy once
// scaled to the real 1000g/1L bottle) actually trip the check.
//
// ── WHAT COUNTS AS "CAN'T CHECK" ─────────────────────────────────────
//
// An entry with any of the four figures missing (energy or any one
// macro) cannot be cross-checked at all — a partial panel isn't wrong,
// it's just incomplete, and inventing a missing macro as 0 to force a
// comparison would be exactly the kind of imputation this whole app's
// philosophy (CLAUDE.md: "missing data is never imputed") forbids. This
// module treats that as `status: 'unknown'`, never as a false positive OR
// a false "it's fine".
//
// Zero-macro foods (black coffee, plain water) are handled for free by
// the floor: expectedKcal is 0, so anything within 50 kcal of 0 reads as
// consistent — exactly the legitimately-zero-and-tiny range these foods
// occupy. A genuinely wrong "400 kcal" stated for a 0/0/0 water entry
// still trips the check (400 - 0 = 400 ≫ 50).
// ═══════════════════════════════════════════════════════════════════════

/** Fractional tolerance applied to the macro-derived (expected) kcal figure. See module doc for the FDA-anchored justification. */
export const ATWATER_TOLERANCE_FRACTION = 0.2;

/** Absolute kcal floor beneath which a disagreement is never flagged, regardless of percentage. See module doc for why small entries need this. */
export const ATWATER_TOLERANCE_FLOOR_KCAL = 50;

/** The macro/energy figures needed to cross-check one entry — whatever unit basis the caller is checking at (per-100g, per-serving, or an absolute logged quantity), as long as all four are on the SAME basis. */
export type AtwaterInput = {
  kcal: number | null | undefined;
  protein_g: number | null | undefined;
  carbs_g: number | null | undefined;
  fat_g: number | null | undefined;
};

export type AtwaterCheckResult =
  | {
      /** One or more of kcal/protein/carbs/fat is missing or non-finite — there is nothing to compare. Never treat this as either "consistent" or "inconsistent". */
      status: 'unknown';
    }
  | {
      /** Stated energy is within tolerance of the macro-derived figure. */
      status: 'ok';
      statedKcal: number;
      expectedKcal: number;
      diffKcal: number;
      toleranceKcal: number;
    }
  | {
      /** Stated energy and macro-derived energy disagree by more than tolerance — a fact to surface, never to silently correct. */
      status: 'mismatch';
      statedKcal: number;
      expectedKcal: number;
      diffKcal: number;
      toleranceKcal: number;
    };

/** Standard Atwater general factors: 4 kcal/g protein, 4 kcal/g carbohydrate, 9 kcal/g fat. The same factors nutrition panels are themselves built from. */
export function expectedKcalFromMacros(protein_g: number, carbs_g: number, fat_g: number): number {
  return 4 * protein_g + 4 * carbs_g + 9 * fat_g;
}

/** `max(20% of expectedKcal, 50 kcal)` — see module doc for the justification of both numbers. */
export function atwaterToleranceKcal(expectedKcal: number): number {
  return Math.max(ATWATER_TOLERANCE_FRACTION * expectedKcal, ATWATER_TOLERANCE_FLOOR_KCAL);
}

/**
 * Cross-checks one entry's stated energy against what its own macros
 * imply. Pure, synchronous, no knowledge of where the entry came from —
 * every input path (barcode/OFF, label OCR, meal photo, voice, AFCD,
 * saved foods, manual entry, pot ingredients) can call this identically.
 *
 * `status: 'unknown'` whenever any of the four figures is missing/
 * non-finite — see module doc: incomplete data is not the same as
 * disagreeing data, and must never be reported as either.
 */
export function checkAtwaterConsistency(input: AtwaterInput): AtwaterCheckResult {
  const { kcal, protein_g, carbs_g, fat_g } = input;

  if (
    kcal === null ||
    kcal === undefined ||
    protein_g === null ||
    protein_g === undefined ||
    carbs_g === null ||
    carbs_g === undefined ||
    fat_g === null ||
    fat_g === undefined ||
    !Number.isFinite(kcal) ||
    !Number.isFinite(protein_g) ||
    !Number.isFinite(carbs_g) ||
    !Number.isFinite(fat_g)
  ) {
    return { status: 'unknown' };
  }

  const expectedKcal = expectedKcalFromMacros(protein_g, carbs_g, fat_g);
  const diffKcal = kcal - expectedKcal;
  const toleranceKcal = atwaterToleranceKcal(expectedKcal);

  if (Math.abs(diffKcal) <= toleranceKcal) {
    return { status: 'ok', statedKcal: kcal, expectedKcal, diffKcal, toleranceKcal };
  }
  return { status: 'mismatch', statedKcal: kcal, expectedKcal, diffKcal, toleranceKcal };
}

/**
 * The one neutral, factual sentence surfaced for a mismatch (PRD §10: no
 * red, no guilt — this is information, never an accusation). Never
 * states which figure is "right"; both the stated and macro-derived
 * numbers are shown so the human — not the app — decides which to keep.
 */
export function formatAtwaterNote(result: Extract<AtwaterCheckResult, { status: 'mismatch' }>): string {
  const stated = Math.round(result.statedKcal);
  const expected = Math.round(result.expectedKcal);
  return `Stated energy is ${stated} kcal, but protein/carbs/fat add up to about ${expected} kcal.`;
}
