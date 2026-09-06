// ═══════════════════════════════════════════════════════════════════════
// DB-LAYER TYPES
//
// `ExternalEstimate` lives here — and ONLY here — deliberately. PRD §3:
// "REFERENCE ONLY: engine must NOT read this." The engine
// (src/engine/**) must never import this module. That rule is enforced
// structurally by eslint.config.js (no-restricted-imports zone), not by
// convention: any accidental `import ... from '../db/types'` inside
// src/engine will fail lint.
//
// Wearable/Zepp figures are Mifflin-St Jeor plus an accelerometer guess.
// They're useful for calibration ("your strap runs 19% high") but never
// get a vote in computeTDEE (PRD §3, §11).
// ═══════════════════════════════════════════════════════════════════════

import type { Confounder } from '../engine/types';

/**
 * Reference-only wearable data (e.g. Zepp). Mirrors the `external_estimate`
 * table (PRD §3). Imported/displayed on trend charts in Phase 2; never
 * read by the TDEE engine.
 */
export type ExternalEstimate = {
  /** ISO yyyy-mm-dd, local time. */
  date: string;
  /** e.g. 'zepp'. */
  source: string;
  tdee_est: number;
  active_kcal: number;
  steps: number;
  sleep_minutes: number;
  readiness: number;
};

/** Row shape for `day_intake` as stored in SQLite (before mapping to DayIntake). */
export type DayIntakeRow = {
  date: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** SQLite stores booleans as 0/1. */
  is_complete: number;
};

/** Row shape for `weight_log` as stored in SQLite. */
export type WeightLogRow = {
  date: string;
  weight_kg: number;
  confounder: Confounder | null;
  /** manual | health_connect | healthkit */
  source: string;
};

/** Row shape for `external_estimate` as stored in SQLite. */
export type ExternalEstimateRow = {
  date: string;
  source: string;
  tdee_est: number;
  active_kcal: number;
  steps: number;
  sleep_minutes: number;
  readiness: number;
};

/** Row shape for `food_entry` (PRD §3). */
export type FoodEntrySource =
  | 'barcode'
  | 'label_ocr'
  | 'meal_photo'
  | 'voice'
  | 'pot'
  | 'manual'
  | 'afcd';

export type EntryConfidence = 'exact' | 'high' | 'medium' | 'low';

/** Mirrors food_entry.meal_type (schema v2). NULL = no meal type assigned. */
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type FoodEntryRow = {
  id: string;
  date: string;
  logged_at: number;
  name: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  source: FoodEntrySource;
  confidence: EntryConfidence;
  pot_id: string | null;
  raw_input: string | null;
  /**
   * Schema v2 addition. NULL for every pre-v2 row and any v2 row the user
   * never assigned a meal type to — never imputed, never defaulted at the
   * storage layer (a UI default is applied only at log time, per
   * mealType.ts's `defaultMealTypeForTime`, and only as a pre-filled,
   * user-editable suggestion, not a silent write).
   */
  meal_type: MealType | null;
  /**
   * Schema v2 addition. Shared, app-generated id linking food_entry rows
   * logged together from one capture (e.g. a multi-item meal photo). NULL
   * for a standalone entry — renders as its own row, exactly as every
   * entry did before this feature existed.
   */
  meal_group_id: string | null;
  /**
   * Schema v2 addition. Display name for the group ("Chicken Sushi").
   * NULL when meal_group_id is NULL, or when a grouped capture was never
   * named (the UI derives a fallback label rather than requiring this).
   */
  meal_name: string | null;
  /**
   * Schema v6 addition. Container weight (grams) subtracted to arrive at
   * this entry's `grams`, recorded for pot servings only — see
   * schema.ts's v6 header for the full NULL vs 0 vs >0 semantics. `grams`
   * is always the net food weight regardless of this value; it is pure
   * after-the-fact bookkeeping ("how was this number reached"), never a
   * second subtraction anything downstream needs to apply. NULL for every
   * pre-v6 row and every non-pot entry.
   */
  tare_g: number | null;
};

