// ═══════════════════════════════════════════════════════════════════════
// StatusBlock — Today's headline numbers (PRD §9.1), rendered from the
// PRD's layout:
//
//   1,847 / 2,240              remaining 393
//   P 142/165   C 180/220   F 58/62
//   TDEE 2,510 ±90    ·    trend −0.42 kg/wk
//
// Plain large numbers, no decorative rings (PRD §9.1 explicitly rejects
// rings on this block). Protein listed first AND visually weighted (PRD
// §9.1: "the macro that matters and the one most often missed") — it
// gets its own full-width row at h2 size with a taller fill bar; carbs/fat
// share a lighter, smaller second row below it. Over/under target render
// in the identical neutral tone — there is no red "over budget" state
// anywhere in this component (PRD §10 / CLAUDE.md: "no streaks, no
// guilt, no red"). The thin fill
// bar under each macro is a comparison aid, not a ring: it clamps at
// full for any at-or-over-target amount (`computeMacroProgress`) so
// going over never draws a longer or differently-coloured bar than
// hitting the target exactly — "how full", never "how over".
//
// No target yet (fresh install, pre-first-check-in): every macro falls
// back to a bare amount with no fill bar and an em-dash target, e.g.
// "P 33 / —" — never a bar stuck at 0% or 100%, which would misread as
// "failing" or "done" against a target that does not exist (PRD §10: a
// missing target is data-neutral, not a failure state).
//
// Weight row (task: "the owner can only log his weight when the app
// decides to offer it" — WeightPrompt only appears when nothing is
// logged yet for the selected day, and only until it is). This row is
// the permanent second door: always rendered regardless of whether a
// reading exists, so a past reading can always be corrected too (PRD
// §10 "everything editable forever"). It shares the bottom bordered
// section with the TDEE/trend line rather than opening a new one, since
// both read off the same weight_log history and existing spacing tokens
// (spacing.lg/md/sm, the hairline border) are reused as-is rather than
// introducing new values.
// ═══════════════════════════════════════════════════════════════════════

import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, minTouchTarget, numeric, spacing, type } from '../lib/theme';
import type { TDEEResult } from '../engine/types';
import type { StoredTargets } from '../lib/targetsStore';
import { computeMacroProgress } from '../lib/macroProgress';
import { formatWeightRow } from '../lib/weightEntryActions';

type MacroTotals = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type Props = {
  totals: MacroTotals;
  targets: StoredTargets | null;
  tdee: TDEEResult | null;
  /** The selected day's reading, or null if none is logged yet. Never imputed. */
  weightKg: number | null;
  /** Opens WeightEntryScreen for whichever date this block is showing. */
  onLogWeight: () => void;
};

function round(n: number): number {
  return Math.round(n);
}

/** TDEE dataQuality -> plain-language label. Never implies a bare/measured number while seeding. */
function tdeeQualityLabel(quality: TDEEResult['dataQuality']): string | null {
  if (quality === 'seeding') return 'Estimated — collecting data';
  if (quality === 'converging') return 'Converging';
  return null;
}

