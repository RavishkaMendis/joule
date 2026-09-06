# PRD — Adaptive Macro Tracker (working name: **Basal**)

**Owner:** Rav
**Version:** 1.0
**Platform:** Expo / React Native (Android + iOS)
**Status:** Ready to build

---

## 1. Purpose

A personal nutrition tracker whose core value is an **adaptive TDEE engine** that measures true energy expenditure from the relationship between logged intake and smoothed bodyweight trend, and adjusts calorie targets weekly.

Food logging exists to feed that engine. It is a means, not the product.

### Success criteria
1. Logging a typical repeat meal takes **under 10 seconds**.
2. TDEE estimate converges to a stable value within **~6 weeks** of daily use, with an *honest confidence band from day one*. — **Revised 2026-08-26 after measurement; was "14 days".** See the Appendix for the numbers. 14 days is not physically achievable: with σ≈0.7 kg daily scale noise, 21 readings carry a slope standard error of ≈194 kcal, so a ±100 kcal claim at day 21 is roughly half a standard deviation and lands ~40% of the time. This is an information-theoretic floor, not a tuning problem — no `Q`/`R` beats it. What *is* achievable, and what actually builds trust, is a correctly-sized band that visibly narrows (§4.5).
3. User can log 90% of meals without a network connection failure blocking them.
4. All data exportable as JSON/CSV at any time.

### Non-goals (v1)
- Micronutrient tracking (beyond a supplements stub)
- Exercise/workout calorie logging — **the TDEE engine already captures activity; adding it double-counts**
- Cloud sync, accounts, social features
- Recipe discovery, meal plans, coaching content

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Expo (SDK latest) + TypeScript | Dev build required (`expo-dev-client`), not Expo Go |
| Local DB | `expo-sqlite` | Single source of truth. Offline-first. |
| Camera / barcode | `expo-camera` | Built-in `onBarcodeScanned` — no separate scanner lib |
| Audio capture | `expo-av` | Records voice notes |
| AI | Google Gemini API (Flash / Flash-Lite) | Vision + audio + structured output |
| Health data | `react-native-health-connect` (Android), HealthKit module (iOS) | **Phase 2** |
| Charts | `victory-native` or `react-native-svg` direct | Keep light |
| Build | EAS Build | Android APK sideload; iOS via TestFlight later |

### Known Expo gotchas to plan for
- **Native modules require a dev build.** Health Connect, HealthKit, and any STT library will not run in Expo Go. Build with `expo-dev-client` from day one so you're not migrating later.
- **`expo-speech` is text-to-speech, not speech-to-text.** See §7.1 — we sidestep STT libraries entirely.
- **iOS distribution needs an Apple Developer account ($99/yr)** for TestFlight. Android sideloading is free. Ship Android first; iOS when the partner actually wants it.
- **EAS free tier has monthly build limits.** Android can also be built locally on Linux if you hit them.

---

## 3. Data model

Four core tables. Note the deliberate wall between measured truth and external estimates.

