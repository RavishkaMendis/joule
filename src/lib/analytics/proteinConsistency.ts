// ═══════════════════════════════════════════════════════════════════════
// PROTEIN CONSISTENCY — PRD §9.1: "the macro that matters and the one
// most often missed." Surfaces hit-rate and a distribution, not just an
// average — an average can hide "half the days were great, half were
// nowhere close."
//
// Hit-rate uses a small tolerance band around the target (>= 90% of
// target counts as "hit") rather than requiring the target be hit or
// exceeded exactly, since protein targets are themselves a g/kg estimate,
// not a hard line. This is descriptive framing, not a pass/fail grade —
// no colour-coding decision is made here (PRD §10: no red, no guilt);
// this module only computes numbers, the UI decides neutral presentation.
// ═══════════════════════════════════════════════════════════════════════

export type ProteinDay = {
  date: string;
  /** null = day not logged at all (gap) — excluded from every stat below. */
  proteinG: number | null;
  isComplete: boolean;
};

export type ProteinConsistencySummary = {
  loggedDays: number;
  /** Days where proteinG >= HIT_THRESHOLD_FRACTION * targetG. */
  daysHitTarget: number;
  /** null if there were zero logged days (nothing to rate). */
  hitRateFraction: number | null;
  avgProteinG: number | null;
  medianProteinG: number | null;
  /** Distribution buckets for a simple histogram, in ascending g order. */
  histogram: ProteinHistogramBucket[];
};

export type ProteinHistogramBucket = {
  /** e.g. "<80%", "80-99%", "100-119%", "120%+" — relative to target. */
  label: string;
  count: number;
};

const HIT_THRESHOLD_FRACTION = 0.9;

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Summarise protein consistency against a single target value (the target
 * in force for most of the window — this module doesn't attempt to
 * reconstruct historical per-day targets, since targets only change at a
 * weekly check-in and StoredTargets only retains the latest snapshot).
 * `targetG === null` (no check-in completed yet) means hit-rate/histogram
 * are meaningless, so this returns all-null stats except the raw average,
 * which is still informative on its own.
 */
export function summarizeProteinConsistency(days: ProteinDay[], targetG: number | null): ProteinConsistencySummary {
  const loggedValues = days.filter((d) => d.proteinG !== null).map((d) => d.proteinG as number);
  const loggedDays = loggedValues.length;

  const avgProteinG = loggedDays > 0 ? loggedValues.reduce((a, b) => a + b, 0) / loggedDays : null;
  const medianProteinG = median([...loggedValues].sort((a, b) => a - b));

  if (targetG === null || targetG <= 0) {
    return {
      loggedDays,
      daysHitTarget: 0,
      hitRateFraction: null,
      avgProteinG,
      medianProteinG,
      histogram: [],
    };
  }

  const daysHitTarget = loggedValues.filter((g) => g >= targetG * HIT_THRESHOLD_FRACTION).length;
  const hitRateFraction = loggedDays > 0 ? daysHitTarget / loggedDays : null;

  const bucketDefs: { label: string; test: (ratio: number) => boolean }[] = [
    { label: '<60%', test: (r) => r < 0.6 },
    { label: '60-89%', test: (r) => r >= 0.6 && r < 0.9 },
    { label: '90-109%', test: (r) => r >= 0.9 && r < 1.1 },
    { label: '110-139%', test: (r) => r >= 1.1 && r < 1.4 },
    { label: '140%+', test: (r) => r >= 1.4 },
  ];
  const histogram: ProteinHistogramBucket[] = bucketDefs.map(({ label, test }) => ({
    label,
    count: loggedValues.filter((g) => test(g / targetG)).length,
  }));

  return { loggedDays, daysHitTarget, hitRateFraction, avgProteinG, medianProteinG, histogram };
}
