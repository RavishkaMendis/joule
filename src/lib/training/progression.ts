// ═══════════════════════════════════════════════════════════════════════
// progression — per-exercise best-set history and honest trend/%-change,
// across sessions.
//
// "Best set" for a session = the working (non-warmup) set with the
// heaviest weight that session, ties broken by more reps at that weight,
// then by the earlier of the two. This mirrors the reference dashboard
// the user pointed to, whose own footnote is explicit: "% change compares
// best-set weight, not reps." Reps and estimated 1RM are additionally
// reported per best-set entry, but the %-change figure itself is always
// weight-vs-weight — never conflated with a volume or 1RM change, which
// would silently shift the basis a user thinks they're reading.
//
// Honesty rules carried over from the nutrition side (CLAUDE.md/PRD §10):
//   - Two data points is not a trend. `confidence` is 'insufficient' with
//     fewer than 2 sessions of data (nothing to compare), 'comparison'
//     with exactly 2 (a % change is computable and shown, but callers
//     must not draw a trend line or claim a *direction* is established —
//     label it "since last time", not "trending up"), and 'trend' only
//     from 3+ sessions.
//   - No streaks, no guilt, no red: a skipped week between sessions is
//     data-neutral here, same as a missed food-logging day. This module
//     has no concept of "days since last session" at all — it only ever
//     compares the sessions that exist.
// ═══════════════════════════════════════════════════════════════════════

import { estimateOneRepMax, type OneRepMaxEstimate } from './oneRepMax';

export type TrainingSet = {
  session_id: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  weight_kg: number;
  reps: number;
  is_warmup?: boolean | number;
  /** Epoch ms — used only to break ties between sets at the same weight/reps within a session. */
  logged_at: number;
};

export type BestSetForSession = {
  sessionId: string;
  date: string;
  weightKg: number;
  reps: number;
  estimatedOneRepMax: OneRepMaxEstimate | null;
  /** weightKg * reps for this one set (not the whole session's volume). */
  setVolume: number;
};

export type ProgressionConfidence = 'insufficient' | 'comparison' | 'trend';

export type PercentChangeUnavailableReason = 'previous_weight_zero' | 'insufficient_data';

export type ExerciseProgression = {
  /** One entry per session that has at least one working set for this exercise, oldest first. */
  history: BestSetForSession[];
  confidence: ProgressionConfidence;
  /** Always compares best-set WEIGHT between the latest two sessions in `history` — never reps, never volume, never 1RM. `null` when unavailable (see percentChangeUnavailableReason). */
  percentChangeVsPrevious: number | null;
  percentChangeBasis: 'best_set_weight';
  percentChangeUnavailableReason?: PercentChangeUnavailableReason;
};

function isWarmupSet(set: TrainingSet): boolean {
  return typeof set.is_warmup === 'number' ? set.is_warmup === 1 : !!set.is_warmup;
}

/**
 * The best (heaviest working) set among `sets`, which must all belong to
 * one session/exercise pair already. Tie-break: more reps at the top
 * weight wins, then the earlier-logged of the two. Returns `null` if
 * every set is a warm-up or the list is empty.
 */
export function bestSetInSession(sets: TrainingSet[]): TrainingSet | null {
  const working = sets.filter((s) => !isWarmupSet(s) && Number.isFinite(s.weight_kg) && Number.isFinite(s.reps) && s.reps > 0);
  if (working.length === 0) return null;

  return working.reduce((best, current) => {
    if (current.weight_kg > best.weight_kg) return current;
    if (current.weight_kg < best.weight_kg) return best;
    // same weight: more reps wins
    if (current.reps > best.reps) return current;
    if (current.reps < best.reps) return best;
    // same weight and reps: earlier logged wins (arbitrary but stable)
    return current.logged_at <= best.logged_at ? current : best;
  });
}

/**
 * Full progression for one exercise, given every set ever logged for it
 * (any order; grouping/sorting happens here). Sessions with zero working
 * sets for this exercise (e.g. only a warm-up got logged before the user
 * moved on) contribute nothing to `history` — a warm-up-only session is
 * not a data point, the same way a `is_complete = 0` day still drops out
 * of the intake window on the nutrition side.
 */
export function computeExerciseProgression(sets: TrainingSet[]): ExerciseProgression {
  const bySession = new Map<string, TrainingSet[]>();
  for (const set of sets) {
    const bucket = bySession.get(set.session_id);
    if (bucket) bucket.push(set);
    else bySession.set(set.session_id, [set]);
  }

  const history: BestSetForSession[] = [];
  for (const [sessionId, sessionSets] of bySession) {
    const best = bestSetInSession(sessionSets);
    if (!best) continue;
    history.push({
      sessionId,
      date: best.date,
      weightKg: best.weight_kg,
      reps: best.reps,
      estimatedOneRepMax: estimateOneRepMax(best.weight_kg, best.reps),
      setVolume: best.weight_kg * best.reps,
    });
  }

  // Chronological order. Same-date sessions (two workouts logged the same
  // day) fall back to a stable sort by sessionId — there is no
  // started_at on this minimal input type, and this is a rare enough
  // edge case that "some stable order" beats pulling in more fields.
  history.sort((a, b) => (a.date === b.date ? a.sessionId.localeCompare(b.sessionId) : a.date.localeCompare(b.date)));

  const confidence: ProgressionConfidence =
    history.length < 2 ? 'insufficient' : history.length === 2 ? 'comparison' : 'trend';

  let percentChangeVsPrevious: number | null = null;
  let percentChangeUnavailableReason: PercentChangeUnavailableReason | undefined;

  if (history.length >= 2) {
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    if (previous.weightKg === 0) {
      percentChangeUnavailableReason = 'previous_weight_zero';
    } else {
      percentChangeVsPrevious = ((latest.weightKg - previous.weightKg) / previous.weightKg) * 100;
    }
  } else {
    percentChangeUnavailableReason = 'insufficient_data';
  }

  return {
    history,
    confidence,
    percentChangeVsPrevious,
    percentChangeBasis: 'best_set_weight',
    ...(percentChangeUnavailableReason ? { percentChangeUnavailableReason } : {}),
  };
}