/** Row shape for `saved_food` (PRD §3). */
export type SavedFoodRow = {
  id: string;
  name: string;
  barcode: string | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  default_grams: number;
  use_count: number;
  last_used: number | null;
  /**
   * Schema v3 addition. The originating food_entry's confidence at the
   * moment "Save to my foods" was toggled (PRD §10: a `low`-confidence
   * meal-photo item must not become an `exact`-tagged entry once quick-
   * added). NULL for every pre-v3 row — see foodEntryActions.ts's
   * `logQuickAdd` for how NULL is defaulted (documented there, not
   * imputed at the storage layer).
   */
  confidence: EntryConfidence | null;
};

/** Row shape for `pot` (PRD §3). */
export type PotRow = {
  id: string;
  name: string;
  created_at: number;
  /**
   * Weight of the finished cooked batch, in grams — `null` until it's
   * weighed (task brief #1: "the total weight is not needed" for the
   * batch's total kcal, which is just the sum of ingredients; it's only
   * needed to VALUE a serving, i.e. `kcal_per_g`). A pot may be created
   * from ingredients alone and have its cooked weight added later, either
   * from the pot itself or the moment the first serving is weighed.
   */
  total_weight_g: number | null;
  /**
   * Grams of the batch physically left. `null` exactly when
   * `total_weight_g` is `null` — nothing can have been served yet, since
   * `potRepo.logServing` refuses to log a scale-based serving against a
   * pot with no cooked weight (there'd be no `kcal_per_g` to value it
   * with).
   */
  remaining_g: number | null;
  /** `null` until `total_weight_g` is set — see `total_weight_g`'s own doc. */
  kcal_per_g: number | null;
  protein_per_g: number | null;
  carbs_per_g: number | null;
  fat_per_g: number | null;
  /** JSON-encoded array, for reference/editing. */
  ingredients: string;
  is_active: number;
};

/**
 * Row shape for `pot_container` (schema v6) — saved container tare
 * weights for one-tap reuse at serving time (task brief: the user's own
 * "sometimes with the plate weight and sometimes without"). Never read by
 * src/engine/**; purely a serving-UI convenience that feeds
 * food_entry.tare_g bookkeeping, never day_intake/weight_log directly.
 */
export type PotContainerRow = {
  id: string;
  name: string;
  /** Empty container's own weight, in grams. */
  tare_g: number;
  use_count: number;
  last_used: number | null;
};

/** Row shape for `supplement` (PRD §3 stub, built out in schema v5 — see schema.ts's v5 header for the full column-by-column rationale). */
export type SupplementRow = {
  id: string;
  name: string;
  dose: string;
  /** JSON-encoded ScheduleSpec from this version forward — see src/lib/supplements/schedule.ts. Parse with `parseSchedule`, never `JSON.parse` directly (it defends against pre-v5/malformed values). */
  schedule: string;
  kcal: number;
  protein_g: number;
  /** Schema v5. Free-text unit alongside `dose` (e.g. "mg", "capsule", "scoop"). NULL for rows written before this column existed. */
  unit: string | null;
  /** Schema v5. Optional free-text notes — never dosing guidance generated by the app, only what the user typed. */
  notes: string | null;
  /** Schema v5. 1 = active regimen (shown in due-today/manage), 0 = archived. SQLite stores booleans as 0/1. */
  is_active: number;
  /** Schema v5. Epoch ms. NULL for rows written before this column existed. */
  created_at: number | null;
};

/**
 * Row shape for `supplement_log` (schema v5). One row per
 * (supplement_id, date) — adherence is boolean-per-day, not a multi-dose
 * ledger (CLAUDE.md/PRD §10: this is a checklist, not a score — see
 * src/lib/supplements/dueToday.ts for how "due today" is built from this
 * plus each supplement's schedule).
 */
