import * as SQLite from 'expo-sqlite';
import uuid from '../utils/uuid';
import type {
  Exercise, Template, TemplateExercise, Workout, WorkoutSet,
  ExerciseType, TrainingGoal, SetTag,
} from '../types/database';

let db: SQLite.SQLiteDatabase;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('workout-enhanced.db');
    await initSchema(db);
  }
  return db;
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
      default_reps INTEGER NOT NULL DEFAULT 10,
      default_weight REAL NOT NULL DEFAULT 0,
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
  `);
}

// ─── Exercises ───

export async function getExerciseById(id: string): Promise<Exercise | null> {
  const database = await getDb();
  const rows = await database.getAllAsync('SELECT * FROM exercises WHERE id = ?', id) as any[];
  if (rows.length === 0) return null;
  return parseExercise(rows[0]);
}

export async function getAllExercises(): Promise<Exercise[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>('SELECT * FROM exercises ORDER BY name');
  return rows.map(parseExercise);
}

export async function createExercise(e: Omit<Exercise, 'id' | 'user_id' | 'created_at'>): Promise<Exercise> {
  const database = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  await database.runAsync(
    'INSERT INTO exercises (id, name, type, muscle_groups, training_goal, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, e.name, e.type, JSON.stringify(e.muscle_groups), e.training_goal, e.description, now,
  );
  return { id, user_id: 'local', name: e.name, type: e.type, muscle_groups: e.muscle_groups, training_goal: e.training_goal, description: e.description, created_at: now };
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
    default_reps: r.default_reps,
    default_weight: r.default_weight,
    exercise: {
      id: r.exercise_id,
      user_id: 'local',
      name: r.exercise_name,
      type: r.exercise_type as ExerciseType,
      muscle_groups: JSON.parse(r.exercise_muscle_groups || '[]'),
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

export async function addExerciseToTemplate(templateId: string, exerciseId: string, defaults?: { sets?: number; reps?: number; weight?: number }): Promise<TemplateExercise> {
  const database = await getDb();
  const id = uuid();
  const existing = await database.getAllAsync<any>('SELECT MAX(sort_order) as max_order FROM template_exercises WHERE template_id = ?', templateId);
  const order = (existing[0]?.max_order ?? -1) + 1;
  await database.runAsync(
    'INSERT INTO template_exercises (id, template_id, exercise_id, sort_order, default_sets, default_reps, default_weight) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, templateId, exerciseId, order, defaults?.sets ?? 3, defaults?.reps ?? 10, defaults?.weight ?? 0,
  );
  return { id, template_id: templateId, exercise_id: exerciseId, order, default_sets: defaults?.sets ?? 3, default_reps: defaults?.reps ?? 10, default_weight: defaults?.weight ?? 0 };
}

export async function removeExerciseFromTemplate(id: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM template_exercises WHERE id = ?', id);
}

export async function updateTemplateExerciseDefaults(id: string, defaults: { sets?: number; reps?: number; weight?: number }): Promise<void> {
  const database = await getDb();
  const parts: string[] = [];
  const values: any[] = [];
  if (defaults.sets !== undefined) { parts.push('default_sets = ?'); values.push(defaults.sets); }
  if (defaults.reps !== undefined) { parts.push('default_reps = ?'); values.push(defaults.reps); }
  if (defaults.weight !== undefined) { parts.push('default_weight = ?'); values.push(defaults.weight); }
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
  const database = await getDb();
  const rows = await database.getAllAsync<any>(
    `SELECT w.*, t.name as template_name FROM workouts w LEFT JOIN templates t ON w.template_id = t.id WHERE w.finished_at IS NOT NULL ORDER BY w.started_at DESC`
  );
  return rows.map((r: any) => ({ ...r, template_name: r.template_name }));
}

export async function getActiveWorkout(): Promise<Workout | null> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>('SELECT * FROM workouts WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1');
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
  const workouts = await database.getAllAsync<any>(
    `SELECT w.* FROM workouts w
     INNER JOIN workout_sets ws ON ws.workout_id = w.id
     WHERE ws.exercise_id = ? AND w.finished_at IS NOT NULL
     GROUP BY w.id
     ORDER BY w.started_at DESC
     LIMIT ?`,
    exerciseId, limit,
  );
  const result: { workout: Workout; sets: WorkoutSet[] }[] = [];
  for (const w of workouts) {
    const sets = await database.getAllAsync<any>(
      'SELECT * FROM workout_sets WHERE workout_id = ? AND exercise_id = ? ORDER BY set_number',
      w.id, exerciseId,
    );
    result.push({ workout: w, sets: sets.map((s: any) => ({ ...s, is_completed: !!s.is_completed, tag: s.tag as SetTag })) });
  }
  return result;
}

// ─── Helpers ───

function parseExercise(r: any): Exercise {
  return {
    ...r,
    muscle_groups: JSON.parse(r.muscle_groups || '[]'),
  };
}
