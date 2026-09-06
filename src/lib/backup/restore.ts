// ═══════════════════════════════════════════════════════════════════════
// RESTORE — full-fidelity, explicit, replace-all restore from a snapshot.
//
// "Restoring must be explicit and must not silently merge into existing
// data. Offer replace-all semantics with a clear confirmation stating
// what will happen. Wrap it in a transaction so a mid-restore failure
// can't leave a half-populated database."
//
// This module does the DB half only (no file picking, no confirmation UI
// — that's SettingsScreen.tsx / the first-run offer's job, same
// separation export.ts already uses). Every table this app owns is
// deleted and re-inserted from the snapshot inside one transaction:
// day_intake, weight_log, external_estimate, food_entry, saved_food, pot,
// exercise, workout_session, workout_set, program, program_day,
// program_exercise, program_substitution, supplement, supplement_log,
// user_profile (the src/db/schema.ts core, via src/db/export.ts's
// FullExport shape) plus the three app-level tables (app_target_snapshot,
// app_household_prefs, app_checkin_history) that src/lib/backup/
// snapshot.ts adds on top.
//
// exercise/workout_session/workout_set (schema v4) and supplement_log
// (schema v5) were added to this chain after the fact, closing a gap
// where two features shipped (strength training, supplements) without
// their tables ever reaching export.ts/snapshot.ts/restore.ts — a
// restore onto a new/wiped device would otherwise silently drop them.
// None of the five is ever read by src/engine/**; see schema.ts's v4/v5
// headers for the full per-table architectural rationale.
//
// day_intake is a derived rollup of food_entry (see
// src/db/repositories/intakeRepo.ts's header comment) — restoring the
// snapshot's stored day_intake rows verbatim would work for a
// byte-identical round-trip, but PRD-mandated invariant is "day_intake
// always equals SUM(food_entry) for that date", and a backup taken at a
// slightly different moment than an in-flight edit is exactly the kind
// of drift that invariant exists to prevent. So after loading food_entry,
// this module calls intakeRepo.recomputeDay for every affected date
// rather than trusting the snapshot's rollup numbers — the snapshot's
// day_intake rows are only used as a source of dates to recompute (and
// as a safety net for any date that has zero food_entry rows, e.g. a
// manually-imported CSV day with no itemized entries).
//
// Schema v2 (meal_type/meal_group_id/meal_name on food_entry, added for
// meal grouping/date-nav) is handled defensively in the food_entry
// insert loop below: an OLD (v1) backup file's food_entry rows simply
// don't have these three keys in their JSON at all, so they come off
// `snapshot.food_entry` as `undefined` rather than `null` — normalized to
// `null` explicitly before binding, since `undefined` is not a valid bind
// value. A v1 snapshot therefore restores cleanly into a v2 database with
// every entry present and its meal metadata absent (not an error, not
// dropped data — those columns simply didn't exist yet when the backup
// was taken). day_intake's rollup is entirely unaffected either way,
// since recomputeDay sums food_entry's macro columns regardless of
// meal_type/meal_group_id/meal_name.
//
// Schema v3 (saved_food.confidence, added so quick-add stops hardcoding
// 'exact' — PRD §10) is handled the same defensive way in the saved_food
// insert loop below: a v1/v2 backup's saved_food rows don't have a
// `confidence` key at all, so it is normalized `undefined -> null` before
// binding. NULL is the documented "no recorded confidence" state (see
// LEGACY_SAVED_FOOD_CONFIDENCE in src/lib/foodEntryActions.ts) — it is not
// an error and does not block the restore.
//
// Schema v6 (pot meal-prep container/tare support — see schema.ts's v6
// header) is handled the same two ways as every prior addition:
//   - `pot_container` is a brand-new table, so a pre-v6 snapshot simply
//     has no `pot_container` key at all -> defaulted to `[] ` (same
//     `?? []` pattern as `exercise`/`workout_session`/`workout_set`
//     above) rather than letting `for...of undefined` throw.
//   - `food_entry.tare_g` is a new column, so a pre-v6 snapshot's
//     food_entry rows don't have this key -> normalized `undefined ->
//     null` before binding, same pattern as meal_type/meal_group_id/
//     meal_name and saved_food.confidence above. NULL is exactly the
//     "no container info recorded" state schema.ts documents for every
//     pre-v6 row, not an error.
//
// Schema v7 (training programs/templates — see schema.ts's v7 header) is
// handled the same way again:
//   - `program`/`program_day`/`program_exercise`/`program_substitution`
//     are four brand-new tables, so a pre-v7 snapshot has none of these
//     keys at all -> each defaults to `[]`, same pattern as
//     `exercise`/`workout_session`/`workout_set`. Parents are inserted
//     before children (program -> program_day -> program_exercise ->
//     program_substitution) and children are deleted before parents,
//     matching the exact ordering discipline the v4 training tables
//     already established for their own parent/child pair.
//   - `workout_session.program_day_id` is a new column, so a pre-v7
//     snapshot's workout_session rows don't have this key at all ->
//     normalized `undefined -> null` before binding, same
//     undefined-tolerant pattern as every other column addition above.
//     NULL is exactly "ad-hoc session, no program" (schema.ts's v7
//     header) — not an error, and the overwhelmingly common case even
//     going forward.
//   - `workout_set.set_type` is a new column on the pre-existing (v4)
//     `workout_set` table, so a pre-v7 snapshot's workout_set rows don't
//     have this key at all -> normalized `undefined -> 'straight'`
//     (matching the column's own `NOT NULL DEFAULT 'straight'` — every
//     pre-v7 set genuinely WAS an ordinary straight set, since drop/myo-
//     rep/partials logging didn't exist yet).
//   - `workout_set_segment` is a brand-new table -> defaults to `[]`,
//     same pattern as every other table addition. Inserted AFTER
//     `workout_set` (parent before child) and deleted BEFORE it (child
//     before parent).
//   - `program_exercise.prescription_type` is new alongside the whole
//     `program_exercise` table itself, so there is no real "pre-
//     prescription_type" snapshot shape in practice — still normalized
//     `undefined -> 'rep_range'` defensively, matching the column's own
//     DB default.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from '../../db/database';
import * as intakeRepo from '../../db/repositories/intakeRepo';
import type { BackupSnapshot } from './snapshot';