```sql
-- ═══ ENGINE INPUTS: the only two tables the TDEE engine may read ═══

CREATE TABLE day_intake (
  date            TEXT PRIMARY KEY,   -- ISO yyyy-mm-dd, local time
  kcal            REAL,
  protein_g       REAL,
  carbs_g         REAL,
  fat_g           REAL,
  is_complete     INTEGER DEFAULT 1   -- 0 = user flagged "didn't log everything"
);

CREATE TABLE weight_log (
  date            TEXT PRIMARY KEY,
  weight_kg       REAL NOT NULL,
  confounder      TEXT,               -- null | 'ate_out' | 'travel' | 'ill' | 'poor_sleep' | 'alcohol'
  source          TEXT DEFAULT 'manual'  -- manual | health_connect | healthkit
);

-- ═══ REFERENCE ONLY: engine must NOT read this ═══

CREATE TABLE external_estimate (
  date            TEXT PRIMARY KEY,
  source          TEXT,               -- 'zepp'
  tdee_est        REAL,
  active_kcal     REAL,
  steps           INTEGER,
  sleep_minutes   INTEGER,
  readiness       INTEGER
);

-- ═══ LOGGING LAYER ═══

CREATE TABLE food_entry (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL,
  logged_at       INTEGER,
  name            TEXT,
  grams           REAL,
  kcal            REAL,
  protein_g       REAL,
  carbs_g         REAL,
  fat_g           REAL,
  source          TEXT,               -- barcode | label_ocr | meal_photo | voice | pot | manual | afcd
  confidence      TEXT,               -- exact | high | medium | low
  pot_id          TEXT,
  raw_input       TEXT                -- original transcript / model response, for debugging
);

CREATE TABLE saved_food (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  barcode         TEXT,
  kcal_per_100g   REAL,
  protein_per_100g REAL,
  carbs_per_100g  REAL,
  fat_per_100g    REAL,
  default_grams   REAL,
  use_count       INTEGER DEFAULT 0,
  last_used       INTEGER
);

CREATE TABLE pot (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  created_at      INTEGER,
  total_weight_g  REAL,               -- weight of finished cooked batch
  remaining_g     REAL,
  kcal_per_g      REAL,
  protein_per_g   REAL,
  carbs_per_g     REAL,
  fat_per_g       REAL,
  ingredients     TEXT,               -- JSON array, for reference/editing
  is_active       INTEGER DEFAULT 1
);

CREATE TABLE supplement (        -- stub for phase 2
  id              TEXT PRIMARY KEY,
  name            TEXT,
  dose            TEXT,
  schedule        TEXT,
  kcal            REAL DEFAULT 0,
  protein_g       REAL DEFAULT 0
);

CREATE TABLE user_profile (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  height_cm       REAL,
  birth_year      INTEGER,
  sex             TEXT,
  goal            TEXT,               -- cut | maintain | gain
  rate_kg_per_week REAL,
  activity_seed   TEXT,               -- sedentary..very_active, cold-start only
  protein_override REAL,
  units           TEXT DEFAULT 'metric'
);
```

### Architectural rule (non-negotiable)

The TDEE engine is a **pure function** with this signature:

```typescript
function computeTDEE(
  intake: DayIntake[],
  weights: WeightLog[],
  profile: UserProfile
): TDEEResult
```

It cannot accept `ExternalEstimate`. Enforce this at the type level so it's a compile error, not a discipline problem. At 2am "I'll just blend them a little" will look reasonable. It is not.

---

## 4. The TDEE engine

This is the product. Build and test it **first**, with manual data entry only, before any camera code exists.

### 4.1 Stage one — smooth the weight signal (Kalman filter)

Raw scale readings are dominated by water, glycogen, sodium and gut contents. A rice-and-dal diet means large day-to-day swings, so smoothing matters more here than for most diets.

Use a 2-state Kalman filter. **Not** a moving average — moving averages lag by half their window, which is the difference between an app that feels responsive and one that feels broken.

**State vector:** `x = [true_weight_kg, trend_kg_per_day]`

```
Prediction step:
  weight_pred = weight + trend
  trend_pred  = trend
  F = [[1, 1], [0, 1]]
  P = F·P·Fᵀ + Q

Update step:
  H = [1, 0]                     (we observe weight only)
  y = z_observed − weight_pred   (innovation)
  S = H·P·Hᵀ + R
  K = P·Hᵀ·S⁻¹                   (Kalman gain)
  x = x + K·y
  P = (I − K·H)·P
```

**Tuning constants (start here, expose in a debug screen):**

| Param | Value | Meaning |
|---|---|---|
| `R` (measurement noise) | `0.6 kg²` | Daily scale noise. Higher = trust individual readings less. |
| `Q_weight` | `0.005` | Process noise on weight |
| `Q_trend` | `0.0005` | Process noise on trend. Lower = smoother, slower to react. |
| `P₀` | `[[1.0, 0], [0, 0.01]]` | Initial uncertainty |

**Confounder handling:** when `confounder IS NOT NULL`, inflate `R` for that observation (e.g. `R × 4`). The reading still informs the filter but carries far less weight. This is cleaner than discarding it.

