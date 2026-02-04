import * as SQLite from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import uuid from '../utils/uuid';
import type {
  Exercise, Template, TemplateExercise, Workout, WorkoutSet,
  ExerciseType, TrainingGoal, SetTag,
  UpcomingWorkout, UpcomingWorkoutExercise, UpcomingWorkoutSet,
} from '../types/database';

// ─── Helpers ───

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function parseExercise(r: any): Exercise {
  return {
    ...r,
    muscle_groups: safeJsonParse(r.muscle_groups, []),
  };
}

let db: SQLite.SQLiteDatabase;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      db = await SQLite.openDatabaseAsync('workout-enhanced.db');
      await initSchema(db);
      return db;
    })();
  }
  return dbInitPromise;
}

async function initSchema(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
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
      ai_summary TEXT,
      notes TEXT,
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
  `);

  // Migration: drop columns that may exist from older schema
  await database.runAsync('ALTER TABLE template_exercises DROP COLUMN default_reps').catch(() => {});
  await database.runAsync('ALTER TABLE template_exercises DROP COLUMN default_weight').catch(() => {});
  await database.runAsync('ALTER TABLE template_exercises ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 150').catch(() => {});
}

// ─── Exercises ───

export async function getExerciseById(id: string): Promise<Exercise | null> {
  try {
    const database = await getDb();
    const rows = await database.getAllAsync('SELECT * FROM exercises WHERE id = ?', id) as any[];
    if (rows.length === 0) return null;
    return parseExercise(rows[0]);
  } catch (error) {
    console.error('getExerciseById error:', error);
    Sentry.captureException(error);
    throw error;
  }
}

export async function getAllExercises(): Promise<Exercise[]> {
  try {
    const database = await getDb();
    const rows = await database.getAllAsync<any>('SELECT * FROM exercises ORDER BY name');
    return rows.map(parseExercise);
  } catch (error) {
    console.error('getAllExercises error:', error);
    Sentry.captureException(error);
    throw error;
  }
}

export async function createExercise(e: Omit<Exercise, 'id' | 'user_id' | 'created_at'>): Promise<Exercise> {
  try {
    const database = await getDb();
    const id = uuid();
    const now = new Date().toISOString();
    await database.runAsync(
      'INSERT INTO exercises (id, name, type, muscle_groups, training_goal, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, e.name, e.type, JSON.stringify(e.muscle_groups), e.training_goal, e.description, now,
    );
    return { id, user_id: 'local', name: e.name, type: e.type, muscle_groups: e.muscle_groups, training_goal: e.training_goal, description: e.description, created_at: now };
  } catch (error) {
    console.error('createExercise error:', error);
    Sentry.captureException(error);
    throw error;
  }
}

export async function deleteExercise(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM exercises WHERE id = ?', id);
}

// ─── Templates ───

export async function getAllTemplates(): Promise<Template[]> {
  const database = await getDb();
  return database.getAllAsync<Template>('SELECT * FROM templates ORDER BY updated_at DESC');
}

export async function createTemplate(name: string): Promise<Template> {
  const database = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  await database.runAsync('INSERT INTO templates (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', id, name, now, now);
  return { id, user_id: 'local', name, created_at: now, updated_at: now };
}

export async function updateTemplate(id: string, name: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE templates SET name = ?, updated_at = datetime(\'now\') WHERE id = ?', name, id);
}

export async function deleteTemplate(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM template_exercises WHERE template_id = ?', id);
  await database.runAsync('DELETE FROM templates WHERE id = ?', id);
}

// ─── Template Exercises ───

export async function getTemplateExercises(templateId: string): Promise<TemplateExercise[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(
    `SELECT te.*, e.name as exercise_name, e.type as exercise_type, e.muscle_groups as exercise_muscle_groups, e.training_goal as exercise_training_goal, e.description as exercise_description, e.created_at as exercise_created_at
     FROM template_exercises te
     JOIN exercises e ON te.exercise_id = e.id
     WHERE te.template_id = ?
     ORDER BY te.sort_order`,
    templateId,
  );
  return rows.map((r: any) => ({
    id: r.id,
    template_id: r.template_id,
    exercise_id: r.exercise_id,
    order: r.sort_order,
    default_sets: r.default_sets,
    rest_seconds: r.rest_seconds ?? 150,
    exercise: {
      id: r.exercise_id,
      user_id: 'local',
      name: r.exercise_name,
      type: r.exercise_type as ExerciseType,
      muscle_groups: safeJsonParse(r.exercise_muscle_groups, []),
      training_goal: r.exercise_training_goal as TrainingGoal,
      description: r.exercise_description,
      created_at: r.exercise_created_at,
    },
  }));
}

export async function getTemplateExerciseCount(templateId: string): Promise<number> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>('SELECT COUNT(*) as count FROM template_exercises WHERE template_id = ?', templateId);
  return rows[0]?.count ?? 0;
}

export async function addExerciseToTemplate(templateId: string, exerciseId: string, defaults?: { sets?: number; rest_seconds?: number }): Promise<TemplateExercise> {
  const database = await getDb();
  const id = uuid();
  const existing = await database.getAllAsync<any>('SELECT MAX(sort_order) as max_order FROM template_exercises WHERE template_id = ?', templateId);
  const order = (existing[0]?.max_order ?? -1) + 1;
  const restSec = defaults?.rest_seconds ?? 150;
  await database.runAsync(
    'INSERT INTO template_exercises (id, template_id, exercise_id, sort_order, default_sets, rest_seconds) VALUES (?, ?, ?, ?, ?, ?)',
    id, templateId, exerciseId, order, defaults?.sets ?? 3, restSec,
  );
  return { id, template_id: templateId, exercise_id: exerciseId, order, default_sets: defaults?.sets ?? 3, rest_seconds: restSec };
}

export async function removeExerciseFromTemplate(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM template_exercises WHERE id = ?', id);
}

export async function updateTemplateExerciseDefaults(id: string, defaults: { sets?: number; rest_seconds?: number }): Promise<void> {
  const database = await getDb();
  const parts: string[] = [];
  const values: any[] = [];
  if (defaults.sets !== undefined) { parts.push('default_sets = ?'); values.push(defaults.sets); }
  if (defaults.rest_seconds !== undefined) { parts.push('rest_seconds = ?'); values.push(defaults.rest_seconds); }
  if (parts.length === 0) return;
  values.push(id);
  await database.runAsync(`UPDATE template_exercises SET ${parts.join(', ')} WHERE id = ?`, ...values);
}

// ─── Workouts ───

export async function startWorkout(templateId: string | null): Promise<Workout> {
  const database = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  await database.runAsync('INSERT INTO workouts (id, template_id, started_at) VALUES (?, ?, ?)', id, templateId, now);
  return { id, user_id: 'local', template_id: templateId, started_at: now, finished_at: null, ai_summary: null, notes: null };
}

export async function finishWorkout(id: string, summary?: string, notes?: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE workouts SET finished_at = datetime(\'now\'), ai_summary = ?, notes = ? WHERE id = ?', summary ?? null, notes ?? null, id);
}

export async function getWorkoutHistory(): Promise<Workout[]> {
  try {
    const database = await getDb();
    const rows = await database.getAllAsync<any>(
      `SELECT w.*, t.name as template_name FROM workouts w LEFT JOIN templates t ON w.template_id = t.id WHERE w.finished_at IS NOT NULL ORDER BY w.started_at DESC`
    );
    return rows;
  } catch (error) {
    console.error('getWorkoutHistory error:', error);
    Sentry.captureException(error);
    throw error;
  }
}

export async function getActiveWorkout(): Promise<Workout | null> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(
    'SELECT w.*, t.name as template_name FROM workouts w LEFT JOIN templates t ON w.template_id = t.id WHERE w.finished_at IS NULL ORDER BY w.started_at DESC LIMIT 1'
  );
  return rows[0] ?? null;
}

export async function deleteWorkout(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM workout_sets WHERE workout_id = ?', id);
  await database.runAsync('DELETE FROM workouts WHERE id = ?', id);
}

// ─── Workout Sets ───

export async function getWorkoutSets(workoutId: string): Promise<WorkoutSet[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(
    'SELECT * FROM workout_sets WHERE workout_id = ? ORDER BY exercise_id, set_number',
    workoutId,
  );
  return rows.map((r: any) => ({ ...r, is_completed: !!r.is_completed, tag: r.tag as SetTag }));
}

export async function addWorkoutSet(set: Omit<WorkoutSet, 'id'>): Promise<WorkoutSet> {
  const database = await getDb();
  const id = uuid();
  await database.runAsync(
    'INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe, is_completed, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, set.workout_id, set.exercise_id, set.set_number, set.reps, set.weight, set.tag, set.rpe, set.is_completed ? 1 : 0, set.notes,
  );
  return { id, ...set };
}

export async function updateWorkoutSet(id: string, updates: Partial<WorkoutSet>): Promise<void> {
  const database = await getDb();
  const parts: string[] = [];
  const values: any[] = [];
  if (updates.reps !== undefined) { parts.push('reps = ?'); values.push(updates.reps); }
  if (updates.weight !== undefined) { parts.push('weight = ?'); values.push(updates.weight); }
  if (updates.tag !== undefined) { parts.push('tag = ?'); values.push(updates.tag); }
  if (updates.rpe !== undefined) { parts.push('rpe = ?'); values.push(updates.rpe); }
  if (updates.is_completed !== undefined) { parts.push('is_completed = ?'); values.push(updates.is_completed ? 1 : 0); }
  if (updates.notes !== undefined) { parts.push('notes = ?'); values.push(updates.notes); }
  if (parts.length === 0) return;
  values.push(id);
  await database.runAsync(`UPDATE workout_sets SET ${parts.join(', ')} WHERE id = ?`, ...values);
}

export async function deleteWorkoutSet(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM workout_sets WHERE id = ?', id);
}

export async function getExerciseHistory(exerciseId: string, limit = 5): Promise<{ workout: Workout; sets: WorkoutSet[] }[]> {
  const database = await getDb();

  // Get workout IDs first (needed for LIMIT on workouts, not sets)
  const workoutIds = await database.getAllAsync<any>(
    `SELECT DISTINCT w.id FROM workouts w
     INNER JOIN workout_sets ws ON ws.workout_id = w.id
     WHERE ws.exercise_id = ? AND w.finished_at IS NOT NULL
     ORDER BY w.started_at DESC
     LIMIT ?`,
    exerciseId, limit,
  );

  if (workoutIds.length === 0) return [];

  const ids = workoutIds.map((w: any) => w.id);
  const placeholders = ids.map(() => '?').join(',');

  // Single JOIN query for workouts and sets
  const rows = await database.getAllAsync<any>(
    `SELECT
       w.id as w_id, w.user_id as w_user_id, w.template_id as w_template_id,
       w.started_at as w_started_at, w.finished_at as w_finished_at,
       w.ai_summary as w_ai_summary, w.notes as w_notes,
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
          started_at: r.w_started_at,
          finished_at: r.w_finished_at,
          ai_summary: r.w_ai_summary,
          notes: r.w_notes,
        },
        sets: [],
      });
    }

    workoutMap.get(r.w_id)!.sets.push({
      id: r.s_id,
      workout_id: r.s_workout_id,
      exercise_id: r.s_exercise_id,
      set_number: r.s_set_number,
      reps: r.s_reps,
      weight: r.s_weight,
      tag: r.s_tag as SetTag,
      rpe: r.s_rpe,
      is_completed: !!r.s_is_completed,
      notes: r.s_notes,
    });
  }

  // Return in same order as workout IDs (most recent first)
  return ids.map(id => workoutMap.get(id)!).filter(Boolean);
}