export function StatusBlock({ totals, targets, tdee, weightKg, onLogWeight }: Props) {
  const targetKcal = targets?.targetKcal ?? null;
  const remaining = targetKcal !== null ? targetKcal - totals.kcal : null;
  const weightRow = formatWeightRow(weightKg);

  return (
    <View style={styles.container}>
      <View style={styles.headlineRow}>
        <Text style={styles.headlineNumber}>
          {round(totals.kcal).toLocaleString()}
          {targetKcal !== null && (
            <Text style={styles.headlineTarget}> / {round(targetKcal).toLocaleString()}</Text>
          )}
        </Text>
        {remaining !== null && (
          <Text style={styles.remaining}>
            remaining {remaining >= 0 ? round(remaining).toLocaleString() : `${round(Math.abs(remaining)).toLocaleString()} over`}
          </Text>
        )}
      </View>

      {!targets && (
        <Text style={styles.noTargetsHint}>
          No target yet — log a few days of food and a morning weigh-in, and your first weekly check-in will set one.
        </Text>
      )}

      <View style={styles.macroBlock}>
        <ProteinStat value={totals.protein_g} target={targets?.proteinG ?? null} />
        <View style={styles.secondaryMacroRow}>
          <MacroStat label="C" value={totals.carbs_g} target={targets?.carbsG ?? null} />
          <MacroStat label="F" value={totals.fat_g} target={targets?.fatG ?? null} />
        </View>
      </View>

      {/* Permanent second door to WeightEntryScreen (task: "the owner can
          only log his weight when the app decides to offer it") — always
          rendered, independent of WeightPrompt above and of whether `tdee`
          has anything to show, so a reading for the selected day can
          always be added or corrected in one tap. Shares this bordered
          section with the TDEE row below rather than adding a second
          hairline border. */}
      <View style={styles.bottomSection}>
        <Pressable
          onPress={onLogWeight}
          style={({ pressed }) => [styles.weightRow, pressed && styles.weightRowPressed]}
          accessibilityRole="button"
          accessibilityLabel={weightRow.a11yLabel}
        >
          <Text style={styles.weightLabel}>Weight</Text>
          <View style={styles.weightValueRow}>
            <Text style={[styles.weightValue, weightKg === null && styles.weightValueEmpty]}>{weightRow.value}</Text>
            <Text style={styles.weightChevron}>{'>'}</Text>
          </View>
        </Pressable>

        {tdee && (
          <View style={styles.tdeeRow}>
            <Text style={styles.tdeeText}>
              TDEE {round(tdee.tdee).toLocaleString()} ±{round((tdee.confidenceHigh - tdee.confidenceLow) / 2)}
              <Text style={styles.tdeeSeparator}>    ·    </Text>
              trend {tdee.trendKgPerWeek >= 0 ? '+' : '−'}
              {Math.abs(tdee.trendKgPerWeek).toFixed(2)} kg/wk
            </Text>
            {tdeeQualityLabel(tdee.dataQuality) && (
              <Text style={styles.tdeeQuality}>{tdeeQualityLabel(tdee.dataQuality)}</Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Protein's own full-width row — deliberately larger type (h2, vs. body
 * for carbs/fat) and a taller fill bar, per PRD §9.1's instruction that
 * protein is "the macro that matters and the one most often missed."
 * Same neutral colour and same clamp-at-full treatment as the secondary
 * macros — weighted by size/position, never by a different
 * (alarm-adjacent) colour.
 */
function ProteinStat({ value, target }: { value: number; target: number | null }) {
  const progress = computeMacroProgress(value, target);
  return (
    <View style={styles.proteinStat}>
      <View style={styles.proteinTextRow}>
        <Text style={styles.proteinLabel}>Protein</Text>
        <Text style={styles.proteinValue}>
          {round(value)}
          <Text style={styles.proteinTarget}>{target !== null ? ` / ${round(target)}` : ' / —'}</Text>
        </Text>
      </View>
      {target !== null && (
        <View style={styles.fillTrack} accessibilityElementsHidden importantForAccessibility="no">
          <View style={[styles.fillBar, { width: `${progress.fillFraction * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

function MacroStat({ label, value, target }: { label: string; value: number; target: number | null }) {
  const progress = computeMacroProgress(value, target);
  return (
    <View style={styles.macroStat}>
      <Text style={styles.macroText}>
        {label} {round(value)}
        <Text style={styles.macroTarget}>{target !== null ? `/${round(target)}` : '/—'}</Text>
      </Text>
      {target !== null && (
        <View style={styles.fillTrackSmall} accessibilityElementsHidden importantForAccessibility="no">
          <View style={[styles.fillBarSmall, { width: `${progress.fillFraction * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  headlineNumber: {
    ...type.hero,
    ...numeric,
    color: colors.text,
  },
  headlineTarget: {
    ...type.h1,
    ...numeric,
    color: colors.textSecondary,
  },
  remaining: {
    ...type.body,
    ...numeric,
    color: colors.textSecondary,
  },
  noTargetsHint: {
    ...type.caption,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
  macroBlock: {
    marginTop: spacing.lg,
  },
  proteinStat: {
    marginBottom: spacing.sm,
  },
  proteinTextRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  proteinLabel: {
    ...type.caption,
    color: colors.textSecondary,
  },
  proteinValue: {
    ...type.h2,
    ...numeric,
    color: colors.text,
  },
  proteinTarget: {
    ...type.body,
    ...numeric,
    color: colors.textSecondary,
  },
  secondaryMacroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  macroStat: {
    flex: 1,
  },
  macroText: {
    ...type.body,
    ...numeric,
    color: colors.textSecondary,
  },
  macroTarget: {
    color: colors.textTertiary,
  },
  fillTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceAlt,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  fillBar: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
  },
  fillTrackSmall: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.surfaceAlt,
    marginTop: 6,
    overflow: 'hidden',
  },
  fillBarSmall: {
    height: '100%',
    borderRadius: 1.5,
    backgroundColor: colors.textTertiary,
  },
  // Wraps the permanent weight row and (when present) the TDEE row —
  // this is the section's one hairline border/marginTop, reusing the
  // exact values the TDEE row used to carry on its own so the section
  // reads identically whether or not `tdee` has anything to show.
  bottomSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
  },
  weightRowPressed: {
    opacity: 0.6,
  },
  weightLabel: {
    ...type.caption,
    color: colors.textSecondary,
  },
  weightValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  weightValue: {
    ...type.caption,
    ...numeric,
    color: colors.text,
  },
  // Not a failure state (PRD §10) — same tone family as the "no target
  // yet" hint above, never red/dimmed-as-warning.
  weightValueEmpty: {
    color: colors.textTertiary,
  },
  weightChevron: {
    color: colors.textTertiary,
  },
  tdeeRow: {
    marginTop: spacing.sm,
  },
  tdeeText: {
    ...type.caption,
    ...numeric,
    color: colors.textSecondary,
  },
  tdeeSeparator: {
    color: colors.textTertiary,
  },
  tdeeQuality: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.xs,
  },
});
