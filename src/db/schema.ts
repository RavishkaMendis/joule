// ═══════════════════════════════════════════════════════════════════════
// SCHEMA — PRD §3 (verbatim column names/types/defaults, singleton CHECK).
//
// Section comments below are carried over from the PRD on purpose: they
// encode the architectural wall between measured truth (day_intake,
// weight_log — the only two tables the TDEE engine may read) and
// reference-only external data (external_estimate, which the engine must
// never read; see src/db/types.ts and eslint.config.js for how that's
// enforced).
//
// Phase 1 builds tables for every phase up front (per task brief) but only
// ships repositories for what Phase 1 needs: weight_log, day_intake,
// food_entry, saved_food, pot, user_profile. `external_estimate` and
// `supplement` are schema-only stubs until their phases arrive.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Full DDL for schema version 1. Run inside the migration runner
 * (`src/db/migrations.ts`), never executed standalone.
 */
export const SCHEMA_V1_SQL = `
-- ═══ ENGINE INPUTS: the only two tables the TDEE engine may read ═══

CREATE TABLE IF NOT EXISTS day_intake (
  date            TEXT PRIMARY KEY,   -- ISO yyyy-mm-dd, local time
  kcal            REAL,
  protein_g       REAL,
  carbs_g         REAL,
  fat_g           REAL,
  is_complete     INTEGER DEFAULT 1   -- 0 = user flagged "didn't log everything"
);

CREATE TABLE IF NOT EXISTS weight_log (
  date            TEXT PRIMARY KEY,
  weight_kg       REAL NOT NULL,
  confounder      TEXT,               -- null | 'ate_out' | 'travel' | 'ill' | 'poor_sleep' | 'alcohol'
  source          TEXT DEFAULT 'manual'  -- manual | health_connect | healthkit
);

-- ═══ REFERENCE ONLY: engine must NOT read this ═══

CREATE TABLE IF NOT EXISTS external_estimate (
  date            TEXT PRIMARY KEY,
  source          TEXT,               -- 'zepp'
  tdee_est        REAL,
  active_kcal     REAL,
  steps           INTEGER,
  sleep_minutes   INTEGER,
  readiness       INTEGER
);

-- ═══ LOGGING LAYER ═══

CREATE TABLE IF NOT EXISTS food_entry (
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

CREATE TABLE IF NOT EXISTS saved_food (
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

CREATE TABLE IF NOT EXISTS pot (
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

CREATE TABLE IF NOT EXISTS supplement (        -- stub for phase 2
  id              TEXT PRIMARY KEY,
  name            TEXT,
  dose            TEXT,
  schedule        TEXT,
  kcal            REAL DEFAULT 0,
  protein_g       REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_profile (
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

-- ═══ INDICES (Phase 1 query patterns) ═══

-- Today screen / trends pull a day's or a range's entries by date.
CREATE INDEX IF NOT EXISTS idx_food_entry_date ON food_entry (date);

-- Quick-add chips: frequency-ranked, most-recently-used tiebreak.
CREATE INDEX IF NOT EXISTS idx_saved_food_frequency ON saved_food (use_count DESC, last_used DESC);

-- Foods & Pots screen: active pots list.
CREATE INDEX IF NOT EXISTS idx_pot_is_active ON pot (is_active);
`;

// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V2 — meal grouping, meal type, date navigation support.
//
// Purely additive: three nullable columns on `food_entry`, plus one index.
// No existing column changes meaning, no table is dropped/recreated, and
// every existing row is valid post-migration with all three new columns
// NULL (SQLite's ALTER TABLE ... ADD COLUMN back-fills existing rows with
// the column's default, which is NULL here since none is specified).
//
//   meal_type      — 'breakfast' | 'lunch' | 'dinner' | 'snack' | NULL.
//                    NULL means "no meal type set" (e.g. every pre-v2 row,
//                    or a v2 row the user never assigned one to) — this is
//                    not an error state, just unset, exactly like `pot_id`
//                    already works for entries that aren't pot servings.
//   meal_group_id  — shared, app-generated id for entries logged together
//                    from one capture (e.g. one meal-photo/voice capture
//                    that yields several food_entry rows). NULL for a
//                    standalone entry (manual/barcode/label/quick-add),
//                    which renders as its own ungrouped row exactly as
//                    before this feature existed.
//   meal_name      — display name for the group ("Chicken Sushi"), shown
//                    on the collapsed Today row. NULL when meal_group_id
//                    is NULL, or (rare) a grouped capture the user never
//                    named — the UI falls back to a derived label rather
//                    than requiring this to be non-null.
//
// None of this touches day_intake or the TDEE engine: day_intake's
// rollup sums food_entry.kcal/protein_g/carbs_g/fat_g regardless of
// meal_group_id, and the engine (src/engine/**) never reads food_entry at
// all. Grouping is a presentation concern layered on top of the existing
// rows, not a change to what gets summed.
// ═══════════════════════════════════════════════════════════════════════
export const SCHEMA_V2_SQL = `
ALTER TABLE food_entry ADD COLUMN meal_type TEXT;
ALTER TABLE food_entry ADD COLUMN meal_group_id TEXT;
ALTER TABLE food_entry ADD COLUMN meal_name TEXT;

-- Today screen groups a day's entries by meal_group_id to render one
-- collapsed row per captured meal — this index makes that grouping (and
-- "find the other rows in this group" on expand/edit/delete) index-only
-- for any date with grouped entries, matching idx_food_entry_date's
-- existing "pull a day's entries" pattern.
CREATE INDEX IF NOT EXISTS idx_food_entry_meal_group ON food_entry (meal_group_id);
`;

// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V3 — saved_food.confidence (PRD §10 fix: quick-add must not
// launder a low-confidence photo/voice estimate into an `exact` entry).
//
// Purely additive: one nullable column on `saved_food`. No existing
// column changes meaning, no table is dropped/recreated, and every
// existing row is valid post-migration with the new column NULL.
//
//   confidence — 'exact' | 'high' | 'medium' | 'low' | NULL. Mirrors
//                food_entry.confidence's ladder (PRD §10). Set at
//                "save to my foods" time (ConfirmSheet.tsx,
//                foodEntryActions.logManualEntry) to the ORIGINATING
//                entry's confidence, so a low-confidence meal-photo item
//                saved via "Save to my foods" stays tagged `low` (not
//                silently promoted to `exact`) when later quick-added.
//
//                NULL means "saved before this column existed" — every
//                pre-v3 row. logQuickAdd (foodEntryActions.ts) treats
//                NULL as `high`, not `exact`: the user deliberately saved
//                this food and is now deliberately re-selecting it from
//                their own library, which is a real assertion the same
//                way a quick-add-preset's stated quantity is (PRD §7.4's
//                confidence ladder already treats "user asserts a known
//                quantity" as `high`, one rung below `exact`, which stays
//                reserved for barcode/label-panel reads) — but we have no
//                record that the ORIGINAL numbers came from a scan, so
//                asserting `exact` would be exactly the PRD §10 violation
//                this migration exists to fix, just moved one step later.
//
// None of this touches day_intake or the TDEE engine: saved_food is not
// summed into any rollup, and the engine (src/engine/**) never reads
// saved_food at all.
// ═══════════════════════════════════════════════════════════════════════
export const SCHEMA_V3_SQL = `
ALTER TABLE saved_food ADD COLUMN confidence TEXT;
`;

// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V4 — strength training tracker (three new tables, zero changes
// to any existing table).
//
// ⚠️ ARCHITECTURAL WALL, same as external_estimate: these tables are
// NEVER read by the TDEE engine (src/engine/**) and NEVER written to
// day_intake or weight_log. PRD §1 lists exercise-calorie logging as an
// explicit non-goal ("the TDEE engine already captures activity; adding
// it double-counts") — burning kcal lifting already shows up as a smaller
// weight change for the same intake, so there is deliberately no
// calorie-burn column anywhere below. This is for the user's own
// progression tracking, full stop.
//
//   exercise         — a library of liftable movements. Seeded with
//                       compound lifts + common accessories below
//                       (is_custom = 0) so the first session isn't a
//                       blank slate; a user-added movement gets
//                       is_custom = 1. `category` is a loose muscle-group
//                       tag (chest | back | legs | shoulders | arms |
//                       core) and `equipment` a loose implement tag
//                       (barbell | dumbbell | machine | cable |
//                       bodyweight) — both nullable free text, not
//                       CHECK-constrained, so a custom exercise can be
//                       added without forcing the user into a fixed enum.
//
//   workout_session   — one gym visit. `date` is the same ISO yyyy-mm-dd
//                       local-time convention as day_intake/weight_log
//                       (so a session can be filtered/sorted alongside
//                       those without a format translation), `started_at`
//                       is epoch ms for same-day ordering when a user
//                       logs two sessions in one day. `name`/`notes` are
//                       both nullable — "Push day" is a label the user
//                       adds, not a requirement to start logging (PRD
//                       §10's 10-second test applies to gym logging too).
//
//   workout_set       — one set: exercise + weight + reps (+ optional
//                       RPE), tagged is_warmup so warm-up sets don't
//                       launder into working-set volume/1RM/progression
//                       math (src/lib/training/**). `set_index` is the
//                       set's position within (session_id, exercise_id)
//                       for stable display ordering when two sets share a
//                       logged_at millisecond (fast between-set logging
//                       makes that a real possibility, not a theoretical
//                       one). `session_id` cascades on delete — deleting
//                       a session is expected to delete its sets, exactly
//                       like deleteGroup already does for food_entry
//                       rows sharing a meal_group_id. `exercise_id` does
//                       NOT cascade: there is no exercise-delete path in
//                       Phase 1, so this is a straightforward FK with no
//                       ON DELETE clause (SQLite's default, NO ACTION).
//
// No calorie/energy column exists on any of these three tables — that is
// intentional, not an oversight, and must not be "fixed" later without
// revisiting PRD §1's non-goal first.
// ═══════════════════════════════════════════════════════════════════════
export const SCHEMA_V4_SQL = `
CREATE TABLE IF NOT EXISTS exercise (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,               -- chest | back | legs | shoulders | arms | core (free text, not enum-constrained)
  equipment   TEXT,               -- barbell | dumbbell | machine | cable | bodyweight (free text, not enum-constrained)
  is_custom   INTEGER DEFAULT 0   -- 0 = seeded library exercise, 1 = user-added
);

CREATE TABLE IF NOT EXISTS workout_session (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,      -- ISO yyyy-mm-dd, local time (matches day_intake/weight_log convention)
  name        TEXT,               -- e.g. "Push day" — nullable, never required to start logging
  started_at  INTEGER NOT NULL,   -- epoch ms
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS workout_set (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES workout_session(id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercise(id),
  set_index     INTEGER NOT NULL, -- position within (session_id, exercise_id), for stable ordering
  weight_kg     REAL NOT NULL,    -- 0 is valid (bodyweight exercise, no added load) — never null/omitted
  reps          INTEGER NOT NULL,
  rpe           REAL,             -- nullable — RPE is optional per set
  is_warmup     INTEGER DEFAULT 0,
  logged_at     INTEGER NOT NULL  -- epoch ms
);

-- ═══ INDICES (Train tab query patterns) ═══

-- Session detail screen: pull every set in a session.
CREATE INDEX IF NOT EXISTS idx_workout_set_session ON workout_set (session_id);

-- Per-exercise progression (best set / 1RM / trend across sessions):
-- every set ever logged for one exercise, in chronological order.
CREATE INDEX IF NOT EXISTS idx_workout_set_exercise ON workout_set (exercise_id, logged_at);

-- Train tab history list: sessions in date order.
CREATE INDEX IF NOT EXISTS idx_workout_session_date ON workout_session (date);

-- ═══ SEED EXERCISE LIBRARY ═══
-- Compound lifts + common accessories across every major category, so the
-- first session isn't a blank slate. INSERT OR IGNORE keys on the fixed
-- ids below so this block stays safe to run exactly once (migrations
-- never re-run their SQL for an already-applied version, but IGNORE keeps
-- this block itself idempotent if ever invoked twice).
INSERT OR IGNORE INTO exercise (id, name, category, equipment, is_custom) VALUES
  ('seed_back_squat',        'Back Squat',              'legs',      'barbell',    0),
  ('seed_bench_press',       'Bench Press',             'chest',     'barbell',    0),
  ('seed_deadlift',          'Deadlift',                'back',      'barbell',    0),
  ('seed_overhead_press',    'Overhead Press',          'shoulders', 'barbell',    0),
  ('seed_barbell_row',       'Barbell Row',             'back',      'barbell',    0),
  ('seed_pull_up',           'Pull-up',                 'back',      'bodyweight', 0),
  ('seed_chin_up',           'Chin-up',                 'back',      'bodyweight', 0),
  ('seed_incline_db_press',  'Incline Dumbbell Press',  'chest',     'dumbbell',   0),
  ('seed_db_shoulder_press', 'Dumbbell Shoulder Press', 'shoulders', 'dumbbell',   0),
  ('seed_lat_pulldown',      'Lat Pulldown',            'back',      'cable',      0),
  ('seed_seated_cable_row',  'Seated Cable Row',        'back',      'cable',      0),
  ('seed_leg_press',         'Leg Press',               'legs',      'machine',    0),
  ('seed_romanian_deadlift', 'Romanian Deadlift',       'legs',      'barbell',    0),
  ('seed_leg_curl',          'Leg Curl',                'legs',      'machine',    0),
  ('seed_leg_extension',     'Leg Extension',           'legs',      'machine',    0),
  ('seed_hip_thrust',        'Hip Thrust',              'legs',      'barbell',    0),
  ('seed_db_bicep_curl',     'Dumbbell Bicep Curl',     'arms',      'dumbbell',   0),
  ('seed_tricep_pushdown',   'Tricep Pushdown',         'arms',      'cable',      0),
  ('seed_lateral_raise',     'Lateral Raise',           'shoulders', 'dumbbell',   0),
  ('seed_face_pull',         'Face Pull',               'shoulders', 'cable',      0),
  ('seed_plank',             'Plank',                   'core',      'bodyweight', 0),
  ('seed_hanging_leg_raise', 'Hanging Leg Raise',       'core',      'bodyweight', 0);
`;

// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V5 — supplements: regimen detail + adherence log (PRD §3's
// `supplement` table stub, now built out for real; task brief "Feature 1
// — Supplements").
//
// `supplement` (existing since v1) gets four additive columns, and one
// new table (`supplement_log`) is added. Zero changes to any other
// existing table, and — same architectural wall as external_estimate and
// the v4 training tables — neither of these is ever read by
// src/engine/**.
//
//   supplement.unit        — free text alongside the existing `dose`
//                             column (e.g. dose "500", unit "mg"; dose
//                             "1", unit "capsule"; a peptide's user-typed
//                             unit, whatever that is — no enum, no
//                             clinical vocabulary imposed. Per the task
//                             brief: "store what the user types... no
//                             dosing guidance, no warnings, no
//                             interaction checking, no editorialising."
//   supplement.notes        — optional free text.
//   supplement.is_active    — 1 = shown in "manage supplements" / due-
//                             today; 0 = archived (soft-delete, so
//                             supplement_log rows keep a meaningful
//                             reference instead of pointing at a vanished
//                             row — deleting a supplement outright is
//                             still supported at the app layer and also
//                             removes its log rows there, but archiving
//                             is the default "I stopped taking this" path
//                             so history isn't silently discarded).
//   supplement.created_at   — epoch ms, for stable list ordering.
//
//   supplement.schedule (existing column, TEXT, no type change) is
//   reinterpreted from this version forward as a JSON-encoded
//   ScheduleSpec (src/lib/supplements/schedule.ts: 'daily' |
//   'days_of_week' (+ days[]) | 'as_needed') rather than arbitrary free
//   text. This is a convention change, not a schema change — the column
//   was an unused Phase-2 stub with the app pre-launch (no real rows
//   exist to migrate), so there is nothing to backfill. schedule.ts's
//   parseSchedule() defends against any pre-existing non-JSON value
//   anyway (falls back to 'as_needed' rather than crashing the due-today
//   list on a malformed/legacy string).
//
//   supplement_log — one row per (supplement_id, date): adherence is
//   boolean-per-day here (took it / didn't), not a multi-dose-per-day
//   ledger — matches the "one tap from a due-today list" checklist shape
//   the task brief describes. `food_entry_id` is set ONLY when the user
//   explicitly chose, as a separate confirmed action, to also log this
//   dose's calories/protein into `food_entry` (src/lib/supplements/
//   supplementActions.ts's `logDoseAndFood` — never implicit; see that
//   file's header for why). No `REFERENCES` clause on either
//   `supplement_id` or `food_entry_id` — deliberately, matching this
//   codebase's existing convention for cross-feature link columns that
//   aren't cascade-aware everywhere they're deleted from (food_entry.pot_id
//   is the precedent: also a real foreign key conceptually, also declared
//   as plain TEXT with no REFERENCES). Concretely: src/lib/backup/restore.ts
//   does `DELETE FROM supplement` during a restore without also clearing
//   `supplement_log` (it predates this migration and is out of this
//   feature's ownership — see the migration's report for the exact
//   restore.ts/export.ts changes still needed); with foreign_keys=ON
//   (migrations.ts enables it on every connection) a real FK here would
//   make that restore throw and roll back entirely the moment any
//   supplement_log row exists. Leaving it unenforced keeps restore from a
//   backup that predates this table from breaking; the tradeoff (an
//   orphaned supplement_id after such a restore) is the same one
//   food_entry.pot_id already accepts for pot deletion.
//
// Never fed to the TDEE engine — food_entry writes from
// logDoseAndFood go through the exact same foodEntryActions.logManualEntry
// path as any other manual entry, which is the only supported route
// (see supplementActions.ts): there is no separate/implicit write path
// from supplement_log into day_intake.
// ═══════════════════════════════════════════════════════════════════════
export const SCHEMA_V5_SQL = `
ALTER TABLE supplement ADD COLUMN unit TEXT;
ALTER TABLE supplement ADD COLUMN notes TEXT;
ALTER TABLE supplement ADD COLUMN is_active INTEGER DEFAULT 1;
ALTER TABLE supplement ADD COLUMN created_at INTEGER;

CREATE TABLE IF NOT EXISTS supplement_log (
  id             TEXT PRIMARY KEY,
  supplement_id  TEXT NOT NULL,   -- see header: deliberately no REFERENCES clause
  date           TEXT NOT NULL,   -- ISO yyyy-mm-dd, local time — same convention as weight_log/day_intake
  logged_at      INTEGER NOT NULL, -- epoch ms
  food_entry_id  TEXT             -- set only when the user explicitly chose "log as food too" (see header)
);

-- One adherence row per supplement per day — logDose/unlogDose (supplementRepo.ts) upsert/delete against this key rather than accumulating duplicate rows for the same day.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplement_log_unique ON supplement_log (supplement_id, date);

-- Due-today / history screens pull a day's (or a range's) logged supplements by date.
CREATE INDEX IF NOT EXISTS idx_supplement_log_date ON supplement_log (date);

-- "Manage supplements" list: active regimen first, most-recently-added on top within that.
CREATE INDEX IF NOT EXISTS idx_supplement_is_active ON supplement (is_active, created_at DESC);
`;

// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V6 — pot meal-prep workflow: container/tare support (task brief
// "Build the meal-prep (pot) workflow into a first-class, accurate
// feature" — the user's own words: "sometimes with the plate weight and
// sometimes without"). One new table, one additive column on `food_entry`.
// Zero changes to any existing table's meaning, and - same architectural
// wall as every other schema addition - neither is ever read by
// src/engine/**: a pot serving reaches the engine only via the
// day_intake rollup of food_entry.kcal/protein_g/carbs_g/fat_g, exactly
// as it always has, and `tare_g` carries no weight in that sum (it is
// purely a record of HOW `grams` was arrived at, never a value added to
// or subtracted from it after the fact).
//
//   pot_container - saved container tare weights, so a household's usual
//                    bowls/plates can be recalled with one tap instead of
//                    re-typing a weight every serving (task brief: "Remember
//                    commonly used container weights for one-tap reuse").
//                    `tare_g` is the empty container's own weight in grams.
//                    `use_count`/`last_used` mirror saved_food's existing
//                    frequency-ranking columns/index exactly, so the
//                    container picker can sort "most-used first" the same
//                    way quick-add chips already do.
//
//   food_entry.tare_g - records the container weight (if any) that was
//                    subtracted to arrive at THIS entry's `grams`, purely
//                    for after-the-fact transparency/editability (PRD
//                    section 10: "everything editable forever" - a user
//                    revisiting a past pot serving should be able to see
//                    it was weighed "gross 550g minus 250g bowl", not just
//                    a bare 300g with no memory of how that number was
//                    reached). Semantics, once a value is recorded
//                    (schema v6 onward, pot servings only):
//                      NULL  - no container info recorded (scale was
//                              already tared to zero, OR this entry
//                              predates this column/isn't a pot serving -
//                              both collapse to "nothing to subtract",
//                              which is what NULL already meant
//                              everywhere else in this schema, e.g.
//                              food_entry.pot_id for a non-pot entry).
//                      0     - explicitly recorded as "scale tared to
//                              zero" for this serving (a real, deliberate
//                              value, not an absent one - same
//                              NULL-vs-0 distinction numericInput.ts's
//                              header explains for every other numeric
//                              field in this app).
//                      >0    - the container's tare weight that was
//                              subtracted from the gross scale reading to
//                              produce `grams`.
//                    `grams` itself is ALWAYS the net (food-only) weight
//                    regardless of `tare_g` - tare_g is bookkeeping, never
//                    a second subtraction the UI or engine has to apply.
// ═══════════════════════════════════════════════════════════════════════
export const SCHEMA_V6_SQL = `
CREATE TABLE IF NOT EXISTS pot_container (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tare_g      REAL NOT NULL,
  use_count   INTEGER DEFAULT 0,
  last_used   INTEGER
);

-- Container picker: most-used first, same ranking shape as saved_food's existing idx_saved_food_frequency.
CREATE INDEX IF NOT EXISTS idx_pot_container_frequency ON pot_container (use_count DESC, last_used DESC);

ALTER TABLE food_entry ADD COLUMN tare_g REAL;
`;

