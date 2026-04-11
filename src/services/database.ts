import * as SQLite from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';
import uuid from '../utils/uuid';
import { calculateEstimated1RM, calculateE1RM, FRESHNESS_HALF_LIFE_DAYS } from '../utils/oneRepMax';
import type { E1RMResult } from '../types/oneRepMax';
import type {
  Exercise, ExerciseNotes, Template, TemplateExercise, Workout, WorkoutSet,
  ExerciseType, TrainingGoal, SetTag,
  UpcomingWorkout, UpcomingWorkoutExercise, UpcomingWorkoutSet,
} from '../types/database';

// ─── Row Interfaces (raw SQLite rows before transformation) ───

/** Raw row from exercises table — muscle_groups is a JSON string, not parsed array */
interface ExerciseRow {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  muscle_groups: string;
  training_goal: string;
  description: string;
  created_at: string;
}

interface ExerciseNotesRow {
  exercise_id: string;
  notes: string | null;
  form_notes: string | null;
  machine_notes: string | null;
}

/** Raw row from workouts table, optionally joined with template name */
interface WorkoutRow {
  id: string;
  user_id: string;
  template_id: string | null;
  upcoming_workout_id: string | null;
  started_at: string;
  finished_at: string | null;
  coach_notes: string | null;
  exercise_coach_notes: string | null;
  session_notes: string | null;
  template_name?: string;
}

/** Raw row from workout_sets table — is_completed is 0/1 integer in SQLite */
interface WorkoutSetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  tag: string;
  rpe: number | null;
  is_completed: number;
  notes: string | null;
  target_weight: number | null;
  target_reps: number | null;
  target_rpe: number | null;
  exercise_order: number;
}

/** Row from template_exercises joined with exercises table */
interface TemplateExerciseJoinRow {
  id: string;
  template_id: string;
  exercise_id: string;
  sort_order: number;
  default_sets: number;
  warmup_sets: number;
  rest_seconds: number | null;
  exercise_user_id: string | null;
  exercise_name: string;
  exercise_type: string;
  exercise_muscle_groups: string;
  exercise_training_goal: string;
  exercise_description: string;
  exercise_created_at: string;
}

/** For COUNT(*) queries */
interface CountRow {
  count: number;
}

/** For MAX(sort_order) queries */
interface MaxOrderRow {
  max_order: number | null;
}

/** For SELECT DISTINCT w.id queries (workout ID only) */
interface WorkoutIdRow {
  id: string;
}

/** Joined row from workouts + workout_sets for exercise history */
interface ExerciseHistoryJoinRow {
  w_id: string;
  w_user_id: string;
  w_template_id: string | null;
  w_upcoming_workout_id: string | null;
  w_started_at: string;
  w_finished_at: string | null;
  w_coach_notes: string | null;
  w_exercise_coach_notes: string | null;
  w_session_notes: string | null;
  s_id: string;
  s_workout_id: string;
  s_exercise_id: string;
  s_set_number: number;
  s_reps: number | null;
  s_weight: number | null;
  s_tag: string;
  s_rpe: number | null;
  s_is_completed: number;
  s_notes: string | null;
}

/** Row for PR calculation queries — exercise_id, weight, reps, rpe */
interface PRSetRow {
  exercise_id: string;
  weight: number;
  reps: number;
  rpe: number | null;
}

/** Row from upcoming_workout_exercises joined with exercises */
interface UpcomingExerciseJoinRow {
  id: string;
  upcoming_workout_id: string;
  exercise_id: string;
  sort_order: number;
  rest_seconds: number;
  notes: string | null;
  e_id: string;
  e_user_id: string | null;
  e_name: string;
  e_type: string;
  e_muscle_groups: string;
  e_training_goal: string;
  e_description: string;
  e_created_at: string;
}

/** Raw row from upcoming_workouts table */
interface UpcomingWorkoutRow {
  id: string;
  date: string;
  template_id: string | null;
  notes: string | null;
  created_at: string;
}

/** Raw row from upcoming_workout_sets table — tag may be null for pre-migration rows */
interface UpcomingWorkoutSetRow {
  id: string;
  upcoming_exercise_id: string;
  set_number: number;
  target_weight: number;
  target_reps: number;
  target_rpe: number | null;
  tag: string | null;
}

// ─── Helpers ───

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function parseExercise(r: ExerciseRow): Exercise {
  return {
    ...r,
    type: r.type as ExerciseType,
    muscle_groups: safeJsonParse(r.muscle_groups, []),
    training_goal: r.training_goal as TrainingGoal,
  };
}

/** Map a raw WorkoutSetRow to a typed WorkoutSet (tag cast, boolean conversion, order default) */
function mapWorkoutSetRow(r: WorkoutSetRow): WorkoutSet {
  return {
    ...r,
    tag: r.tag as SetTag,
    is_completed: !!r.is_completed,
    exercise_order: r.exercise_order ?? 0,
  };
}

/** Build a typed Exercise from join-row columns with e_ prefix */
function parseExerciseFromJoin(r: { e_id: string; e_user_id: string | null; e_name: string; e_type: string; e_muscle_groups: string; e_training_goal: string; e_description: string; e_created_at: string }): Exercise {
  return {
    id: r.e_id,
    user_id: r.e_user_id,
    name: r.e_name,
    type: r.e_type as ExerciseType,
    muscle_groups: safeJsonParse(r.e_muscle_groups, []),
    training_goal: r.e_training_goal as TrainingGoal,
    description: r.e_description,
    created_at: r.e_created_at,
  };
}

/** Map a raw UpcomingWorkoutSetRow to a typed UpcomingWorkoutSet (tag default + cast) */
function mapUpcomingWorkoutSetRow(r: UpcomingWorkoutSetRow): UpcomingWorkoutSet {
  return {
    ...r,
    tag: (r.tag ?? 'working') as SetTag,
  };
}

/** Build a typed Exercise from template-exercise join-row columns with exercise_ prefix */
function parseExerciseFromTemplateJoin(r: TemplateExerciseJoinRow): Exercise {
  return {
    id: r.exercise_id,
    user_id: r.exercise_user_id ?? null,
    name: r.exercise_name,
    type: r.exercise_type as ExerciseType,
    muscle_groups: safeJsonParse(r.exercise_muscle_groups, []),
    training_goal: r.exercise_training_goal as TrainingGoal,
    description: r.exercise_description,
    created_at: r.exercise_created_at,
  };
}

