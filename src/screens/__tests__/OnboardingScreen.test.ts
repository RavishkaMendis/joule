// ═══════════════════════════════════════════════════════════════════════
// OnboardingScreen — step-gating tests.
//
// This repo has no React Native Testing Library dependency (every
// existing test operates at the logic/data layer — see
// src/lib/__tests__/*), so this exercises `validateOnboardingStep`, the
// pure function OnboardingScreen.tsx uses to decide whether `next`/
// `handleFinish` may proceed, directly.
//
// The bug being closed: height/weight/rate/birth-year/meals-per-day used
// to fall back to `Number(x) || <placeholder>` at save time (170cm,
// 70kg, 1995, 0 kg/wk, 3 meals) — a blank field was therefore
// indistinguishable from a deliberately-entered placeholder, and those
// numbers feed Mifflin-St Jeor (PRD §4.3), the cold-start TDEE, and now
// the provisional target seeded at onboarding (onboardingActions.ts).
// A wrong height/weight here poisons every downstream estimate with no
// visible sign anything is wrong.
// ═══════════════════════════════════════════════════════════════════════

import { validateOnboardingStep } from '../OnboardingScreen';

const BASE_VALUES = {
  heightCm: '178',
  birthYear: '1990',
  currentWeightKg: '82.4',
  goal: 'cut' as const,
  rateKgPerWeek: '0.5',
  mealsPerDay: '3',
};

describe('validateOnboardingStep', () => {
  it('blocks step 0 (height) when blank', () => {
    const result = validateOnboardingStep(0, { ...BASE_VALUES, heightCm: '' });
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/height/i);
  });

  it('blocks step 0 (height) when whitespace-only', () => {
    expect(validateOnboardingStep(0, { ...BASE_VALUES, heightCm: '   ' }).blocked).toBe(true);
  });

  it('allows step 0 through with a valid height, including a comma decimal', () => {
    expect(validateOnboardingStep(0, { ...BASE_VALUES, heightCm: '178' }).blocked).toBe(false);
    expect(validateOnboardingStep(0, { ...BASE_VALUES, heightCm: '178,5' }).blocked).toBe(false);
  });

  it('blocks step 1 (birth year) when blank', () => {
    const result = validateOnboardingStep(1, { ...BASE_VALUES, birthYear: '' });
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/birth year/i);
  });

  it('blocks step 3 (current weight) when blank', () => {
    const result = validateOnboardingStep(3, { ...BASE_VALUES, currentWeightKg: '' });
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/weight/i);
  });

  it('blocks step 5 (target rate) when blank and goal is cut', () => {
    const result = validateOnboardingStep(5, { ...BASE_VALUES, goal: 'cut', rateKgPerWeek: '' });
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/rate/i);
  });

  it('blocks step 5 (target rate) when blank and goal is gain', () => {
    expect(validateOnboardingStep(5, { ...BASE_VALUES, goal: 'gain', rateKgPerWeek: '' }).blocked).toBe(true);
  });

  it('never blocks step 5 when goal is maintain, even with a blank rate field — 0 is the legitimate, fixed rate', () => {
    const result = validateOnboardingStep(5, { ...BASE_VALUES, goal: 'maintain', rateKgPerWeek: '' });
    expect(result.blocked).toBe(false);
    expect(result.message).toBeNull();
  });

  it('allows step 5 through with an explicit "0" rate for a non-maintain goal — 0 is a legitimate value, not blank', () => {
    // Not the normal path (maintain is used for a fixed 0 rate), but the
    // validator must not conflate "0 typed" with "blank" even here — the
    // whole point of parseRequiredNumber is that distinction.
    expect(validateOnboardingStep(5, { ...BASE_VALUES, goal: 'cut', rateKgPerWeek: '0' }).blocked).toBe(false);
  });

  it('blocks step 7 (meals per day) when blank', () => {
    const result = validateOnboardingStep(7, { ...BASE_VALUES, mealsPerDay: '' });
    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/meals/i);
  });

  it('never blocks a step with no numeric field (sex, goal, activity, who-cooks, expectation screen)', () => {
    expect(validateOnboardingStep(2, BASE_VALUES).blocked).toBe(false);
    expect(validateOnboardingStep(4, BASE_VALUES).blocked).toBe(false);
    expect(validateOnboardingStep(6, BASE_VALUES).blocked).toBe(false);
    expect(validateOnboardingStep(8, BASE_VALUES).blocked).toBe(false);
  });

  it('rejects non-numeric text the same way as blank ("abc" is not a height)', () => {
    expect(validateOnboardingStep(0, { ...BASE_VALUES, heightCm: 'abc' }).blocked).toBe(true);
  });

  it('never silently substitutes the old fallback placeholders (170cm / 70kg / 1995 / 3 meals) for blank input — it blocks instead', () => {
    // This is the regression test for the actual data-integrity bug: the
    // old code was `Number(heightCm) || 170`, so a blank height produced
    // a *valid-looking* 170 with no way to tell it apart from a real
    // measurement. validateOnboardingStep must report `blocked: true` for
    // every one of the fields that used to have a silent fallback,
    // whenever that field is blank — it must never report `blocked: false`
    // for blank input just because a placeholder value would have been
    // available.
    const blankEverything = {
      heightCm: '',
      birthYear: '',
      currentWeightKg: '',
      goal: 'cut' as const,
      rateKgPerWeek: '',
      mealsPerDay: '',
    };
    for (const step of [0, 1, 3, 5, 7]) {
      expect(validateOnboardingStep(step, blankEverything).blocked).toBe(true);
    }
  });
});
