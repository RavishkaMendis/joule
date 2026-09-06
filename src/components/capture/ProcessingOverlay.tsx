// ═══════════════════════════════════════════════════════════════════════
// ProcessingOverlay — the fix for reported bug #2, "dead end while
// analysing." Renders the captured photo dimmed behind a genuine
// progress indicator with honest, changing copy, plus a cancel action
// that is always present and always works.
//
// Gemini calls take low-single-digit seconds typically, but network
// variance means "stuck for 10+ seconds with no way out" is the worst
// moment in the app (task brief). This component never hides the cancel
// button — there is no "too late to cancel" state, because the underlying
// fetch can always be abandoned by the caller (the screen still owns the
// actual network call and simply stops caring about its result).
//
// Background-job addition (task brief: "sometimes it takes a minute and
// I'm stuck waiting on the scan screen ... let the user leave
// immediately"): the analysis itself now runs as a job in
// src/lib/captureJobs that outlives this screen, so there are genuinely
// two different things "get me out of here" can mean, and this component
// offers both, distinctly:
//   - Cancel: abandon this attempt entirely (the caller drops the job).
//   - `onLeaveInBackground` (optional secondary action, only rendered
//     when the caller supplies it): keep the job running and just leave —
//     the result shows up later as a notification plus a pill on Today.
// Conflating these into one button would silently do the wrong thing for
// whichever meaning didn't win, so they stay two clearly-labelled actions
// rather than one "Cancel" whose behaviour changed underneath it.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, radii, spacing, type } from '../../lib/theme';
import type { CapturedPhoto } from './capturePhases';

type Props = {
  photo: CapturedPhoto;
  /** Cycles through honest progress copy — see DEFAULT_STAGES. */
  stages?: string[];
  onCancel: () => void;
  /** When supplied, renders a secondary action that leaves this screen while the job keeps running in the background (src/lib/captureJobs) — completion surfaces later via a notification and the Today indicator pill. Omitted entirely (no button rendered) rather than defaulting to a no-op, so a caller that hasn't wired background support yet can't silently offer a broken button. */
  onLeaveInBackground?: () => void;
};

/**
 * Honest, sequential copy rather than a single static "reading food"
 * message (the exact complaint from tonight's device use). These are
 * genuine phases of one Gemini multimodal call, not decorative filler:
 * the request uploads the photo (+ voice note, if any), the model reads
 * it, then estimates portions/macros. Advancing on a timer, not on real
 * milestones from the network call, because the underlying SDK call in
 * `runs.ts` does not expose sub-progress — advancing communicates "still
 * working," not literal completion percentage.
 */
const DEFAULT_STAGES = ['Uploading the photo…', 'Reading the photo…', 'Working out portions…'];
const STAGE_INTERVAL_MS = 1800;

export function ProcessingOverlay({ photo, stages = DEFAULT_STAGES, onCancel, onLeaveInBackground }: Props) {
  const [stageIndex, setStageIndex] = useState(0);
  const stagesRef = useRef(stages);
  stagesRef.current = stages;

  useEffect(() => {
    setStageIndex(0);
    const id = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, stagesRef.current.length - 1));
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [photo.uri]);

  return (
    <View style={styles.container}>
      <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={2} />
      <View style={styles.scrim} />

      <View style={styles.content}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.stageText} accessibilityLiveRegion="polite">
          {stages[stageIndex] ?? stages[stages.length - 1]}
        </Text>

        <Pressable onPress={onCancel} style={styles.cancelButton} accessibilityRole="button" accessibilityLabel="Cancel analysis and go back">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>

        {onLeaveInBackground && (
          <Pressable
            onPress={onLeaveInBackground}
            style={styles.backgroundButton}
            accessibilityRole="button"
            accessibilityLabel="Leave this screen and keep analysing in the background — you'll get notified when it's ready"
          >
            <Text style={styles.backgroundText}>Leave — I&apos;ll get notified</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  stageText: {
    ...type.body,
    color: colors.text,
    textAlign: 'center',
  },
  cancelButton: {
    marginTop: spacing.md,
    minHeight: minTouchTarget,
    minWidth: minTouchTarget * 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    ...type.bodyStrong,
    color: colors.text,
  },
  backgroundButton: {
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backgroundText: {
    ...type.body,
    color: colors.textSecondary,
  },
});
