# Competitive analysis — Joule vs. MacroFactor / MyFitnessPal / Cronometer

Research date: 2026-08-28. Scope per brief: logging speed, meal structure, date navigation, analytics presentation, adaptive-TDEE legibility, anti-patterns. Meal grouping (breakfast/lunch/dinner/snack + naming) and calendar date-navigation are already being built by other agents — they are *not* headline recommendations here, but are discussed where their design choices affect the rest of the app.

**How to read this document:** every competitor claim is tagged **[Verified: URL]** (found in an official help doc, blog post, or a review I can cite) or **[Inferred]** (my synthesis/assumption, not directly sourced). Where I couldn't confirm a mechanism, I say so rather than guess.

---

## 1. What Joule already does well

Reading `src/` before researching anything else, Joule is materially ahead of the PRD's Phase 1–3 scope, and ahead of competitors on a few specific points:

- **Quantity multiplier chips in `ConfirmSheet`** (½ ⅓ ¾ ×1 ×2 ×3, `src/components/ConfirmSheet.tsx`) — a one-tap "I had two of these" / "I only ate half" that MacroFactor's own multi-add doesn't obviously expose as a portion fraction, only a quantity count **[Inferred — I could not confirm MacroFactor exposes fraction-of-serving portions this directly; their "Favorites" store fixed presets instead, see §2]**.
- **Confidence-anchored promotion logic** (`originalConfidence` in `ConfirmSheet.tsx`) — editing a low-confidence AI estimate promotes it towards `high` without letting repeated keystrokes over-promote it. This is a level of rigor no competitor documentation mentions; it directly serves PRD §10's "confidence always visible" rule instead of undermining it.
- **8-panel Trends dashboard** (`src/screens/TrendsScreen.tsx`) already includes energy balance (intake vs. expenditure, gap-shaded), weekly rollup table, protein consistency (hit-rate + distribution, not just average), day-of-week pattern, and a data-quality/confidence breakdown. This matches or exceeds what MacroFactor's dashboard shows per their own materials (§4 below), and Joule got there without a "customize your dashboard" settings screen — it just shows the useful things by default.
- **Weekly check-in explanation is generated from real numbers** (`src/lib/checkInLogic.ts`'s `explainTargetChange`), not a canned string — this is exactly the legibility PRD §9.3 asks for, and MacroFactor's own transparency messaging is the standard being matched **[Verified](https://help.macrofactorapp.com/en/articles/26-how-should-i-interpret-changes-to-my-energy-expenditure)**.
- **Gap-not-zero handling is already threaded through, not just the engine.** `AdherenceChart` and the Trends footnote explicitly render unlogged days as gaps and say so ("doesn't count against you here or anywhere else"). This is a real point of difference from MyFitnessPal, which pressures users to backfill *something* to protect a streak (§6).

## 2. Gap analysis

### 2.1 Logging speed and friction

**What the leaders do, verified:**
- MyFitnessPal: swipe right below a meal name to bring forward the last-logged items for that meal slot without searching **[Verified](https://community.myfitnesspal.com/en/discussion/10932477/copy-previous-meal-to-today)**; web "Quick Tools" copies checked items to/from any date **[Verified](https://support.myfitnesspal.com/hc/en-us/articles/360032622131-How-do-I-copy-a-meal-from-one-day-to-another)**. Copying works at the meal level, not whole-day or single-item **[Verified](https://community.myfitnesspal.com/en/discussion/10932477/copy-previous-meal-to-today)**.
- MacroFactor built and published a "Fastest Food Logger Speed Index" (FLSI) — an explicit, methodical action-count benchmark against competitors, remeasured in 2025 **[Verified](https://macrofactor.com/fastest-food-logger-2025/)**. Their claim: their strongest competitor needs 25% more discrete actions, the average competitor ~70% more, and vs. MyFitnessPal specifically, 10 actions vs. 15 for a food-search log **[Verified](https://macrofactor.com/fastest-food-logger-2025/)**. Their "Latest" list surfaces recently-logged foods so repeats don't need search at all, and "multi-add" remembers the last-used serving so a repeat log needs no quantity re-entry **[Verified](https://help.macrofactorapp.com/en/articles/215-how-to-log-food-in-macrofactor)**.
- Cronometer: recipes can be saved as gram-based or serving-based, but **you cannot convert between the two after creation** — you have to "Edit a Copy" and pick again, and multiple serving-size definitions can be layered onto one recipe (e.g., "8 slices of pie") **[Verified](https://forums.cronometer.com/discussion/3109/working-with-recipe-serving-size)**. This is presented as a rigid, occasionally frustrating design, per the community-forum tone.

**Gap in Joule:** Joule's quick-add is single-tap already (`logQuickAdd` — no dialog, `src/lib/foodEntryActions.ts`), which structurally matches MacroFactor's fastest path. What Joule is missing that MyFitnessPal/MacroFactor both have and Joule doesn't yet: a **"repeat yesterday's [meal]" action scoped to a meal**, distinct from the flat quick-add-chip ranking. Quick-add chips (`getQuickAddCandidates`, ranked by `use_count`/`last_used` globally) are the *individual-food* fast path; nothing currently reconstructs "the whole lunch I ate yesterday" as one action. This is squarely inside the meal-grouping work already in flight, so it's not a headline item here, but the underlying data note matters: **`saved_food` currently has no concept of a multi-item bundle** — only single foods get `use_count`/`default_grams`. If the meal-grouping agent doesn't already add a "save this meal as a template" primitive, that's the single highest-leverage miss relative to both competitors (see §2.2 and Recommendation R1).

### 2.2 Meal structure

**What the leaders do, verified:**
- MyFitnessPal's default sections are Breakfast/Lunch/Dinner/Snacks/Beverages/Supplements, renameable per-user (the rename applies globally across all days, not per-day) **[Verified](https://support.myfitnesspal.com/hc/en-us/articles/360032622311-Can-I-change-my-meal-names-or-add-more-meals)**, plus up to two extra custom slots **[Verified](https://wellnd.com/can-i-add-another-meal-on-myfitnesspal-your-definitive-guide)**. "Save as Meal" bundles the current entries under one saved name for reuse **[Verified](https://blog.myfitnesspal.com/create-meals-recipes-myfitnesspal/)**.
- MacroFactor's "recipe" mechanism: select foods from the timeline → "Create recipe" → name it and set servings → reuse later in one action **[Verified](https://help.macrofactorapp.com/en/articles/239-save-a-meal-for-later-use)**. Notably they also built an **"Explode Recipe"** feature: pull a saved recipe back apart into its constituent items so you can tweak one ingredient without either re-entering the whole thing or permanently mutating the saved template **[Verified](https://help.macrofactorapp.com/en/articles/239-save-a-meal-for-later-use)** (via their `10-macrofactor-features` roundup). This solves a real problem neither MyFitnessPal's model nor Joule's current data model solves: "same lunch, but no rice today."
- MacroFactor also has "Favorites" — multiple saved *presets of the same food* (e.g., half-portion vs. full-portion versions) logged with one tap each, separate from the recipe/meal-template mechanism **[Verified](https://macrofactor.com/favorite-foods/)**.

**Gap in Joule:** three distinct capabilities are being conflated by "meal grouping," and only one of them is what's currently being built:
1. Grouping entries visually under a meal-time label (in flight elsewhere — fine).
2. **Saving a *combination* of entries as one reusable, named template** (not yet in the schema — `saved_food` is single-item only). This is the actual "3 seconds instead of 30" mechanism competitors have and Joule doesn't.
3. **Editing one item within a reused combination without exploding the abstraction** — MacroFactor's answer is the explicit "Explode" verb. Worth naming explicitly so whoever builds meal templates doesn't ship a template that's all-or-nothing (log the whole saved meal or don't use it at all), which would actively regress logging speed on the very common case of "same lunch, minus the naan today."

This is Recommendation R1 below — flagged as the most important miss the meal-grouping work should not walk past.

### 2.3 Date navigation

**What the leaders do, verified:**
- MyFitnessPal: `<`/`>` arrows either side of the date on both web and mobile step one day at a time; a calendar icon jumps to any arbitrary date **[Verified](https://community.myfitnesspal.com/en/discussion/10652545/viewing-previous-weeks-food-diary)**. Diary history and total counts persist even across missed days, so backfilling doesn't require reconstructing anything **[Verified](https://blog.myfitnesspal.com/what-to-do-when-you-miss-a-day-of-food-logging/)**.
- A recurring community complaint pattern (forum threads, not official docs, so weaker evidence): users repeatedly ask for "copy the whole previous day" and are told it doesn't exist — copying is meal-scoped only **[Verified — as a documented limitation, not a feature](https://community.myfitnesspal.com/en/discussion/10818760/can-you-copy-the-whole-previous-day-when-adding-things-today)**.

**Gap/inference for Joule:** the date-navigation work in flight should cover the `<`/`>` step-by-day plus jump-to-date pattern; that's the well-established baseline and is presumably what's being built. One thing worth flagging to whoever owns that work, since it's adjacent but not the same: **the weight-entry and check-in flows are date-implicit today** (`WeightEntryScreen` navigates with `{ date }`, but `WeeklyCheckInScreen` always computes off `todayLocalISO()` — see `src/screens/WeeklyCheckInScreen.tsx` line 117). If date navigation lets a user sit on a past day, make sure nothing on that day accidentally lets them re-trigger a check-in or misdate a weight reading against "today" instead of the viewed date — this is a one-line risk, not a design gap, but worth a note since it's exactly the kind of bug that only shows up once back-filling exists.

### 2.4 Analytics and insight presentation

**What MacroFactor actually shows, verified:**
- Dashboard: Trend Weight (Kalman/exponential-smoothing-style trend line, distinct from raw scale weight) **[Verified](https://help.macrofactorapp.com/en/articles/21-weight-trend)**; an energy-balance widget overlaying consumption against expenditure/targets **[Verified](https://help.macrofactorapp.com/en/articles/254-how-to-customize-your-dashboard)**; adherence rate alongside average intake/macros and their relationship to rate of weight change **[Verified — described at a high level, exact formula not published](https://macrofactor.com/dashboard-revamp/)**; body-metrics comparison, steps, progress photos as of the 4.0.0 dashboard customization release **[Verified](https://macrofactor.com/dashboard-customization/)**.
- MacroFactor's own framing: insights are communicated "in a colorful yet adherence-neutral way that emphasizes sustainable process over short-term failure or success" **[Verified](https://macrofactor.com/dashboard-revamp/)** — i.e., they explicitly designed against a shame framing, which validates PRD §10 rather than undercutting it.
- I could **not verify the exact adherence-score formula** MacroFactor uses — their materials describe what the score relates to, not how it's computed. Do not assume it's a simple hit-rate; Joule's own `proteinConsistency`/`adherenceSeries` approach (hit-rate + distribution, gaps-not-zeros) is a reasonable and defensible design already, not something to chase toward an unverified competitor internals.

**Assessment: mostly decorative-vs-useful is already resolved correctly in Joule.** The Trends screen's own doc-comment explicitly rejected a "rate vs goal" chart as redundant with the weight chart + weekly table — that's the right instinct, and it's one MacroFactor's "customizable dashboard" pitch implicitly concedes by needing 4.0.0 to let users *hide* widgets that don't serve them. Joule doesn't have that clutter problem because it ships fewer, denser panels by default.

**One real gap:** MacroFactor overlays consumption against *expenditure* (not just target) on an energy-balance-style widget **[Verified](https://help.macrofactorapp.com/en/articles/254-how-to-customize-your-dashboard)**. Joule's `EnergyBalanceChart` already does intake vs. expenditure per the Trends screen's own comment ("shows WHY weight moved, not just that it did") — so this is already covered, not a gap. No action needed here; noted only so it's not mistakenly re-built.

### 2.5 Adaptive TDEE legibility

**What MacroFactor actually says, verified:**
- They frame it as measuring the energy-balance equation over "typically two to four weeks," explicitly smoothing out water retention, weekend overeating, and weigh-in noise to find the underlying trend, and state 50–100 kcal accuracy after 2–3 weeks of consistent logging **[Verified](https://help.macrofactorapp.com/en/articles/26-how-should-i-interpret-changes-to-my-energy-expenditure)**, **[Verified — accuracy claim](https://caleye.fit/blog/macrofactor-tdee-tracking-accuracy/ — secondary source, not MacroFactor's own claim, treat with caution)**.
- They explicitly refuse to blend in wearable data at all, citing more confidence in their own algorithm than in wearable measurement error **[Verified](https://help.macrofactorapp.com/en/articles/126-why-is-my-expenditure-in-macrofactor-different-from-the-output-of-a-tdee-calculator)** — this is the exact same architectural stance as PRD's engine input wall (Zepp reference-only, never a vote). Good independent confirmation the wall is the right call, not overcaution.

**Joule's position relative to this:** the PRD Appendix's honesty about the day-21 gate being statistically unachievable, and the calibration-not-point-accuracy acceptance test in `src/engine/__tests__/calibration.test.ts`, is **more rigorous than anything MacroFactor publishes**. MacroFactor's "50–100 kcal after 2-3 weeks" claim reads, against Joule's own measured 151 kcal MAE / 40% hit-rate at day 21, either as marketing rounding, a different (looser) accuracy definition, or a genuinely better-tuned algorithm — I cannot tell which from public sources, and Joule's own appendix is right not to just copy the claim. **Recommendation: do not chase MacroFactor's stated accuracy number as a target; it's unverifiable and the honest, calibrated band is the more defensible position PRD §4.5 already commits to.**

One presentation gap worth naming: MacroFactor's help-center article structure (`interpet_energy_expenditure`, `why-is-my-expenditure-different-from-a-tdee-calculator`) suggests they maintain **standing, linkable explainer copy** a user can return to when confused, separate from the in-the-moment one-sentence explanation at check-in. Joule's `explainTargetChange` covers the "why did it move this week" moment (PRD §9.3) but there's no equivalent "why does my number differ from what a TDEE calculator would say" reference screen. See R4.

### 2.6 Anti-patterns — streaks, guilt, gamification

**Verified findings, and they're worse than "annoying":**
- Qualitative research (Cambridge/BJPsych Open) found users of diet/fitness apps reported guilt, embarrassment, and shame specifically triggered by **exceeding a calorie budget and being shown red visualizations** in response **[Verified](https://www.cambridge.org/core/journals/bjpsych-open/article/effects-of-diet-and-fitness-apps-on-eating-disorder-behaviours-qualitative-study/2D1EE739D97AB3EFC6573835E4C527BD)**.
- MyFitnessPal's 2026 Today tab ships a food-logging streak counter for consecutive logging days; reporting on it describes users experiencing "devastation" at breaking a streak before reaching round-number milestones (e.g., 100 days), and characterizes missing a day as being made to feel like "moral failure" **[Verified](https://www.ksl.com/article/51582307/nutrition-apps-can-help-build-healthy-habits-for-some-users-their-gaming-features-carry-risks)**.
- Expert commentary in the same reporting ties these gamified mechanics to reinforcement of body-dysmorphia and disordered-eating-adjacent behaviors, and to binge-eating triggers specifically **[Verified](https://www.ksl.com/article/51582307/nutrition-apps-can-help-build-healthy-habits-for-some-users-their-gaming-features-carry-risks)**.

**Why this matters mechanically, not just ethically, for Joule specifically:** PRD §10's "no streaks, no guilt, no red" isn't a vibes preference — the mechanism is that a user protecting a streak or a green/red state has a direct incentive to log dishonestly (skip logging a binge, log a smaller portion than eaten) or to force a phantom log just to keep a chain alive. Both corrupt exactly the two inputs (`day_intake`, `weight_log`) the TDEE engine is a pure function over. The research above is externally-sourced confirmation that this isn't a hypothetical risk — it's the documented, common failure mode of the exact features PRD §10 forbids. **This validates the rule; there is nothing here to argue Joule should adopt.** See §3 for the one place I'd flag tension with §10 anyway.

---

## 3. Explicit PRD §10 tension check

The brief asks me to flag anything I'd recommend that §10 forbids, rather than quietly avoid the question. Having done the research: **I am not recommending anything that violates §10.** The evidence from §2.6 makes the rule stronger, not weaker — every leading app's guilt/streak mechanic is externally documented as actively harmful and psychologically counterproductive to the exact user this app serves (someone who wants an honest number, not a dopamine loop). MacroFactor's own "adherence-neutral" framing language is corroborating evidence from a competitor that took the opposite lesson from the same failure mode.

The one adjacent, non-forbidden idea worth naming so it isn't confused with a streak: a **passive "days logged this week" count with no goal, no color, no congratulation** (e.g., quietly inside the check-in card, which already shows "Logged 6/7 days") is informational, not gamified, and Joule already has it (`adherenceLabel` in `WeeklyCheckInScreen`). Do not extend it into a streak counter, badge, or milestone — that would be the line PRD §10 draws.

---

## 4. Prioritised recommendations

Ordered by (impact × how directly it serves the 10-second test or engine integrity) ÷ effort. R1–R2 assume the in-flight meal-grouping/date-nav work does *not* already cover them — worth a quick check-in with those agents before starting.

### R1 — Meal *templates* (multi-item saved combos), not just meal *labels*
**Problem:** the meal-grouping work in flight (per the brief) groups entries visually and lets you name a meal slot. Neither MyFitnessPal's "Save as Meal" nor MacroFactor's "recipe" feature is really about labeling — it's about **collapsing a known combination of N items into 1 tap**, which is the actual "30 seconds → 3 seconds" mechanism both competitors ship and cite performance numbers for.
**Proposed change:** add a `meal_template` concept: a named, ordered list of `saved_food` references + gram amounts (or a lightweight `template_item` join table). One tap on a template logs all constituent items at once via the existing `ConfirmSheet` (fits the "one shared confirmation sheet" rule — the template just prefills multiple rows instead of one). Include an "edit before logging" path equivalent to MacroFactor's "Explode" — the template pre-fills rows in the same editable `ConfirmSheet`, so removing/adjusting one item before confirming is already free if the sheet is the entry point, not a separate "instant-log" bypass.
**Effort:** medium. One new table + repo functions (mirrors `saved_food`'s existing shape), one "Save this meal as a template" affordance somewhere in the (in-flight) meal-grouped entry list, one template picker (could reuse `QuickAddChips`' visual pattern, scrollable row).
**PRD conflict:** none. This is squarely inside §7's "one shared confirmation sheet" architecture and §9.1's 10-second test; it's additive to the schema in §3, not a rule change.

### R2 — "Repeat yesterday" as a first-class action, distinct from per-food quick-add
**Problem:** Joule's quick-add chips rank *individual* foods by frequency; nothing currently answers "log everything I ate yesterday at this time" in one action, which both MyFitnessPal (meal-level copy) and MacroFactor (multi-add + Latest list) treat as core.
**Proposed change:** a single affordance — could be as simple as a "Copy yesterday's [mealname]" button surfaced once the in-flight meal-grouping work has meal-scoped entries to copy from. Mechanically: read yesterday's entries for a given meal slot, re-run them through `ConfirmSheet` as prefilled rows (same pattern as R1), don't write directly.
**Effort:** small, if R1's data model exists (a "yesterday's lunch" is just an ad-hoc, unsaved instance of the same "multiple rows into the confirm sheet" pattern R1 needs anyway) — build them together.
**PRD conflict:** none.

### R3 — Recipe/template partial-edit ("explode") as an explicit, named affordance
**Problem:** if R1 ships as an all-or-nothing "log the saved combo" button with no easy way to drop one item, it will actively *cost* speed on the common case of "same lunch, minus one thing today" — users will abandon the template and re-log from scratch, which is worse than not having templates at all.
**Proposed change:** not a separate feature — a design constraint on R1: templates must prefill an editable `ConfirmSheet`, never write directly. This is already how a same-day quick-add *chip* differs from `ConfirmSheet` (chips skip the sheet entirely, single-item, exact-confidence, PRD-sanctioned for the single-item case) — a multi-item template should not skip the sheet, because skipping it removes the per-row removability that makes "explode" free. Flagging as its own numbered item only because it's easy to build R1 wrong in a way that looks done but isn't.
**Effort:** zero marginal effort if R1 is built as above; a rework if it's built wrong first.
**PRD conflict:** none — arguably this *is* what §7's "always a human beat before save" already demands, just applied to multi-item logs instead of AI-sourced ones.

### R4 — A standing "why does my number differ from a TDEE calculator / from Zepp" reference screen
**Problem:** PRD §9.3 already nails the *in-the-moment* explanation (why did this week's number move). MacroFactor separately maintains standing help-center articles for the *recurring* confusion ("why is my number different from what I calculated by hand / what my wearable says"). Joule has the data for this already (`external_estimate`'s "Strap bias: +19%" stat, PRD §11) but nowhere to send a confused user to read the reasoning once, calmly, outside the pressure of a check-in decision.
**Proposed change:** a short static help screen (or expandable section on Settings/Trends) covering: why the engine ignores Mifflin-St Jeor after day 21, why it ignores Zepp entirely, why the band doesn't shrink to a point. This is copy-writing, not engineering — could largely reuse language already in the PRD's own §4.3/§4.5/Appendix.
**Effort:** small (static content screen).
**PRD conflict:** none — directly serves §9.3's "legibility of the reasoning is exactly why it works psychologically" rationale, extended from the check-in moment to anytime.

### R5 — Do not add an adherence *score* or single blended "consistency" number
**Problem:** MacroFactor ships some form of adherence metric on its dashboard; the temptation is to add a similar single-number "consistency score" to Joule's Trends screen for parity.
**Proposed change:** explicitly don't, beyond what already exists (`adherenceLabel`'s plain "6/7 days" and the protein hit-rate chart). A single blended score is one design decision away from becoming a proxy for a streak/guilt number the moment it's colored or trended — exactly the failure mode in §2.6. Joule's current "count + gaps-not-zeros" approach is more honest and already sufficient; MacroFactor's own "adherence-neutral" framing language (§2.4) suggests even they are wary of over-scoring this.
**Effort:** none — this is a "don't build" recommendation.
**PRD conflict:** none; this recommendation exists specifically *to protect* §10.

### R6 — Confirm the weekly check-in's date-scoping survives date navigation
**Problem:** noted in §2.3 — `WeeklyCheckInScreen` currently computes off `todayLocalISO()` unconditionally (`src/screens/WeeklyCheckInScreen.tsx`, `load()`). Once date-navigation back-filling exists, verify a user browsing a past day can't reach the check-in screen and have it silently operate on "today" instead of the viewed date, and that weight entries logged while viewing a past day are attributed to that day, not today.
**Proposed change:** a review/test pass by whoever owns the date-nav work, not a Joule feature per se — flagging because it's the kind of latent bug that specifically only manifests once back-filling is possible, and nobody would think to check it in isolation.
**Effort:** trivial (code review + a test case), but only after date-nav lands.
**PRD conflict:** none — this is enforcing PRD's own "everything editable forever, recomputed from history" rule (§10), not adding anything new.

---

## 5. What I explicitly did not recommend, and why

- **Wearable-blended TDEE** — MacroFactor's own stated position (§2.5) independently confirms PRD's engine wall is correct, not overly conservative. No change.
- **A customizable/reorderable dashboard** (MacroFactor 4.0.0) — Joule's fixed 8-panel Trends screen is already curated well; customization solves clutter Joule doesn't have. Not worth the settings-UI cost for a two-person app.
- **Matching MacroFactor's stated "50–100 kcal after 2–3 weeks" accuracy claim** — unverifiable, likely a different/looser definition than Joule's calibration-tested band, and chasing it would risk exactly the "confident ±50 lying" failure mode PRD's Appendix already identified and rejected. Joule's honesty here is a feature, not a gap.
- **Streaks, colored adherence, badges, milestones** — actively researched and confirmed harmful (§2.6, §3). Not a close call.

---

## Sources consulted

- [MyFitnessPal: Copy previous meal to today](https://community.myfitnesspal.com/en/discussion/10932477/copy-previous-meal-to-today)
- [MyFitnessPal Help: How do I copy a meal from one day to another?](https://support.myfitnesspal.com/hc/en-us/articles/360032622131-How-do-I-copy-a-meal-from-one-day-to-another)
- [MyFitnessPal: Can you copy the whole previous day?](https://community.myfitnesspal.com/en/discussion/10818760/can-you-copy-the-whole-previous-day-when-adding-things-today)
- [MyFitnessPal Help: Can I change my meal names, or add more meals?](https://support.myfitnesspal.com/hc/en-us/articles/360032622311-Can-I-change-my-meal-names-or-add-more-meals)
- [MyFitnessPal: Can I Add Another Meal? (extra slots)](https://wellnd.com/can-i-add-another-meal-on-myfitnesspal-your-definitive-guide)
- [MyFitnessPal Blog: How to Create Meals and Recipes](https://blog.myfitnesspal.com/create-meals-recipes-myfitnesspal/)
- [MyFitnessPal: Viewing previous weeks food diary](https://community.myfitnesspal.com/en/discussion/10652545/viewing-previous-weeks-food-diary)
- [MyFitnessPal Blog: What to Do When You Miss a Day of Logging](https://blog.myfitnesspal.com/what-to-do-when-you-miss-a-day-of-food-logging/)
- [MacroFactor Help: How to Log Food](https://help.macrofactorapp.com/en/articles/215-how-to-log-food-in-macrofactor)
- [MacroFactor: Is MacroFactor Still the Fastest Food Logger? (2025 FLSI Update)](https://macrofactor.com/fastest-food-logger-2025/)
- [MacroFactor: What is the Fastest Food Logger? We Designed a System to Find Out](https://macrofactor.com/fastest-food-logger/)
- [MacroFactor Help: Save a Meal For Later Use](https://help.macrofactorapp.com/en/articles/239-save-a-meal-for-later-use)
- [MacroFactor: Favorite Foods](https://macrofactor.com/favorite-foods/)
- [MacroFactor Help: How Should I Interpret Changes to my Energy Expenditure?](https://help.macrofactorapp.com/en/articles/26-how-should-i-interpret-changes-to-my-energy-expenditure)
- [MacroFactor Help: Why is my Expenditure Different From a TDEE Calculator?](https://help.macrofactorapp.com/en/articles/126-why-is-my-expenditure-in-macrofactor-different-from-the-output-of-a-tdee-calculator)
- [MacroFactor Help: Weight Trend](https://help.macrofactorapp.com/en/articles/21-weight-trend)
- [MacroFactor: Welcome Home, Data (Dashboard Customization)](https://macrofactor.com/dashboard-customization/)
- [MacroFactor: Dashboard Revamp announcement](https://macrofactor.com/dashboard-revamp/)
- [MacroFactor Help: How to Customize your Dashboard](https://help.macrofactorapp.com/en/articles/254-how-to-customize-your-dashboard)
- [Cronometer forum: Working with Recipe Serving Size](https://forums.cronometer.com/discussion/3109/working-with-recipe-serving-size)
- [BJPsych Open: Effects of diet and fitness apps on eating disorder behaviours (qualitative study)](https://www.cambridge.org/core/journals/bjpsych-open/article/effects-of-diet-and-fitness-apps-on-eating-disorder-behaviours-qualitative-study/2D1EE739D97AB3EFC6573835E4C527BD)
- [KSL.com: Nutrition apps can help build healthy habits — gaming features carry risks](https://www.ksl.com/article/51582307/nutrition-apps-can-help-build-healthy-habits-for-some-users-their-gaming-features-carry-risks)
- [caleye.fit: MacroFactor's Adaptive TDEE — How Accurate Is It Really? (secondary source, cited with caution)](https://caleye.fit/blog/macrofactor-tdee-tracking-accuracy/)