// ─── PRs This Week ───

export async function getPRsThisWeek(): Promise<number> {
  const database = await getDb();
  const now = new Date();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = weekStart.toISOString();

  // Get this week's sets
  const weekSets = await database.getAllAsync<any>(
    `SELECT ws.exercise_id, ws.weight, ws.reps
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

  const exerciseIds = Array.from(new Set(weekSets.map((s: any) => s.exercise_id)));

  // Get all prior sets in a single query (only for exercises that have sets this week)
  const placeholders = exerciseIds.map(() => '?').join(',');
  const priorSets = await database.getAllAsync<any>(
    `SELECT ws.exercise_id, ws.weight, ws.reps
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
    const e1rm = s.weight * (1 + s.reps / 30);
    const current = priorBestByExercise.get(s.exercise_id) ?? 0;
    if (e1rm > current) {
      priorBestByExercise.set(s.exercise_id, e1rm);
    }
  }

  // Calculate week best for each exercise and count PRs
  let prCount = 0;
  for (const exId of exerciseIds) {
    const weekBest = weekSets
      .filter((s: any) => s.exercise_id === exId)
      .reduce((max: number, s: any) => {
        const e1rm = s.weight * (1 + s.reps / 30);
        return e1rm > max ? e1rm : max;
      }, 0);

    const priorBest = priorBestByExercise.get(exId) ?? 0;

    if (weekBest > priorBest && priorBest > 0) {
      prCount++;
    }
  }

  return prCount;
}

