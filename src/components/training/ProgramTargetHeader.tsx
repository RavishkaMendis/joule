// ═══════════════════════════════════════════════════════════════════════
// ProgramTargetHeader — rendered above an ExerciseCard when the session
// is following a program (task brief: "each exercise shows: target...
// and the set inputs... make it readable at a glance, between sets,
// one-handed"). Deliberately a SEPARATE component from ExerciseCard
// rather than a prop bolted onto it — ExerciseCard's ad-hoc logging path
// (the 10-second-test-critical one) stays completely untouched; this is
// pure addition above it.
//
// Three things live here, each optional and each collapsed to nothing
// when not applicable:
//   - the target line + rest hint (always shown when a target exists)
//   - coaching cues, shown once tapped into (task brief: "Tap into any
//     exercise and you get... coaching cues" + optional reference link —
//     never a bundled/faked video demo)
//   - a substitution chip row (task brief: "swap in substitutions if you
//     don't have the equipment"), hidden once the slot already has a
//     real logged set THIS session (`swapLocked`) — a swap changes which
//     exercise the NEXT set logs against, so it stops making sense once
//     that choice has already been made for real.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, numeric, radii, spacing, type } from '../../lib/theme';
import { formatTarget, formatRest, type TargetLike } from '../../lib/training/targetFormat';
import type { ProgressionSuggestion } from '../../lib/training/progressionSuggestion';

export type SubstituteChip = {
  exerciseId: string;
  name: string;
  note: string | null;
};

type Props = {
  /** `formatTarget`'s TargetLike plus restSeconds, which this header ALSO renders (formatTarget itself doesn't cover rest — see targetFormat.ts's `formatRest`). */
  target: TargetLike & { restSeconds: number | null };
  cues: string | null;
  demoUrl: string | null;
  substitutes: SubstituteChip[];
  /** True once this slot has a real logged set this session — hides the swap row (see file header). */
  swapLocked: boolean;
  onSwap: (exerciseId: string) => void;
  /**
   * The progressive-overload suggestion for THIS session's sets so far
   * (src/lib/training/progressionSuggestion.ts). `null`/`'unknown'` renders
   * nothing — a suggestion only appears once there's something honest to
   * say (task brief: "Keep it a suggestion, never an automatic change").
   * No colour coding either way (PRD §10: no red, no guilt) — 'hold' and
   * 'increase_load' render in the exact same neutral tone.
   */
  suggestion?: ProgressionSuggestion | null;
};

export function ProgramTargetHeader({ target, cues, demoUrl, substitutes, swapLocked, onSwap, suggestion }: Props) {
  const [cuesOpen, setCuesOpen] = useState(false);
  const hasCues = (cues && cues.trim().length > 0) || (demoUrl && demoUrl.trim().length > 0);
  const rest = formatRest(target.restSeconds);

  return (
    <View style={styles.container}>
      <View style={styles.targetRow}>
        <Text style={styles.targetText}>Target: {formatTarget(target)}</Text>
        {rest.length > 0 && <Text style={styles.restText}>{rest}</Text>}
      </View>

      {hasCues && (
        <Pressable onPress={() => setCuesOpen((v) => !v)} accessibilityRole="button">
          <Text style={styles.cuesToggle}>{cuesOpen ? 'Hide cues' : 'Cues'}</Text>
        </Pressable>
      )}
      {cuesOpen && (
        <View style={styles.cuesBlock}>
          {cues && cues.trim().length > 0 && <Text style={styles.cuesText}>{cues}</Text>}
          {demoUrl && demoUrl.trim().length > 0 && (
            <Pressable onPress={() => void Linking.openURL(demoUrl)} accessibilityRole="button">
              <Text style={styles.demoLink}>Open reference link</Text>
            </Pressable>
          )}
        </View>
      )}

      {suggestion && suggestion.action !== 'unknown' && (
        <Text style={styles.suggestionText}>{suggestion.reason}</Text>
      )}

      {!swapLocked && substitutes.length > 0 && (
        <View style={styles.subRow}>
          <Text style={styles.subLabel}>Swap:</Text>
          {substitutes.map((sub) => (
            <Pressable key={sub.exerciseId} onPress={() => onSwap(sub.exerciseId)} style={styles.subChip} accessibilityRole="button">
              <Text style={styles.subChipText}>{sub.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  targetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  targetText: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  restText: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
  },
  cuesToggle: {
    ...type.small,
    color: colors.accent,
  },
  cuesBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  cuesText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  demoLink: {
    ...type.caption,
    color: colors.accent,
  },
  suggestionText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  subRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  subLabel: {
    ...type.small,
    color: colors.textTertiary,
  },
  subChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  subChipText: {
    ...type.small,
    color: colors.textSecondary,
  },
});
