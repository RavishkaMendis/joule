// ═══════════════════════════════════════════════════════════════════════
// oneRepMax — estimated 1-rep max from a single logged set.
//
// Formula: EPLEY, not Brzycki. Both are standard; the choice matters at
// the edges, and this app's own accessory work (leg curls, lateral
// raises, planks-adjacent isolation sets) routinely lands in the
// mid-teens for reps, which is exactly where the two formulas diverge in
// how they fail:
//
//   Epley:   1RM = w * (1 + r/30)
//   Brzycki: 1RM = w * 36 / (37 - r)
//
// Brzycki has a singularity at r = 37 (division by zero) and goes
// NEGATIVE for any r > 37 — a "max" that comes out negative is a worse
// failure mode than one that is merely imprecise, and nothing stops a
// real set of high-rep leg curls from landing north of 20 reps. Epley
// degrades gracefully instead: it keeps producing a plausible (if
// increasingly unreliable) number as reps climb, with no discontinuity.
// It is also the more common industry default (Strong, Hevy, and most
// strength-tracking apps use it), so numbers here will match what the
// user may have seen elsewhere.
//
// Neither formula is reliable far from the ~1-10 rep range it was
// validated on, so this module does not paper over that: every estimate
// carries a confidence band, and callers (UI) must render it accordingly
// (CLAUDE.md/PRD §10: "a ±15% photo estimate must not look identical to a
// barcode scan" — same principle, applied to a set of 12 vs. a set of 3).
// ═══════════════════════════════════════════════════════════════════════

export type OneRepMaxConfidence = 'high' | 'medium' | 'low';

export type OneRepMaxEstimate = {
  /** Estimated 1-rep max, in the same unit as the input weight (kg). */
  value: number;
  /**
   * high  — reps <= 5, well inside Epley's validated range (includes the
   *         reps === 1 case, which is not an estimate at all — the
   *         logged weight IS the 1RM).
   * medium — reps 6-12, moderate extrapolation.
   * low   — reps > 12, extrapolation far outside the range either formula
   *         was validated on. Still computed (never withheld — the PRD's
   *         confidence ladder always shows a number, just faded/labelled,
   *         never a blank), but must not be presented with the same
   *         visual weight as a high-confidence estimate.
   */
  confidence: OneRepMaxConfidence;
};

/**
 * Estimate 1RM from one set. Returns `null` for inputs with no valid
 * strength signal — a non-finite value, negative weight (a data error;
 * weight_kg should never be negative), or zero/negative reps (a set that
 * was never actually performed carries no information, and must not be
 * silently treated as an implicit floor of 0 the way an unlogged food day
 * must never be treated as an implicit 0 kcal — see CLAUDE.md "missing
 * data is never imputed").
 *
 * `weightKg === 0` (a bodyweight exercise with no added load) is valid
 * and returns an estimate of 0 — that is an honest answer ("no external
 * load basis"), not a degenerate one.
 */
export function estimateOneRepMax(weightKg: number, reps: number): OneRepMaxEstimate | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null;
  if (weightKg < 0 || reps <= 0) return null;

  // A single IS the max, not an estimate of it.
  if (reps === 1) return { value: weightKg, confidence: 'high' };

  const value = weightKg * (1 + reps / 30);
  const confidence: OneRepMaxConfidence = reps <= 5 ? 'high' : reps <= 12 ? 'medium' : 'low';
  return { value, confidence };
}