// ─── Upcoming Workouts ───

export async function getUpcomingWorkoutForToday(): Promise<{
  workout: UpcomingWorkout;
  exercises: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[];
} | null> {
  const database = await getDb();
  const today = new Date().toISOString().slice(0, 10);

  const workouts = await database.getAllAsync<any>(
    'SELECT * FROM upcoming_workouts WHERE date = ? ORDER BY created_at DESC LIMIT 1',
    today,
  );
  if (workouts.length === 0) return null;

  const workout: UpcomingWorkout = workouts[0];

  const exerciseRows = await database.getAllAsync<any>(
    `SELECT ue.*, e.id as e_id, e.user_id as e_user_id, e.name as e_name, e.type as e_type,
            e.muscle_groups as e_muscle_groups, e.training_goal as e_training_goal,
            e.description as e_description, e.created_at as e_created_at
     FROM upcoming_workout_exercises ue
     JOIN exercises e ON ue.exercise_id = e.id
     WHERE ue.upcoming_workout_id = ?
     ORDER BY ue.sort_order`,
    workout.id,
  );

  const exercises: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] = [];

  for (const r of exerciseRows) {
    const sets = await database.getAllAsync<UpcomingWorkoutSet>(
      'SELECT * FROM upcoming_workout_sets WHERE upcoming_exercise_id = ? ORDER BY set_number',
      r.id,
    );

    exercises.push({
      id: r.id,
      upcoming_workout_id: r.upcoming_workout_id,
      exercise_id: r.exercise_id,
      order: r.sort_order,
      rest_seconds: r.rest_seconds,
      notes: r.notes,
      exercise: {
        id: r.e_id,
        user_id: r.e_user_id,
        name: r.e_name,
        type: r.e_type as ExerciseType,
        muscle_groups: safeJsonParse(r.e_muscle_groups, []),
        training_goal: r.e_training_goal as TrainingGoal,
        description: r.e_description,
        created_at: r.e_created_at,
      },
      sets,
    });
  }

  return { workout, exercises };
}

// ─── Clear All ───

export async function clearAllLocalData(): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM upcoming_workout_sets');
  await database.runAsync('DELETE FROM upcoming_workout_exercises');
  await database.runAsync('DELETE FROM upcoming_workouts');
  await database.runAsync('DELETE FROM workout_sets');
  await database.runAsync('DELETE FROM workouts');
  await database.runAsync('DELETE FROM template_exercises');
  await database.runAsync('DELETE FROM templates');
  await database.runAsync('DELETE FROM exercises');
}
