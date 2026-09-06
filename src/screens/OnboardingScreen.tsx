// ═══════════════════════════════════════════════════════════════════════
// OnboardingScreen — PRD §9.5.
//
// "Height, birth year, sex, current weight, goal, target rate, activity
// level, typical meals/day. All editable later in settings. Ends by
// asking who cooks — used to frame pot-logging prompts."
//
// ⚠️ Uses the REVISED expectation-setting copy verbatim (task brief — the
// original "two weeks" promise was replaced 2026-08-26 after measurement
// showed it isn't achievable; see PRD Appendix). Do not restore it.
//
// Only writes user_profile (+ first weight reading + household prefs) via
// src/lib/onboardingActions.ts — never touches targets. A fresh install
// therefore has a profile but no target snapshot until the first weekly
// check-in, which Today already renders correctly ("No targets set yet").
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/navigation';
import { colors, numeric, radii, spacing, type, minTouchTarget } from '../lib/theme';
import { getDatabase } from '../lib/db';
import { todayLocalISO } from '../lib/localDate';
import { completeOnboarding, type WhoCooks } from '../lib/onboardingActions';
import type { UserProfile } from '../engine/types';
import { parseRequiredNumber } from '../lib/numericInput';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;

const ACTIVITY_OPTIONS: { value: UserProfile['activity_seed']; label: string }[] = [
  { value: 'sedentary', label: 'Sedentary (desk job, little exercise)' },
  { value: 'lightly_active', label: 'Lightly active (1-3 days/wk)' },
  { value: 'moderately_active', label: 'Moderately active (3-5 days/wk)' },
  { value: 'very_active', label: 'Very active (6-7 days/wk, physical job)' },
];

const GOAL_OPTIONS: { value: UserProfile['goal']; label: string }[] = [
  { value: 'cut', label: 'Lose weight' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'gain', label: 'Gain weight' },
];

const WHO_COOKS_OPTIONS: { value: WhoCooks; label: string }[] = [
  { value: 'me', label: 'Mostly me' },
  { value: 'partner', label: 'Mostly my partner' },
  { value: 'both', label: 'Both of us' },
  { value: 'other', label: 'Someone else' },
];

const TOTAL_STEPS = 9; // 8 data steps + 1 expectation-setting screen

/**
 * Steps that gate on a free-text numeric field before allowing `next`/
 * finish. This is the fix for the onboarding half of the numericInput bug
 * (task brief): height/weight/rate/birth-year/meals-per-day used to fall
 * back to `Number(x) || <placeholder>` on save, so leaving a field blank
 * silently seeded Mifflin-St Jeor — the cold-start TDEE (PRD §4.3) and the
 * provisional target (onboardingActions.ts) — from a fabricated 170cm/70kg
 * rather than blocking. `parseRequiredNumber` makes "blank" a distinct,
 * checkable state instead of a coerced 0.
 *
 * Exported so this can be unit-tested directly without mounting the
 * screen (this repo has no React Native Testing Library dependency —
 * every existing test operates at the logic/data layer).
 */
export function validateOnboardingStep(
  step: number,
  values: {
    heightCm: string;
    birthYear: string;
    currentWeightKg: string;
    goal: UserProfile['goal'];
    rateKgPerWeek: string;
    mealsPerDay: string;
  }
): { blocked: boolean; message: string | null } {
  switch (step) {
    case 0:
      return parseRequiredNumber(values.heightCm).valid
        ? { blocked: false, message: null }
        : { blocked: true, message: 'Enter your height to continue.' };
    case 1:
      return parseRequiredNumber(values.birthYear).valid
        ? { blocked: false, message: null }
        : { blocked: true, message: 'Enter your birth year to continue.' };
    case 3:
      return parseRequiredNumber(values.currentWeightKg).valid
        ? { blocked: false, message: null }
        : { blocked: true, message: 'Enter your current weight to continue.' };
    case 5:
      // Maintain fixes the rate at 0 and auto-advances (see AutoAdvance
      // below) — this step never even renders an input to leave blank in
      // that case, so it's never blocked.
      if (values.goal === 'maintain') return { blocked: false, message: null };
      return parseRequiredNumber(values.rateKgPerWeek).valid
        ? { blocked: false, message: null }
        : { blocked: true, message: 'Enter a target rate to continue.' };
    case 7:
      return parseRequiredNumber(values.mealsPerDay).valid
        ? { blocked: false, message: null }
        : { blocked: true, message: 'Enter how many meals you typically eat per day.' };
    default:
      return { blocked: false, message: null };
  }
}

