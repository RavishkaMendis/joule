// ═══════════════════════════════════════════════════════════════════════
// DataHealthScreen — finds and fixes the OFF kJ/4.184 unit-conversion
// damage (and the other arithmetic-impossible shapes src/lib/dataHealth.ts
// checks for) already sitting in the user's logged food_entry rows.
//
// Nothing here writes automatically. Every fix — single or bulk — is an
// explicit, confirmed action (CLAUDE.md: "the model never writes directly
// to the log ... there is always a human beat before save"; that rule
// isn't just about the five capture paths, it applies to any rewrite of
// a previously-logged calorie figure too). A fix always goes through
// foodRepo.updateEntry, which triggers intakeRepo.recomputeDay, so the
// engine picks up the corrected total the next time it reads day_intake
// (see useEngine.ts — TodayScreen already refreshes it on every focus).
//
// No red, no guilt (PRD §10, CLAUDE.md): this screen reports facts about
// arithmetic, not a verdict on the user's logging. Copy stays neutral —
// "stated" vs "macro-derived", never "wrong"/"error"/"bad".
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import * as foodRepo from '../db/repositories/foodRepo';
import * as intakeRepo from '../db/repositories/intakeRepo';
import { scanFoodEntriesForDataHealth, type DataHealthCategory, type DataHealthFinding } from '../lib/dataHealth';

// Wide enough to cover every date the app could possibly have written,
// so this is a genuine full-history scan without needing a new "get all
// food_entry rows" repo function (foodRepo.ts is outside this task's
// file ownership — getEntriesInRange already exists and does the job).
const EARLIEST_POSSIBLE_DATE = '0001-01-01';
const LATEST_POSSIBLE_DATE = '9999-12-31';

function categoryLabel(category: DataHealthCategory): string {
  switch (category) {
    case 'implausible_values':
      return 'Implausible value';
    case 'implausible_density':
      return 'Implausible energy density';
    case 'zero_energy_with_macros':
      return 'Zero energy with macros logged';
    case 'atwater_mismatch':
      return 'Energy/macro mismatch';
  }
}

