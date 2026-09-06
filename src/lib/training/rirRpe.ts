// ═══════════════════════════════════════════════════════════════════════
// rirRpe — RIR ⇄ RPE conversion, and ONLY that.
//
// DECISION (task brief: "RIR vs RPE... state your choice and reasoning"):
// `workout_set.rpe` (schema v4, already shipped and wired through
// ExerciseCard/SetRow/the dashboard's e1RM math) stays the ONE column
// that records logged per-set effort. Programs (schema v7) prescribe
// effort as `program_exercise.target_rir` instead, because RIR ("2 reps
// left in the tank") is how a *prescription* is normally written and read
// by a lifter mid-set, while RPE is how *logged, after-the-fact* effort is
// normally recorded — this app already had the latter shipped, so v7
// adds the former as its own column rather than repurposing `rpe` to mean
// two different things depending on which table it's read from.
//
// What v7 deliberately does NOT do: add a duplicate `rir` column to
// `workout_set`. RIR and RPE are the same underlying "how hard was that"
// scale read from opposite ends (RPE 10 = 0 RIR = failure; RPE counts UP
// as effort increases, RIR counts DOWN as effort increases) — storing
// both per set would let them silently drift apart (a UI bug or an old
// row could show RPE 8 next to a stale RIR 1, and nothing in the schema
// would ever catch it). One stored number (`rpe`) plus this pure,
// unit-tested conversion is the single-source-of-truth alternative:
// anything that needs to compare a LOGGED set against a PRESCRIBED RIR
// target (src/lib/training/progressionSuggestion.ts) converts at read
// time via `rpeToRir` below, never by reading two independently-drifting
// columns.
//
// The conversion itself is the standard linear inverse used throughout
// RPE/RIR-based autoregulation: RPE 10 (failure) = RIR 0, RPE 9 = RIR 1,
// RPE 6 = RIR 4, and so on, at 1:1 down the scale. Half-steps (RPE 7.5,
// target_rir 1.5) round-trip exactly since this is a plain 10-minus
// relationship, not a lookup table.
// ═══════════════════════════════════════════════════════════════════════

/** Convert a logged RPE (0-10 scale, 10 = failure) to reps-in-reserve. */
export function rpeToRir(rpe: number): number {
  return 10 - rpe;
}

/** Convert a prescribed RIR (reps left in the tank) to the RPE it corresponds to. */
export function rirToRpe(rir: number): number {
  return 10 - rir;
}
