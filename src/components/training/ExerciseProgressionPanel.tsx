// ═══════════════════════════════════════════════════════════════════════
// ExerciseProgressionPanel — wraps one ExerciseProgressCard per selected
// exercise (exerciseSelection.ts picks which). Task brief: "per-exercise
// progression" + "estimated 1RM over time for main lifts" — see
// ExerciseProgressCard's header for why those two are combined per card.
// ═══════════════════════════════════════════════════════════════════════

import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, type } from '../../lib/theme';
import type { ExerciseProgression } from '../../lib/training/progression';
import { ExerciseProgressCard } from './ExerciseProgressCard';

export type ExerciseProgressionItem = {
  exerciseId: string;
  exerciseName: string;
  progression: ExerciseProgression;
};

type Props = {
  items: ExerciseProgressionItem[];
};

export function ExerciseProgressionPanel({ items }: Props) {
  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Exercise progression</Text>
        <Text style={styles.empty}>
          Needs at least one logged working set. Once you do, this shows your best set (heaviest working set of a
          session) for the exercises you train most, first vs. most recent, plus an estimated 1-rep max trend.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Exercise progression</Text>
      <View style={styles.list}>
        {items.map((item) => (
          <ExerciseProgressCard key={item.exerciseId} exerciseName={item.exerciseName} progression={item.progression} />
        ))}
      </View>
      <Text style={styles.footnote}>
        &quot;Best set&quot; = the heaviest working set of a session (ties broken by more reps). % change and bar
        widths are based on best-set WEIGHT only, never reps or volume. Bars are scaled to that exercise&apos;s own
        first/latest weights and aren&apos;t comparable across exercises. Estimated 1RM uses the Epley formula and is
        shown with a confidence dot per point — bright for a set of 5 reps or fewer, dim for a high-rep set, since
        the formula is far less reliable there.
      </Text>
      <Text style={styles.footnote}>
        Showing the {items.length} exercise{items.length === 1 ? '' : 's'} you&apos;ve trained across the most
        sessions — not a hardcoded list of &quot;main lifts,&quot; since that would assume what you actually train.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    ...type.bodyStrong,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  empty: {
    ...type.caption,
    color: colors.textTertiary,
    lineHeight: 19,
  },
  list: {
    gap: spacing.lg,
  },
  footnote: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
});
