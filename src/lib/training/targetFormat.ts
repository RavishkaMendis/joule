// ═══════════════════════════════════════════════════════════════════════
// targetFormat — the one place a program exercise's target renders as
// text ("3 × 8–10 @ 2 RIR"). Shared by ProgramDayScreen (editing) and
// ProgramTargetHeader (in-session, task brief: "each exercise shows:
// target... make it readable at a glance, between sets, one-handed").
// ═══════════════════════════════════════════════════════════════════════

export type TargetLike = {
  targetSets: number;
  prescriptionType: 'rep_range' | 'amrap';
  /** NULL when prescriptionType is 'amrap' (reps are an outcome, not a target). */
  repLow: number | null;
  repHigh: number | null;
  targetRir: number | null;
};

/**
 * "3 × 8–10 @ 2 RIR" for a rep-range prescription, or "3 sets to failure @
 * 1 RIR" (or "3 sets to failure" with no RIR hint) for an AMRAP
 * prescription. A single rep number (repLow === repHigh) collapses to
 * "3 × 8 @ 2 RIR" rather than "8–8".
 */
export function formatTarget(target: TargetLike): string {
  if (target.prescriptionType === 'amrap') {
    const base = `${target.targetSets} ${target.targetSets === 1 ? 'set' : 'sets'} to failure`;
    return target.targetRir !== null ? `${base} @ ${target.targetRir} RIR` : base;
  }
  const reps = target.repLow === target.repHigh ? String(target.repLow) : `${target.repLow}–${target.repHigh}`;
  const base = `${target.targetSets} × ${reps}`;
  return target.targetRir !== null ? `${base} @ ${target.targetRir} RIR` : base;
}

/** "Rest ~150s", or "" when no rest is prescribed (callers should treat empty as "nothing to show"). Seconds only, matching how rest_seconds is stored — no minutes-and-seconds formatting since program rest windows are typically well under an hour. */
export function formatRest(restSeconds: number | null): string {
  return restSeconds !== null ? `Rest ~${restSeconds}s` : '';
}
