// ═══════════════════════════════════════════════════════════════════════
// progressionSuggestion — TWO progressive-overload rules, one per
// prescription type (task brief, extended after the first cut only
// covered rep-range prescriptions): "Keep it a SUGGESTION, never an
// automatic change."
//
// This module never writes anything — it only classifies a session's
// already-logged sets against a program exercise's target and returns a
// suggestion + a plain-English reason. Nothing here touches `workout_set`,
// `program_exercise`, day_intake, or weight_log; callers decide whether
// and how to surface the result.
//
// ── RULE 1: 'rep_range' (task brief, original) ──────────────────────────
// "if the top of the rep range was hit at or below target RIR, suggest a
// load increase next time." (RIR: lower number = harder/closer to
// failure — see rirRpe.ts.)
//   1. No working set logged yet this session -> 'unknown'.
//   2. The best (heaviest) working set didn't reach the TOP of the
//      prescribed rep range -> 'hold'. Still building up reps at this
//      weight; not a signal either way about the load itself.
//   3. Top of the rep range reached, but no target RIR is prescribed OR
//      no RPE was logged on that set -> 'unknown'. The rule needs an
//      actual-vs-target RIR comparison; guessing one would be exactly the
//      kind of dishonest confidence PRD §10 bans elsewhere in this app.
//   4. Top of the rep range reached AND the logged set's RIR (converted
//      from its RPE) is AT OR BELOW the target RIR -> 'increase_load'.
//   5. Top of the rep range reached but the logged RIR came out ABOVE
//      target (easier than prescribed) -> 'hold'. Only case 4 triggers,
//      deliberately: this keeps the rule to exactly the one condition the
//      task brief states.
//
// ── RULE 2: 'amrap' / to-failure (extension) ────────────────────────────
// Rule 1 is meaningless for a to-failure set — there is no "top of the
// rep range" to compare against, since reps are the OUTCOME, not a
// target. Per the extended brief: "base the suggestion on reps achieved
// at the same load versus last session."
//   1. No working set logged yet this session, OR no last-session data to
//      compare against -> 'unknown'.
//   2. This session's top set's weight differs from last session's top
//      set's weight -> 'unknown'. The rule is explicitly "at the SAME
//      load" — a weight change already answers the loading question by
//      itself, and comparing rep counts across two different weights
//      would silently misattribute a weight change's effect to fatigue
//      or vice versa.
//   3. Same weight, MORE reps than last session -> 'increase_load'. Got
//      stronger at this exact weight; time to add load next time.
//   4. Same weight, same-or-fewer reps than last session -> 'hold'.
// ═══════════════════════════════════════════════════════════════════════

import { rpeToRir } from './rirRpe';

export type SetForSuggestion = {
  weight_kg: number;
  reps: number;
  /** Nullable — RPE is optional per set (schema v4), same as everywhere else in this app. */
  rpe: number | null;
  is_warmup?: boolean | number;
  /** Epoch ms — tie-break only. */
  logged_at: number;
};

/** The load/rep pair a top set reduces to, for AMRAP's cross-session comparison. */
export type TopSetForSuggestion = {
  weight_kg: number;
  reps: number;
};

export type ProgramTargetForSuggestion = {
  prescriptionType: 'rep_range' | 'amrap';
  /** Required (non-null, in practice) for 'rep_range'; ignored for 'amrap' — reps are an outcome there, not a target. */
  repHigh: number | null;
  /** Nullable either way — a program exercise may prescribe no RIR target/hint (schema.ts's v7 header). Unused by the 'amrap' rule (rule 2 above compares reps, not RIR). */
  targetRir: number | null;
};

export type ProgressionSuggestionAction = 'increase_load' | 'hold' | 'unknown';

export type ProgressionSuggestion = {
  action: ProgressionSuggestionAction;
  /** Always populated — a plain-English "why", never a bare enum value shown to the user (CLAUDE.md: "explain why", applied here to a suggestion instead of a check-in). */
  reason: string;
};

function isWarmupSet(set: SetForSuggestion): boolean {
  return typeof set.is_warmup === 'number' ? set.is_warmup === 1 : !!set.is_warmup;
}

/**
 * The heaviest working set among `sets` (tie-break: more reps at the top
 * weight, then earliest logged) — same tie-break rule as
 * progression.ts's `bestSetInSession`, reimplemented locally on this
 * module's own narrower input shape rather than importing progression.ts,
 * so this module stays independently testable with no cross-file
 * coupling. Returns `null` if every set is a warm-up or the list is empty.
 */
