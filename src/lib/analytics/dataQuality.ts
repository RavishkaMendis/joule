// ═══════════════════════════════════════════════════════════════════════
// DATA QUALITY — shared "weakest wins" helper for the analytics layer.
//
// Root cause of the honesty defect this file exists to fix: `TDEEResult`
// (src/engine/types.ts) carries `dataQuality: 'seeding' | 'converging' |
// 'stable'` so the engine can tell a Mifflin-St Jeor cold-start seed apart
// from a measured estimate. The analytics layer (useTrendsData, the
// energy-balance and weekly-rollup modules) was discarding that field the
// moment it touched a chart-ready shape, so every downstream panel showed
// a seeded number identically to a measured one — see PRD §4.3 ("Display
// it clearly labelled 'Estimated — collecting data' ... Do not pretend
// it's measured") and §10 ("Confidence always visible").
//
// This module only defines an ordering and a reducer over that ordering.
// It does not compute or reclassify quality itself — that stays the
// engine's job (src/engine/tdee.ts's classifyDataQuality). Analytics code
// only ever propagates a quality value it was handed, never invents one.
// ═══════════════════════════════════════════════════════════════════════

import type { DataQuality } from '../../engine/types';

/** Weakest (least trustworthy) to strongest, matching PRD §4.3's cold-start progression. */
const QUALITY_RANK: Record<DataQuality, number> = {
  seeding: 0,
  converging: 1,
  stable: 2,
};

/** True if `a` is weaker (less trustworthy) than `b`. */
export function isWeakerQuality(a: DataQuality, b: DataQuality): boolean {
  return QUALITY_RANK[a] < QUALITY_RANK[b];
}

/**
 * Returns the weakest (least trustworthy) quality among the given values.
 *
 * Used in two places with the same underlying rule — "a derived figure is
 * only as trustworthy as its least trustworthy input":
 *   - `interpolateExpenditure`: a day interpolated between a seeded cutoff
 *     and a converging/stable one inherits the seeded quality. It is not
 *     an average of trust; a single seeded neighbour is enough to make the
 *     interpolated point itself unreliable.
 *   - `buildWeeklyRollup`: a week's expenditure quality is the weakest
 *     quality among the days that contributed to its average, not the most
 *     recent or most common one.
 *
 * Returns null for an empty input — "no contributing days" is a distinct,
 * honest state from any real quality level and must not silently default
 * to 'stable' (the friendliest-looking value) or 'seeding' (a fabricated
 * pessimism about data that doesn't exist).
 */
export function weakestQuality(qualities: DataQuality[]): DataQuality | null {
  if (qualities.length === 0) return null;
  return qualities.reduce((worst, q) => (isWeakerQuality(q, worst) ? q : worst));
}