**Missing days:** run the prediction step only, skip the update. Uncertainty `P` grows naturally, which is correct — the app genuinely knows less.

### 4.2 Stage two — solve for expenditure

Energy balance:

```
TDEE ≈ mean_daily_intake + (7700 × kg_lost_per_day)
```

7700 kcal/kg is the approximate energy density of body tissue change. Losing weight means expenditure exceeded intake; the gap is your TDEE surplus over what you ate.

Do **not** compute this on a flat trailing average. Use **exponentially weighted linear regression** over the history:

```
weight_i = exp(−ln(2) × days_ago_i / HALF_LIFE)
HALF_LIFE = 14 days
```

Recent days dominate, older days fade smoothly. This gives responsiveness *and* stability instead of forcing a choice.

Implementation: weighted least squares over the joint series of (cumulative intake, Kalman-smoothed weight), solving for the expenditure constant that best explains observed weight change.

### 4.3 Cold start

No historical data — this is expected and fine.

**Days 0–9:** Seed with Mifflin-St Jeor from onboarding data, multiplied by the declared activity factor.

```
BMR (male)   = 10·kg + 6.25·cm − 5·age + 5
BMR (female) = 10·kg + 6.25·cm − 5·age − 161
seed_TDEE    = BMR × activity_factor   (1.2 / 1.375 / 1.55 / 1.725)
```

Display it clearly labelled **"Estimated — collecting data"** with a wide confidence band. Do not pretend it's measured.

**Days 10–21:** Blend seed and measured, weighting measured progressively higher as the confidence interval narrows.

**Day 21+:** Pure measured. Drop the seed entirely.

### 4.4 Edge cases that will otherwise ruin it

| Case | Handling |
|---|---|
| **Unlogged day** | Exclude from **both** intake and weight-delta windows. Never impute zero, never assume target was hit. One phantom zero-calorie day corrupts the whole window. |
| **Partial log** (`is_complete = 0`) | Exclude from the intake series. Weight reading still counts. |
| **First 10 days of a new diet phase** | Heavily downweight. Glycogen and water shifts will make the filter briefly report a 4,000 kcal TDEE. It is lying. Detect via `abs(trend) > 0.15 kg/day` in the first two weeks and damp accordingly. |
| **Sustained underreporting** | Mathematically self-correcting — if you log 2,000 and eat 2,400, the engine concludes your TDEE is 400 lower and the *targets still work*. Worth surfacing in a help screen so the user doesn't chase a "broken metabolism." |
| **Weight gain during a deficit** | Do not alarm. Widen the band, wait. Almost always water. |
| **Gap > 7 days** | Reset `P` upward substantially. Prompt: "Been a while — want to recalibrate?" |

### 4.5 Output contract

```typescript
type TDEEResult = {
  tdee: number;              // kcal/day
  confidenceLow: number;
  confidenceHigh: number;
  trendKgPerWeek: number;
  smoothedWeightKg: number;
  dataQuality: 'seeding' | 'converging' | 'stable';
  daysOfData: number;
  loggedDaysInWindow: number;
}
```

**Always report a range, never a bare number.** The band narrows as data accumulates — that visible narrowing is what builds trust in the number.

---

## 5. Targets

Recalculated **only** at the weekly check-in. Never daily.

```
target_kcal = TDEE − (rate_kg_per_week × 7700 / 7)
```

**Safety rails:**
- Deficit capped at **25% of TDEE**
- Absolute floor: **1,500 kcal** (male) / **1,200 kcal** (female)
- If the requested rate would breach a rail, cap it and tell the user plainly

**Macro allocation, in order:**
1. **Protein** — `1.6 g/kg` (maintain/gain) to `2.2 g/kg` (cut), from smoothed weight. Set automatically, manually overridable.
2. **Fat floor** — `0.8 g/kg` minimum, hormonal health.
3. **Carbs** — absorb the remainder.

---

## 6. Food data sources

**Priority cascade** on any lookup:

