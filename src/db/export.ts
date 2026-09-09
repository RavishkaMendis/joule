// ═══════════════════════════════════════════════════════════════════════
// EXPORT / IMPORT — PRD §12
//
// "Export: full JSON dump + per-table CSV, via share sheet. Available
// from day one. Import: generic CSV for weight_log and day_intake."
// "The point of this app is escaping a subscription. Don't build a new
// prison."
//
// This module only builds the strings/objects; wiring to the OS share
// sheet (expo-sharing) is a screens/App concern outside src/db and
// src/lib, so it is deliberately not done here.
// ═══════════════════════════════════════════════════════════════════════

import type { Database } from './database';
import { toCsv, parseCsv } from '../lib/csv';
import * as intakeRepo from './repositories/intakeRepo';
import type {
  DayIntakeRow,
  WeightLogRow,
  ExternalEstimateRow,
  FoodEntryRow,
  SavedFoodRow,
  PotRow,
  PotContainerRow,
  SupplementRow,
  SupplementLogRow,
  ExerciseRow,
  WorkoutSessionRow,
  WorkoutSetRow,
  WorkoutSetSegmentRow,
  ProgramRow,
  ProgramDayRow,
  ProgramExerciseRow,
  ProgramSubstitutionRow,
  UserProfileRow,
} from './types';

export type FullExport = {
  exported_at: string; // ISO timestamp
  schema_version: number;
  day_intake: DayIntakeRow[];
  weight_log: WeightLogRow[];
  external_estimate: ExternalEstimateRow[];
  food_entry: FoodEntryRow[];
  saved_food: SavedFoodRow[];
  pot: PotRow[];
  // Schema v6 (pot meal-prep container/tare support) — see schema.ts's v6
  // header. Never read by src/engine; included so a restore doesn't
  // silently lose saved container weights.
  pot_container: PotContainerRow[];
  // Schema v4 (strength training) — see schema.ts's v4 header. Never read
  // by src/engine; included here purely so a restore onto a new/wiped
  // device doesn't silently lose training history (the gap this change
  // closes).
  exercise: ExerciseRow[];
  workout_session: WorkoutSessionRow[];
  workout_set: WorkoutSetRow[];
  // Schema v7 addition — drop/myo-rep/partials segments. Never read by
  // src/engine; included so a restore doesn't silently drop a logged
  // drop set's later, lighter segments.
  workout_set_segment: WorkoutSetSegmentRow[];
  // Schema v7 (training programs/templates) — see schema.ts's v7 header.
  // Never read by src/engine; included so a restore doesn't silently lose
  // a user's defined programs/days/exercises/substitutions.
  program: ProgramRow[];
  program_day: ProgramDayRow[];
  program_exercise: ProgramExerciseRow[];
  program_substitution: ProgramSubstitutionRow[];
  supplement: SupplementRow[];
  // Schema v5 addition — adherence history. Never read by src/engine.
  supplement_log: SupplementLogRow[];
  user_profile: UserProfileRow[];
};

const TABLE_COLUMNS = {
  day_intake: ['date', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'is_complete'],
  weight_log: ['date', 'weight_kg', 'confounder', 'source'],
  external_estimate: ['date', 'source', 'tdee_est', 'active_kcal', 'steps', 'sleep_minutes', 'readiness'],
  food_entry: [
    'id',
    'date',
    'logged_at',
    'name',
    'grams',
    'kcal',
    'protein_g',
    'carbs_g',
    'fat_g',
    'source',
    'confidence',
    'pot_id',
    'raw_input',
    'meal_type',
    'meal_group_id',
    'meal_name',
    'tare_g',
  ],
  saved_food: [
    'id',
    'name',
    'barcode',
    'kcal_per_100g',
    'protein_per_100g',
    'carbs_per_100g',
    'fat_per_100g',
    'default_grams',
    'use_count',
    'last_used',
    'confidence',
  ],
  pot: [
    'id',
    'name',
    'created_at',
    'total_weight_g',
    'remaining_g',
    'kcal_per_g',
    'protein_per_g',
    'carbs_per_g',
    'fat_per_g',
    'ingredients',
    'is_active',
  ],
  pot_container: ['id', 'name', 'tare_g', 'use_count', 'last_used'],
  exercise: ['id', 'name', 'category', 'equipment', 'is_custom'],
  workout_session: ['id', 'date', 'name', 'started_at', 'notes', 'program_day_id'],
  workout_set: [
    'id',
    'session_id',
    'exercise_id',
    'set_index',
    'weight_kg',
    'reps',
    'rpe',
    'is_warmup',
    'logged_at',
    'set_type',
  ],
  workout_set_segment: ['id', 'workout_set_id', 'segment_index', 'weight_kg', 'reps'],
  program: ['id', 'name', 'description', 'is_active', 'created_at'],
  program_day: ['id', 'program_id', 'order_index', 'label'],
  program_exercise: [
    'id',
    'program_day_id',
    'exercise_id',
    'order_index',
    'target_sets',
    'prescription_type',
    'rep_low',
    'rep_high',
    'target_rir',
    'rest_seconds',
    'cues',
    'demo_url',
  ],
  program_substitution: ['id', 'program_exercise_id', 'exercise_id', 'note'],
  supplement: ['id', 'name', 'dose', 'schedule', 'kcal', 'protein_g', 'unit', 'notes', 'is_active', 'created_at'],
  supplement_log: ['id', 'supplement_id', 'date', 'logged_at', 'food_entry_id'],
  user_profile: [
    'id',
    'height_cm',
    'birth_year',
    'sex',
    'goal',
    'rate_kg_per_week',
    'activity_seed',
    'protein_override',
    'units',
  ],
} as const satisfies Record<keyof Omit<FullExport, 'exported_at' | 'schema_version'>, readonly string[]>;

