// ═══════════════════════════════════════════════════════════════════════
// dashboardStats — headline numbers for the training dashboard: total
// volume, total working sets, session count, average volume/session, over
// a caller-supplied window.
//
// Reuses computeVolume (./volume) rather than re-summing weight*reps here
// — one formula for "volume" across the whole app, per CLAUDE.md's general
// "don't reimplement" instinct and this task brief's explicit instruction
// for computeExerciseProgression.
//
// Gaps-not-zeros: `avgVolumePerSession` divides by the number of SESSIONS
// THAT HAPPENED in the window, never by the number of calendar days or
// weeks it spans. A 4-week window containing two sessions two weeks apart
// averages those two sessions' volume — the 26 days with no session are
// gaps, not zero-volume sessions dragging the mean down. A session that
// genuinely happened with zero working volume (e.g. one just started, or a
// warm-up-only session) IS counted as a real zero, though — that is
// observed data, not an absence, exactly mirroring how a session with 0
// sets is still a valid SessionSummary in ./volume.
// ═══════════════════════════════════════════════════════════════════════

import { computeVolume, type SetForVolume } from './volume';
import { isWithinWindow } from './dashboardWindow';

export type DashboardStatsSet = SetForVolume & { sessionId: string };
export type DashboardStatsSession = { id: string; date: string };

export type HeadlineStats = {
  totalVolume: number;
  workingSetCount: number;
  warmupSetCount: number;
  sessionCount: number;
  /** null only when sessionCount === 0 — there is no session to average, not a session that averaged to zero. */
  avgVolumePerSession: number | null;
};

function isWarmupSet(set: SetForVolume): boolean {
  return typeof set.is_warmup === 'number' ? set.is_warmup === 1 : !!set.is_warmup;
}

/**
 * Headline stats over [windowStart, windowEnd] (windowStart === null means
 * unbounded below — "all time"). `sets` and `sessions` may span a much
 * wider range than the window; filtering happens here so callers can fetch
 * once and re-slice as the user changes the window selector.
 */
export function computeHeadlineStats(
  sets: DashboardStatsSet[],
  sessions: DashboardStatsSession[],
  windowStart: string | null,
  windowEnd: string
): HeadlineStats {
  const sessionsInWindow = sessions.filter((s) => isWithinWindow(s.date, windowStart, windowEnd));
  const sessionIdsInWindow = new Set(sessionsInWindow.map((s) => s.id));
  const setsInWindow = sets.filter((s) => sessionIdsInWindow.has(s.sessionId));

  const workingSets = setsInWindow.filter((s) => !isWarmupSet(s));
  const warmupSets = setsInWindow.filter((s) => isWarmupSet(s));
  const totalVolume = computeVolume(workingSets);
  const sessionCount = sessionsInWindow.length;

  return {
    totalVolume,
    workingSetCount: workingSets.length,
    warmupSetCount: warmupSets.length,
    sessionCount,
    avgVolumePerSession: sessionCount > 0 ? totalVolume / sessionCount : null,
  };
}