export type SupplementLogRow = {
  id: string;
  supplement_id: string;
  date: string;
  /** Epoch ms. */
  logged_at: number;
  /**
   * Set only when the user explicitly chose "log as food too"
   * (src/lib/supplements/supplementActions.ts's `logDoseAndFood` — never
   * implicit). NULL otherwise, including for every supplement with no
   * kcal/protein_g at all.
   */
  food_entry_id: string | null;
};

// ─── Strength training (schema v4) ─────────────────────────────────────
//
// These three tables are read/written ONLY by src/db/repositories/workout*
// and src/lib/training/**. They are never imported by src/engine (no
// calorie/energy field exists on any of them — see schema.ts's v4 header
// for why that is a deliberate PRD §1 non-goal, not an oversight) and
// never write into day_intake or weight_log.

/** Loose muscle-group tag. Free text at the DB layer (schema.ts does not CHECK-constrain it) so a custom exercise isn't forced into a fixed enum, but the app only ever writes one of these. */
export type ExerciseCategory = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core';

/** Loose equipment tag. Same free-text-at-the-DB-layer reasoning as ExerciseCategory. */
export type ExerciseEquipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight';

/** Row shape for `exercise` (schema v4). */
export type ExerciseRow = {
  id: string;
  name: string;
  category: ExerciseCategory | null;
  equipment: ExerciseEquipment | null;
  /** 0 = seeded library exercise, 1 = user-added. SQLite stores booleans as 0/1. */
  is_custom: number;
};

/** Row shape for `workout_session` (schema v4, +program_day_id in v6→v7). */
export type WorkoutSessionRow = {
  id: string;
  /** ISO yyyy-mm-dd, local time — same convention as day_intake/weight_log. */
  date: string;
  name: string | null;
  /** Epoch ms. */
  started_at: number;
  notes: string | null;
  /**
   * Schema v7 addition. The program_day this session was started from, if
   * any — NULL for every pre-v7 row and every ad-hoc (no-program) session,
   * which is the common case and must keep working identically (see
   * schema.ts's v7 header). Deliberately no REFERENCES clause (same
   * cross-feature soft-link convention as food_entry.pot_id): a session
   * whose program_day has since been deleted keeps this as a harmless
   * orphaned id, never a broken FK.
   */
  program_day_id: string | null;
};

/**
 * Intensity technique for a logged set (schema v7 addition). Free text at
 * the DB layer (schema.ts does not CHECK-constrain it, same loose-tag
 * convention as ExerciseCategory/ExerciseEquipment), but the app only
 * ever writes one of these. Deliberately NOT how "warm-up" is
 * represented — that stays `is_warmup`, untouched (see schema.ts's v7
 * header for why reconciling the two by adding a `'warmup'` value here
 * would be duplication, not reconciliation).
 */
export type SetType = 'straight' | 'drop' | 'myo_rep' | 'partials';

/** Row shape for `workout_set` (schema v4, +set_type in v7). */
export type WorkoutSetRow = {
  id: string;
  session_id: string;
  exercise_id: string;
  /** Position within (session_id, exercise_id) — stable display ordering when two sets share a logged_at millisecond. */
  set_index: number;
  /**
   * 0 is valid — a bodyweight exercise with no added load, never
   * null/omitted. For a drop/myo-rep/partials set (`set_type` below),
   * this is the set's TOP (first) weight — see schema.ts's v7 header for
   * the full contract; additional segments live in
   * `workout_set_segment`, keyed by this row's id.
   */
  weight_kg: number;
  /** Same "top segment" contract as `weight_kg` above. */
  reps: number;
  /** Nullable — RPE is optional per set. */
  rpe: number | null;
  /** SQLite stores booleans as 0/1. */
  is_warmup: number;
  /** Epoch ms. */
  logged_at: number;
  /**
   * Schema v7 addition, `NOT NULL DEFAULT 'straight'` — SQLite backfills
   * every pre-existing row with 'straight' on migration, and a pre-v7
   * backup snapshot (whose JSON has no `set_type` key at all) is
   * normalized `undefined -> 'straight'` the same way at restore time
   * (see restore.ts). Never actually NULL.
   */
  set_type: SetType;
};