type TableName = keyof typeof TABLE_COLUMNS;

async function fetchAll<T>(db: Database, table: TableName): Promise<T[]> {
  return db.getAllAsync<T>(`SELECT * FROM ${table}`);
}

/** Build a full JSON dump of every table (PRD §12). */
export async function exportFullJson(db: Database, schemaVersion: number): Promise<FullExport> {
  const [
    day_intake,
    weight_log,
    external_estimate,
    food_entry,
    saved_food,
    pot,
    pot_container,
    exercise,
    workout_session,
    workout_set,
    workout_set_segment,
    program,
    program_day,
    program_exercise,
    program_substitution,
    supplement,
    supplement_log,
    user_profile,
  ] = await Promise.all([
    fetchAll<DayIntakeRow>(db, 'day_intake'),
    fetchAll<WeightLogRow>(db, 'weight_log'),
    fetchAll<ExternalEstimateRow>(db, 'external_estimate'),
    fetchAll<FoodEntryRow>(db, 'food_entry'),
    fetchAll<SavedFoodRow>(db, 'saved_food'),
    fetchAll<PotRow>(db, 'pot'),
    fetchAll<PotContainerRow>(db, 'pot_container'),
    fetchAll<ExerciseRow>(db, 'exercise'),
    fetchAll<WorkoutSessionRow>(db, 'workout_session'),
    fetchAll<WorkoutSetRow>(db, 'workout_set'),
    fetchAll<WorkoutSetSegmentRow>(db, 'workout_set_segment'),
    fetchAll<ProgramRow>(db, 'program'),
    fetchAll<ProgramDayRow>(db, 'program_day'),
    fetchAll<ProgramExerciseRow>(db, 'program_exercise'),
    fetchAll<ProgramSubstitutionRow>(db, 'program_substitution'),
    fetchAll<SupplementRow>(db, 'supplement'),
    fetchAll<SupplementLogRow>(db, 'supplement_log'),
    fetchAll<UserProfileRow>(db, 'user_profile'),
  ]);

  return {
    exported_at: new Date().toISOString(),
    schema_version: schemaVersion,
    day_intake,
    weight_log,
    external_estimate,
    food_entry,
    saved_food,
    pot,
    pot_container,
    exercise,
    workout_session,
    workout_set,
    workout_set_segment,
    program,
    program_day,
    program_exercise,
    program_substitution,
    supplement,
    supplement_log,
    user_profile,
  };
}

/** Build a CSV string for a single table. */
export async function exportTableCsv(db: Database, table: TableName): Promise<string> {
  const rows = await fetchAll<Record<string, unknown>>(db, table);
  return toCsv(rows, TABLE_COLUMNS[table]);
}

/** Build CSV strings for every table, keyed by table name (one file per table, PRD §12). */
export async function exportAllCsv(db: Database): Promise<Record<TableName, string>> {
  const entries = await Promise.all(
    (Object.keys(TABLE_COLUMNS) as TableName[]).map(async (table) => [table, await exportTableCsv(db, table)] as const)
  );
  return Object.fromEntries(entries) as Record<TableName, string>;
}

// ─── Import ──────────────────────────────────────────────────────────────

export type ImportResult = {
  table: 'weight_log' | 'day_intake';
  rowsImported: number;
  errors: string[];
};

function parseNumber(value: string, field: string, errors: string[]): number | null {
  if (value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) {
    errors.push(`invalid number for ${field}: "${value}"`);
    return null;
  }
  return n;
}

/**
 * Generic CSV import for `weight_log` (PRD §12). Expects (at minimum) the
 * columns `date` and `weight_kg`; `confounder` and `source` are optional
 * and default to null / 'manual'. Upserts by date, same semantics as
 * weightRepo.upsertWeight — importing is just re-entering data, so a
 * re-import of the same file is idempotent.
 */
