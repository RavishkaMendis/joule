// ═══════════════════════════════════════════════════════════════════════
// TRENDS CHART MATH — pure helpers extracted from useTrendsData.ts.
//
// Deliberately has ZERO imports of anything that transitively pulls in
// expo-sqlite/react-native (useTrendsData.ts itself imports ../lib/db,
// which imports expo-sqlite, which isn't resolvable under this Jest
// config — see task brief: "RN components don't render under this Jest
// config without extra setup"). Splitting the pure day-offset math out
// here is what makes it plain-Node-testable at all.
// ═══════════════════════════════════════════════════════════════════════

/** Cap on how many TDEE re-evaluations useTrendsData runs for the historical TDEE line. */
export const MAX_TDEE_CHART_POINTS = 20;

/** Evenly-spaced day indices (0-based offsets from the window start) to re-evaluate the TDEE history at, capped at maxPoints. */
export function pickChartDayOffsets(totalDays: number, maxPoints: number): number[] {
  if (totalDays < 0) return [];
  if (totalDays <= maxPoints) return Array.from({ length: totalDays + 1 }, (_, i) => i);
  const offsets: number[] = [];
  for (let i = 0; i <= maxPoints; i++) {
    offsets.push(Math.round((i * totalDays) / maxPoints));
  }
  return Array.from(new Set(offsets));
}