export function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showValidation, setShowValidation] = useState(false);

  const [heightCm, setHeightCm] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [sex, setSex] = useState<UserProfile['sex']>('male');
  const [currentWeightKg, setCurrentWeightKg] = useState('');
  const [goal, setGoal] = useState<UserProfile['goal']>('cut');
  const [rateKgPerWeek, setRateKgPerWeek] = useState('0.5');
  const [activitySeed, setActivitySeed] = useState<UserProfile['activity_seed']>('sedentary');
  const [mealsPerDay, setMealsPerDay] = useState('3');
  const [whoCooks, setWhoCooks] = useState<WhoCooks>('both');

  const stepValidation = validateOnboardingStep(step, {
    heightCm,
    birthYear,
    currentWeightKg,
    goal,
    rateKgPerWeek,
    mealsPerDay,
  });

  // Re-arm the "show validation message" flag on every step change so an
  // old step's message never bleeds into a fresh one, and so a step the
  // user hasn't tried to leave yet stays quiet (task brief's 10-second
  // test: "don't nag while typing — surface the problem when the user
  // tries to proceed").
  const goToStep = (updater: (s: number) => number) => {
    setShowValidation(false);
    setStep(updater);
  };

  const next = () => {
    if (stepValidation.blocked) {
      setShowValidation(true);
      return;
    }
    goToStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };
  const back = () => goToStep((s) => Math.max(s - 1, 0));

  const handleFinish = async () => {
    if (stepValidation.blocked) {
      setShowValidation(true);
      return;
    }
    // Defensive re-parse rather than trusting the fields blindly: this is
    // the last line of defence before writing user_profile, and a wrong
    // height/weight here silently poisons every downstream Mifflin-St
    // Jeor estimate (PRD §4.3) with no visible sign anything is wrong.
    const heightResult = parseRequiredNumber(heightCm);
    const birthYearResult = parseRequiredNumber(birthYear);
    const weightResult = parseRequiredNumber(currentWeightKg);
    const rateResult = goal === 'maintain' ? { valid: true as const, value: 0 } : parseRequiredNumber(rateKgPerWeek);
    const mealsResult = parseRequiredNumber(mealsPerDay);
    if (!heightResult.valid || !birthYearResult.valid || !weightResult.valid || !rateResult.valid || !mealsResult.valid) {
      setShowValidation(true);
      return;
    }

    setSaving(true);
    try {
      const db = await getDatabase();
      await completeOnboarding(
        db,
        {
          height_cm: heightResult.value,
          birth_year: birthYearResult.value,
          sex,
          currentWeightKg: weightResult.value,
          goal,
          rateKgPerWeek: rateResult.value,
          activity_seed: activitySeed,
          mealsPerDay: mealsResult.value,
          whoCooks,
        },
        todayLocalISO()
      );
      // On first launch Onboarding is the stack's initial route (no
      // screen behind it — see App.tsx), so goBack() alone is a no-op
      // and the screen would appear to hang after a successful save.
      // When reached from Settings to edit answers, Onboarding *is*
      // pushed on top of Tabs, so goBack() there is correct. Handle
      // both by only resetting when there's nothing to go back to.
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.stepIndicator}>
          {step + 1} / {TOTAL_STEPS}
        </Text>

        {step === 0 && (
          <StepShell title="Height">
            <TextInput
              style={styles.bigInput}
              value={heightCm}
              onChangeText={setHeightCm}
              keyboardType="decimal-pad"
              placeholder="170"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <Text style={styles.unitLabel}>cm</Text>
            <ValidationMessage show={showValidation} message={stepValidation.message} />
          </StepShell>
        )}

        {step === 1 && (
          <StepShell title="Birth year">
            <TextInput
              style={styles.bigInput}
              value={birthYear}
              onChangeText={setBirthYear}
              keyboardType="number-pad"
              placeholder="1995"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <ValidationMessage show={showValidation} message={stepValidation.message} />
          </StepShell>
        )}

        {step === 2 && (
          <StepShell title="Sex">
            <Text style={styles.hint}>Used for the Mifflin-St Jeor BMR formula during cold start.</Text>
            <ChoiceRow options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} selected={sex} onSelect={setSex} />
          </StepShell>
        )}

        {step === 3 && (
          <StepShell title="Current weight">
            <TextInput
              style={styles.bigInput}
              value={currentWeightKg}
              onChangeText={setCurrentWeightKg}
              keyboardType="decimal-pad"
              placeholder="70.0"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
            <Text style={styles.unitLabel}>kg</Text>
            <ValidationMessage show={showValidation} message={stepValidation.message} />
          </StepShell>
        )}

        {step === 4 && (
          <StepShell title="Goal">
            <ChoiceRow options={GOAL_OPTIONS} selected={goal} onSelect={setGoal} />
          </StepShell>
        )}

        {step === 5 && goal !== 'maintain' && (
          <StepShell title="Target rate">
            <Text style={styles.hint}>
              {goal === 'cut' ? 'How much weight would you like to lose per week?' : 'How much weight would you like to gain per week?'}
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.bigInput}
                value={rateKgPerWeek}
                onChangeText={setRateKgPerWeek}
                keyboardType="decimal-pad"
                placeholder="0.5"
                placeholderTextColor={colors.textTertiary}
                selectTextOnFocus
                autoFocus
              />
              <Text style={styles.unitLabel}>kg/wk</Text>
            </View>
            <Text style={styles.hintSmall}>A safety rail caps anything too aggressive — you&apos;ll see it plainly if it binds.</Text>
            <ValidationMessage show={showValidation} message={stepValidation.message} />
          </StepShell>
        )}
        {step === 5 && goal === 'maintain' && <AutoAdvance onReady={next} />}

        {step === 6 && (
          <StepShell title="Activity level">
            <ChoiceColumn options={ACTIVITY_OPTIONS} selected={activitySeed} onSelect={setActivitySeed} />
          </StepShell>
        )}

        {step === 7 && (
          <StepShell title="Typical meals per day">
            <TextInput
              style={styles.bigInput}
              value={mealsPerDay}
              onChangeText={setMealsPerDay}
              keyboardType="number-pad"
              placeholder="3"
              placeholderTextColor={colors.textTertiary}
              selectTextOnFocus
              autoFocus
            />
            <ValidationMessage show={showValidation} message={stepValidation.message} />
          </StepShell>
        )}

        {step === 8 && (
          <StepShell title="Who cooks?">
            <Text style={styles.hint}>Used to frame pot-logging prompts — either person can log a pot regardless.</Text>
            <ChoiceColumn options={WHO_COOKS_OPTIONS} selected={whoCooks} onSelect={setWhoCooks} />

            <View style={styles.expectationBox}>
              <Text style={styles.expectationText}>
                For the first couple of weeks I&apos;ll show a wide range rather than a single number — that range is
                honest, not a placeholder. It tightens as you log. Expect a number you can lean on after about six
                weeks of daily weigh-ins.
              </Text>
              <Text style={styles.expectationSubtext}>The band is the feature. No apology needed.</Text>
            </View>
          </StepShell>
        )}

        <View style={styles.navRow}>
          {step > 0 && (
            <Pressable onPress={back} style={styles.backButton} accessibilityRole="button">
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          )}
          <View style={styles.navSpacer} />
          {step < TOTAL_STEPS - 1 ? (
            <Pressable onPress={next} style={styles.nextButton} accessibilityRole="button">
              <Text style={styles.nextText}>Next</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => void handleFinish()} disabled={saving} style={[styles.nextButton, saving && styles.buttonDisabled]} accessibilityRole="button">
              <Text style={styles.nextText}>{saving ? 'Saving…' : 'Start using Joule'}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Skips the "target rate" step automatically when goal is maintain (rate
 * is fixed at 0). `onReady` is intentionally not in the dependency array:
 * this component is only ever mounted for the single render where
 * step===5 && goal==='maintain', and unmounts as soon as onReady advances
 * the step, so there is no meaningful re-run to guard against by widening
 * the dependency list.
 */
function AutoAdvance({ onReady }: { onReady: () => void }) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    onReadyRef.current();
  }, []);
  return null;
}