let db: SQLite.SQLiteDatabase | undefined;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export const DB_NAME = 'workout-enhanced.db';

// ─── Current User ID (set by AuthContext on login/logout) ───
let currentUserId = 'local';
export function setCurrentUserId(id: string) { currentUserId = id; }
export function getCurrentUserId(): string { return currentUserId; }

/**
 * Returns the effective user id for DB reads/writes.
 *
 * If the module global is a real id, returns it. Otherwise consults the live
 * Supabase session and self-heals the global. Returns 'local' only when there
 * is genuinely no session (logged out / offline first run).
 *
 * Defense in depth: AuthContext is supposed to keep currentUserId in sync,
 * but if a write fires before that propagation (cold-start race, future code
 * path we forgot), this prevents silent 'local' orphans.
 */
async function resolveUserId(): Promise<string> {
  if (currentUserId && currentUserId !== 'local') return currentUserId;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const id = session?.user?.id;
    if (id) {
      currentUserId = id;
      return id;
    }
  } catch (err) {
    Sentry.captureException(err);
  }
  return 'local';
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      db = await SQLite.openDatabaseAsync(DB_NAME);
      await initSchema(db);
      return db;
    })();
  }
  return dbInitPromise;
}

/** Nuclear reset: close connection, delete the SQLite file, reinitialize fresh schema.
 *  Use when the DB file is corrupted beyond repair (e.g. phone died mid-write). */
export async function resetDatabase(): Promise<void> {
  try {
    if (db) await db.closeAsync();
  } catch {
    // May fail if DB is corrupted — that's fine, we're deleting it anyway
  }
  db = undefined;
  dbInitPromise = null;
  try {
    await SQLite.deleteDatabaseAsync(DB_NAME);
  } catch (error) {
    // Best-effort: if delete fails, proceed with getDb() anyway — the file may still
    // be openable, and pulling from Supabase can upsert on top. Aborting here would
    // leave the user with no data at all, which is worse.
    Sentry.captureException(error);
  }
  // Assign dbInitPromise SYNCHRONOUSLY before awaiting, so concurrent getDb()
  // callers get the same reinit promise instead of spawning a second one.
  dbInitPromise = (async () => {
    db = await SQLite.openDatabaseAsync(DB_NAME);
    await initSchema(db);
    return db;
  })();
  await dbInitPromise;
}

async function withDb<T>(label: string, fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  try {
    const database = await getDb();
    return await fn(database);
  } catch (error) {
    if (__DEV__) console.error(`${label} error:`, error);
    Sentry.captureException(error);
    throw error;
  }
}