function formatDate(dateISO: string): string {
  const parsed = new Date(`${dateISO}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateISO;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function DataHealthScreen() {
  const [loading, setLoading] = useState(true);
  const [findings, setFindings] = useState<DataHealthFinding[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastRecomputeMessage, setLastRecomputeMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      const entries = await foodRepo.getEntriesInRange(db, EARLIEST_POSSIBLE_DATE, LATEST_POSSIBLE_DATE);
      setFindings(scanFoodEntriesForDataHealth(entries));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const fixableFindings = findings.filter((f) => f.suggestedKcal !== null);

  const handleApplyFix = (finding: DataHealthFinding) => {
    if (finding.suggestedKcal === null) return;
    const suggested = finding.suggestedKcal;
    Alert.alert(
      'Apply this fix?',
      `"${finding.entry.name}" (${formatDate(finding.entry.date)}) will change from ${Math.round(finding.statedKcal)} kcal to ${suggested} kcal, derived from its logged protein/carbs/fat. You can edit it again afterwards if this isn't right.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply fix',
          onPress: () =>
            void (async () => {
              setBusy(finding.entry.id);
              try {
                const db = await getDatabase();
                await foodRepo.updateEntry(db, finding.entry.id, { kcal: suggested });
                await load();
              } catch (e) {
                Alert.alert('Could not apply fix', e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(null);
              }
            })(),
        },
      ]
    );
  };

  const handleApplyAll = () => {
    if (fixableFindings.length === 0) return;
    const count = fixableFindings.length;
    Alert.alert(
      'Apply all suggested fixes?',
      `This will update the stated energy for ${count} ${count === 1 ? 'entry' : 'entries'} to its macro-derived value. Each entry can still be edited individually afterwards.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply fixes',
          onPress: () =>
            void (async () => {
              setBusy('apply-all');
              try {
                const db = await getDatabase();
                for (const finding of fixableFindings) {
                  if (finding.suggestedKcal === null) continue;
                  await foodRepo.updateEntry(db, finding.entry.id, { kcal: finding.suggestedKcal });
                }
                await load();
              } catch (e) {
                Alert.alert('Could not apply all fixes', e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(null);
              }
            })(),
        },
      ]
    );
  };

  const handleRecomputeAll = async () => {
    setBusy('recompute-all');
    setLastRecomputeMessage(null);
    try {
      const db = await getDatabase();
      const result = await intakeRepo.recomputeAllDays(db);
      setLastRecomputeMessage(
        result.daysTouched === 0
          ? 'No days to rebuild — no logged data yet.'
          : `Rebuilt daily totals for ${result.daysTouched} ${result.daysTouched === 1 ? 'day' : 'days'}.`
      );
      await load();
    } catch (e) {
      Alert.alert('Recalculation failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Data health</Text>
        <Text style={styles.intro}>
          Scans every logged entry for arithmetic that doesn&apos;t add up — including energy figures left too low by a
          unit-conversion bug that has since been fixed. Nothing changes unless you apply a fix.
        </Text>

        <Section title="Maintenance">
          <ActionButton
            label={busy === 'recompute-all' ? 'Recalculating…' : 'Recalculate all daily totals'}
            onPress={() => void handleRecomputeAll()}
            disabled={busy !== null}
          />
          {lastRecomputeMessage && <Text style={styles.statusLine}>{lastRecomputeMessage}</Text>}
        </Section>

        <Section
          title="Suspect entries"
          subtitle={
            loading
              ? undefined
              : findings.length === 0
                ? undefined
                : `${findings.length} of them ${findings.length === 1 ? 'has' : 'have'} a macro-derived fix available: ${fixableFindings.length}.`
          }
        >
          {loading ? (
            <Text style={styles.statusLine}>Scanning your food log…</Text>
          ) : findings.length === 0 ? (
            <Text style={styles.statusLine}>Nothing looks wrong.</Text>
          ) : (
            <>
              <Text style={styles.summaryLine}>
                {findings.length} suspect {findings.length === 1 ? 'entry' : 'entries'} found.
              </Text>
              {fixableFindings.length > 0 && (
                <ActionButton
                  label={busy === 'apply-all' ? 'Applying…' : `Apply all suggested fixes (${fixableFindings.length})`}
                  onPress={handleApplyAll}
                  disabled={busy !== null}
                />
              )}
              {findings.map((finding) => (
                <FindingCard
                  key={finding.entry.id}
                  finding={finding}
                  busy={busy === finding.entry.id}
                  disabled={busy !== null}
                  onApply={() => handleApplyFix(finding)}
                />
              ))}
            </>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

function FindingCard({
  finding,
  busy,
  disabled,
  onApply,
}: {
  finding: DataHealthFinding;
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardName} numberOfLines={1}>
          {finding.entry.name}
        </Text>
        <Text style={styles.cardDate}>{formatDate(finding.entry.date)}</Text>
      </View>
      <Text style={styles.cardCategory}>{categoryLabel(finding.category)}</Text>
      <Text style={styles.cardMessage}>{finding.message}</Text>
      <View style={styles.cardFigureRow}>
        <Text style={[styles.cardFigure, numeric]}>Stated: {Math.round(finding.statedKcal)} kcal</Text>
        <Text style={[styles.cardFigure, numeric]}>
          {finding.suggestedKcal === null ? 'No reliable suggestion' : `Macro-derived: ${finding.suggestedKcal} kcal`}
        </Text>
      </View>
      {finding.suggestedKcal !== null && (
        <ActionButton label={busy ? 'Applying…' : 'Apply fix'} onPress={onApply} disabled={disabled} compact />
      )}
    </View>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  compact,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        pressed && styles.actionButtonPressed,
        disabled && styles.actionButtonDisabled,
      ]}
      accessibilityRole="button"
    >
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  header: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  intro: {
    ...type.caption,
    color: colors.textTertiary,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  sectionSubtitle: {
    ...type.caption,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  statusLine: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  summaryLine: {
    ...type.body,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  cardName: {
    ...type.bodyStrong,
    color: colors.text,
    flexShrink: 1,
  },
  cardDate: {
    ...type.caption,
    color: colors.textTertiary,
  },
  cardCategory: {
    ...type.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardMessage: {
    ...type.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  cardFigureRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  cardFigure: {
    ...type.caption,
    color: colors.text,
  },
  actionButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  actionButtonCompact: {
    paddingVertical: spacing.sm,
  },
  actionButtonPressed: {
    backgroundColor: colors.surface,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    ...type.body,
    color: colors.text,
    textAlign: 'center',
  },
});
