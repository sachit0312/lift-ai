import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';
import { getDb } from './database';

// ─── Row Interfaces (raw SQLite rows for sync queries) ───

/** Exercise row for sync — subset of columns selected */
interface SyncExerciseRow {
  id: string;
  name: string;
  type: string;
  muscle_groups: string;
  training_goal: string;
  description: string;
}

/** Template row for sync — subset of columns selected */
interface SyncTemplateRow {
  id: string;
  name: string;
}

/** Template exercise row for sync — subset of columns selected */
interface SyncTemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  sort_order: number;
  default_sets: number;
}

/** Workout row for sync — subset of columns selected */
interface SyncWorkoutRow {
  id: string;
  template_id: string | null;
  started_at: string;
  finished_at: string | null;
  ai_summary: string | null;
  notes: string | null;
}

/** Workout set row for sync — is_completed is 0/1 integer in SQLite */
interface SyncWorkoutSetRow {
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
}

export async function syncToSupabase(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const db = await getDb();

    // Exercises — select specific columns, parse muscle_groups
    const exercises = await db.getAllAsync<SyncExerciseRow>('SELECT id, name, type, muscle_groups, training_goal, description FROM exercises');
    if (exercises.length > 0) {
      const parsed = exercises.map((e: SyncExerciseRow) => ({
        id: e.id,
        user_id: session.user.id,
        name: e.name,
        type: e.type,
        muscle_groups: JSON.parse(e.muscle_groups || '[]'),
        training_goal: e.training_goal,
        description: e.description,
      }));
      const { error } = await supabase.from('exercises').upsert(parsed, { onConflict: 'id' });
      if (error) { console.error('Sync exercises error:', error); Sentry.captureException(error); return; }
    }

    // Templates — select specific columns
    const templates = await db.getAllAsync<SyncTemplateRow>('SELECT id, name FROM templates');
    if (templates.length > 0) {
      const mapped = templates.map((t: SyncTemplateRow) => ({ ...t, user_id: session.user.id }));
      const { error } = await supabase.from('templates').upsert(mapped, { onConflict: 'id' });
      if (error) { console.error('Sync templates error:', error); Sentry.captureException(error); return; }
    }

    // Template exercises — select specific columns
    const templateExercises = await db.getAllAsync<SyncTemplateExerciseRow>('SELECT id, template_id, exercise_id, sort_order, default_sets FROM template_exercises');
    if (templateExercises.length > 0) {
      const { error } = await supabase.from('template_exercises').upsert(templateExercises, { onConflict: 'id' });
      if (error) { console.error('Sync template_exercises error:', error); Sentry.captureException(error); return; }
    }

    // Workouts (only finished) — select specific columns
    const workouts = await db.getAllAsync<SyncWorkoutRow>('SELECT id, template_id, started_at, finished_at, ai_summary, notes FROM workouts WHERE finished_at IS NOT NULL');
    if (workouts.length > 0) {
      const mappedWorkouts = workouts.map((w: SyncWorkoutRow) => ({ ...w, user_id: session.user.id }));
      const { error } = await supabase.from('workouts').upsert(mappedWorkouts, { onConflict: 'id' });
      if (error) { console.error('Sync workouts error:', error); Sentry.captureException(error); return; }
    }

    // Workout sets — only for finished workouts, convert is_completed to boolean
    const workoutSets = await db.getAllAsync<SyncWorkoutSetRow>(
      `SELECT ws.id, ws.workout_id, ws.exercise_id, ws.set_number, ws.reps, ws.weight, ws.tag, ws.rpe, ws.notes, ws.is_completed
       FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE w.finished_at IS NOT NULL`
    );
    if (workoutSets.length > 0) {
      const mapped = workoutSets.map((s: SyncWorkoutSetRow) => ({
        ...s,
        is_completed: !!s.is_completed,
      }));
      const { error } = await supabase.from('workout_sets').upsert(mapped, { onConflict: 'id' });
      if (error) { console.error('Sync workout_sets error:', error); Sentry.captureException(error); return; }
    }

    console.log('Sync to Supabase complete');
  } catch (err) {
    console.error('syncToSupabase failed:', err);
    Sentry.captureException(err);
  }
}

// ─── Pull Row Interfaces (Supabase → local SQLite) ───

/** Exercise row from Supabase (muscle_groups is JSONB array) */
interface PullExerciseRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  muscle_groups: string[];
  training_goal: string;
  description: string;
  created_at: string;
}