export type RestoreResult = {
  tablesRestored: string[];
  rowCounts: Record<string, number>;
};

async function deleteAll(db: Database, table: string): Promise<void> {
  await db.runAsync(`DELETE FROM ${table}`);
}

// Each app_* table below is normally created lazily by its owning
// module's own ensureTable() (targetsStore.ts / onboardingActions.ts /
// checkInHistory.ts) the first time that module touches its DB
// connection. Restore can run against a database those modules haven't
// touched yet in this process (e.g. a fresh install that goes straight
// from "no folder granted" to "restore from file" without ever visiting
// Settings/onboarding/check-in first) — deliberately NOT relying on
// calling into those modules to ensure their own tables exist here,
// since each one caches "already ensured" as *module-level* state rather
// than per-connection state (see each file's own resetXForTesting()):
// on a process that already opened a different Database instance earlier
// (a real risk in tests; theoretically possible in-app too if a restore
// races the first read of one of these stores), that cache would report
// "already ensured" for the wrong connection and this restore would
// crash on `DELETE FROM app_target_snapshot` with "no such table". Using
// the exact same `CREATE TABLE IF NOT EXISTS` DDL those modules define
// (idempotent, safe to run unconditionally) sidesteps the cache entirely.
const ENSURE_APP_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS app_target_snapshot (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  target_kcal       REAL NOT NULL,
  protein_g         REAL NOT NULL,
  fat_g             REAL NOT NULL,
  carbs_g           REAL NOT NULL,
  rail_reason_json  TEXT,
  accepted_at       INTEGER NOT NULL,
  week_label        TEXT
);
CREATE TABLE IF NOT EXISTS app_household_prefs (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  who_cooks   TEXT NOT NULL,
  meals_per_day INTEGER
);
CREATE TABLE IF NOT EXISTS app_checkin_history (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  tdee                REAL NOT NULL,
  confidence_low      REAL NOT NULL,
  confidence_high     REAL NOT NULL,
  trend_kg_per_week   REAL NOT NULL,
  smoothed_weight_kg  REAL NOT NULL,
  data_quality        TEXT NOT NULL,
  days_of_data        INTEGER NOT NULL,
  logged_days_in_window INTEGER NOT NULL,
  goal_rate_kg_per_week REAL NOT NULL,
  recorded_at         INTEGER NOT NULL
);
`;

/**
 * Replace every row of the given app tables (and the app_* singleton
 * tables) with the contents of `snapshot`, inside a single transaction.
 * On any failure, the transaction is rolled back and the DB is left
 * exactly as it was before the call — "a mid-restore failure can't leave
 * a half-populated database."
 *
 * This is a hard replace-all: existing rows are deleted first. Callers
 * (SettingsScreen, the first-run offer) are responsible for getting
 * explicit user confirmation before calling this — this function itself
 * does not prompt.
 */
export async function restoreFromSnapshot(db: Database, snapshot: BackupSnapshot): Promise<RestoreResult> {
  const rowCounts: Record<string, number> = {};

  // Guarantee the three app_* tables exist (idempotent — see
  // ENSURE_APP_TABLES_SQL's comment above for why this duplicates rather
  // than calls into targetsStore/onboardingActions/checkInHistory) before
  // `DELETE FROM app_target_snapshot` etc. below runs.
  await db.execAsync(ENSURE_APP_TABLES_SQL);

  await db.execAsync('BEGIN');
  try {
    // ─── Core PRD §3 tables (src/db/export.ts's FullExport shape) ───
    await deleteAll(db, 'day_intake');
    await deleteAll(db, 'weight_log');
    await deleteAll(db, 'external_estimate');
    await deleteAll(db, 'food_entry');
    await deleteAll(db, 'saved_food');
    await deleteAll(db, 'pot');
    await deleteAll(db, 'pot_container');

    // ─── Training programs/templates (schema v7). Children before
    // parents: program_substitution -> program_exercise -> program_day ->
    // program. Both program_substitution.exercise_id AND
    // program_exercise.exercise_id are plain REFERENCES exercise(id) with
    // NO ACTION (same shape as workout_set.exercise_id below), so — same
    // reasoning as the v4 block that follows — this WHOLE block must run
    // BEFORE `exercise` is deleted, or `PRAGMA foreign_keys = ON` throws
    // immediately on the `DELETE FROM exercise` the moment any
    // program_exercise/program_substitution row still points at it.
    // workout_session.program_day_id has NO REFERENCES clause at all (see
    // schema.ts's v7 header), so deleting `program`/`program_day` here
    // never touches or blocks on workout_session either way.
    await deleteAll(db, 'program_substitution');
    await deleteAll(db, 'program_exercise');
    await deleteAll(db, 'program_day');
    await deleteAll(db, 'program');

    // ─── Strength training (schema v4) — children before parents. ───
    // workout_set.session_id is ON DELETE CASCADE (deleting
    // workout_session would take its sets with it automatically), but
    // workout_set.exercise_id is a plain REFERENCES with NO ACTION — with
    // `PRAGMA foreign_keys = ON` (migrations.ts enables it on every
    // connection), deleting a row from `exercise` while a workout_set
    // still points at it would throw immediately. So workout_set must be
    // deleted first, before either of its two parent tables.
    // workout_set_segment.workout_set_id is ON DELETE CASCADE, so
    // deleting workout_set below would already remove these automatically
    // — deleted explicitly first anyway, matching this file's convention
    // of never relying on cascade alone (every table gets its own
    // deleteAll call, child before parent).
    await deleteAll(db, 'workout_set_segment');
    await deleteAll(db, 'workout_set');
    await deleteAll(db, 'workout_session');
    await deleteAll(db, 'exercise');

    // ─── Supplements (schema v5). supplement_log.supplement_id has no
    // REFERENCES clause at all (deliberately — see schema.ts's v5 header:
    // a real FK here would make `DELETE FROM supplement` throw under
    // foreign_keys=ON the moment any log row exists, exactly the
    // food_entry.pot_id precedent). Nothing here depends on delete order
    // for correctness, but supplement_log is still deleted before its
    // logical parent for consistency with the training tables above.
    await deleteAll(db, 'supplement_log');
    await deleteAll(db, 'supplement');
    await deleteAll(db, 'user_profile');

    for (const row of snapshot.weight_log) {
      await db.runAsync(
        `INSERT INTO weight_log (date, weight_kg, confounder, source) VALUES (?, ?, ?, ?)`,
        [row.date, row.weight_kg, row.confounder, row.source]
      );
    }
    rowCounts.weight_log = snapshot.weight_log.length;

    // `external_estimate` has been in the schema since v1, but a snapshot
    // taken before Zepp import existed (build order item 19) never wrote
    // this key at all if the exporting code predates it, or — more subtly
    // — some other producer of a "Joule-shaped" JSON file simply omits an
    // always-empty array. Either way `snapshot.external_estimate` can come
    // off `JSON.parse` as `undefined`, and `for...of undefined` throws,
    // aborting the whole restore transaction over a table that is
    // reference-only and never affects targets/TDEE in the first place.
    // Default to empty rather than fail the restore.
    for (const row of snapshot.external_estimate ?? []) {
      await db.runAsync(
        `INSERT INTO external_estimate (date, source, tdee_est, active_kcal, steps, sleep_minutes, readiness)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [row.date, row.source, row.tdee_est, row.active_kcal, row.steps, row.sleep_minutes, row.readiness]
      );
    }
    rowCounts.external_estimate = (snapshot.external_estimate ?? []).length;

    for (const row of snapshot.food_entry) {
      // schema v2 addition: meal_type/meal_group_id/meal_name. A snapshot
      // taken by a pre-v2 build of this app simply doesn't have these keys
      // on its food_entry rows at all (JSON.parse never invents them), so
      // `row.meal_type` etc. are `undefined`, not `null`, coming off an old
      // file — normalize to `null` explicitly here rather than passing
      // `undefined` to the driver, which node:sqlite/expo-sqlite would
      // reject as a bind parameter. This is the one place an OLD backup
      // meets the NEW schema, and it must degrade to "no meal metadata"
      // rather than throwing and aborting the whole restore transaction.
      const mealType = row.meal_type ?? null;
      const mealGroupId = row.meal_group_id ?? null;
      const mealName = row.meal_name ?? null;
      // Schema v6 addition: tare_g. Same undefined-tolerant pattern as the
      // three meal-grouping columns above — a pre-v6 backup's food_entry
      // rows simply don't have this key at all.
      const tareG = row.tare_g ?? null;

      await db.runAsync(
        `INSERT INTO food_entry
           (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input, meal_type, meal_group_id, meal_name, tare_g)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.date,
          row.logged_at,
          row.name,
          row.grams,
          row.kcal,
          row.protein_g,
          row.carbs_g,
          row.fat_g,
          row.source,
          row.confidence,
          row.pot_id,
          row.raw_input,
          mealType,
          mealGroupId,
          mealName,
          tareG,
        ]
      );
    }
    rowCounts.food_entry = snapshot.food_entry.length;

    for (const row of snapshot.saved_food) {
      // Schema v3 addition: saved_food.confidence. An OLD (pre-v3) backup
      // file's saved_food rows don't have this key in their JSON at all,
      // so `row.confidence` comes off `snapshot.saved_food` as `undefined`
      // rather than `null` — normalized here for the same reason
      // meal_type/meal_group_id/meal_name are normalized below: `undefined`
      // is not a valid SQLite bind value and would abort the whole restore
      // transaction mid-way. A v1/v2 snapshot therefore restores cleanly
      // into a v3 database with every saved food present and its
      // confidence NULL — exactly what logQuickAdd already treats as "no
      // recorded confidence" (see LEGACY_SAVED_FOOD_CONFIDENCE in
      // foodEntryActions.ts).
      const confidence = row.confidence ?? null;

      await db.runAsync(
        `INSERT INTO saved_food
           (id, name, barcode, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, default_grams, use_count, last_used, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.name,
          row.barcode,
          row.kcal_per_100g,
          row.protein_per_100g,
          row.carbs_per_100g,
          row.fat_per_100g,
          row.default_grams,
          row.use_count,
          row.last_used,
          confidence,
        ]
      );
    }
    rowCounts.saved_food = snapshot.saved_food.length;

    for (const row of snapshot.pot) {
      await db.runAsync(
        `INSERT INTO pot
           (id, name, created_at, total_weight_g, remaining_g, kcal_per_g, protein_per_g, carbs_per_g, fat_per_g, ingredients, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.name,
          row.created_at,
          row.total_weight_g,
          row.remaining_g,
          row.kcal_per_g,
          row.protein_per_g,
          row.carbs_per_g,
          row.fat_per_g,
          row.ingredients,
          row.is_active,
        ]
      );
    }
    rowCounts.pot = snapshot.pot.length;

    // Schema v6 addition: pot_container. A snapshot taken before this
    // feature existed has no `pot_container` key at all -> default to []
    // (same pattern as exercise/workout_session/workout_set below) rather
    // than let `for...of undefined` throw and abort the whole restore.
    for (const row of snapshot.pot_container ?? []) {
      await db.runAsync(`INSERT INTO pot_container (id, name, tare_g, use_count, last_used) VALUES (?, ?, ?, ?, ?)`, [
        row.id,
        row.name,
        row.tare_g,
        row.use_count,
        row.last_used,
      ]);
    }
    rowCounts.pot_container = (snapshot.pot_container ?? []).length;

    // ─── Strength training (schema v4). A snapshot taken before this
    // feature existed has no `exercise`/`workout_session`/`workout_set`
    // keys at all, so they come off JSON.parse as `undefined` — default
    // to an empty array (same pattern as `external_estimate` above)
    // rather than let `for...of undefined` throw and abort the whole
    // restore. Parents (exercise, workout_session) are inserted before
    // the child (workout_set), matching the delete order above in reverse.
    for (const row of snapshot.exercise ?? []) {
      await db.runAsync(
        `INSERT INTO exercise (id, name, category, equipment, is_custom) VALUES (?, ?, ?, ?, ?)`,
        [row.id, row.name, row.category, row.equipment, row.is_custom]
      );
    }
    rowCounts.exercise = (snapshot.exercise ?? []).length;

    for (const row of snapshot.workout_session ?? []) {
      // Schema v7 addition: program_day_id. A pre-v7 snapshot's
      // workout_session rows don't have this key at all — normalize
      // undefined -> null (see file header), which is exactly "ad-hoc
      // session, no program", never an error.
      const programDayId = row.program_day_id ?? null;

      await db.runAsync(
        `INSERT INTO workout_session (id, date, name, started_at, notes, program_day_id) VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, row.date, row.name, row.started_at, row.notes, programDayId]
      );
    }
    rowCounts.workout_session = (snapshot.workout_session ?? []).length;

    for (const row of snapshot.workout_set ?? []) {
      // Schema v7 addition: set_type. A pre-v7 snapshot's workout_set
      // rows don't have this key at all — normalize undefined ->
      // 'straight' (see file header), matching the column's own
      // NOT NULL DEFAULT 'straight'.
      const setType = row.set_type ?? 'straight';

      await db.runAsync(
        `INSERT INTO workout_set
           (id, session_id, exercise_id, set_index, weight_kg, reps, rpe, is_warmup, logged_at, set_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.session_id,
          row.exercise_id,
          row.set_index,
          row.weight_kg,
          row.reps,
          row.rpe,
          row.is_warmup,
          row.logged_at,
          setType,
        ]
      );
    }
    rowCounts.workout_set = (snapshot.workout_set ?? []).length;

    // workout_set_segment (schema v7 addition) — brand-new table, so a
    // pre-v7 snapshot has no key for it at all -> defaults to [].
    // Inserted after workout_set (its parent).
    for (const row of snapshot.workout_set_segment ?? []) {
      await db.runAsync(
        `INSERT INTO workout_set_segment (id, workout_set_id, segment_index, weight_kg, reps) VALUES (?, ?, ?, ?, ?)`,
        [row.id, row.workout_set_id, row.segment_index, row.weight_kg, row.reps]
      );
    }
    rowCounts.workout_set_segment = (snapshot.workout_set_segment ?? []).length;

    // ─── Training programs/templates (schema v7). A snapshot taken
    // before this feature existed has none of these four keys at all, so
    // they come off JSON.parse as `undefined` — default to an empty
    // array (same pattern as `exercise`/`workout_session`/`workout_set`
    // above) rather than let `for...of undefined` throw and abort the
    // whole restore. Parents are inserted before children: program ->
    // program_day -> program_exercise -> program_substitution.
    for (const row of snapshot.program ?? []) {
      await db.runAsync(`INSERT INTO program (id, name, description, is_active, created_at) VALUES (?, ?, ?, ?, ?)`, [
        row.id,
        row.name,
        row.description,
        row.is_active,
        row.created_at,
      ]);
    }
    rowCounts.program = (snapshot.program ?? []).length;

    for (const row of snapshot.program_day ?? []) {
      await db.runAsync(`INSERT INTO program_day (id, program_id, order_index, label) VALUES (?, ?, ?, ?)`, [
        row.id,
        row.program_id,
        row.order_index,
        row.label,
      ]);
    }
    rowCounts.program_day = (snapshot.program_day ?? []).length;

    for (const row of snapshot.program_exercise ?? []) {
      // prescription_type: defensively normalized undefined -> 'rep_range'
      // (matching the column's own DB default) — see file header.
      const prescriptionType = row.prescription_type ?? 'rep_range';

      await db.runAsync(
        `INSERT INTO program_exercise
           (id, program_day_id, exercise_id, order_index, target_sets, prescription_type, rep_low, rep_high, target_rir, rest_seconds, cues, demo_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.program_day_id,
          row.exercise_id,
          row.order_index,
          row.target_sets,
          prescriptionType,
          row.rep_low,
          row.rep_high,
          row.target_rir,
          row.rest_seconds,
          row.cues,
          row.demo_url,
        ]
      );
    }
    rowCounts.program_exercise = (snapshot.program_exercise ?? []).length;

    for (const row of snapshot.program_substitution ?? []) {
      await db.runAsync(
        `INSERT INTO program_substitution (id, program_exercise_id, exercise_id, note) VALUES (?, ?, ?, ?)`,
        [row.id, row.program_exercise_id, row.exercise_id, row.note]
      );
    }
    rowCounts.program_substitution = (snapshot.program_substitution ?? []).length;

    for (const row of snapshot.supplement) {
      // Schema v5 additions: unit/notes/is_active/created_at. A snapshot
      // taken before this migration has `supplement` rows without these
      // four keys at all (undefined, not null) — normalized here for the
      // same reason meal_type/confidence are normalized above. is_active
      // defaults to 1 (matching the column's own `DEFAULT 1`): an old
      // backup's supplements were, definitionally, all "active" since the
      // archive concept didn't exist yet.
      const unit = row.unit ?? null;
      const notes = row.notes ?? null;
      const isActive = row.is_active ?? 1;
      const createdAt = row.created_at ?? null;

      await db.runAsync(
        `INSERT INTO supplement (id, name, dose, schedule, kcal, protein_g, unit, notes, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.name, row.dose, row.schedule, row.kcal, row.protein_g, unit, notes, isActive, createdAt]
      );
    }
    rowCounts.supplement = snapshot.supplement.length;

    // supplement_log (schema v5 addition) — same undefined-tolerant
    // pattern as the training tables above; absent entirely in any
    // pre-v5 snapshot.
    for (const row of snapshot.supplement_log ?? []) {
      await db.runAsync(
        `INSERT INTO supplement_log (id, supplement_id, date, logged_at, food_entry_id) VALUES (?, ?, ?, ?, ?)`,
        [row.id, row.supplement_id, row.date, row.logged_at, row.food_entry_id]
      );
    }
    rowCounts.supplement_log = (snapshot.supplement_log ?? []).length;

    for (const row of snapshot.user_profile) {
      await db.runAsync(
        `INSERT INTO user_profile
           (id, height_cm, birth_year, sex, goal, rate_kg_per_week, activity_seed, protein_override, units)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.height_cm,
          row.birth_year,
          row.sex,
          row.goal,
          row.rate_kg_per_week,
          row.activity_seed,
          row.protein_override,
          row.units,
        ]
      );
    }
    rowCounts.user_profile = snapshot.user_profile.length;

    // ─── day_intake: recompute from food_entry rather than trust the
    // snapshot's rollup verbatim (see file header). Union of dates from
    // both food_entry and the snapshot's own day_intake rows, so a date
    // with zero itemized entries (e.g. CSV-imported day_intake with no
    // food_entry rows behind it) still gets restored via the fallback
    // path recomputeDay already has (SUM over zero rows -> 0, then
    // is_complete is taken from the pre-existing day_intake row — but
    // since we just wiped day_intake, we insert the snapshot's row
    // directly first so recomputeDay can preserve its is_complete flag).
    for (const row of snapshot.day_intake) {
      await db.runAsync(
        `INSERT INTO day_intake (date, kcal, protein_g, carbs_g, fat_g, is_complete)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET is_complete = excluded.is_complete`,
        [row.date, row.kcal, row.protein_g, row.carbs_g, row.fat_g, row.is_complete]
      );
    }
    const affectedDates = new Set<string>([
      ...snapshot.day_intake.map((r) => r.date),
      ...snapshot.food_entry.map((r) => r.date),
    ]);
    for (const date of affectedDates) {
      await intakeRepo.recomputeDay(db, date);
    }
    rowCounts.day_intake = affectedDates.size;

    // ─── App-level tables (src/lib/*, not src/db/schema.ts) ───
    await deleteAll(db, 'app_target_snapshot');
    await deleteAll(db, 'app_household_prefs');
    await deleteAll(db, 'app_checkin_history');

    if (snapshot.app_target_snapshot) {
      const t = snapshot.app_target_snapshot;
      await db.runAsync(
        `INSERT INTO app_target_snapshot (id, target_kcal, protein_g, fat_g, carbs_g, rail_reason_json, accepted_at, week_label)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
        [t.target_kcal, t.protein_g, t.fat_g, t.carbs_g, t.rail_reason_json, t.accepted_at, t.week_label]
      );
    }

    if (snapshot.app_household_prefs) {
      const h = snapshot.app_household_prefs;
      await db.runAsync(`INSERT INTO app_household_prefs (id, who_cooks, meals_per_day) VALUES (1, ?, ?)`, [
        h.who_cooks,
        h.meals_per_day,
      ]);
    }

    if (snapshot.app_checkin_history) {
      const c = snapshot.app_checkin_history;
      await db.runAsync(
        `INSERT INTO app_checkin_history
           (id, tdee, confidence_low, confidence_high, trend_kg_per_week, smoothed_weight_kg, data_quality, days_of_data, logged_days_in_window, goal_rate_kg_per_week, recorded_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          c.tdee,
          c.confidence_low,
          c.confidence_high,
          c.trend_kg_per_week,
          c.smoothed_weight_kg,
          c.data_quality,
          c.days_of_data,
          c.logged_days_in_window,
          c.goal_rate_kg_per_week,
          c.recorded_at,
        ]
      );
    }

    await db.execAsync('COMMIT');
  } catch (e) {
    await db.execAsync('ROLLBACK');
    throw e;
  }

  return {
    tablesRestored: [
      'day_intake',
      'weight_log',
      'external_estimate',
      'food_entry',
      'saved_food',
      'pot',
      'pot_container',
      'exercise',
      'workout_session',
      'workout_set',
      'workout_set_segment',
      'program',
      'program_day',
      'program_exercise',
      'program_substitution',
      'supplement',
      'supplement_log',
      'user_profile',
      'app_target_snapshot',
      'app_household_prefs',
      'app_checkin_history',
    ],
    rowCounts,
  };
}