1. **Local `saved_food`** — instant, offline, personal. Always checked first.
2. **Bundled AFCD SQLite** — Australian Food Composition Database, Release 3.0, ~1,588 generic foods. Ships in the app bundle. Zero network, zero cost, and Australian-accurate.
3. **Open Food Facts** — barcode lookup, free, no API key, requires a `User-Agent` header. AU coverage is patchier than Europe.
4. **Label OCR** — the reliable fallback. Always available.

### ⚠️ Kilojoule handling

**Australian nutrition panels list energy in kJ, not kcal.** The label OCR path must detect the unit and convert:

```
kcal = kJ / 4.184
```

Getting this wrong makes every number ~4× too high. Add an explicit unit field to the OCR output schema and a sanity check (`kcal_per_100g` between 0 and 900) before saving.

### Why not USDA
Generic-food entries traced to USDA give American values for Australian foods — the well-documented "why does my Weet-Bix have American calories" problem. AFCD replaces it entirely.

---

## 7. Input methods

Five paths, **one shared confirmation sheet**. Every path produces the same intermediate object:

```typescript
type PendingEntry = {
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: 'exact' | 'high' | 'medium' | 'low';
  source: EntrySource;
}
```

Build the sheet once, build it well. Every input method is then just a different way to populate it. **The model never writes directly to the log — there is always a human beat before save.**

### 7.1 Voice (primary)

Hold FAB → record → release → confirmation sheet.

**Skip speech-to-text libraries entirely.** Send the audio file directly to Gemini with a structured-output prompt. One API call: audio in, parsed food entries out. No `@react-native-voice/voice`, no native module, no transcription step to go wrong.

> *"One wrap, about 150 grams of chicken, tablespoon of oil, bit of yoghurt"*
> → `[{wrap, 60g}, {chicken breast, 150g}, {olive oil, 14g}, {greek yoghurt, 30g}]`

Audio tokens cost more than text but volume is negligible (see §8).

### 7.2 Barcode

`expo-camera` → Open Food Facts → confirmation sheet. On miss, offer label OCR immediately in the same flow. **Never dead-end the user.**

### 7.3 Label OCR (workhorse in AU)

Photo of the Nutrition Information Panel → Gemini reads the per-100g column → user enters grams consumed. Near-exact accuracy, works on any product regardless of database coverage.

Offer "save to my foods" on every successful scan — this is how the personal library grows.

### 7.4 Meal photo + annotation

Photo of the plate, optionally with a voice note. **The model identifies components; the user's stated quantities win.** Where the user gives no quantity, the model estimates and marks confidence `low`.

Expect ±25–40% error with no annotation, ±15% with it. Display confidence honestly.

### 7.5 Pot logging (highest value for this user)

The feature that makes rice/dal/chicken tractable, and the only one that captures **cooking oil** — the single largest hidden variable in South Asian home cooking. Three tablespoons of ghee is ~360 kcal no vision model will ever see.

**Flow:**
1. Cook batch → log ingredients once (voice or search)
2. Weigh the finished pot → enter total grams
3. App computes `kcal_per_g` for the batch
4. Every serving after: tap pot → weigh bowl → done (2 taps)

**⚠️ Raw vs cooked:** the app must force an explicit declaration. 100g raw basmati ≈ 300g cooked. Getting this wrong is a 200% error. Default ingredient entry to **raw weight** and label the field unmistakably.

Either partner can create a pot. Pots decrement `remaining_g` per serving and auto-archive at zero.

---

## 8. AI integration

**Provider:** Google Gemini via AI Studio key. Flash-Lite for label OCR and voice parsing; Flash for meal photos.

**Rationale:** Flash and Flash-Lite are free at the API level with daily rate limits in the hundreds-to-thousands of requests. Expected usage is ~6–10 calls/day. No credit card required.

### Cost projection (6 photos/day, 180/month)

| Model | Per month |
|---|---|
| **Gemini free tier** | **$0.00** |
| Gemini 2.5 Flash-Lite (if paid) | ~$0.06 |
| Gemini Flash (if paid) | ~$1.00 |

Even at paid rates with voice audio included, under **$2/month**. Barcode and AFCD lookups cost nothing.

### Key handling

⚠️ **Do not ship the API key in the app bundle.** Anyone with the APK can extract it.