// ═══════════════════════════════════════════════════════════════════════
// SCHEMA V7 — training programs / templates: define a program once, follow
// it session to session (task brief "training program / template system").
//
// ⚠️ SAME ARCHITECTURAL WALL as v4's strength-training tables: nothing
// below is ever read by src/engine/**, and no column here holds a
// calorie/energy figure (PRD §1 non-goal — "the TDEE engine already
// captures activity; adding it double-counts"). This is set/rep/RIR
// PRESCRIPTION data, one layer above the v4 tables it points at
// (`exercise`), and it never writes to day_intake/weight_log.
//
//   program             — one named plan (e.g. a 4-day upper/lower). One
//                          row per program the user has defined; `is_active`
//                          is a soft "currently following this one" flag
//                          the app sets via programRepo.setActiveProgram
//                          (NOT a DB-enforced singleton — same non-unique
//                          soft-flag pattern as supplement.is_active — the
//                          app is responsible for clearing the previous
//                          active program when a new one is chosen).
//                          `created_at` is epoch ms, for stable list
//                          ordering (mirrors supplement.created_at, v5).
//
//   program_day         — one training day within a program ("Upper A",
//                          "Lower B"). `order_index` is the day's position
//                          within the program (0-based) — this is what
//                          "start the NEXT one" (task brief) walks.
//                          ON DELETE CASCADE from `program`: deleting a
//                          program takes its days with it, same cascade
//                          shape as workout_session -> workout_set (v4).
//
//   program_exercise    — one prescribed exercise within a program_day:
//                          target sets/RIR/rest/cues, in `order_index`
//                          position. `exercise_id` points at the SAME
//                          `exercise` table workout_set already uses (v4)
//                          — a program exercise and a logged set share one
//                          exercise identity, which is what lets "last
//                          time's actual for that exercise" (task brief)
//                          reach across from ordinary workout_set history
//                          with no extra join table. `exercise_id` has NO
//                          cascade (plain REFERENCES, NO ACTION) — same
//                          reasoning as workout_set.exercise_id: there is
//                          no exercise-delete path in this app, so this
//                          mirrors that FK exactly rather than inventing a
//                          new convention.
//
//                          `prescription_type` ('rep_range' | 'amrap') —
//                          added after the first cut of this schema shipped
//                          only 'rep_range', once it became clear the user
//                          ALSO trains high-intensity bro-split style,
//                          where the prescription is genuinely "work to
//                          failure," not a rep window at a target RIR.
//                          This is a real enum, not a sentinel value on
//                          the existing fields, because `target_rir = 0`
//                          ("work to your absolute limit, but you still
//                          have a defined rep range") is a legitimate,
//                          DIFFERENT prescription from AMRAP ("reps are
//                          however many you get, full stop") — conflating
//                          the two by reading rep_low/rep_high as
//                          "ignored when target_rir is 0" would be exactly
//                          the kind of silent, undocumented double-meaning
//                          this schema avoids everywhere else (see
//                          ExerciseCategory/ExerciseEquipment's "loose tag,
//                          not silently overloaded" precedent). The CHECK
//                          constraint below enforces the pairing at the DB
//                          layer rather than trusting every future write
//                          path to remember it: `rep_range` REQUIRES both
//                          rep_low/rep_high (and rep_low <= rep_high);
//                          `amrap` REQUIRES both to be NULL — "reps are an
//                          outcome, not a target" (task brief) is a real,
//                          enforced absence, not just an app-layer
//                          convention. `target_rir` stays meaningful
//                          either way: for `rep_range` it's the usual
//                          "stop this many reps short of failure"; for
//                          `amrap` it's an optional "how close to failure"
//                          hint (0 = literal failure, 1 = one left) rather
//                          than a target rep count.
//
//                          `cues` is free-text coaching notes (also where
//                          "drop a set on the finisher" instructions live
//                          for an AMRAP prescription — see the bro-split
//                          seed template below; there is no separate
//                          "prescribed set_type" column, because dictating
//                          the exact intensity technique in advance is
//                          exactly the kind of rigid over-modelling a free-
//                          text cue already handles honestly), and
//                          `demo_url` is an OPTIONAL user-supplied link —
//                          deliberately not a bundled video (task brief:
//                          "You cannot ship video demos — do not fake one
//                          or link to third-party content [the app does
//                          not curate]. A cues field plus an optional
//                          user-supplied URL is the honest scope").
//                          ON DELETE CASCADE from `program_day`.
//
//   program_substitution — equipment-alternative exercises for one
//                          program_exercise ("no squat rack? use leg
//                          press"), each with an optional free-text
//                          `note`. Purely a CATALOG of allowed swaps
//                          defined when editing the program — swapping
//                          IN A SESSION (task brief) does not write a row
//                          here at all: it just changes which exercise_id
//                          the session's own workout_set rows carry (see
//                          src/lib/training/programSession.ts's
//                          `resolveSlotExerciseId`), which is already the
//                          session's honest record of "what was actually
//                          done" with zero new session-side schema. ON
//                          DELETE CASCADE from `program_exercise`.
//
//   workout_session.program_day_id — nullable link from a session back to
//                          the program day it followed (if any). NULLABLE
//                          IS ESSENTIAL: an ad-hoc session (no program)
//                          must keep working exactly as it does today,
//                          simply never setting this column — every
//                          existing workoutRepo/workoutActions call site
//                          that doesn't know about programs keeps
//                          compiling and behaving identically. Added via
//                          plain `ALTER TABLE ... ADD COLUMN` with NO
//                          `REFERENCES` clause — deliberately, matching
//                          this codebase's existing convention for
//                          cross-feature link columns added after a
//                          table's original CREATE (food_entry.pot_id is
//                          the precedent, restated in v5's header: a real
//                          FK here would make deleting a program (and
//                          hence its days) throw under `PRAGMA
//                          foreign_keys = ON` the moment any session had
//                          ever followed one of those days — deleting a
//                          PROGRAM must never be blocked by, or silently
//                          rewrite, someone's training history). A workout_session
//                          whose program_day_id points at a since-deleted
//                          program_day simply has a harmless orphaned
//                          reference — the session and its sets are
//                          completely unaffected, exactly like
//                          food_entry.pot_id after its pot is deleted.
//
//   workout_set.set_type — added for the same high-intensity-training
//                          reason as `prescription_type` above: a logged
//                          set can be a straight set, a drop set, a
//                          myo-rep cluster, or a partials finisher, and
//                          the app needs to know which to render/sum it
//                          correctly. Free text, NOT enum-CHECKed (same
//                          loose-tag convention as exercise.category/
//                          equipment), default 'straight' so every
//                          existing v4 row (and every future row that
//                          doesn't care) reads as an ordinary set with no
//                          backfill needed. DELIBERATELY NOT a value that
//                          also means "warm-up" — `is_warmup` (v4) already
//                          owns that concept and stays completely
//                          untouched; a warm-up set is still
//                          `is_warmup = 1` however its `set_type` reads
//                          (typically 'straight', since nobody drop-sets a
//                          warm-up). Reconciling the two by ADDING a
//                          second "is this a warm-up" representation would
//                          be the exact duplication risk this column is
//                          written to avoid.
//
//   workout_set_segment  — the drop-set/myo-rep/partials modelling
//                          decision, spelled out because there were three
//                          real options:
//                            (a) a JSON column on workout_set holding an
//                                array of {weight_kg, reps} — rejected:
//                                every consumer (volume, 1RM, "last
//                                time", the editor for a set logged three
//                                weeks ago) would need to parse and
//                                defensively validate a blob instead of
//                                querying/updating a real row, and this
//                                schema already reserves JSON columns
//                                (`pot.ingredients`) for reference-only
//                                data that nothing sums or edits
//                                cell-by-cell — a drop set's segments are
//                                exactly the opposite: aggregated (volume)
//                                AND individually editable forever (PRD
//                                §10).
//                            (b) a self-referencing parent_set_id on
//                                workout_set itself — rejected: it blurs
//                                "one logically single set with multiple
//                                weight/rep segments" into "several
//                                separate sets that happen to point at
//                                each other," which fights every place
//                                this schema already treats one
//                                workout_set row as one atomic performed
//                                set (set_index, is_warmup, rpe all apply
//                                to "the set," not "one segment of a
//                                set") — and leaves it ambiguous what the
//                                PARENT row's own weight_kg/reps mean once
//                                children exist.
//                            (c) a dedicated child table, ON DELETE
//                                CASCADE from workout_set — CHOSEN. It
//                                matches this schema's own existing idiom
//                                for "one row, several typed child rows"
//                                (workout_session -> workout_set is the
//                                direct precedent), keeps every segment a
//                                real, individually queryable/editable/
//                                deletable row (PRD §10 "everything
//                                editable forever" applies to a drop set's
//                                third segment from three weeks ago
//                                exactly as it does to any other number in
//                                this app), and needs zero JSON parsing
//                                anywhere.
//                          Contract: `workout_set.weight_kg`/`reps` IS the
//                          set's own first/top segment (unchanged meaning
//                          — every existing best-set/1RM/"last time"
//                          comparison keeps reading it exactly as before,
//                          which is correct: the TOP weight is what
//                          progressive-overload tracking cares about, not
//                          a blend across drops). `workout_set_segment`
//                          rows are ADDITIONAL segments logged after that
//                          top set (`segment_index` 1, 2, ... — the parent
//                          row is implicitly segment 0). Volume MUST sum
//                          every segment or a drop/myo-rep/partials set
//                          silently under-reports for exactly the
//                          training style this exists for — see
//                          src/lib/training/volume.ts's `computeVolume`
//                          and its "a drop set counts every segment" test.
//
// None of this touches day_intake's rollup, and no column here is a
// calorie/energy figure — see the wall note above.
// ═══════════════════════════════════════════════════════════════════════
export const SCHEMA_V7_SQL = `
CREATE TABLE IF NOT EXISTS program (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS program_day (
  id           TEXT PRIMARY KEY,
  program_id   TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  order_index  INTEGER NOT NULL,
  label        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_exercise (
  id                TEXT PRIMARY KEY,
  program_day_id    TEXT NOT NULL REFERENCES program_day(id) ON DELETE CASCADE,
  exercise_id       TEXT NOT NULL REFERENCES exercise(id),
  order_index       INTEGER NOT NULL,
  target_sets       INTEGER NOT NULL,
  prescription_type TEXT NOT NULL DEFAULT 'rep_range' CHECK (prescription_type IN ('rep_range', 'amrap')),
  rep_low           INTEGER,          -- required for 'rep_range' (see CHECK below), NULL for 'amrap' — reps are an outcome, not a target
  rep_high          INTEGER,          -- same as rep_low
  target_rir        REAL,             -- nullable either way: 'rep_range' target, or an optional "how close to failure" hint for 'amrap'
  rest_seconds      INTEGER,
  cues              TEXT,             -- free-text coaching cues, shown when the user taps into the exercise (also where a prescribed drop-set/myo-rep finisher instruction lives)
  demo_url          TEXT,             -- optional user-supplied reference link — never a bundled/faked video
  CHECK (
    (prescription_type = 'rep_range' AND rep_low IS NOT NULL AND rep_high IS NOT NULL AND rep_low <= rep_high)
    OR
    (prescription_type = 'amrap' AND rep_low IS NULL AND rep_high IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS program_substitution (
  id                    TEXT PRIMARY KEY,
  program_exercise_id   TEXT NOT NULL REFERENCES program_exercise(id) ON DELETE CASCADE,
  exercise_id           TEXT NOT NULL REFERENCES exercise(id),
  note                  TEXT         -- e.g. "no squat rack available"
);

ALTER TABLE workout_session ADD COLUMN program_day_id TEXT;

-- Intensity technique for a logged set: 'straight' (default) | 'drop' |
-- 'myo_rep' | 'partials'. Free text, not enum-CHECKed (same loose-tag
-- convention as exercise.category/equipment) — see this file's v7 header
-- for why this is deliberately NOT how "warm-up" is represented (that
-- stays is_warmup, untouched).
ALTER TABLE workout_set ADD COLUMN set_type TEXT NOT NULL DEFAULT 'straight';

-- Additional weight/rep segments logged AFTER a set's own top weight/reps
-- (a drop, a myo-rep cluster, a partials tail) — see this file's v7
-- header for the full modelling rationale (dedicated child table, not a
-- JSON column or a self-referencing link on workout_set).
CREATE TABLE IF NOT EXISTS workout_set_segment (
  id              TEXT PRIMARY KEY,
  workout_set_id  TEXT NOT NULL REFERENCES workout_set(id) ON DELETE CASCADE,
  segment_index   INTEGER NOT NULL,  -- 1-based; the parent workout_set row is implicitly segment 0 (the top/first weight)
  weight_kg       REAL NOT NULL,
  reps            INTEGER NOT NULL
);

-- ═══ INDICES (program-following query patterns) ═══

-- Program list screen -> a program's days in order.
CREATE INDEX IF NOT EXISTS idx_program_day_program ON program_day (program_id, order_index);

-- Program day screen / session pre-population -> a day's exercises in order.
CREATE INDEX IF NOT EXISTS idx_program_exercise_day ON program_exercise (program_day_id, order_index);

-- In-session substitution lookup -> alternatives for one prescribed exercise.
CREATE INDEX IF NOT EXISTS idx_program_substitution_exercise ON program_substitution (program_exercise_id);

-- "Which sessions followed this program day" (e.g. a future day-level history view).
CREATE INDEX IF NOT EXISTS idx_workout_session_program_day ON workout_session (program_day_id);

-- Session logging screen: every segment of one drop/myo-rep/partials set, in order.
CREATE INDEX IF NOT EXISTS idx_workout_set_segment_set ON workout_set_segment (workout_set_id, segment_index);

-- ═══ GENERIC STARTER TEMPLATE ═══
-- A clearly-labelled, GENERIC 4-day upper/lower split built from widely-
-- published training principles (hypertrophy rep ranges, RIR-based
-- autoregulation, ~10-20 hard sets/muscle/week, progressive overload) —
-- NOT a reproduction of any named commercial program. Every exercise_id
-- below is one of the v4 seed library's own compound/accessory movements,
-- so this needs no new exercise rows. Ships active (is_active = 1) purely
-- so the Train tab isn't a blank slate on first launch; fully editable and
-- deletable like any other program (task brief). INSERT OR IGNORE on
-- fixed ids, same idempotent-reseed pattern as v4's exercise library.
INSERT OR IGNORE INTO program (id, name, description, is_active, created_at) VALUES
  ('seed_program_generic_ul', 'Generic Upper/Lower (starter template)',
   'A generic starting point built from common training principles — hypertrophy rep ranges, RIR-based autoregulation, roughly 10-20 hard sets per muscle group per week. Not tied to any specific commercial program. Edit, duplicate, or delete freely.',
   1, 0);

INSERT OR IGNORE INTO program_day (id, program_id, order_index, label) VALUES
  ('seed_day_upper_a', 'seed_program_generic_ul', 0, 'Upper A'),
  ('seed_day_lower_a', 'seed_program_generic_ul', 1, 'Lower A'),
  ('seed_day_upper_b', 'seed_program_generic_ul', 2, 'Upper B'),
  ('seed_day_lower_b', 'seed_program_generic_ul', 3, 'Lower B');

INSERT OR IGNORE INTO program_exercise (id, program_day_id, exercise_id, order_index, target_sets, rep_low, rep_high, target_rir, rest_seconds, cues, demo_url) VALUES
  ('seed_pe_ua_1', 'seed_day_upper_a', 'seed_bench_press',      0, 4, 6,  8,  2, 150, 'Brace core, lower under control, drive feet into the floor.', NULL),
  ('seed_pe_ua_2', 'seed_day_upper_a', 'seed_barbell_row',      1, 4, 6,  8,  2, 150, 'Pull to the lower ribs, squeeze shoulder blades together, avoid using momentum.', NULL),
  ('seed_pe_ua_3', 'seed_day_upper_a', 'seed_overhead_press',   2, 3, 8,  10, 2, 120, 'Brace your core, press straight overhead, avoid over-arching the lower back.', NULL),
  ('seed_pe_ua_4', 'seed_day_upper_a', 'seed_lat_pulldown',     3, 3, 8,  12, 2, 90,  'Lead with the elbows, pull to the upper chest, control the return.', NULL),
  ('seed_pe_ua_5', 'seed_day_upper_a', 'seed_lateral_raise',    4, 3, 12, 15, 1, 60,  'Slight bend in the elbow, raise to shoulder height, avoid using momentum.', NULL),
  ('seed_pe_ua_6', 'seed_day_upper_a', 'seed_tricep_pushdown',  5, 3, 10, 15, 1, 60,  'Keep elbows pinned to your sides, full extension, control the negative.', NULL),

  ('seed_pe_la_1', 'seed_day_lower_a', 'seed_back_squat',        0, 4, 5,  8,  2, 180, 'Brace core, sit back and down, drive through the whole foot.', NULL),
  ('seed_pe_la_2', 'seed_day_lower_a', 'seed_romanian_deadlift', 1, 3, 8,  10, 2, 120, 'Soft knees, hinge at the hips, keep the bar close to your legs.', NULL),
  ('seed_pe_la_3', 'seed_day_lower_a', 'seed_leg_press',         2, 3, 10, 12, 1, 90,  'Full range of motion, avoid locking out the knees hard at the top.', NULL),
  ('seed_pe_la_4', 'seed_day_lower_a', 'seed_leg_curl',          3, 3, 10, 15, 1, 60,  'Control the eccentric, avoid your hips lifting off the pad.', NULL),
  ('seed_pe_la_5', 'seed_day_lower_a', 'seed_hanging_leg_raise', 4, 3, 8,  12, 1, 60,  'Curl the pelvis, avoid swinging, control the descent.', NULL),

  ('seed_pe_ub_1', 'seed_day_upper_b', 'seed_incline_db_press',   0, 4, 8,  10, 2, 120, 'Moderate incline, control the dumbbells down, press up and slightly in.', NULL),
  ('seed_pe_ub_2', 'seed_day_upper_b', 'seed_pull_up',            1, 4, 6,  10, 2, 120, 'Full hang at the bottom, chest to the bar, control the descent.', NULL),
  ('seed_pe_ub_3', 'seed_day_upper_b', 'seed_db_shoulder_press',  2, 3, 8,  10, 2, 90,  'Brace core, press without excessive back arch, control the descent.', NULL),
  ('seed_pe_ub_4', 'seed_day_upper_b', 'seed_seated_cable_row',   3, 3, 10, 12, 1, 90,  'Chest up, pull to the torso, avoid rounding the lower back.', NULL),
  ('seed_pe_ub_5', 'seed_day_upper_b', 'seed_face_pull',          4, 3, 12, 15, 1, 60,  'Pull to eye level, rotate shoulders back, squeeze at the end range.', NULL),
  ('seed_pe_ub_6', 'seed_day_upper_b', 'seed_db_bicep_curl',      5, 3, 10, 15, 1, 60,  'Keep elbows still, control the negative, avoid swinging the weight.', NULL),

  ('seed_pe_lb_1', 'seed_day_lower_b', 'seed_deadlift',        0, 3, 5,  6,  2, 180, 'Brace core, flat back, push the floor away.', NULL),
  ('seed_pe_lb_2', 'seed_day_lower_b', 'seed_hip_thrust',      1, 3, 8,  10, 2, 120, 'Chin tucked, drive through heels, squeeze glutes at the top.', NULL),
  ('seed_pe_lb_3', 'seed_day_lower_b', 'seed_leg_extension',   2, 3, 12, 15, 1, 60,  'Controlled tempo, slight pause at the top, avoid swinging.', NULL),
  ('seed_pe_lb_4', 'seed_day_lower_b', 'seed_chin_up',         3, 3, 6,  10, 2, 120, 'Underhand grip, full hang at the bottom, control the descent.', NULL);

INSERT OR IGNORE INTO program_substitution (id, program_exercise_id, exercise_id, note) VALUES
  ('seed_sub_1', 'seed_pe_ua_1', 'seed_incline_db_press',  'No barbell/flat bench available'),
  ('seed_sub_2', 'seed_pe_ua_2', 'seed_seated_cable_row',  'No barbell available'),
  ('seed_sub_3', 'seed_pe_ua_3', 'seed_db_shoulder_press', 'No barbell available'),
  ('seed_sub_4', 'seed_pe_la_1', 'seed_leg_press',         'No squat rack available'),
  ('seed_sub_5', 'seed_pe_ub_2', 'seed_lat_pulldown',      'Can not yet do bodyweight pull-ups'),
  ('seed_sub_6', 'seed_pe_lb_1', 'seed_romanian_deadlift', 'Deadlift platform occupied'),
  ('seed_sub_7', 'seed_pe_lb_4', 'seed_lat_pulldown',      'Can not yet do bodyweight chin-ups');

-- ═══ SECOND STARTER TEMPLATE — HIGH-INTENSITY BRO SPLIT ═══
-- A clearly-labelled, GENERIC 5-day "one major muscle group per day"
-- split (chest / back / shoulders / legs / arms), built from widely-
-- practised high-intensity training principles (train to or past
-- failure, drop sets / myo-reps / partials on finishers, high set volume
-- per session) — named and described DESCRIPTIVELY, not after any
-- person, and not a reproduction of any specific published routine.
-- Every exercise_id below is one of the v4 seed library's own
-- compound/accessory movements; ships INACTIVE (is_active = 0) so
-- creating it never silently switches the user off whichever program (if
-- any) they're already following — the generic upper/lower above is the
-- one that ships active by default. Fully editable, duplicatable, and
-- deletable like any other program.
--
-- Known modelling limitation (see programSession.ts's header): two
-- program_exercise rows in the SAME day must not share an exercise_id —
-- a logged set is attributed to a slot purely by exercise_id, so two
-- slots for the same exercise in one day cannot be told apart once sets
-- exist for it. Every day below deliberately uses a distinct exercise_id
-- per row for exactly this reason (e.g. chest day's finisher is Incline
-- Dumbbell Press, not a second Bench Press row).
INSERT OR IGNORE INTO program (id, name, description, is_active, created_at) VALUES
  ('seed_program_hit_bro_split', 'High-intensity bro split — 5 day',
   'A generic 5-day split — one major muscle group per day (chest, back, shoulders, legs, arms) — for training to or past failure with drop sets, myo-reps, and partials on finisher sets. Built from widely-practised high-intensity principles, not tied to any specific person or published routine. Edit, duplicate, or delete freely.',
   0, 0);

INSERT OR IGNORE INTO program_day (id, program_id, order_index, label) VALUES
  ('seed_day_hit_chest',     'seed_program_hit_bro_split', 0, 'Chest'),
  ('seed_day_hit_back',      'seed_program_hit_bro_split', 1, 'Back'),
  ('seed_day_hit_shoulders', 'seed_program_hit_bro_split', 2, 'Shoulders'),
  ('seed_day_hit_legs',      'seed_program_hit_bro_split', 3, 'Legs'),
  ('seed_day_hit_arms',      'seed_program_hit_bro_split', 4, 'Arms');

-- rep_low/rep_high are NULL and prescription_type = 'amrap' for every
-- to-failure row below — the CHECK constraint on program_exercise
-- enforces this pairing, not just this comment.
INSERT OR IGNORE INTO program_exercise
  (id, program_day_id, exercise_id, order_index, target_sets, prescription_type, rep_low, rep_high, target_rir, rest_seconds, cues, demo_url)
VALUES
  ('seed_pe_hit_chest_1', 'seed_day_hit_chest', 'seed_bench_press', 0, 4, 'rep_range', 6, 8, 1, 120,
   'Brace core, full range of motion, controlled descent.', NULL),
  ('seed_pe_hit_chest_2', 'seed_day_hit_chest', 'seed_incline_db_press', 1, 3, 'amrap', NULL, NULL, 0, 90,
   'Work each set to failure. On the last set, after failure drop the weight roughly 20-30% and keep going to failure again (drop set).', NULL),

  ('seed_pe_hit_back_1', 'seed_day_hit_back', 'seed_deadlift', 0, 3, 'rep_range', 4, 6, 2, 180,
   'Brace core, flat back, drive through the floor. This is heavy work, not the failure set — leave a rep or two.', NULL),
  ('seed_pe_hit_back_2', 'seed_day_hit_back', 'seed_barbell_row', 1, 4, 'rep_range', 8, 10, 1, 120,
   'Pull to the lower ribs, squeeze shoulder blades together, avoid using momentum.', NULL),
  ('seed_pe_hit_back_3', 'seed_day_hit_back', 'seed_pull_up', 2, 4, 'amrap', NULL, NULL, 0, 90,
   'Each set to failure. On the last set, add a myo-rep cluster: after failure rest about 15 seconds, squeeze out a few more, repeat once.', NULL),
  ('seed_pe_hit_back_4', 'seed_day_hit_back', 'seed_lat_pulldown', 3, 3, 'rep_range', 10, 12, 1, 75,
   'Lead with the elbows, pull to the upper chest, control the return.', NULL),

  ('seed_pe_hit_shoulders_1', 'seed_day_hit_shoulders', 'seed_overhead_press', 0, 4, 'rep_range', 6, 8, 1, 120,
   'Brace your core, press straight overhead, avoid over-arching the lower back.', NULL),
  ('seed_pe_hit_shoulders_2', 'seed_day_hit_shoulders', 'seed_db_shoulder_press', 1, 3, 'rep_range', 8, 10, 1, 90,
   'Brace core, press without excessive back arch, control the descent.', NULL),
  ('seed_pe_hit_shoulders_3', 'seed_day_hit_shoulders', 'seed_lateral_raise', 2, 4, 'amrap', NULL, NULL, 0, 45,
   'Work to failure with strict form, then keep going with a few partial-range reps once strict reps run out (partials).', NULL),
  ('seed_pe_hit_shoulders_4', 'seed_day_hit_shoulders', 'seed_face_pull', 3, 3, 'rep_range', 12, 15, 1, 60,
   'Pull to eye level, rotate shoulders back, squeeze at the end range.', NULL),

  ('seed_pe_hit_legs_1', 'seed_day_hit_legs', 'seed_back_squat', 0, 4, 'rep_range', 6, 8, 1, 180,
   'Brace core, sit back and down, drive through the whole foot.', NULL),
  ('seed_pe_hit_legs_2', 'seed_day_hit_legs', 'seed_romanian_deadlift', 1, 3, 'rep_range', 8, 10, 1, 120,
   'Soft knees, hinge at the hips, keep the bar close to your legs.', NULL),
  ('seed_pe_hit_legs_3', 'seed_day_hit_legs', 'seed_leg_press', 2, 3, 'amrap', NULL, NULL, 0, 90,
   'Work each set to failure. On the last set, after failure strip a plate or two and continue to failure again (drop set).', NULL),
  ('seed_pe_hit_legs_4', 'seed_day_hit_legs', 'seed_leg_extension', 3, 3, 'amrap', NULL, NULL, 0, 60,
   'Burn-out finisher — go to failure, no need to hold back.', NULL),

  ('seed_pe_hit_arms_1', 'seed_day_hit_arms', 'seed_tricep_pushdown', 0, 4, 'rep_range', 10, 12, 1, 60,
   'Keep elbows pinned to your sides, full extension, control the negative.', NULL),
  ('seed_pe_hit_arms_2', 'seed_day_hit_arms', 'seed_db_bicep_curl', 1, 4, 'amrap', NULL, NULL, 0, 60,
   'Work to failure, then add a myo-rep cluster: rest about 15 seconds, squeeze out a few more, repeat once.', NULL),
  ('seed_pe_hit_arms_3', 'seed_day_hit_arms', 'seed_hanging_leg_raise', 2, 3, 'rep_range', 8, 12, 1, 60,
   'Curl the pelvis, avoid swinging, control the descent.', NULL);

INSERT OR IGNORE INTO program_substitution (id, program_exercise_id, exercise_id, note) VALUES
  ('seed_sub_hit_1', 'seed_pe_hit_chest_1',     'seed_incline_db_press',   'No barbell/flat bench available'),
  ('seed_sub_hit_2', 'seed_pe_hit_back_1',      'seed_romanian_deadlift', 'Deadlift platform occupied'),
  ('seed_sub_hit_3', 'seed_pe_hit_back_3',      'seed_lat_pulldown',      'Can not yet do bodyweight pull-ups'),
  ('seed_sub_hit_4', 'seed_pe_hit_shoulders_1', 'seed_db_shoulder_press', 'No barbell available'),
  ('seed_sub_hit_5', 'seed_pe_hit_legs_1',      'seed_leg_press',         'No squat rack available');
`;
