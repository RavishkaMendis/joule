# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

**Pre-implementation.** The repository contains only [PRD-macro-tracker.md](PRD-macro-tracker.md) — no source, no package manifest, no git history. There are no build, lint, or test commands yet because nothing has been scaffolded.

The PRD is the spec and is detailed enough to build from directly. Read it before proposing structure; it settles most design questions already (stack, schema, algorithms, tuning constants, build order).

## Product in one line

An adaptive TDEE engine that infers true energy expenditure from logged intake vs. smoothed bodyweight trend, and adjusts calorie targets weekly. Food logging exists to feed the engine — it is not the product.

## Intended stack (PRD §2)

Expo + TypeScript with `expo-dev-client` (a dev build, **not** Expo Go — native modules are required from day one), `expo-sqlite` as the single offline-first source of truth, `expo-camera` for barcode/OCR, `expo-av` for audio, Google Gemini for vision/audio/structured output, EAS Build for distribution (Android first).

When scaffolding, set up `expo-dev-client` immediately rather than migrating later.

## Architectural invariants

These are the constraints that are easy to violate and expensive to unwind. Enforce them at the type level where possible.

**The engine's input wall.** `computeTDEE(intake, weights, profile)` is a pure function. It reads only `day_intake` and `weight_log`. It must not be able to accept `ExternalEstimate` (Zepp/wearable data) — that should be a compile error, not a convention. Wearable TDEE figures are Mifflin-St Jeor plus an accelerometer guess; they are reference-only, shown on charts, and never get a vote.

**Missing data is never imputed.** Unlogged days are excluded from both the intake and weight-delta windows. Never substitute zero, never assume the target was hit. One phantom zero-calorie day corrupts an entire window. Partial logs (`is_complete = 0`) drop out of the intake series but their weight reading still counts. In the UI, unlogged days render as gaps, not zeros.

**Smoothing is a Kalman filter, not a moving average.** 2-state (`[true_weight, trend_per_day]`). A moving average lags by half its window, which is the difference between responsive and broken. Confounders (`ate_out`, `travel`, `ill`, `poor_sleep`, `alcohol`) inflate `R` for that observation (≈ ×4) rather than discarding it. Missing days run the prediction step only — uncertainty `P` grows, which is correct.

**Targets change only at the weekly check-in.** Never daily, and no other screen may write them.

**The model never writes directly to the log.** All five input paths (voice, barcode, label OCR, meal photo, pot) converge on one `PendingEntry` object and one shared confirmation sheet. There is always a human beat before save.

**Always report TDEE as a range.** The visibly narrowing confidence band is what builds trust in the number.

## Domain traps

- **Kilojoules.** Australian nutrition panels list kJ, not kcal (`kcal = kJ / 4.184`). Getting this wrong makes every number ~4× too high. The OCR schema needs an explicit `energy_unit_detected` field plus a sanity check that `kcal_per_100g` falls between 0 and 900.
- **Raw vs cooked weight.** 100g raw basmati ≈ 300g cooked — a 200% error. Pot ingredient entry defaults to raw and must label the field unmistakably.
- **New diet phases.** Glycogen and water shifts make the filter briefly report absurd TDEEs (~4,000 kcal). Detect via `abs(trend) > 0.15 kg/day` in the first two weeks and damp.
- **`expo-speech` is text-to-speech.** There is no STT step in this app by design — audio goes straight to Gemini with a structured-output prompt. Do not reach for `@react-native-voice/voice` or similar.
- **Food lookup cascade order:** local `saved_food` → bundled AFCD SQLite → Open Food Facts (needs a `User-Agent` header) → label OCR. Not USDA — it gives American values for Australian foods.

## Build order

Phase 1 is the engine, with **no camera code**: schema/migrations → manual entry → Kalman filter (unit tested against synthetic data) → EWMA regression solver + edge cases → cold-start blend → Today/Trends screens → weekly check-in. Ship that and use it for a week before decorating it. Phases 2–4 (logging speed, AI paths, health integration) follow in PRD §13.

Resist jumping to camera or Gemini work early; the PRD is explicit that the engine must be verified first.

## Validating the engine

Test against synthetic data: a known true TDEE, a known intake series, derived weight change, Gaussian noise (σ ≈ 0.7 kg), injected water-weight spikes, and a **seeded PRNG** (never bare `Math.random()` — these tests must not flake).

**The PRD's original "±100 kcal by day 21" gate is not achievable, and you should not try to make it pass.** Measured over 300 seeds: 40% hit rate at day 21 (MAE 151 kcal), 78% by day 45, 89% by day 60. Theory confirms it — slope standard error over 21 points at σ=0.7 kg is ≈194 kcal of TDEE error, so ±100 kcal is ~0.5σ. A 20× parameter sweep found nothing better, so `KALMAN_DEFAULTS` stay at the PRD §4.1 values. Both the PRD Appendix and success criterion #2 have been annotated with this.

The gate that actually matters lives in `src/engine/__tests__/calibration.test.ts`: **the point estimate is unbiased and the reported band is correctly sized.** Empirical coverage of `[confidenceLow, confidenceHigh]` must land in 90–99%, with rails against a lyingly-narrow band *and* a uselessly-wide one (±5000 would score perfect coverage and say nothing). A calibrated ±190 at day 21 is a good result; a confident ±50 at day 21 is the engine lying. Verified by mutation — shrinking the band to 40% trips four assertions.

**When testing bias, centre the synthetic true TDEE on the Mifflin seed.** Otherwise the §4.3 cold-start blend produces ~+100 kcal of *apparent* bias during days 10–21 that is really just the prior doing its job, and you will go hunting a bug that does not exist. Residual genuine bias peaks around +53 kcal near day 30 and decays to ~+7 by day 60 — real, but ~2% of TDEE and well inside the band.

Kalman `Q`/`R` remain provisional per PRD §14 — they are exported parameters, not inlined constants, so a debug screen can drive them. If you retune, report real numbers, and never loosen an assertion to make a test green.

## UI rules that are algorithmic, not aesthetic

- **No streaks, no guilt, no red.** A missed day is data-neutral to the algorithm. If the UI implies otherwise, the user starts logging dishonestly to protect a number, which poisons the engine.
- **The 10-second test.** If logging a repeat meal takes longer than 10 seconds, the user quits within a fortnight and the engine starves. Today-screen decisions defer to this.
- **Confidence always visible.** A ±15% photo estimate must not look identical to a barcode scan.
- **Explain why the target moved**, in one sentence, at every check-in.
- Everything stays editable forever, including past days — the engine recomputes from history.

## Distribution

Two devices, one update stream. `eas.json` has a `preview` profile (Android APK, internal distribution) and a `testflight` profile (iOS, **store** distribution so no device UDID registration is needed). Both deliberately sit on the **same `preview` channel**, so one `eas update --branch preview` reaches both phones — for a two-person personal app there is no reason to maintain separate streams.

`eas.json` has no comment support: every key under `build` must be a profile object, and a `"_comment_*"` string key fails validation with `must be of type object`. Document build reasoning here instead.

Android updates install **over the top** (same keystore) and preserve the database. Only uninstalling wipes it. Most changes here are JS, so `eas update` reaches the phone with no APK at all; a new build is only needed when native modules change.

## Secrets

The Gemini key may live in `.env` with an `EXPO_PUBLIC_` prefix **only** for a personally sideloaded APK. Before any build leaves the owner's device, a Cloudflare Worker proxy must hold the key instead (PRD §8, and item 17 in the build order is marked mandatory for this reason).