/**
 * Row shape for `workout_set_segment` (schema v7). One additional
 * weight/rep segment logged AFTER a drop/myo-rep/partials set's own top
 * weight/reps — see schema.ts's v7 header for the full modelling
 * rationale (a dedicated child table, not JSON, not a self-referencing
 * link on workout_set). `segment_index` is 1-based; the parent
 * `workout_set` row is implicitly segment 0.
 */
export type WorkoutSetSegmentRow = {
  id: string;
  workout_set_id: string;
  segment_index: number;
  weight_kg: number;
  reps: number;
};

// ─── Training programs / templates (schema v7) ─────────────────────────
//
// Read/written ONLY by src/db/repositories/programRepo.ts and
// src/lib/training/**. Same architectural wall as the v4 tables above: no
// calorie/energy column exists anywhere below, never imported by
// src/engine, never written to day_intake/weight_log. See schema.ts's v7
// header for the full per-table/per-column rationale (in particular why
// `program_substitution` is a catalog of allowed swaps, not a record of
// what a session actually did — that record is just the session's own
// workout_set.exercise_id, exactly as it always has been).

/** Row shape for `program` (schema v7). */
export type ProgramRow = {
  id: string;
  name: string;
  description: string | null;
  /** Soft "currently following this one" flag — NOT a DB-enforced singleton. SQLite stores booleans as 0/1. */
  is_active: number;
  /** Epoch ms. */
  created_at: number;
};

/** Row shape for `program_day` (schema v7). One training day within a program ("Upper A"). */
export type ProgramDayRow = {
  id: string;
  program_id: string;
  /** 0-based position within the program — "start the next one" walks this order. */
  order_index: number;
  label: string;
};

/**
 * A program exercise's prescription shape (schema v7, extended after the
 * first cut shipped only rep-range prescriptions):
 *   - 'rep_range' — a rep window at an optional target RIR (rep_low/
 *     rep_high are both required — see the DB CHECK constraint, schema.ts's
 *     v7 header).
 *   - 'amrap' — "as many reps as possible" / to-failure. Reps are an
 *     OUTCOME, not a target: rep_low/rep_high are both NULL (enforced by
 *     the same CHECK). `target_rir`, if set, is an optional "how close to
 *     failure" hint (0 = literal failure) rather than a rep count.
 */
export type PrescriptionType = 'rep_range' | 'amrap';

/** Row shape for `program_exercise` (schema v7). One prescribed exercise within a program_day. */
export type ProgramExerciseRow = {
  id: string;
  program_day_id: string;
  /** Points at the same `exercise` table workout_set uses (v4) — a program exercise and a logged set share one exercise identity. */
  exercise_id: string;
  /** 0-based position within the day. */
  order_index: number;
  target_sets: number;
  prescription_type: PrescriptionType;
  /** Required (non-null) for 'rep_range', NULL for 'amrap' — see `PrescriptionType`. */
  rep_low: number | null;
  /** Same rep_range/amrap pairing as `rep_low`. */
  rep_high: number | null;
  /** Nullable either way — see `PrescriptionType`. */
  target_rir: number | null;
  rest_seconds: number | null;
  /** Free-text coaching cues, shown when the user taps into the exercise. Also where a prescribed drop-set/myo-rep finisher instruction lives — there is no separate "prescribed set_type" column. */
  cues: string | null;
  /** Optional user-supplied reference link — never a bundled/faked video demo. */
  demo_url: string | null;
};

/** Row shape for `program_substitution` (schema v7). A catalog entry: "for this program_exercise, X is an allowed equipment alternative." */
export type ProgramSubstitutionRow = {
  id: string;
  program_exercise_id: string;
  exercise_id: string;
  note: string | null;
};

/** Row shape for `user_profile` (PRD §3). Singleton row, id always 1. */
export type UserProfileRow = {
  id: 1;
  height_cm: number;
  birth_year: number;
  sex: string;
  goal: string;
  rate_kg_per_week: number;
  activity_seed: string;
  protein_override: number | null;
  units: string;
};
