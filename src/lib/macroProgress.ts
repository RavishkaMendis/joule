// ═══════════════════════════════════════════════════════════════════════
// macroProgress — pure helpers behind StatusBlock's macro row (PRD §9.1).
//
// PRD §9.1 spec: `P 142/165   C 180/220   F 58/62`. The row needs to read
// as "amount against target" at a glance, protein weighted first (§9.1:
// "the macro that matters and the one most often missed"), with a thin
// linear fill as the comparison aid — NOT a ring (§9.1 explicitly rejects
// decorative rings on the status block) and NOT a colour-coded
// over/under signal (§10 / CLAUDE.md: no red, no guilt — over-target and
// under-target render identically).
//
// Kept pure and separate from StatusBlock.tsx so the ratio/clamp math is
// unit-testable (this repo's Jest config cannot render RN components —
// see that file's test for the coverage this buys).
// ═══════════════════════════════════════════════════════════════════════

export type MacroProgress = {
  /** Raw value / target, unclamped — negative only if value is negative (never happens in practice). */
  ratio: number | null;
  /**
   * Fill width fraction for the thin progress indicator, clamped to
   * [0, 1]. Over-target still renders a full (1.0) bar, never a longer
   * one and never a differently-coloured one — the bar communicates
   * "how full", not "how over" (no guilt signal, PRD §10).
   */
  fillFraction: number;
  /** True once value meets or exceeds target — drives no colour change, only used by callers that want an accessibility label. */
  isOverTarget: boolean;
};

/**
 * Computes the fill fraction / over-target flag for one macro. Returns
 * `null` progress (fillFraction 0, isOverTarget false) semantics when
 * there is no target yet — callers should render the amount alone
 * ("33 / —") rather than a zero-filled bar, since a bar with nothing to
 * measure against would misleadingly read as "0% of nothing".
 */
export function computeMacroProgress(value: number, target: number | null): MacroProgress {
  if (target === null || !Number.isFinite(target) || target <= 0) {
    return { ratio: null, fillFraction: 0, isOverTarget: false };
  }
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const ratio = safeValue / target;
  return {
    ratio,
    fillFraction: Math.max(0, Math.min(1, ratio)),
    isOverTarget: ratio >= 1,
  };
}