async function initSchema(database: SQLite.SQLiteDatabase) {
  await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'weighted',
      muscle_groups TEXT NOT NULL DEFAULT '[]',
      training_goal TEXT NOT NULL DEFAULT 'hypertrophy',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS template_exercises (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      default_sets INTEGER NOT NULL DEFAULT 3,
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      template_id TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      coach_notes TEXT,
      exercise_coach_notes TEXT,
      session_notes TEXT,
      FOREIGN KEY (template_id) REFERENCES templates(id)
    );

    CREATE TABLE IF NOT EXISTS workout_sets (
      id TEXT PRIMARY KEY,
      workout_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      set_number INTEGER NOT NULL,
      reps INTEGER,
      weight REAL,
      tag TEXT NOT NULL DEFAULT 'working',
      rpe REAL,
      is_completed INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    CREATE TABLE IF NOT EXISTS upcoming_workouts (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      template_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (template_id) REFERENCES templates(id)
    );

    CREATE TABLE IF NOT EXISTS upcoming_workout_exercises (
      id TEXT PRIMARY KEY,
      upcoming_workout_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      rest_seconds INTEGER NOT NULL DEFAULT 90,
      notes TEXT,
      FOREIGN KEY (upcoming_workout_id) REFERENCES upcoming_workouts(id) ON DELETE CASCADE,
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    CREATE TABLE IF NOT EXISTS upcoming_workout_sets (
      id TEXT PRIMARY KEY,
      upcoming_exercise_id TEXT NOT NULL,
      set_number INTEGER NOT NULL,
      target_weight REAL NOT NULL,
      target_reps INTEGER NOT NULL,
      FOREIGN KEY (upcoming_exercise_id) REFERENCES upcoming_workout_exercises(id) ON DELETE CASCADE
    );
  `);

  // Database indexes for performance
  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_workout_sets_workout_id ON workout_sets(workout_id);
    CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise_id ON workout_sets(exercise_id);
    CREATE INDEX IF NOT EXISTS idx_workouts_finished_at ON workouts(finished_at);
    CREATE INDEX IF NOT EXISTS idx_workouts_started_at ON workouts(started_at);
    CREATE INDEX IF NOT EXISTS idx_template_exercises_template_id ON template_exercises(template_id);
    CREATE INDEX IF NOT EXISTS idx_template_exercises_exercise_id ON template_exercises(exercise_id);
  `);

  // Migration: drop columns that may exist from older schema
  await database.runAsync('ALTER TABLE template_exercises DROP COLUMN default_reps').catch(() => {});
  await database.runAsync('ALTER TABLE template_exercises DROP COLUMN default_weight').catch(() => {});
  await database.runAsync('ALTER TABLE template_exercises ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 150').catch(() => {});

  // Migration: add notes column to exercises table for sticky notes
  await database.runAsync('ALTER TABLE exercises ADD COLUMN notes TEXT').catch(() => {});

  // Migration: add target_rpe column for MCP-prescribed RPE per set
  await database.runAsync('ALTER TABLE upcoming_workout_sets ADD COLUMN target_rpe REAL').catch(() => {});

  // Migration: add warmup_sets to template_exercises and tag to upcoming_workout_sets
  await database.runAsync('ALTER TABLE template_exercises ADD COLUMN warmup_sets INTEGER NOT NULL DEFAULT 0').catch(() => {});
  await database.runAsync("ALTER TABLE upcoming_workout_sets ADD COLUMN tag TEXT DEFAULT 'working'").catch(() => {});

  // Migration: planned vs actual comparison — persist upcoming targets alongside workout results
  await database.runAsync('ALTER TABLE workouts ADD COLUMN upcoming_workout_id TEXT').catch(() => {});
  await database.runAsync('ALTER TABLE workout_sets ADD COLUMN target_weight REAL').catch(() => {});
  await database.runAsync('ALTER TABLE workout_sets ADD COLUMN target_reps INTEGER').catch(() => {});
  await database.runAsync('ALTER TABLE workout_sets ADD COLUMN target_rpe REAL').catch(() => {});

  // Migration: exercise_order for workout history sequence tracking
  await database.runAsync('ALTER TABLE workout_sets ADD COLUMN exercise_order INTEGER NOT NULL DEFAULT 0').catch(() => {});

  // Migration: rename workouts.notes → session_notes for clarity
  await database.runAsync('ALTER TABLE workouts RENAME COLUMN notes TO session_notes').catch(() => {});

  // Migration: null out RPE on failure sets (failure = implicit RPE 10, no need to store it)
  await database.runAsync("UPDATE workout_sets SET rpe = NULL WHERE tag = 'failure' AND rpe IS NOT NULL");

  // Migration: split notes into three types (form_notes, machine_notes, existing notes)
  await database.runAsync('ALTER TABLE exercises ADD COLUMN form_notes TEXT').catch(() => {});
  await database.runAsync('ALTER TABLE exercises ADD COLUMN machine_notes TEXT').catch(() => {});

  // Migration: persist AI coach notes — rename ai_summary to coach_notes, add exercise_coach_notes
  await database.runAsync('ALTER TABLE workouts RENAME COLUMN ai_summary TO coach_notes').catch(() => {});
  await database.runAsync('ALTER TABLE workouts ADD COLUMN exercise_coach_notes TEXT').catch(() => {});

  // Migration: create user_exercise_notes table for per-user notes
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS user_exercise_notes (
      user_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      notes TEXT,
      form_notes TEXT,
      machine_notes TEXT,
      PRIMARY KEY (user_id, exercise_id)
    )
  `);
}

// ─── Exercises ───

export function getExerciseById(id: string): Promise<Exercise | null> {
  return withDb('getExerciseById', async (database) => {
    const rows = await database.getAllAsync<ExerciseRow>('SELECT id, user_id, name, type, muscle_groups, training_goal, description, created_at FROM exercises WHERE id = ?', id);
    if (rows.length === 0) return null;
    return parseExercise(rows[0]);
  });
}

export function getAllExercises(): Promise<Exercise[]> {
  return withDb('getAllExercises', async (database) => {
    const rows = await database.getAllAsync<ExerciseRow>('SELECT id, user_id, name, type, muscle_groups, training_goal, description, created_at FROM exercises ORDER BY name');
    return rows.map(parseExercise);
  });
}

export async function createExercise(e: Omit<Exercise, 'id' | 'user_id' | 'created_at'>): Promise<Exercise> {
  const userId = await resolveUserId();
  return withDb('createExercise', async (database) => {
    const id = uuid();
    const now = new Date().toISOString();
    await database.runAsync(
      'INSERT INTO exercises (id, user_id, name, type, muscle_groups, training_goal, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, userId, e.name, e.type, JSON.stringify(e.muscle_groups), e.training_goal, e.description, now,
    );
    return { id, user_id: userId, name: e.name, type: e.type, muscle_groups: e.muscle_groups, training_goal: e.training_goal, description: e.description, created_at: now };
  });
}

export function getBulkExercises(ids: string[]): Promise<Exercise[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return withDb('getBulkExercises', async (database) => {
    const placeholders = ids.map(() => '?').join(',');
    const rows = await database.getAllAsync<ExerciseRow>(
      `SELECT id, user_id, name, type, muscle_groups, training_goal, description, created_at FROM exercises WHERE id IN (${placeholders})`, ...ids
    );
    return rows.map(parseExercise);
  });
}

// ─── User Exercise Notes ───

export async function getUserExerciseNotes(exerciseId: string): Promise<ExerciseNotes | null> {
  const userId = await resolveUserId();
  return withDb('getUserExerciseNotes', async (database) => {
    const rows = await database.getAllAsync<ExerciseNotesRow>(
      'SELECT exercise_id, notes, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ? AND exercise_id = ?',
      userId, exerciseId,
    );
    if (rows.length === 0) return null;
    return { notes: rows[0].notes, form_notes: rows[0].form_notes, machine_notes: rows[0].machine_notes };
  });
}

export async function getUserExerciseNotesBatch(exerciseIds: string[]): Promise<Map<string, ExerciseNotes>> {
  if (exerciseIds.length === 0) return new Map();
  const userId = await resolveUserId();
  return withDb('getUserExerciseNotesBatch', async (database) => {
    const placeholders = exerciseIds.map(() => '?').join(',');
    const rows = await database.getAllAsync<ExerciseNotesRow>(
      `SELECT exercise_id, notes, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ? AND exercise_id IN (${placeholders})`,
      userId, ...exerciseIds,
    );
    const map = new Map<string, ExerciseNotes>();
    for (const r of rows) {
      map.set(r.exercise_id, { notes: r.notes, form_notes: r.form_notes, machine_notes: r.machine_notes });
    }
    return map;
  });
}

const VALID_NOTE_FIELDS = new Set(['notes', 'form_notes', 'machine_notes'] as const);

export async function upsertExerciseNote(exerciseId: string, field: 'notes' | 'form_notes' | 'machine_notes', value: string | null): Promise<void> {
  if (!VALID_NOTE_FIELDS.has(field)) throw new Error(`Invalid note field: ${field}`);
  const userId = await resolveUserId();
  return withDb('upsertExerciseNote', async (database) => {
    await database.runAsync(
      `INSERT INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
       VALUES (?, ?, NULL, NULL, NULL)
       ON CONFLICT(user_id, exercise_id) DO UPDATE SET ${field} = ?`,
      userId, exerciseId, value,
    );
  });
}

export function updateExerciseNotes(exerciseId: string, notes: string | null): Promise<void> {
  return upsertExerciseNote(exerciseId, 'notes', notes);
}

export function updateExerciseFormNotes(exerciseId: string, formNotes: string | null): Promise<void> {
  return upsertExerciseNote(exerciseId, 'form_notes', formNotes);
}

export function updateExerciseMachineNotes(exerciseId: string, machineNotes: string | null): Promise<void> {
  return upsertExerciseNote(exerciseId, 'machine_notes', machineNotes);
}

export function updateExercise(
  exerciseId: string,
  updates: { name?: string; type?: string; muscle_groups?: string[]; training_goal?: string; description?: string }
): Promise<void> {
  return withDb('updateExercise', async (database) => {
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];
    if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name); }
    if (updates.type !== undefined) { setClauses.push('type = ?'); values.push(updates.type); }
    if (updates.muscle_groups !== undefined) { setClauses.push('muscle_groups = ?'); values.push(JSON.stringify(updates.muscle_groups)); }
    if (updates.training_goal !== undefined) { setClauses.push('training_goal = ?'); values.push(updates.training_goal); }
    if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
    if (setClauses.length === 0) return;
    values.push(exerciseId);
    await database.runAsync(`UPDATE exercises SET ${setClauses.join(', ')} WHERE id = ?`, ...values);
  });
}

// ─── Templates ───

export function getAllTemplates(): Promise<Template[]> {
  return withDb('getAllTemplates', (database) =>
    database.getAllAsync<Template>('SELECT * FROM templates ORDER BY updated_at DESC')
  );
}

export function createTemplate(name: string): Promise<Template> {
  return withDb('createTemplate', async (database) => {
    const id = uuid();
    const now = new Date().toISOString();
    await database.runAsync('INSERT INTO templates (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', id, name, now, now);
    return { id, user_id: 'local', name, created_at: now, updated_at: now };
  });
}

export function updateTemplate(id: string, name: string): Promise<void> {
  return withDb('updateTemplate', async (database) => {
    await database.runAsync('UPDATE templates SET name = ?, updated_at = datetime(\'now\') WHERE id = ?', name, id);
  });
}

export function deleteTemplate(id: string): Promise<void> {
  return withDb('deleteTemplate', async (database) => {
    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM template_exercises WHERE template_id = ?', id);
      await database.runAsync('DELETE FROM templates WHERE id = ?', id);
    });
  });
}

// ─── Template Exercises ───

export function getTemplateExercises(templateId: string): Promise<TemplateExercise[]> {
  return withDb('getTemplateExercises', async (database) => {
    const rows = await database.getAllAsync<TemplateExerciseJoinRow>(
      `SELECT te.*, e.user_id as exercise_user_id, e.name as exercise_name, e.type as exercise_type, e.muscle_groups as exercise_muscle_groups, e.training_goal as exercise_training_goal, e.description as exercise_description, e.created_at as exercise_created_at
       FROM template_exercises te
       JOIN exercises e ON te.exercise_id = e.id
       WHERE te.template_id = ?
       ORDER BY te.sort_order`,
      templateId,
    );
    return rows.map((r: TemplateExerciseJoinRow) => ({
      id: r.id,
      template_id: r.template_id,
      exercise_id: r.exercise_id,
      order: r.sort_order,
      default_sets: r.default_sets,
      warmup_sets: r.warmup_sets ?? 0,
      rest_seconds: r.rest_seconds ?? 150,
      exercise: parseExerciseFromTemplateJoin(r),
    }));
  });
}

export function getTemplateExerciseCountsBatch(templateIds: string[]): Promise<Map<string, number>> {
  if (templateIds.length === 0) return Promise.resolve(new Map());
  return withDb('getTemplateExerciseCountsBatch', async (database) => {
    const placeholders = templateIds.map(() => '?').join(',');
    const rows = await database.getAllAsync<{ template_id: string; count: number }>(
      `SELECT template_id, COUNT(*) as count FROM template_exercises WHERE template_id IN (${placeholders}) GROUP BY template_id`,
      ...templateIds,
    );
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.template_id, r.count);
    return map;
  });
}

export function addExerciseToTemplate(templateId: string, exerciseId: string, defaults?: { sets?: number; warmup_sets?: number; rest_seconds?: number }): Promise<TemplateExercise> {
  return withDb('addExerciseToTemplate', async (database) => {
    const id = uuid();
    const existing = await database.getAllAsync<MaxOrderRow>('SELECT MAX(sort_order) as max_order FROM template_exercises WHERE template_id = ?', templateId);
    const order = (existing[0]?.max_order ?? -1) + 1;
    const restSec = defaults?.rest_seconds ?? 150;
    const warmupSets = defaults?.warmup_sets ?? 0;
    await database.runAsync(
      'INSERT INTO template_exercises (id, template_id, exercise_id, sort_order, default_sets, warmup_sets, rest_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, templateId, exerciseId, order, defaults?.sets ?? 3, warmupSets, restSec,
    );
    return { id, template_id: templateId, exercise_id: exerciseId, order, default_sets: defaults?.sets ?? 3, warmup_sets: warmupSets, rest_seconds: restSec };
  });
}

export function removeExerciseFromTemplate(id: string): Promise<void> {
  return withDb('removeExerciseFromTemplate', async (database) => {
    // Get template_id before deleting so we can re-compact sort_order
    const row = await database.getFirstAsync<{ template_id: string }>(
      'SELECT template_id FROM template_exercises WHERE id = ?', id
    );
    if (row) {
      // Delete + re-compact in a single transaction for atomicity
      await database.withTransactionAsync(async () => {
        await database.runAsync('DELETE FROM template_exercises WHERE id = ?', id);
        const remaining = await database.getAllAsync<{ id: string }>(
          'SELECT id FROM template_exercises WHERE template_id = ? ORDER BY sort_order', row.template_id
        );
        for (let i = 0; i < remaining.length; i++) {
          await database.runAsync(
            'UPDATE template_exercises SET sort_order = ? WHERE id = ?', i, remaining[i].id
          );
        }
      });
    } else {
      await database.runAsync('DELETE FROM template_exercises WHERE id = ?', id);
    }
  });
}

/** Batch-update sort_order for template exercises. Takes junction-table row IDs (template_exercises.id), not exercise IDs. */
export function updateTemplateExerciseOrder(templateId: string, orderedIds: string[]): Promise<void> {
  return withDb('updateTemplateExerciseOrder', async (database) => {
    await database.withTransactionAsync(async () => {
      for (let i = 0; i < orderedIds.length; i++) {
        await database.runAsync(
          'UPDATE template_exercises SET sort_order = ? WHERE id = ? AND template_id = ?',
          i, orderedIds[i], templateId,
        );
      }
    });
  });
}

export function updateTemplateExerciseDefaults(id: string, defaults: { sets?: number; warmup_sets?: number; rest_seconds?: number }): Promise<void> {
  return withDb('updateTemplateExerciseDefaults', async (database) => {
    const parts: string[] = [];
    const values: (string | number)[] = [];
    if (defaults.sets !== undefined) { parts.push('default_sets = ?'); values.push(defaults.sets); }
    if (defaults.warmup_sets !== undefined) { parts.push('warmup_sets = ?'); values.push(defaults.warmup_sets); }
    if (defaults.rest_seconds !== undefined) { parts.push('rest_seconds = ?'); values.push(defaults.rest_seconds); }
    if (parts.length === 0) return;
    values.push(id);
    await database.runAsync(`UPDATE template_exercises SET ${parts.join(', ')} WHERE id = ?`, ...values);
  });
}

// ─── Workouts ───

export function startWorkout(templateId: string | null, upcomingWorkoutId?: string | null): Promise<Workout> {
  return withDb('startWorkout', async (database) => {
    const id = uuid();
    const now = new Date().toISOString();
    await database.runAsync(
      'INSERT INTO workouts (id, template_id, upcoming_workout_id, started_at) VALUES (?, ?, ?, ?)',
      id, templateId, upcomingWorkoutId ?? null, now,
    );
    return { id, user_id: 'local', template_id: templateId, upcoming_workout_id: upcomingWorkoutId ?? null, started_at: now, finished_at: null, coach_notes: null, exercise_coach_notes: null, session_notes: null };
  });
}

export function finishWorkout(id: string, sessionNotes?: string): Promise<void> {
  return withDb('finishWorkout', async (database) => {
    await database.runAsync('UPDATE workouts SET finished_at = datetime(\'now\'), session_notes = ? WHERE id = ?', sessionNotes ?? null, id);
  });
}

export function updateWorkoutSessionNotes(id: string, sessionNotes: string | null): Promise<void> {
  return withDb('updateWorkoutSessionNotes', async (database) => {
    await database.runAsync('UPDATE workouts SET session_notes = ? WHERE id = ?', sessionNotes, id);
  });
}

export function updateWorkoutCoachNotes(workoutId: string, coachNotes: string | null, exerciseCoachNotes: string | null): Promise<void> {
  return withDb('updateWorkoutCoachNotes', async (database) => {
    await database.runAsync('UPDATE workouts SET coach_notes = ?, exercise_coach_notes = ? WHERE id = ?', coachNotes, exerciseCoachNotes, workoutId);
  });
}

export function getWorkoutHistory(limit: number = 100): Promise<Workout[]> {
  return withDb('getWorkoutHistory', (database) =>
    database.getAllAsync<WorkoutRow>(
      `SELECT w.*, t.name as template_name FROM workouts w LEFT JOIN templates t ON w.template_id = t.id WHERE w.finished_at IS NOT NULL ORDER BY w.started_at DESC LIMIT ?`, limit
    )
  );
}

export function getActiveWorkout(): Promise<Workout | null> {
  return withDb('getActiveWorkout', async (database) => {
    const rows = await database.getAllAsync<WorkoutRow>(
      'SELECT w.*, t.name as template_name FROM workouts w LEFT JOIN templates t ON w.template_id = t.id WHERE w.finished_at IS NULL ORDER BY w.started_at DESC LIMIT 1'
    );
    return rows[0] ?? null;
  });
}

export function deleteWorkout(id: string): Promise<void> {
  return withDb('deleteWorkout', async (database) => {
    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM workout_sets WHERE workout_id = ?', id);
      await database.runAsync('DELETE FROM workouts WHERE id = ?', id);
    });
  });
}

// ─── Workout Sets ───

export function getWorkoutSets(workoutId: string): Promise<WorkoutSet[]> {
  return withDb('getWorkoutSets', async (database) => {
    const rows = await database.getAllAsync<WorkoutSetRow>(
      'SELECT * FROM workout_sets WHERE workout_id = ? ORDER BY exercise_order, rowid, set_number',
      workoutId,
    );
    return rows.map(mapWorkoutSetRow);
  });
}

export function addWorkoutSet(set: Omit<WorkoutSet, 'id'>): Promise<WorkoutSet> {
  return withDb('addWorkoutSet', async (database) => {
    const id = uuid();
    await database.runAsync(
      'INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe, is_completed, notes, target_weight, target_reps, target_rpe, exercise_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, set.workout_id, set.exercise_id, set.set_number, set.reps, set.weight, set.tag, set.rpe, set.is_completed ? 1 : 0, set.notes,
      set.target_weight ?? null, set.target_reps ?? null, set.target_rpe ?? null, set.exercise_order ?? 0,
    );
    return { id, ...set };
  });
}

export function addWorkoutSetsBatch(sets: Omit<WorkoutSet, 'id'>[]): Promise<WorkoutSet[]> {
  if (sets.length === 0) return Promise.resolve([]);
  return withDb('addWorkoutSetsBatch', async (database) => {
    const ids = sets.map(() => uuid());
    const placeholderGroup = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const placeholders = sets.map(() => placeholderGroup).join(', ');
    const values: (string | number | null)[] = [];
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      values.push(ids[i], set.workout_id, set.exercise_id, set.set_number, set.reps, set.weight, set.tag, set.rpe, set.is_completed ? 1 : 0, set.notes,
        set.target_weight ?? null, set.target_reps ?? null, set.target_rpe ?? null, set.exercise_order ?? 0);
    }
    await database.runAsync(
      `INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe, is_completed, notes, target_weight, target_reps, target_rpe, exercise_order) VALUES ${placeholders}`,
      ...values,
    );
    return sets.map((set, i) => ({ id: ids[i], ...set }));
  });
}

export function updateWorkoutSet(id: string, updates: Partial<WorkoutSet>): Promise<void> {
  return withDb('updateWorkoutSet', async (database) => {
    const parts: string[] = [];
    const values: (string | number | null)[] = [];
    if (updates.reps !== undefined) { parts.push('reps = ?'); values.push(updates.reps); }
    if (updates.weight !== undefined) { parts.push('weight = ?'); values.push(updates.weight); }
    if (updates.tag !== undefined) { parts.push('tag = ?'); values.push(updates.tag); }
    if (updates.rpe !== undefined) { parts.push('rpe = ?'); values.push(updates.rpe); }
    if (updates.is_completed !== undefined) { parts.push('is_completed = ?'); values.push(updates.is_completed ? 1 : 0); }
    if (updates.notes !== undefined) { parts.push('notes = ?'); values.push(updates.notes); }
    if (updates.set_number !== undefined) { parts.push('set_number = ?'); values.push(updates.set_number); }
    if (updates.target_weight !== undefined) { parts.push('target_weight = ?'); values.push(updates.target_weight ?? null); }
    if (updates.target_reps !== undefined) { parts.push('target_reps = ?'); values.push(updates.target_reps ?? null); }
    if (updates.target_rpe !== undefined) { parts.push('target_rpe = ?'); values.push(updates.target_rpe ?? null); }
    if (updates.exercise_order !== undefined) { parts.push('exercise_order = ?'); values.push(updates.exercise_order); }
    if (parts.length === 0) return;
    values.push(id);
    await database.runAsync(`UPDATE workout_sets SET ${parts.join(', ')} WHERE id = ?`, ...values);
  });
}

export function deleteWorkoutSet(id: string): Promise<void> {
  return withDb('deleteWorkoutSet', async (database) => {
    await database.runAsync('DELETE FROM workout_sets WHERE id = ?', id);
  });
}

/** Stamp exercise_order on all sets for a finished workout based on block positions */
export function stampExerciseOrder(workoutId: string, entries: Array<{ id: string; order: number }>): Promise<void> {
  return withDb('stampExerciseOrder', async (database) => {
    await database.withTransactionAsync(async () => {
      for (const { id, order } of entries) {
        await database.runAsync(
          'UPDATE workout_sets SET exercise_order = ? WHERE id = ?',
          order, id,
        );
      }
    });
  });
}

export function applyWorkoutChangesToTemplate(plan: import('../utils/setDiff').TemplateUpdatePlan): Promise<void> {
  return withDb('applyWorkoutChangesToTemplate', async (database) => {
    await database.withTransactionAsync(async () => {
      for (const change of plan.setChanges) {
        const parts: string[] = [];
        const values: (string | number)[] = [];
        if (change.sets !== undefined) { parts.push('default_sets = ?'); values.push(change.sets); }
        if (change.warmup_sets !== undefined) { parts.push('warmup_sets = ?'); values.push(change.warmup_sets); }
        if (parts.length > 0) {
          values.push(change.templateExerciseId);
          await database.runAsync(`UPDATE template_exercises SET ${parts.join(', ')} WHERE id = ?`, ...values);
        }
      }
      if (plan.reorderedTemplateExerciseIds) {
        // Fetch all template exercise IDs to avoid sort_order collisions
        // with exercises that were removed mid-workout
        const allRows = await database.getAllAsync<{ id: string }>(
          'SELECT id FROM template_exercises WHERE template_id = ? ORDER BY sort_order',
          plan.templateId,
        );
        const updatedSet = new Set(plan.reorderedTemplateExerciseIds);
        // Exercises removed mid-workout are not deleted from template — they get
        // appended to end of new order since they weren't in workoutExerciseIds.
        // This is intentional: the user skipped them this session, not permanently.
        const remainder = allRows.map(r => r.id).filter(id => !updatedSet.has(id));
        const finalOrder = [...plan.reorderedTemplateExerciseIds, ...remainder];
        for (let i = 0; i < finalOrder.length; i++) {
          await database.runAsync(
            'UPDATE template_exercises SET sort_order = ? WHERE id = ? AND template_id = ?',
            i, finalOrder[i], plan.templateId,
          );
        }
      }
    });
  });
}

export function getExerciseHistory(exerciseId: string, limit = 5): Promise<{ workout: Workout; sets: WorkoutSet[] }[]> {
  return withDb('getExerciseHistory', async (database) => {
    // Get workout IDs first (needed for LIMIT on workouts, not sets)
    const workoutIds = await database.getAllAsync<WorkoutIdRow>(
      `SELECT DISTINCT w.id FROM workouts w
       INNER JOIN workout_sets ws ON ws.workout_id = w.id
       WHERE ws.exercise_id = ? AND w.finished_at IS NOT NULL AND ws.is_completed = 1
       ORDER BY w.started_at DESC
       LIMIT ?`,
      exerciseId, limit,
    );

    if (workoutIds.length === 0) return [];

    const ids = workoutIds.map((w: WorkoutIdRow) => w.id);
    const placeholders = ids.map(() => '?').join(',');

    // Single JOIN query for workouts and sets
    const rows = await database.getAllAsync<ExerciseHistoryJoinRow>(
      `SELECT
         w.id as w_id, w.user_id as w_user_id, w.template_id as w_template_id,
         w.upcoming_workout_id as w_upcoming_workout_id,
         w.started_at as w_started_at, w.finished_at as w_finished_at,
         w.coach_notes as w_coach_notes, w.exercise_coach_notes as w_exercise_coach_notes, w.session_notes as w_session_notes,
         ws.id as s_id, ws.workout_id as s_workout_id, ws.exercise_id as s_exercise_id,
         ws.set_number as s_set_number, ws.reps as s_reps, ws.weight as s_weight,
         ws.tag as s_tag, ws.rpe as s_rpe, ws.is_completed as s_is_completed, ws.notes as s_notes
       FROM workouts w
       INNER JOIN workout_sets ws ON ws.workout_id = w.id
       WHERE w.id IN (${placeholders}) AND ws.exercise_id = ?
       ORDER BY w.started_at DESC, ws.set_number`,
      ...ids, exerciseId,
    );

    // Group by workout_id in memory
    const workoutMap = new Map<string, { workout: Workout; sets: WorkoutSet[] }>();

    for (const r of rows) {
      if (!workoutMap.has(r.w_id)) {
        workoutMap.set(r.w_id, {
          workout: {
            id: r.w_id,
            user_id: r.w_user_id,
            template_id: r.w_template_id,
            upcoming_workout_id: r.w_upcoming_workout_id,
            started_at: r.w_started_at,
            finished_at: r.w_finished_at,
            coach_notes: r.w_coach_notes,
            exercise_coach_notes: r.w_exercise_coach_notes,
            session_notes: r.w_session_notes,
          },
          sets: [],
        });
      }

      workoutMap.get(r.w_id)!.sets.push(mapWorkoutSetRow({
        id: r.s_id,
        workout_id: r.s_workout_id,
        exercise_id: r.s_exercise_id,
        set_number: r.s_set_number,
        reps: r.s_reps,
        weight: r.s_weight,
        tag: r.s_tag,
        rpe: r.s_rpe,
        is_completed: r.s_is_completed,
        notes: r.s_notes,
        target_weight: null,
        target_reps: null,
        target_rpe: null,
        exercise_order: 0,
      }));
    }

    // Return in same order as workout IDs (most recent first)
    return ids.map(id => workoutMap.get(id)!).filter(Boolean);
  });
}


// ─── PRs This Week ───

export function getPRsThisWeek(): Promise<number> {
  return withDb('getPRsThisWeek', async (database) => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    const weekStartISO = weekStart.toISOString();

    // Get this week's sets
    const weekSets = await database.getAllAsync<PRSetRow>(
      `SELECT ws.exercise_id, ws.weight, ws.reps, ws.rpe
       FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE w.finished_at IS NOT NULL
         AND w.started_at >= ?
         AND ws.is_completed = 1
         AND ws.weight IS NOT NULL
         AND ws.reps IS NOT NULL`,
      weekStartISO,
    );

    if (weekSets.length === 0) return 0;

    const exerciseIds = Array.from(new Set(weekSets.map((s: PRSetRow) => s.exercise_id)));

    // Get all prior sets in a single query (only for exercises that have sets this week)
    const placeholders = exerciseIds.map(() => '?').join(',');
    const priorSets = await database.getAllAsync<PRSetRow>(
      `SELECT ws.exercise_id, ws.weight, ws.reps, ws.rpe
       FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE w.finished_at IS NOT NULL
         AND w.started_at < ?
         AND ws.exercise_id IN (${placeholders})
         AND ws.is_completed = 1
         AND ws.weight IS NOT NULL
         AND ws.reps IS NOT NULL`,
      weekStartISO, ...exerciseIds,
    );

    // Group prior sets by exercise_id and calculate best e1RM for each
    const priorBestByExercise = new Map<string, number>();
    for (const s of priorSets) {
      const e1rm = calculateEstimated1RM(s.weight, s.reps, s.rpe);
      const current = priorBestByExercise.get(s.exercise_id) ?? 0;
      if (e1rm > current) {
        priorBestByExercise.set(s.exercise_id, e1rm);
      }
    }

    // Calculate week best for each exercise and count PRs
    let prCount = 0;
    for (const exId of exerciseIds) {
      const weekBest = weekSets
        .filter((s: PRSetRow) => s.exercise_id === exId)
        .reduce((max: number, s: PRSetRow) => {
          const e1rm = calculateEstimated1RM(s.weight, s.reps, s.rpe);
          return e1rm > max ? e1rm : max;
        }, 0);

      const priorBest = priorBestByExercise.get(exId) ?? 0;

      if (weekBest > priorBest && priorBest > 0) {
        prCount++;
      }
    }

    return prCount;
  });
}

// ─── Upcoming Workouts ───

async function buildUpcomingExercises(
  database: SQLite.SQLiteDatabase,
  workoutId: string,
): Promise<(UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[]> {
  const exerciseRows = await database.getAllAsync<UpcomingExerciseJoinRow>(
    `SELECT ue.*, e.id as e_id, e.user_id as e_user_id, e.name as e_name, e.type as e_type,
            e.muscle_groups as e_muscle_groups, e.training_goal as e_training_goal,
            e.description as e_description, e.created_at as e_created_at
     FROM upcoming_workout_exercises ue
     JOIN exercises e ON ue.exercise_id = e.id
     WHERE ue.upcoming_workout_id = ?
     ORDER BY ue.sort_order`,
    workoutId,
  );

  const exercises: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] = [];

  for (const r of exerciseRows) {
    const rawSets = await database.getAllAsync<UpcomingWorkoutSetRow>(
      'SELECT * FROM upcoming_workout_sets WHERE upcoming_exercise_id = ? ORDER BY set_number',
      r.id,
    );
    const sets: UpcomingWorkoutSet[] = rawSets.map(mapUpcomingWorkoutSetRow);

    exercises.push({
      id: r.id,
      upcoming_workout_id: r.upcoming_workout_id,
      exercise_id: r.exercise_id,
      order: r.sort_order,
      rest_seconds: r.rest_seconds,
      notes: r.notes,
      exercise: parseExerciseFromJoin(r),
      sets,
    });
  }

  return exercises;
}

export function getUpcomingWorkoutForToday(): Promise<{
  workout: UpcomingWorkout;
  exercises: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[];
} | null> {
  return withDb('getUpcomingWorkoutForToday', async (database) => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const workouts = await database.getAllAsync<UpcomingWorkoutRow>(
      'SELECT * FROM upcoming_workouts WHERE date = ? ORDER BY created_at DESC LIMIT 1',
      today,
    );
    if (workouts.length === 0) return null;

    const workout: UpcomingWorkout = workouts[0];
    const exercises = await buildUpcomingExercises(database, workout.id);
    return { workout, exercises };
  });
}

/** Fetch upcoming workout by ID (for restoring targets on resume) */
export function getUpcomingWorkoutById(id: string): Promise<{
  workout: UpcomingWorkout;
  exercises: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[];
} | null> {
  return withDb('getUpcomingWorkoutById', async (database) => {
    const workouts = await database.getAllAsync<UpcomingWorkoutRow>(
      'SELECT * FROM upcoming_workouts WHERE id = ? LIMIT 1',
      id,
    );
    if (workouts.length === 0) return null;

    const workout: UpcomingWorkout = workouts[0];
    const exercises = await buildUpcomingExercises(database, workout.id);
    return { workout, exercises };
  });
}

// ─── Last Performed By Template ───

/** Row for last-performed query */
interface LastPerformedRow {
  template_id: string;
  last_performed: string;
}

export function getLastPerformedByTemplate(templateIds: string[]): Promise<Record<string, string>> {
  if (templateIds.length === 0) return Promise.resolve({});
  return withDb('getLastPerformedByTemplate', async (database) => {
    const placeholders = templateIds.map(() => '?').join(',');
    const rows = await database.getAllAsync<LastPerformedRow>(
      `SELECT template_id, MAX(started_at) as last_performed
       FROM workouts
       WHERE finished_at IS NOT NULL AND template_id IN (${placeholders})
       GROUP BY template_id`,
      ...templateIds,
    );
    const result: Record<string, string> = {};
    for (const r of rows) result[r.template_id] = r.last_performed;
    return result;
  });
}

// ─── Best Estimated 1RM ───

export function getBestE1RM(exerciseId: string): Promise<number | null> {
  return withDb('getBestE1RM', async (database) => {
    const rows = await database.getAllAsync<PRSetRow>(
      `SELECT ws.exercise_id, ws.weight, ws.reps, ws.rpe
       FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE w.finished_at IS NOT NULL
         AND ws.exercise_id = ?
         AND ws.is_completed = 1
         AND ws.weight IS NOT NULL AND ws.weight > 0
         AND ws.reps IS NOT NULL AND ws.reps > 0`,
      exerciseId,
    );
    if (rows.length === 0) return null;
    let best = 0;
    for (const r of rows) {
      const e1rm = calculateEstimated1RM(r.weight, r.reps, r.rpe);
      if (e1rm > best) best = e1rm;
    }
    return best > 0 ? best : null;
  });
}

/** Row for freshness-weighted 1RM queries — includes workout date */
interface PRSetWithDateRow extends PRSetRow {
  finished_at: string;
}

/**
 * Get the freshness-weighted "current" estimated 1RM for an exercise.
 * Recent sets contribute more than old sets via exponential decay (6-week half-life).
 * Returns the best decay-weighted e1RM, reflecting current capacity rather than all-time peak.
 */
export function getCurrentE1RM(exerciseId: string): Promise<number | null> {
  return withDb('getCurrentE1RM', async (database) => {
    const rows = await database.getAllAsync<PRSetWithDateRow>(
      `SELECT ws.exercise_id, ws.weight, ws.reps, ws.rpe, w.finished_at
       FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE w.finished_at IS NOT NULL
         AND ws.exercise_id = ?
         AND ws.is_completed = 1
         AND ws.weight IS NOT NULL AND ws.weight > 0
         AND ws.reps IS NOT NULL AND ws.reps > 0`,
      exerciseId,
    );
    if (rows.length === 0) return null;

    const now = Date.now();
    let best = 0;
    for (const r of rows) {
      const e1rm = calculateEstimated1RM(r.weight, r.reps, r.rpe);
      const daysAgo = (now - new Date(r.finished_at).getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-0.693 * daysAgo / FRESHNESS_HALF_LIFE_DAYS);
      const weighted = e1rm * decayFactor;
      if (weighted > best) best = weighted;
    }
    return best > 0 ? best : null;
  });
}

/**
 * Get the best estimated 1RM with confidence metadata for an exercise.
 * Returns the highest e1RM result with its confidence tier and margin.
 */
export function getE1RMWithConfidence(exerciseId: string): Promise<E1RMResult | null> {
  return withDb('getE1RMWithConfidence', async (database) => {
    const rows = await database.getAllAsync<PRSetRow>(
      `SELECT ws.exercise_id, ws.weight, ws.reps, ws.rpe
       FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE w.finished_at IS NOT NULL
         AND ws.exercise_id = ?
         AND ws.is_completed = 1
         AND ws.weight IS NOT NULL AND ws.weight > 0
         AND ws.reps IS NOT NULL AND ws.reps > 0`,
      exerciseId,
    );
    if (rows.length === 0) return null;

    let bestResult: E1RMResult | null = null;
    for (const r of rows) {
      const result = calculateE1RM(r.weight, r.reps, r.rpe);
      if (!bestResult || result.value > bestResult.value) {
        bestResult = result;
      }
    }
    return bestResult && bestResult.value > 0 ? bestResult : null;
  });
}

// ─── Clear Upcoming Workout ───

export function clearLocalUpcomingWorkout(): Promise<void> {
  return withDb('clearLocalUpcomingWorkout', async (database) => {
    await database.withTransactionAsync(async () => {
      await database.runAsync('DELETE FROM upcoming_workout_sets');
      await database.runAsync('DELETE FROM upcoming_workout_exercises');
      await database.runAsync('DELETE FROM upcoming_workouts');
    });
  });
}

// ─── Clear All ───

export function clearAllLocalData(): Promise<void> {
  return withDb('clearAllLocalData', async (database) => {
    await database.runAsync('DELETE FROM upcoming_workout_sets');
    await database.runAsync('DELETE FROM upcoming_workout_exercises');
    await database.runAsync('DELETE FROM upcoming_workouts');
    await database.runAsync('DELETE FROM workout_sets');
    await database.runAsync('DELETE FROM workouts');
    await database.runAsync('DELETE FROM template_exercises');
    await database.runAsync('DELETE FROM templates');
    await database.runAsync('DELETE FROM user_exercise_notes');
    await database.runAsync('DELETE FROM exercises');
  });
}

// ─── Migration: Exercise Notes to User Table ───

/** One-time migration: copy notes from legacy exercises columns to user_exercise_notes.
 *  Must be called after auth provides a real userId. Idempotent via INSERT OR IGNORE. */
export function migrateExerciseNotesToUserTable(userId: string): Promise<void> {
  return withDb('migrateExerciseNotesToUserTable', async (database) => {
    await database.runAsync(`
      INSERT OR IGNORE INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
      SELECT ?, id, notes, form_notes, machine_notes FROM exercises
      WHERE (notes IS NOT NULL OR form_notes IS NOT NULL OR machine_notes IS NOT NULL)
    `, userId);
  });
}