export async function importWeightLogCsv(db: Database, csvText: string): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  const errors: string[] = [];
  let rowsImported = 0;

  for (const row of rows) {
    if (!row.date) {
      errors.push('row missing required "date" field, skipped');
      continue;
    }
    const weight = parseNumber(row.weight_kg ?? '', 'weight_kg', errors);
    if (weight === null) {
      errors.push(`row for date ${row.date} missing/invalid weight_kg, skipped`);
      continue;
    }

    await db.runAsync(
      `INSERT INTO weight_log (date, weight_kg, confounder, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         weight_kg = excluded.weight_kg,
         confounder = excluded.confounder,
         source = excluded.source`,
      [row.date, weight, row.confounder || null, row.source || 'manual']
    );
    rowsImported += 1;
  }

  return { table: 'weight_log', rowsImported, errors };
}

/**
 * Generic CSV import for `day_intake` (PRD §12).
 *
 * ⚠️ AUDIT FIX: day_intake is a DERIVED ROLLUP of food_entry — see
 * src/db/repositories/intakeRepo.ts's own header: "no other code should
 * hand-write day_intake's numeric columns." This function used to do
 * exactly that (a raw `INSERT INTO day_intake`), which is a silent time
 * bomb: the imported total looked right only until the NEXT
 * `intakeRepo.recomputeDay` for that date — triggered by adding or editing
 * ANY food_entry for it, even a completely unrelated one, weeks later. At
 * that point recomputeDay re-derives the row from food_entry alone, finds
 * none (or only the new entry), and silently overwrites the imported
 * historical total down to near-zero — no error, no warning, and this
 * value feeds straight into computeTDEE's intake window (day_intake is one
 * of only two tables the engine reads). A restored backup's history could
 * evaporate the first time the user touched a logged item on that date.
 *
 * Fixed by importing each day as ONE synthetic food_entry row instead
 * (`source: 'manual'`, `confidence: 'medium'` — a whole day's total is a
 * real number but no longer attributable to a specific item, so it must
 * not read as more certain than it is; a deterministic id keyed on the
 * date so re-importing the same backup upserts that same row rather than
 * duplicating it), then calling the exact same `intakeRepo.recomputeDay`
 * every other food_entry mutation goes through. A later food_entry edit
 * for that date now recomputes CORRECTLY — the imported total is IN the
 * sum being re-derived, not a value the sum silently replaces. The
 * synthetic row is a completely normal food_entry afterwards: editable and
 * deletable forever like anything else (PRD §10).
 *
 * `is_complete` has no food_entry-derivable equivalent — it's applied as
 * an explicit column update AFTER recomputeDay runs (recomputeDay's own
 * documented behavior is to preserve whatever is already stored, which
 * would otherwise ignore this CSV's value).
 *
 * Documented tradeoff, matching this function's original intended use
 * ("restoring a JSON/CSV backup on a fresh install where food_entry
 * history may not be re-imported"): if food_entry rows already exist for
 * an imported date — e.g. re-running this import onto a device with live
 * data rather than a fresh install — the synthetic entry ADDS to them
 * rather than replacing the day's total. This assumes a fresh/empty day,
 * exactly like the JSON restore flow it exists alongside; it is not a
 * general-purpose "overwrite today's log" tool.
 */
export async function importDayIntakeCsv(db: Database, csvText: string): Promise<ImportResult> {
  const rows = parseCsv(csvText);
  const errors: string[] = [];
  let rowsImported = 0;

  for (const row of rows) {
    if (!row.date) {
      errors.push('row missing required "date" field, skipped');
      continue;
    }
    const kcal = parseNumber(row.kcal ?? '', 'kcal', errors) ?? 0;
    const protein_g = parseNumber(row.protein_g ?? '', 'protein_g', errors) ?? 0;
    const carbs_g = parseNumber(row.carbs_g ?? '', 'carbs_g', errors) ?? 0;
    const fat_g = parseNumber(row.fat_g ?? '', 'fat_g', errors) ?? 0;
    const is_complete = row.is_complete === '' || row.is_complete === undefined ? 1 : Number(row.is_complete) ? 1 : 0;

    // Deterministic per-date id — re-importing the same backup updates
    // this exact synthetic row (see ON CONFLICT below) instead of piling
    // up duplicate food_entry rows and double-counting the day.
    const entryId = `csv_import_day_${row.date}`;

    await db.runAsync(
      `INSERT INTO food_entry
         (id, date, logged_at, name, grams, kcal, protein_g, carbs_g, fat_g, source, confidence, pot_id, raw_input)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'manual', 'medium', NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         logged_at = excluded.logged_at,
         kcal = excluded.kcal,
         protein_g = excluded.protein_g,
         carbs_g = excluded.carbs_g,
         fat_g = excluded.fat_g`,
      [entryId, row.date, Date.now(), 'Imported day total (CSV)', kcal, protein_g, carbs_g, fat_g, 'Imported via day_intake CSV backup']
    );

    // The one true derivation path (intakeRepo.ts) — never a second
    // formula for how day_intake's numeric columns come to be.
    await intakeRepo.recomputeDay(db, row.date);
    await db.runAsync('UPDATE day_intake SET is_complete = ? WHERE date = ?', [is_complete, row.date]);

    rowsImported += 1;
  }

  return { table: 'day_intake', rowsImported, errors };
}