/** Template row from Supabase */
interface PullTemplateRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** Template exercise row from Supabase */
interface PullTemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  sort_order: number;
  default_sets: number;
}

// ─── Pull Exercises & Templates from Supabase ───

async function pullExercises(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const db = await getDb();

  const { data: exercises, error } = await supabase
    .from('exercises')
    .select('*')
    .eq('user_id', session.user.id);

  if (error) {
    console.error('Pull exercises error:', error);
    Sentry.captureException(error);
    return;
  }
  if (!exercises || exercises.length === 0) return;

  for (const ex of exercises as PullExerciseRow[]) {
    await db.runAsync(
      `INSERT INTO exercises (id, user_id, name, type, muscle_groups, training_goal, description, created_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT notes FROM exercises WHERE id = ?))
       ON CONFLICT(id) DO UPDATE SET
         user_id=excluded.user_id, name=excluded.name, type=excluded.type,
         muscle_groups=excluded.muscle_groups, training_goal=excluded.training_goal,
         description=excluded.description, created_at=excluded.created_at`,
      ex.id, ex.user_id, ex.name, ex.type,
      JSON.stringify(ex.muscle_groups ?? []),
      ex.training_goal, ex.description, ex.created_at, ex.id,
    );
  }

  console.log('Pull exercises complete');
}

async function pullTemplates(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const db = await getDb();

  const { data: templates, error: tErr } = await supabase
    .from('templates')
    .select('*')
    .eq('user_id', session.user.id);

  if (tErr) {
    console.error('Pull templates error:', tErr);
    Sentry.captureException(tErr);
    return;
  }
  if (!templates || templates.length === 0) return;

  for (const t of templates as PullTemplateRow[]) {
    await db.runAsync(
      `INSERT INTO templates (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, name=excluded.name, updated_at=excluded.updated_at`,
      t.id, t.user_id, t.name, t.created_at, t.updated_at,
    );

    // Fetch template_exercises for this template
    const { data: templateExercises, error: teErr } = await supabase
      .from('template_exercises')
      .select('*')
      .eq('template_id', t.id)
      .order('sort_order');

    if (teErr) {
      console.error(`Pull template_exercises error for template ${t.id}:`, teErr);
      Sentry.captureException(teErr);
      continue;
    }

    const teList = (templateExercises ?? []) as PullTemplateExerciseRow[];

    // Delete template_exercises removed by MCP
    if (teList.length > 0) {
      const placeholders = teList.map(() => '?').join(', ');
      await db.runAsync(
        `DELETE FROM template_exercises WHERE template_id = ? AND id NOT IN (${placeholders})`,
        t.id, ...teList.map(te => te.id),
      );
    } else {
      // If MCP removed all exercises from this template, delete them all locally
      await db.runAsync('DELETE FROM template_exercises WHERE template_id = ?', t.id);
    }

    // Upsert each template_exercise, preserving local rest_seconds and target_rpe
    for (const te of teList) {
      await db.runAsync(
        `INSERT INTO template_exercises (id, template_id, exercise_id, sort_order, default_sets, rest_seconds, target_rpe)
         VALUES (?, ?, ?, ?, ?, COALESCE((SELECT rest_seconds FROM template_exercises WHERE id = ?), 150), COALESCE((SELECT target_rpe FROM template_exercises WHERE id = ?), NULL))
         ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order, default_sets=excluded.default_sets`,
        te.id, te.template_id, te.exercise_id, te.sort_order, te.default_sets, te.id, te.id,
      );
    }
  }

  console.log('Pull templates complete');
}

export async function pullExercisesAndTemplates(): Promise<void> {
  try {
    await pullExercises();   // exercises first (FK dependency)
    await pullTemplates();
  } catch (err) {
    console.error('pullExercisesAndTemplates failed:', err);
    Sentry.captureException(err);
  }
}

// ─── Pull Workout History from Supabase ───

/** Finished workout row from Supabase */
interface PullWorkoutRow {
  id: string;
  user_id: string;
  template_id: string | null;
  started_at: string;
  finished_at: string;
  ai_summary: string | null;
  notes: string | null;
}

/** Workout set row from Supabase (is_completed is boolean in Supabase) */
interface PullWorkoutSetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  tag: string;
  rpe: number | null;
  is_completed: boolean;
  notes: string | null;
}