- **Personal build:** key in `.env`, `EXPO_PUBLIC_` prefix, acceptable for your own sideloaded APK only.
- **Before sharing with partner/friends:** put a **Cloudflare Worker** in front (free tier, 100k req/day). App calls the Worker, Worker holds the key. ~30 lines. Do this before the APK leaves your device.

### Output schema

Force strict JSON with a defined schema. Reject and retry once on parse failure, then fall back to manual entry.

```json
{
  "items": [
    {
      "name": "string",
      "grams": "number",
      "kcal_per_100g": "number",
      "energy_unit_detected": "kcal | kJ",
      "protein_per_100g": "number",
      "carbs_per_100g": "number",
      "fat_per_100g": "number",
      "confidence": "exact | high | medium | low",
      "assumptions": "string"
    }
  ]
}
```

Surface `assumptions` in the confirmation sheet. "Assumed 1 tbsp oil ≈ 14g" builds trust and catches errors.

---

## 9. Screens

### 9.1 Today (landing)

**Status block** — plain large numbers, no decorative rings:
```
1,847 / 2,240              remaining 393
P 142/165   C 180/220   F 58/62
TDEE 2,510 ±90    ·    trend −0.42 kg/wk
```
Protein listed first — it's the macro that matters and the one most often missed.

**Quick-add chips** — 4–6 most frequent foods and active pots, one tap each. After two weeks this covers the majority of logging. Highest value-per-line-of-code element in the app.

**Entry list** — today's items, tap to edit, swipe to delete, small source icon per row so exactness is visible at a glance.

**FAB** — tap for menu, **hold for voice**.

> **The 10-second test:** if logging a repeat meal takes longer than 10 seconds, the user stops within a fortnight and the engine starves. Every UI decision on this screen defers to that.

### 9.2 Trends

- **TDEE chart** — solid measured line with confidence band; dashed grey Zepp line; "Strap bias: +19%" stat once 30 days exist
- **Weight chart** — faint dots for raw readings, solid line for Kalman-smoothed. Seeing the noise cloud around the smooth line is quietly reassuring.
- **Intake adherence** — bars vs target; **unlogged days render as gaps, not zeros**

### 9.3 Weekly check-in

Fires Sunday morning. Full-screen, single card, feels like an event.

```
Week 6
Measured TDEE   2,510  (was 2,470)
Weight trend    −0.42 kg/wk  (target −0.5)
Logged          6/7 days

New target: 2,240 kcal  (+60)

[Accept]  [Keep current]  [Adjust rate]
```

**Always explain why the number moved, in one sentence.** Legibility of the algorithm's reasoning is exactly why MacroFactor works psychologically. A black box handing down numbers does not.

**This is the only screen that changes targets.**

### 9.4 Foods & Pots

Two tabs. Saved foods (searchable, frequency-ranked). Active pots (name, kcal/g, remaining grams, tap to log a serving).

### 9.5 Onboarding

Height, birth year, sex, current weight, goal, target rate, activity level, typical meals/day. All editable later in settings. Ends by asking who cooks — used to frame pot-logging prompts.

Set expectations explicitly on the final screen. **Revised 2026-08-26** — the original copy promised two weeks, which the measured engine cannot deliver (see Appendix); promising it and then missing it is exactly the way to lose the user's trust in the number:

*"For the first couple of weeks I'll show a wide range rather than a single number — that range is honest, not a placeholder. It tightens as you log. Expect a number you can lean on after about six weeks of daily weigh-ins."*

The band is the feature. Do not apologise for it.

### 9.6 Weight entry

Prominent morning prompt. One number, plus an optional one-tap confounder chip row (ate out / travel / ill / poor sleep / alcohol).

---

## 10. Design rules

- **Dark, system default typography, minimal custom styling.** Function over polish.
- **No streaks, no guilt, no red.** A missed day is data-neutral to the algorithm; the UI must not imply otherwise or the user starts logging dishonestly to protect a number — which poisons the engine.
- **Everything editable forever**, including past days. The engine recomputes from history.
- **Confidence always visible.** A ±15% photo estimate must not look identical to a barcode scan.
- **Offline-first.** Only barcode lookup and AI calls need network. Everything else works on the train.

