// ═══════════════════════════════════════════════════════════════════════
// NAVIGATION PARAM TYPES
//
// Single source of truth for route names/params so screens and the
// navigator in App.tsx stay in sync. Extend these lists (not ad-hoc
// `navigation.navigate('X' as never)` casts) when the next wave adds
// Trends/Foods/Onboarding/Weekly-check-in screens for real.
// ═══════════════════════════════════════════════════════════════════════

import type { NavigatorScreenParams } from '@react-navigation/native';
import type { EntryConfidence } from './pendingEntry';

/**
 * One ingredient row as handed from PotIngredientsPhotoScreen/
 * PotBarcodeAddScreen back to PotCreateScreen, matching that screen's own
 * `IngredientDraft` text-field shape exactly (so it can be dropped straight
 * into initial state with no re-parsing). Kept here rather than imported
 * from PotCreateScreen so navigation.ts stays the single source of truth
 * for every route param shape, per this file's own header.
 */
export type PotIngredientDraftParam = {
  name: string;
  /** Raw (pre-cook) weight in grams, as free text — PRD §7.5's raw-vs-cooked rule. */
  gramsRaw: string;
  kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  /**
   * How much to trust this ROW's macros (task brief "per-ingredient
   * barcode upgrade"): 'exact'/'high' for a scanned barcode or nutrition
   * label, whatever the photo/search source reported otherwise (typically
   * 'low'/'medium' for a visual guess, 'exact' for a saved-food/AFCD/OFF
   * hit). Feeds PotCreateScreen's per-row confidence display and the
   * pot-level mixed-confidence measure (src/lib/potActions.ts's
   * `computePotConfidenceSummary`) once the pot is created.
   */
  confidence: EntryConfidence;
  /**
   * Per-100g basis this row's macros were derived from, when one is known
   * (a photo/barcode/search/OFF hit's own `PendingEntry.per100g`, or one
   * synthesized from a directly-typed row's grams+macros — see
   * potActions.ts's `synthesizeIngredientBasis`).
   *
   * This is the fix for the bug where editing an ingredient's grams
   * changed the gram figure but never the calories/macros: without a
   * retained basis there was nothing to rescale FROM, only a number to
   * overwrite. PotCreateScreen's grams/macro edit handlers
   * (`applyIngredientGramsEdit`/`applyIngredientMacroEdit` in
   * potActions.ts) keep this in sync via `scaleFromPer100g` — the same
   * function ConfirmSheet uses, never a second scaling path. Optional and
   * additive: a row with no basis yet (a from-scratch manual entry before
   * every field is filled in) simply has `per100g: undefined` and behaves
   * exactly as before this field existed.
   */
  per100g?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
};

/** Bottom tab routes — the persistent, always-visible navigation surface. */
export type TabParamList = {
  Today: undefined;
  Trends: undefined;
  Train: undefined;
  Foods: undefined;
};

/**
 * Root stack: the tab navigator plus modal routes layered on top (weight
 * entry, food entry, weekly check-in, onboarding, settings/export).
 * `FoodEntry` takes an optional `date` (defaults to today) and optional
 * `entryId` (editing an existing entry rather than creating one) — this is
 * the date-threading the task brief calls out explicitly for "editing a
 * past day must work".
 */
