// ═══════════════════════════════════════════════════════════════════════
// WeeklyCheckInScreen — PRD §9.3. Full-screen, single card, feels like an
// event. Layout follows the PRD nearly verbatim:
//
//   Week 6
//   Measured TDEE   2,510  (was 2,470)
//   Weight trend    −0.42 kg/wk  (target −0.5)
//   Logged          6/7 days
//
//   New target: 2,240 kcal  (+60)
//
//   [Accept]  [Keep current]  [Adjust rate]
//
// Hard requirements from the task brief:
//  - THIS is the only screen that writes targets (via
//    src/lib/targetsStore.ts's saveAcceptedTargets). "Accept" is the only
//    button that calls it with the newly computed targets; "Keep current"
//    re-saves the EXISTING targets' numbers as a fresh snapshot (so the
//    weekLabel/acceptedAt reflect "reviewed and kept", not silently
//    ignored) — either way, still this screen making the write, never
//    Today.
//  - Always explain why the number moved, in one sentence
//    (src/lib/checkInLogic.ts's explainTargetChange — generated from the
//    real before/after numbers, not a canned string).
//  - No auto-accept after N days of being ignored (PRD §14 open question)
//    — deliberately NOT implemented; noted in the UI copy below.
//
// Date semantics (audited when Today gained a date switcher/back-fill —
// see TodayScreen.tsx): this screen deliberately takes NO date parameter
// and always computes off todayLocalISO(), regardless of which past day
// Today's UI happens to be showing when the user navigates here. This is
// a considered choice, not an oversight:
//   - PRD §5 frames the check-in as a real weekly EVENT ("fires Sunday
//     morning"), not a per-page snapshot of an arbitrary historical week.
//   - computeTDEE/computeTargets read the accumulated history up to
//     `today` regardless of which day Today's UI is scrolled to — "the
//     week ending on the day I'm currently browsing" isn't a question
//     the engine even answers differently, since targets are date-
//     independent between check-ins (PRD §5: "recalculated only at the
//     weekly check-in").
// To keep this unambiguous rather than silently surprising, TodayScreen
// only shows the banner/entry point to this screen while viewing today
// (see its `checkInDue` gating) — a user browsing a past day never sees
// a path into this screen that could be misread as "reviewing that past
// day's week."
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, type } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { todayLocalISO } from '../lib/localDate';
import { addDaysISO } from '../engine/date';
import * as intakeRepo from '../db/repositories/intakeRepo';
import * as weightRepo from '../db/repositories/weightRepo';
import * as profileRepo from '../db/repositories/profileRepo';
import { computeTDEE } from '../engine/tdee';
import type { DayIntake, TDEEResult, UserProfile, WeightLog } from '../engine/types';
import { computeTargets, type TargetResult } from '../engine/targets';
import { getAcceptedTargets, saveAcceptedTargets, type StoredTargets } from '../lib/targetsStore';
import { getLastCheckIn, recordCheckIn, type CheckInHistoryEntry } from '../lib/checkInHistory';
import { explainTargetChange, adherenceLabel, weekLabelFromDaysOfData } from '../lib/checkInLogic';
import { parseRequiredNumber } from '../lib/numericInput';

type Nav = NativeStackNavigationProp<RootStackParamList, 'WeeklyCheckIn'>;

const HISTORY_WINDOW_DAYS = 120;
const ADHERENCE_WINDOW_DAYS = 7;

function toDayIntake(row: {
  date: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  is_complete: number;
}): DayIntake {
  return {
    date: row.date,
    kcal: row.kcal ?? 0,
    protein_g: row.protein_g ?? 0,
    carbs_g: row.carbs_g ?? 0,
    fat_g: row.fat_g ?? 0,
    is_complete: row.is_complete !== 0,
  };
}

function toWeightLog(row: { date: string; weight_kg: number; confounder: WeightLog['confounder'] }): WeightLog {
  return { date: row.date, weight_kg: row.weight_kg, confounder: row.confounder };
}

function toUserProfile(row: {
  height_cm: number;
  birth_year: number;
  sex: string;
  goal: string;
  rate_kg_per_week: number;
  activity_seed: string;
  protein_override: number | null;
  units: string;
}): UserProfile {
  return {
    height_cm: row.height_cm,
    birth_year: row.birth_year,
    sex: row.sex as UserProfile['sex'],
    goal: row.goal as UserProfile['goal'],
    rate_kg_per_week: row.rate_kg_per_week,
    activity_seed: row.activity_seed as UserProfile['activity_seed'],
    protein_override: row.protein_override,
    units: row.units as UserProfile['units'],
  };
}

type LoadedState = {
  tdee: TDEEResult;
  previousTargets: StoredTargets | null;
  previousCheckIn: CheckInHistoryEntry | null;
  newTargets: TargetResult;
  profile: UserProfile;
  loggedDaysInLast7: number;
};