function pickTopSet(sets: SetForSuggestion[]): SetForSuggestion | null {
  const working = sets.filter((s) => !isWarmupSet(s) && Number.isFinite(s.weight_kg) && Number.isFinite(s.reps) && s.reps > 0);
  if (working.length === 0) return null;

  return working.reduce((best, current) => {
    if (current.weight_kg > best.weight_kg) return current;
    if (current.weight_kg < best.weight_kg) return best;
    if (current.reps > best.reps) return current;
    if (current.reps < best.reps) return best;
    return current.logged_at <= best.logged_at ? current : best;
  });
}

/** Rule 1 — see file header. */
function suggestProgressionRepRange(top: SetForSuggestion, target: ProgramTargetForSuggestion): ProgressionSuggestion {
  if (target.repHigh === null) {
    // Defensive only — a real 'rep_range' target always has repHigh
    // (DB CHECK constraint, schema.ts's v7 header); this exists so a
    // malformed caller degrades honestly rather than throwing.
    return { action: 'unknown', reason: 'This exercise has no rep target set, so there is nothing to compare against.' };
  }

  if (top.reps < target.repHigh) {
    return {
      action: 'hold',
      reason: `Top set hit ${top.reps} reps, short of the ${target.repHigh}-rep target — hold the weight and aim for more reps next time.`,
    };
  }

  if (target.targetRir === null) {
    return { action: 'unknown', reason: 'This exercise has no target RIR set, so there is nothing to compare effort against.' };
  }
  if (top.rpe === null) {
    return { action: 'unknown', reason: 'Log an RPE on your top set to get a load suggestion.' };
  }

  const actualRir = rpeToRir(top.rpe);
  if (actualRir <= target.targetRir) {
    const loadHint =
      top.weight_kg > 0
        ? 'Try adding a small amount of weight next time.'
        : 'Try adding reps, or a little external load, next time.';
    return {
      action: 'increase_load',
      reason: `Hit the top of the rep range at or below your target RIR. ${loadHint}`,
    };
  }

  return {
    action: 'hold',
    reason: 'Hit the top of the rep range, but with more left in the tank than the target RIR — hold the weight for now.',
  };
}

/**
 * Rule 2 — see file header. `topSet` is this session's heaviest working
 * set for the exercise (already picked by the caller, e.g. via
 * `suggestProgression`'s own `pickTopSet`, or supplied directly when
 * calling this rule standalone). `lastSessionTopSet` is the equivalent
 * for the most recent PRIOR session (the same value already surfaced
 * elsewhere in this app as "last time" — src/lib/training/workoutActions
 * .ts's `getLastTimeForExercise`); `null` when there is no prior session
 * to compare against.
 */
export function suggestProgressionAmrap(
  topSet: TopSetForSuggestion | null,
  lastSessionTopSet: TopSetForSuggestion | null
): ProgressionSuggestion {
  if (!topSet) {
    return { action: 'unknown', reason: 'No working set logged yet this session.' };
  }
  if (!lastSessionTopSet) {
    return { action: 'unknown', reason: 'Log this exercise again next session to compare reps at the same weight.' };
  }
  if (topSet.weight_kg !== lastSessionTopSet.weight_kg) {
    return {
      action: 'unknown',
      reason: 'Weight changed since last time, so reps aren’t comparable at the same load yet.',
    };
  }
  if (topSet.reps > lastSessionTopSet.reps) {
    return {
      action: 'increase_load',
      reason: `${topSet.reps} reps at this weight, up from ${lastSessionTopSet.reps} last time — try a bit more load next session.`,
    };
  }
  return {
    action: 'hold',
    reason: `${topSet.reps} reps at this weight, same or fewer than last time's ${lastSessionTopSet.reps} — hold the load for now.`,
  };
}

/**
 * Classify one exercise's session against its program target, dispatching
 * to the matching rule above by `target.prescriptionType`. `sets` should
 * be every set (any order, warm-ups included) logged THIS session for the
 * exercise currently in play at this slot (post-substitution — see
 * programSession.ts's `resolveSlotExerciseId`). `lastSessionTopSet` is
 * only used by the 'amrap' rule (rule 2); pass `null`/omit it for a
 * 'rep_range' target, or when no prior session exists.
 */
export function suggestProgression(
  sets: SetForSuggestion[],
  target: ProgramTargetForSuggestion,
  lastSessionTopSet: TopSetForSuggestion | null = null
): ProgressionSuggestion {
  const top = pickTopSet(sets);

  if (target.prescriptionType === 'amrap') {
    return suggestProgressionAmrap(top, lastSessionTopSet);
  }

  if (!top) {
    return { action: 'unknown', reason: 'No working set logged yet this session.' };
  }
  return suggestProgressionRepRange(top, target);
}