export async function pullWorkoutHistory(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const db = await getDb();

    // Fetch finished workouts from Supabase
    const { data: workouts, error: wErr } = await supabase
      .from('workouts')
      .select('*')
      .eq('user_id', session.user.id)
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(200);

    if (wErr) {
      console.error('Pull workouts error:', wErr);
      Sentry.captureException(wErr);
      return;
    }
    if (!workouts || workouts.length === 0) return;

    // Upsert workouts into local SQLite
    for (const w of workouts as PullWorkoutRow[]) {
      await db.runAsync(
        `INSERT INTO workouts (id, user_id, template_id, started_at, finished_at, ai_summary, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id=excluded.user_id, template_id=excluded.template_id,
           started_at=excluded.started_at, finished_at=excluded.finished_at,
           ai_summary=excluded.ai_summary, notes=excluded.notes`,
        w.id, w.user_id, w.template_id, w.started_at, w.finished_at, w.ai_summary, w.notes,
      );
    }

    // Fetch workout_sets for those workouts
    const workoutIds = (workouts as PullWorkoutRow[]).map(w => w.id);
    const { data: sets, error: sErr } = await supabase
      .from('workout_sets')
      .select('*')
      .in('workout_id', workoutIds);

    if (sErr) {
      console.error('Pull workout_sets error:', sErr);
      Sentry.captureException(sErr);
      return;
    }

    for (const s of (sets ?? []) as PullWorkoutSetRow[]) {
      await db.runAsync(
        `INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe, is_completed, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workout_id=excluded.workout_id, exercise_id=excluded.exercise_id,
           set_number=excluded.set_number, reps=excluded.reps, weight=excluded.weight,
           tag=excluded.tag, rpe=excluded.rpe, is_completed=excluded.is_completed, notes=excluded.notes`,
        s.id, s.workout_id, s.exercise_id, s.set_number, s.reps, s.weight, s.tag, s.rpe, s.is_completed ? 1 : 0, s.notes,
      );
    }

    console.log('Pull workout history complete');
  } catch (err) {
    console.error('pullWorkoutHistory failed:', err);
    Sentry.captureException(err);
  }
}

export async function pullUpcomingWorkout(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const db = await getDb();

    // Fetch latest upcoming workout from Supabase
    const { data: workouts, error: wErr } = await supabase
      .from('upcoming_workouts')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (wErr) {
      console.error('Pull upcoming_workouts error:', wErr);
      Sentry.captureException(wErr);
      return;
    }
    if (!workouts || workouts.length === 0) return;

    const workout = workouts[0];

    // Clear local upcoming tables (child tables first)
    await db.runAsync('DELETE FROM upcoming_workout_sets');
    await db.runAsync('DELETE FROM upcoming_workout_exercises');
    await db.runAsync('DELETE FROM upcoming_workouts');

    // Insert upcoming workout
    await db.runAsync(
      'INSERT INTO upcoming_workouts (id, date, template_id, notes, created_at) VALUES (?, ?, ?, ?, ?)',
      workout.id, workout.date, workout.template_id, workout.notes, workout.created_at,
    );

    // Fetch exercises for this workout
    const { data: exercises, error: eErr } = await supabase
      .from('upcoming_workout_exercises')
      .select('*')
      .eq('upcoming_workout_id', workout.id)
      .order('sort_order');

    if (eErr) {
      console.error('Pull upcoming_workout_exercises error:', eErr);
      Sentry.captureException(eErr);
      return;
    }

    for (const ex of exercises ?? []) {
      await db.runAsync(
        'INSERT INTO upcoming_workout_exercises (id, upcoming_workout_id, exercise_id, sort_order, rest_seconds, notes) VALUES (?, ?, ?, ?, ?, ?)',
        ex.id, ex.upcoming_workout_id, ex.exercise_id, ex.sort_order, ex.rest_seconds, ex.notes,
      );

      // Fetch sets for this exercise
      const { data: sets, error: sErr } = await supabase
        .from('upcoming_workout_sets')
        .select('*')
        .eq('upcoming_exercise_id', ex.id)
        .order('set_number');

      if (sErr) {
        console.error('Pull upcoming_workout_sets error:', sErr);
        Sentry.captureException(sErr);
        continue;
      }

      for (const s of sets ?? []) {
        await db.runAsync(
          'INSERT INTO upcoming_workout_sets (id, upcoming_exercise_id, set_number, target_weight, target_reps, target_rpe) VALUES (?, ?, ?, ?, ?, ?)',
          s.id, s.upcoming_exercise_id, s.set_number, s.target_weight, s.target_reps, s.target_rpe ?? null,
        );
      }
    }

    console.log('Pull upcoming workout complete');
  } catch (err) {
    console.error('pullUpcomingWorkout failed:', err);
    Sentry.captureException(err);
  }
}