/**
 * Blank-field guidance, shown only once the user has actually tried to
 * proceed (`show`) — never while typing, per the 10-second test ("don't
 * nag while typing"). Neutral tone, no red, no exclamation (PRD §10) —
 * this is guidance ("Enter your height to continue"), not an error.
 */
function ValidationMessage({ show, message }: { show: boolean; message: string | null }) {
  if (!show || !message) return null;
  return <Text style={styles.validationMessage}>{message}</Text>;
}

function StepShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.stepShell}>
      <Text style={styles.stepTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChoiceRow<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  return (
    <View style={styles.choiceRow}>
      {options.map((opt) => {
        const active = opt.value === selected;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onSelect(opt.value)}
            style={[styles.choiceChip, active && styles.choiceChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ChoiceColumn<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  return (
    <View style={styles.choiceColumn}>
      {options.map((opt) => {
        const active = opt.value === selected;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onSelect(opt.value)}
            style={[styles.choiceRowItem, active && styles.choiceRowItemActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.choiceRowItemText, active && styles.choiceChipTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  stepIndicator: {
    ...type.small,
    ...numeric,
    color: colors.textTertiary,
    marginBottom: spacing.md,
  },
  stepShell: {
    marginBottom: spacing.xl,
  },
  stepTitle: {
    ...type.h1,
    color: colors.text,
    marginBottom: spacing.md,
  },
  hint: {
    ...type.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  hintSmall: {
    ...type.small,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  validationMessage: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  bigInput: {
    ...type.display,
    ...numeric,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.xs,
    minWidth: 140,
  },
  unitLabel: {
    ...type.h2,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  choiceChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  choiceChipActive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.accent,
  },
  choiceChipText: {
    ...type.body,
    color: colors.textSecondary,
  },
  choiceChipTextActive: {
    color: colors.text,
  },
  choiceColumn: {
    gap: spacing.sm,
  },
  choiceRowItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  choiceRowItemActive: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.accent,
  },
  choiceRowItemText: {
    ...type.body,
    color: colors.textSecondary,
  },
  expectationBox: {
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  expectationText: {
    ...type.body,
    color: colors.text,
  },
  expectationSubtext: {
    ...type.caption,
    color: colors.textTertiary,
    marginTop: spacing.sm,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  navSpacer: {
    flex: 1,
  },
  backButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  backText: {
    ...type.body,
    color: colors.textSecondary,
  },
  nextButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radii.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  nextText: {
    ...type.bodyStrong,
    color: colors.background,
  },
});