export function WeeklyCheckInScreen() {
  const navigation = useNavigation<Nav>();
  const [state, setState] = useState<LoadedState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [rateText, setRateText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const db = await getDatabase();
    const today = todayLocalISO();
    const startDate = addDaysISO(today, -HISTORY_WINDOW_DAYS);
    const weekStartDate = addDaysISO(today, -(ADHERENCE_WINDOW_DAYS - 1));

    const [intakeRows, weightRows, profileRow, previousTargets, previousCheckIn, weekIntakeRows] = await Promise.all([
      intakeRepo.getRange(db, startDate, today),
      weightRepo.getRange(db, startDate, today),
      profileRepo.getProfile(db),
      getAcceptedTargets(db),
      getLastCheckIn(db),
      intakeRepo.getRange(db, weekStartDate, today),
    ]);

    const profile: UserProfile = profileRow
      ? toUserProfile(profileRow)
      : {
          height_cm: 170,
          birth_year: 1995,
          sex: 'male',
          goal: 'maintain',
          rate_kg_per_week: 0,
          activity_seed: 'sedentary',
          protein_override: null,
          units: 'metric',
        };

    const intake = intakeRows.map(toDayIntake);
    const weights = weightRows.map(toWeightLog);
    const tdee = computeTDEE(intake, weights, profile);
    const newTargets = computeTargets(tdee, profile);
    const loggedDaysInLast7 = weekIntakeRows.filter((r) => (r.kcal ?? 0) > 0 || r.is_complete === 0).length;

    setState({ tdee, previousTargets, previousCheckIn, newTargets, profile, loggedDaysInLast7 });
    setRateText(String(profile.rate_kg_per_week));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = useCallback(async () => {
    if (!state) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      await saveAcceptedTargets(db, state.newTargets, {
        weekLabel: weekLabelFromDaysOfData(state.tdee.daysOfData),
      });
      await recordCheckIn(db, state.tdee, state.profile.rate_kg_per_week);
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  }, [state, navigation]);

  const handleKeepCurrent = useCallback(async () => {
    if (!state) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const toKeep: TargetResult = state.previousTargets
        ? {
            targetKcal: state.previousTargets.targetKcal,
            proteinG: state.previousTargets.proteinG,
            fatG: state.previousTargets.fatG,
            carbsG: state.previousTargets.carbsG,
            railReason: state.previousTargets.railReason,
          }
        : state.newTargets;
      await saveAcceptedTargets(db, toKeep, {
        weekLabel: weekLabelFromDaysOfData(state.tdee.daysOfData),
      });
      // Still record THIS week's measured TDEE (not the kept target's
      // implied one) — "Keep current" means the target didn't change,
      // not that the measurement didn't happen, so the next check-in's
      // "was X" comparison should be against what was actually measured
      // today.
      await recordCheckIn(db, state.tdee, state.profile.rate_kg_per_week);
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  }, [state, navigation]);

  // A blank field parses to 0 in JS (`Number('') === 0`), which is finite —
  // parseRequiredNumber's blank check stops a cleared input from silently
  // saving a 0 kg/wk rate instead of blocking the save, corrupting the
  // profile's goal rate. (0 itself is legitimate — see maintain's fixed
  // rate elsewhere — this only rejects BLANK/invalid text, not zero.)
  const parsedRate = parseRequiredNumber(rateText);
  const canAdjustRate = parsedRate.valid;

  const handleAdjustRate = useCallback(async () => {
    if (!state) return;
    const parsed = parseRequiredNumber(rateText);
    if (!parsed.valid) return;

    setSaving(true);
    try {
      const db = await getDatabase();
      const updatedProfile: UserProfile = { ...state.profile, rate_kg_per_week: parsed.value };
      await profileRepo.upsertProfile(db, {
        height_cm: updatedProfile.height_cm,
        birth_year: updatedProfile.birth_year,
        sex: updatedProfile.sex,
        goal: updatedProfile.goal,
        rate_kg_per_week: updatedProfile.rate_kg_per_week,
        activity_seed: updatedProfile.activity_seed,
        protein_override: updatedProfile.protein_override,
        units: updatedProfile.units,
      });
      const adjustedTargets = computeTargets(state.tdee, updatedProfile);
      await saveAcceptedTargets(db, adjustedTargets, {
        weekLabel: weekLabelFromDaysOfData(state.tdee.daysOfData),
      });
      await recordCheckIn(db, state.tdee, parsed.value);
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  }, [state, rateText, navigation]);

  if (loading || !state) {
    return (
      <View style={styles.screen}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  const { tdee, previousTargets, previousCheckIn, newTargets, loggedDaysInLast7, profile } = state;
  const targetDelta = previousTargets ? newTargets.targetKcal - previousTargets.targetKcal : null;

  const explanation = explainTargetChange({
    // The exact TDEEResult recorded at the last accepted check-in (see
    // src/lib/checkInHistory.ts) — not reconstructed from targetKcal and
    // the CURRENT rate, which would be wrong after any "Adjust rate" in
    // between (it would use today's rate to back-solve yesterday's TDEE).
    previousTdee: previousCheckIn?.tdee ?? null,
    newTdee: tdee,
    previousTargetKcal: previousTargets?.targetKcal ?? null,
    newTargets,
    goalRateKgPerWeek: profile.rate_kg_per_week,
  });

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.card}>
          <Text style={styles.weekLabel}>{weekLabelFromDaysOfData(tdee.daysOfData)}</Text>

          <Row
            label="Measured TDEE"
            value={`${Math.round(tdee.tdee).toLocaleString()}`}
            sub={previousCheckIn ? `was ${Math.round(previousCheckIn.tdee.tdee).toLocaleString()}` : undefined}
          />
          <Row
            label="Weight trend"
            value={`${tdee.trendKgPerWeek >= 0 ? '+' : '−'}${Math.abs(tdee.trendKgPerWeek).toFixed(2)} kg/wk`}
            sub={`target −${profile.rate_kg_per_week.toFixed(2)}`}
          />
          <Row label="Logged" value={adherenceLabel(loggedDaysInLast7, ADHERENCE_WINDOW_DAYS)} />

          <View style={styles.divider} />

          <Text style={styles.newTargetSectionLabel}>New target</Text>
          <View style={styles.heroRow}>
            <Text style={styles.heroValue}>{Math.round(newTargets.targetKcal).toLocaleString()}</Text>
            <Text style={styles.heroUnit}> kcal</Text>
            {targetDelta !== null && (
              <Text style={styles.newTargetDelta}>
                {' '}
                ({targetDelta >= 0 ? '+' : '−'}
                {Math.round(Math.abs(targetDelta))})
              </Text>
            )}
          </View>

          <Text style={styles.explanation}>{explanation}</Text>

          {newTargets.railReason && (
            <Text style={styles.railNote}>
              A safety rail capped this number — see the explanation above for why.
            </Text>
          )}

          {!adjusting ? (
            <View style={styles.actions}>
              <Pressable
                onPress={() => void handleAccept()}
                disabled={saving}
                style={[styles.primaryButton, saving && styles.buttonDisabled]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryButtonText}>Accept</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleKeepCurrent()}
                disabled={saving}
                style={[styles.secondaryButton, saving && styles.buttonDisabled]}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryButtonText}>Keep current</Text>
              </Pressable>
              <Pressable
                onPress={() => setAdjusting(true)}
                disabled={saving}
                style={[styles.secondaryButton, saving && styles.buttonDisabled]}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryButtonText}>Adjust rate</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.adjustSection}>
              <Text style={styles.adjustLabel}>New goal rate (kg/week, positive = losing)</Text>
              <TextInput
                style={styles.rateInput}
                value={rateText}
                onChangeText={setRateText}
                keyboardType="decimal-pad"
                placeholder="0.5"
                placeholderTextColor={colors.textTertiary}
                selectTextOnFocus
                returnKeyType="done"
                onSubmitEditing={() => void handleAdjustRate()}
                autoFocus
              />
              <View style={styles.actions}>
                <Pressable
                  onPress={() => void handleAdjustRate()}
                  disabled={saving || !canAdjustRate}
                  style={[styles.primaryButton, (saving || !canAdjustRate) && styles.buttonDisabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: saving || !canAdjustRate, busy: saving }}
                >
                  <Text style={styles.primaryButtonText}>Save new rate</Text>
                </Pressable>
                <Pressable onPress={() => setAdjusting(false)} disabled={saving} style={styles.secondaryButton} accessibilityRole="button">
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          <Text style={styles.footnote}>
            This check-in doesn&apos;t auto-accept if you skip it — targets only change here, and only when you
            choose one of the options above.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueGroup}>
        <Text style={styles.rowValue}>{value}</Text>
        {sub && <Text style={styles.rowSub}> ({sub})</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingText: {
    ...type.body,
    color: colors.textSecondary,
    padding: spacing.lg,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  weekLabel: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.md,
  },
  rowLabel: {
    ...type.sectionLabel,
    color: colors.textTertiary,
  },
  rowValueGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  rowValue: {
    ...type.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  rowSub: {
    ...type.caption,
    ...numeric,
    color: colors.textTertiary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xl,
  },
  newTargetSectionLabel: {
    ...type.sectionLabel,
    color: colors.textTertiary,
    marginBottom: spacing.sm,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  heroValue: {
    ...type.display,
    ...numeric,
    color: colors.text,
  },
  heroUnit: {
    ...type.body,
    color: colors.textSecondary,
  },
  newTargetDelta: {
    ...type.body,
    ...numeric,
    color: colors.textSecondary,
  },
  explanation: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  railNote: {
    ...type.caption,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...type.bodyStrong,
    color: colors.background,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    ...type.body,
    color: colors.text,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  adjustSection: {
    marginTop: spacing.lg,
  },
  adjustLabel: {
    ...type.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  rateInput: {
    ...type.h2,
    ...numeric,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
  },
  footnote: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.lg,
  },
});