---

## 11. Health integration (Phase 2)

- **Android:** `react-native-health-connect` — read weight, sleep, steps, readiness
- **iOS:** HealthKit module — same fields
- Smart scale writes to both platforms natively, so weight flows in automatically

**Auto-confounder flagging:** 4 hours of sleep + readiness crash → automatically down-weight that morning's reading. Removes the need for the user to remember. MacroFactor doesn't do this.

**Zepp data is reference-only.** Imported to `external_estimate`, displayed on the trends chart, never read by the engine. Useful for calibrating the wearable against ground truth ("your strap runs 19% high") — which is a genuine feature — but its calorie figure is largely Mifflin-St Jeor plus an accelerometer guess, and it does not get a vote.

---

## 12. Export / import

- **Export:** full JSON dump + per-table CSV, via share sheet. Available from day one.
- **Import:** generic CSV for `weight_log` and `day_intake`.

The point of this app is escaping a subscription. Don't build a new prison.

---

## 13. Build order

**Phase 1 — the brain (build first, no camera code)**
1. SQLite schema + migrations
2. Manual food entry + manual weight entry
3. **Kalman filter — unit tested against synthetic data**
4. EWMA regression TDEE solver + edge cases
5. Cold-start seeding and blend
6. Today screen, Trends screen
7. Weekly check-in

*Ship this to yourself. Use it for a week with manual entry. The engine is the product; verify it works before decorating it.*

**Phase 2 — logging speed**
8. Bundle AFCD SQLite, search UI
9. Saved foods + quick-add chips
10. Barcode scan → Open Food Facts
11. Shared confirmation sheet
12. Gemini integration: label OCR (with kJ handling)

**Phase 3 — the good stuff**
13. Voice → Gemini audio → structured entries
14. Pot logging
15. Meal photo + annotation
16. Export/import

**Phase 4 — polish and share**
17. Cloudflare Worker key proxy *(mandatory before any APK leaves your device)*
18. Health Connect / HealthKit
19. Zepp reference import
20. Supplements
21. iOS build + TestFlight

---

## 14. Open items

- Kalman `Q`/`R` values need empirical tuning once real data exists — build a debug screen exposing them rather than guessing forever
- Decide whether the weekly check-in auto-accepts after N days of being ignored
- App name

---

## Appendix — validating the engine before real data

Generate synthetic data: a known true TDEE, a known intake series, derived weight change, plus Gaussian noise (σ ≈ 0.7 kg) and a few injected water-weight spikes.

The engine should recover the known TDEE within ±100 kcal by day 21. If it doesn't, the filter is mistuned — and you'll find out in minutes rather than after three weeks of real logging.

> **⚠️ Revised 2026-08-26 — the day-21 gate above is not statistically achievable.** It was measured, not assumed. Over 300 seeds against the implemented engine:
>
> | Horizon | Within ±100 kcal | Mean abs error | p90 |
> |---|---|---|---|
> | day 21 | 40% | 151 kcal | 312 |
> | day 30 | 47% | 123 kcal | 238 |
> | day 45 | 78% | 63 kcal | 131 |
> | day 60 | 89% | 50 kcal | 107 |
>
> Theory agrees with measurement: OLS slope standard error over 21 daily points at σ=0.7 kg is `0.7/√770 ≈ 0.0252 kg/day`, i.e. `7700 × 0.0252 ≈ 194 kcal` of TDEE standard error. ±100 kcal is ~0.5σ, so ~40% is exactly what you'd predict. A 20× sweep over `Q_weight`, `Q_trend`, `R`, and half-life found no meaningful improvement, so `KALMAN_DEFAULTS` were left at the §4.1 values.
>
> **The real acceptance gate is therefore:** the point estimate is *unbiased* (errors centre on zero, not skewed), and the *reported confidence band is correctly sized* — i.e. the true TDEE falls inside the stated band about as often as the band claims. A calibrated ±190 at day 21 is a good result. A confident ±50 at day 21 would be the engine lying, and is the actual failure mode to test for.


