// ═══════════════════════════════════════════════════════════════════════
// sessionVolumeSeries — per-session total volume, chronological. The
// "am I doing more work over time" signal (task brief: "the clearest
// signal").
//
// Deliberately does NOT try to colour/label each session by a dominant
// muscle-group category the way the reference dashboard coloured bars by
// session type: this schema has no session-type field (workout_session.name
// is free text a user may or may not fill in), and theme.ts's palette is
// intentionally a single accent colour plus a confidence ladder — "One
// accent... used for the FAB, links, active tab — nothing else" — with no
// categorical palette to borrow. Inventing 6 new hues for muscle-group
// categories would be the kind of "new colour to fix a screen" theme.ts
// explicitly warns against. The per-region breakdown this would have shown
// lives instead in muscleGroupBalance.ts / MuscleGroupBalanceChart, as an
// honest text-labelled panel rather than a chart legend.
//
// A session with sets logged only as warm-ups (or no sets at all) is still
// a real event and gets a real (zero) point — it is not a gap. A calendar
// day/week with no session at all simply has no point plotted; this module
// never fabricates one.
// ═══════════════════════════════════════════════════════════════════════

import { computeVolume, type SetForVolume } from './volume';

export type SessionVolumeSet = SetForVolume & { sessionId: string };

export type SessionVolumeSession = {
  id: string;
  date: string;
  name: string | null;
};

export type SessionVolumePoint = {
  sessionId: string;
  date: string;
  name: string | null;
  totalVolume: number;
  workingSetCount: number;
};

function isWarmupSet(set: SetForVolume): boolean {
  return typeof set.is_warmup === 'number' ? set.is_warmup === 1 : !!set.is_warmup;
}

/**
 * One point per session in `sessions`, oldest first. `sets` may include
 * sets for sessions not in `sessions` (e.g. already window-filtered
 * elsewhere) — anything not matching a session id in `sessions` is simply
 * not attributed to a point.
 */
export function buildSessionVolumeSeries(
  sessions: SessionVolumeSession[],
  sets: SessionVolumeSet[]
): SessionVolumePoint[] {
  const setsBySession = new Map<string, SessionVolumeSet[]>();
  for (const s of sets) {
    const bucket = setsBySession.get(s.sessionId);
    if (bucket) bucket.push(s);
    else setsBySession.set(s.sessionId, [s]);
  }

  const points = sessions.map((session) => {
    const sessionSets = setsBySession.get(session.id) ?? [];
    const working = sessionSets.filter((s) => !isWarmupSet(s));
    return {
      sessionId: session.id,
      date: session.date,
      name: session.name,
      totalVolume: computeVolume(working),
      workingSetCount: working.length,
    };
  });

  return points.sort((a, b) => (a.date === b.date ? a.sessionId.localeCompare(b.sessionId) : a.date.localeCompare(b.date)));
}