export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  WeightEntry: { date?: string } | undefined;
  FoodEntry: { date?: string; entryId?: string } | undefined;
  WeeklyCheckIn: undefined;
  Onboarding: undefined;
  /** First-run choice screen shown instead of Onboarding when no user_profile exists yet — "restore from a backup" or "start fresh" (task brief §4). */
  RestoreOffer: undefined;
  Settings: undefined;
  /**
   * `draftIngredients` (task brief "meal-prep workflow"): pre-filled
   * ingredient rows handed in from PotIngredientsPhotoScreen (photo of raw
   * ingredients) or PotBarcodeAddScreen (one scanned packaged ingredient).
   * Omitted for the ordinary "start a pot from scratch" entry point —
   * PotCreateScreen's existing single blank row is unaffected either way.
   */
  PotCreate:
    | {
        /**
         * Edit mode (task brief #4, "Pots edit — fix it"): when set,
         * PotCreateScreen loads this pot's existing name/ingredients/
         * cooked weight instead of starting blank, and saving calls
         * `potActions.updatePot` instead of `createPot`. Omitted for the
         * ordinary "start a pot from scratch" entry point.
         */
        potId?: string;
        draftIngredients?: PotIngredientDraftParam[];
        /** Unique per navigate() call so PotCreateScreen can tell a genuinely NEW batch of draft rows (a second trip to the photo/barcode screen) apart from react-navigation simply re-focusing this screen with the same params. */
        draftKey?: string;
        /**
         * Per-ingredient barcode/label upgrade (task brief, the headline
         * feature): replaces the EXISTING row at `rowIndex` in place with
         * `ingredient` — PotBarcodeAddScreen sets this instead of
         * `draftIngredients` when it was opened from a "Scan barcode"
         * action on an already-present row, rather than the "+ Scan
         * barcode" add-a-new-ingredient method. Never appends.
         */
        upgradeIngredient?: { rowIndex: number; ingredient: PotIngredientDraftParam };
        /** Same "tell a fresh navigate() apart from a re-focus" guard as `draftKey`, for `upgradeIngredient`. */
        upgradeKey?: string;
      }
    | undefined;
  PotLogServing: { potId: string };
  /** Photo of RAW, pre-cook ingredients -> Gemini identifies them -> back to PotCreate with draft rows prefilled (PRD §7.5). No `date` param: a pot isn't logged against a day, only servings from it are. */
  PotIngredientsPhoto: undefined;
  /**
   * Scan a packaged ingredient's barcode (a bag of rice, a tin of coconut
   * milk) -> saved_food/Open Food Facts cascade -> back to PotCreate with
   * one draft row prefilled.
   *
   * `upgradeRow`, when set (task brief "per-ingredient barcode upgrade"):
   * this screen was opened from an EXISTING ingredient row's own "Scan
   * barcode" action rather than PotCreate's general "+ Scan barcode" add-
   * new-ingredient method. A hit replaces that row's macros/confidence in
   * place; `grams` is that row's current RAW grams, carried through
   * UNCHANGED — a barcode/label panel only ever replaces a row's per-gram
   * macros, never the user-entered raw weight (PRD §7.5's raw-vs-cooked
   * rule: a scanned panel is a per-100g composition, not a serving size).
   * `currentName`/`currentConfidence` are surfaced in the confirmation
   * copy and feed `potActions.resolveBarcodeUpgrade`'s "never downgrade"
   * rule.
   */
  PotBarcodeAdd:
    | { upgradeRow?: { rowIndex: number; grams: number; currentName: string; currentConfidence: EntryConfidence } }
    | undefined;
  /**
   * The FAB's "Meal prep" entry point (task brief "Discoverability"): with
   * zero active pots, goes straight to PotCreate; with exactly one, goes
   * straight to PotLogServing for it; with 2+, shows a short pick-a-pot
   * (or start a new one) list. Never a dead end, never more than one
   * extra tap versus already knowing which screen you wanted.
   */
  PotQuickAccess: undefined;
  /** Supplements (vitamins/peptides) — due-today checklist + manage list (task brief "Feature 1 — Supplements"). Entry point lives on SettingsScreen. */
  Supplements: undefined;
  /** Create (no id) or edit (id set) a single supplement's regimen. */
  SupplementForm: { id?: string } | undefined;
  /** Zepp export import — reference-only data into `external_estimate`, never read by the engine (task brief "Feature 2 — Zepp import"). Entry point lives on SettingsScreen. */
  ZeppImport: undefined;
  /** Scans logged food_entry rows for arithmetic/unit-conversion damage (e.g. the OFF kJ/4.184 bug) and lets the user apply macro-derived fixes, per-entry or in bulk — never automatically. Entry point lives on SettingsScreen. */
  DataHealth: undefined;
  // ─── Capture routes (PRD §7) ───
  // The remaining input paths converge on the one shared ConfirmSheet
  // (see src/lib/pendingEntry.ts), so none of these carry entry params —
  // each screen builds PendingEntry[] internally and hands it to the
  // sheet. BarcodeScan falls back to LabelScan on a miss (PRD §7.2:
  // "never dead-end the user"), so both must stay registered together.
  // Voice logging (a fourth capture route, `VoiceLog`) was removed — the
  // owner didn't use it. `food_entry.source = 'voice'` and
  // `EntrySource`/`FoodEntrySource`'s `'voice'` member stay, since
  // historical entries logged that way still need to render correctly;
  // only the route that could CREATE new ones is gone.
  //
  // `date` (optional, defaults to today when omitted — every existing
  // caller/deep-link keeps compiling): the date the user was browsing on
  // Today when they opened this capture route. PRD §10 promises
  // "everything editable forever, including past days," and TodayScreen
  // now threads `selectedDate` into every one of these routes, not just
  // manual entry — photographing a nutrition label for something eaten
  // yesterday is a legitimate backfill action, not a live-capture-only
  // flow. `date` is always the ALREADY-clamped value TodayScreen is
  // displaying (clampToToday in dateNav.ts is the one choke point that
  // prevents a future date from ever reaching here), so these screens
  // don't need to re-clamp it themselves.
  BarcodeScan: { date?: string } | undefined;
  LabelScan: { date?: string } | undefined;
  MealPhoto: { date?: string } | undefined;
  // ─── Strength training routes (Train tab) ───
  // WorkoutSession is used for BOTH starting a new session and editing an
  // existing one — startSession (src/db/repositories/workoutRepo.ts)
  // always creates the workout_session row first, so by the time this
  // screen is on-screen there is always an existing sessionId to load
  // ("everything editable forever" applies identically to a session from
  // five minutes ago and one from three weeks ago).
  // `addExerciseId` is how WorkoutExercisePickerScreen hands its selection
  // back: it calls navigate('WorkoutSession', { sessionId, addExerciseId })
  // rather than a callback prop, which — since WorkoutSession is already
  // on the stack below the picker — pops back to the existing instance
  // and merges params rather than pushing a new screen. Optional because
  // every other entry point (starting/opening a session) omits it.
  WorkoutSession: { sessionId: string; addExerciseId?: string };
  // Adds an exercise to the given session and returns; does not itself
  // navigate anywhere else.
  WorkoutExercisePicker: { sessionId: string };
  // `exerciseName` is passed through purely so the header can render
  // immediately without waiting on a DB round trip; the screen still
  // fetches the exercise/history itself.
  WorkoutExerciseHistory: { exerciseId: string; exerciseName: string };
  /** Strength-training analytics ("Progress" from the Train tab) — headline stats, volume-over-time, per-exercise progression, muscle-group balance. No params: it loads its own data on focus. */
  WorkoutDashboard: undefined;
  // ─── Training programs/templates (schema v7) ───
  // Editing programs is a settings-shaped task ("clarity beats speed" —
  // task brief), separate from the fast ad-hoc logging path above.
  // Logging AGAINST a program still happens on the existing
  // WorkoutSession screen (it reads session.program_day_id itself) —
  // there is no separate "program session" screen, so following a
  // program adds zero taps versus today's ad-hoc flow.
  /** Program list — the Train tab's entry point into this feature. No params: loads every program on focus. */
  Programs: undefined;
  /** One program's days, in order, plus start/edit/duplicate/delete actions. */
  ProgramDetail: { programId: string };
  /** Create (no id) or edit (id set) a program's name/description. */
  ProgramForm: { id?: string } | undefined;
  /** Create (no dayId) or edit (dayId set) one day's label within a program. */
  ProgramDayForm: { programId: string; dayId?: string };
  /** A day's prescribed exercises, in order — add/reorder/edit/delete. */
  ProgramDay: { programId: string; dayId: string };
  /** Add (no id) or edit (id set) one program_exercise: which exercise, targets, cues, and its substitution catalog. */
  ProgramExerciseForm: { programDayId: string; programExerciseId?: string };
};

declare global {
  // react-navigation's documented global augmentation pattern
  // (https://reactnavigation.org/docs/typescript/#specifying-default-types-for-usenavigation-link-ref-etc)
  // requires an ambient `namespace` with an `interface` that merges with
  // the one declared inside @react-navigation/core — this is a
  // `declare global` augmentation, not a regular module, and declaration
  // merging only works with `interface`, not `type`. Both lint rules
  // fired on the standard form of this exact pattern, so both are
  // disabled narrowly on the two lines that need it, not file-wide.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
