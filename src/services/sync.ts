import * as Sentry from '@sentry/react-native';
import { supabase } from './supabase';
import { getDb, clearLocalUpcomingWorkout, getCurrentUserId } from './database';

function handleSyncError(label: string, error: unknown): void {
  if (__DEV__) console.error(`Sync ${label} error:`, error);
  Sentry.captureException(error);
}

export function fireAndForgetSync(): void {
  syncToSupabase().catch(e => Sentry.addBreadcrumb({
    category: 'sync',
    message: 'syncToSupabase fire-and-forget failed',
    level: 'warning',
    data: { error: String(e) },
  }));
}

// ─── Row Interfaces (raw SQLite rows for sync queries) ───

/** Exercise row for sync — subset of columns selected */
interface SyncExerciseRow {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  muscle_groups: string;
  training_goal: string;
  description: string;
}

/** User exercise notes row for sync */
interface SyncExerciseNotesRow {
  exercise_id: string;
  notes: string | null;
  form_notes: string | null;
  machine_notes: string | null;
}

/** Template row for sync — subset of columns selected */
interface SyncTemplateRow {
  id: string;
  name: string;
}

/** Template exercise row for sync — subset of columns selected.
 *  sort_order intentionally excluded — pushed only by explicit reorder operations
 *  (drag-to-reorder, F5 template update) to prevent overwriting MCP changes. */
interface SyncTemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  default_sets: number;
  warmup_sets: number;
  rest_seconds: number;
}

/** Workout row for sync — subset of columns selected */
interface SyncWorkoutRow {
  id: string;
  template_id: string | null;
  upcoming_workout_id: string | null;
  started_at: string;
  finished_at: string | null;
  coach_notes: string | null;
  exercise_coach_notes: string | null;
  session_notes: string | null;
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
  target_weight: number | null;
  target_reps: number | null;
  target_rpe: number | null;
  exercise_order: number;
}

export async function syncToSupabase(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const db = await getDb();

    // Self-healing rescue: any rows written under the default 'local' user
    // (e.g., during a race with AuthContext propagation) get rewritten to the
    // real session user id so they're picked up by the push queries below.
    try {
      // user_exercise_notes has PRIMARY KEY (user_id, exercise_id). If a row
      // already exists for the real user id on the same exercise, the UPDATE
      // below would violate the unique constraint. Prefer the 'local' row
      // (it's the more recent user edit) by deleting any conflicting real-user
      // rows first, then renaming the local rows to the real user id.
      await db.runAsync(
        `DELETE FROM user_exercise_notes
         WHERE user_id = ?
           AND exercise_id IN (
             SELECT exercise_id FROM user_exercise_notes WHERE user_id = 'local'
           )`,
        session.user.id,
      );
      await db.runAsync(
        `UPDATE user_exercise_notes SET user_id = ? WHERE user_id = 'local'`,
        session.user.id,
      );
      // exercises.id is the sole primary key, so user_id can be rewritten freely.
      await db.runAsync(
        `UPDATE exercises SET user_id = ? WHERE user_id = 'local'`,
        session.user.id,
      );
    } catch (err) {
      handleSyncError('rescue local rows', err);
    }

    // Each sync step runs independently — one step's failure must not block others.
    // Exercises — only push custom exercises (global exercises have user_id = NULL)
    const exercises = await db.getAllAsync<SyncExerciseRow>(
      'SELECT id, user_id, name, type, muscle_groups, training_goal, description FROM exercises WHERE user_id IS NOT NULL'
    );
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
      if (error) handleSyncError('exercises', error);
    }

    // User exercise notes — push all (use session.user.id, not getCurrentUserId(), to avoid stale 'local' on token refresh)
    const noteRows = await db.getAllAsync<SyncExerciseNotesRow>(
      'SELECT exercise_id, notes, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ?',
      session.user.id,
    );
    if (noteRows.length > 0) {
      const mappedNotes = noteRows.map(n => ({
        user_id: session.user.id,
        exercise_id: n.exercise_id,
        notes: n.notes,
        form_notes: n.form_notes,
        machine_notes: n.machine_notes,
      }));
      const { error: notesErr } = await supabase.from('user_exercise_notes').upsert(mappedNotes, { onConflict: 'user_id,exercise_id' });
      if (notesErr) handleSyncError('user_exercise_notes', notesErr);
    }

    // Templates — select specific columns
    const templates = await db.getAllAsync<SyncTemplateRow>('SELECT id, name FROM templates');
    if (templates.length > 0) {
      const mapped = templates.map((t: SyncTemplateRow) => ({ ...t, user_id: session.user.id }));
      const { error } = await supabase.from('templates').upsert(mapped, { onConflict: 'id' });
      if (error) handleSyncError('templates', error);
    }

    // Template exercises — select specific columns (sort_order excluded — pushed only by explicit reorder ops)
    const templateExercises = await db.getAllAsync<SyncTemplateExerciseRow>('SELECT id, template_id, exercise_id, default_sets, warmup_sets, rest_seconds FROM template_exercises');
    if (templateExercises.length > 0) {
      const { error } = await supabase.from('template_exercises').upsert(templateExercises, { onConflict: 'id' });
      if (error) handleSyncError('template_exercises', error);
    }

    // Workouts (only finished) — select specific columns
    let workoutsOk = true;
    const workouts = await db.getAllAsync<SyncWorkoutRow>('SELECT id, template_id, upcoming_workout_id, started_at, finished_at, coach_notes, exercise_coach_notes, session_notes FROM workouts WHERE finished_at IS NOT NULL');
    if (workouts.length > 0) {
      const mappedWorkouts = workouts.map((w: SyncWorkoutRow) => ({
        ...w,
        user_id: session.user.id,
        // Nullify upcoming_workout_id — the referenced upcoming_workout is ephemeral
        // and may have been deleted by create_upcoming_workout before this sync runs,
        // which would cause an FK constraint violation on insert.
        upcoming_workout_id: null,
      }));
      const { error } = await supabase.from('workouts').upsert(mappedWorkouts, { onConflict: 'id' });
      if (error) { handleSyncError('workouts', error); workoutsOk = false; }
    }

    // Workout sets — only attempt if workouts upsert succeeded (FK dependency on workout_id)
    if (workoutsOk) {
      const workoutSets = await db.getAllAsync<SyncWorkoutSetRow>(
        `SELECT ws.id, ws.workout_id, ws.exercise_id, ws.set_number, ws.reps, ws.weight, ws.tag, ws.rpe, ws.notes, ws.is_completed, ws.target_weight, ws.target_reps, ws.target_rpe, ws.exercise_order
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
        if (error) handleSyncError('workout_sets', error);
      }
    }

    if (__DEV__) console.log('Sync to Supabase complete');
  } catch (err) {
    handleSyncError('syncToSupabase', err);
  }
}

/** Push sort_order for a specific template to Supabase.
 *  Called after explicit reorder operations (drag-to-reorder, F5 template update).
 *  Separated from general sync to prevent stale sort_order from overwriting MCP changes. */
export async function pushTemplateOrderToSupabase(templateId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const db = await getDb();
    const rows = await db.getAllAsync<{ id: string; sort_order: number }>(
      'SELECT id, sort_order FROM template_exercises WHERE template_id = ?', templateId
    );
    if (rows.length === 0) return;
    // Individual updates — only sort_order should change; other columns are managed by general sync
    const results = await Promise.all(rows.map(row =>
      supabase.from('template_exercises').update({ sort_order: row.sort_order }).eq('id', row.id)
    ));
    for (const { error } of results) {
      if (error) {
        if (__DEV__) console.error('pushTemplateOrderToSupabase row error:', error);
        Sentry.captureException(error);
      }
    }
  } catch (e) {
    if (__DEV__) console.error('pushTemplateOrderToSupabase error:', e);
    Sentry.captureException(e);
  }
}

export async function deleteTemplateFromSupabase(templateId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', templateId)
      .eq('user_id', session.user.id);

    if (error) { handleSyncError('deleteTemplate', error); }
  } catch (err) {
    handleSyncError('deleteTemplateFromSupabase', err);
  }
}

export async function deleteTemplateExerciseFromSupabase(templateExerciseId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from('template_exercises')
      .delete()
      .eq('id', templateExerciseId);

    if (error) { handleSyncError('deleteTemplateExercise', error); }
  } catch (err) {
    handleSyncError('deleteTemplateExerciseFromSupabase', err);
  }
}

export async function deleteUpcomingWorkoutFromSupabase(upcomingWorkoutId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from('upcoming_workouts')
      .delete()
      .eq('id', upcomingWorkoutId)
      .eq('user_id', session.user.id);

    if (error) { handleSyncError('deleteUpcomingWorkout', error); }
  } catch (err) {
    handleSyncError('deleteUpcomingWorkoutFromSupabase', err);
  }
}

// ─── Pull Row Interfaces (Supabase → local SQLite) ───

/** Exercise row from Supabase (muscle_groups is JSONB array) */
interface PullExerciseRow {
  id: string;
  user_id: string | null;
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

/** Template exercise row from Supabase (includes rest_seconds, warmup_sets) */
interface PullTemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  sort_order: number;
  default_sets: number;
  warmup_sets: number;
  rest_seconds: number;
}

// ─── Pull Exercises & Templates from Supabase ───

async function pullExercises(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const db = await getDb();

  const { data: exercises, error } = await supabase
    .from('exercises')
    .select('id, user_id, name, type, muscle_groups, training_goal, description, created_at');

  if (error) { handleSyncError('pull exercises', error); return; }
  if (!exercises || exercises.length === 0) return;

  for (const ex of exercises as PullExerciseRow[]) {
    await db.runAsync(
      `INSERT INTO exercises (id, user_id, name, type, muscle_groups, training_goal, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id=excluded.user_id, name=excluded.name, type=excluded.type,
         muscle_groups=excluded.muscle_groups, training_goal=excluded.training_goal,
         description=excluded.description, created_at=excluded.created_at`,
      ex.id, ex.user_id, ex.name, ex.type,
      JSON.stringify(ex.muscle_groups ?? []),
      ex.training_goal, ex.description, ex.created_at,
    );
  }

  // Pull user's exercise notes
  const { data: notes, error: notesErr } = await supabase
    .from('user_exercise_notes')
    .select('exercise_id, notes, form_notes, machine_notes')
    .eq('user_id', session.user.id);

  if (notesErr) { handleSyncError('pull exercise notes', notesErr); }
  else if (notes && notes.length > 0) {
    for (const n of notes) {
      await db.runAsync(
        `INSERT INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, exercise_id) DO UPDATE SET
           notes=excluded.notes, form_notes=excluded.form_notes, machine_notes=excluded.machine_notes`,
        session.user.id, n.exercise_id, n.notes ?? null, n.form_notes ?? null, n.machine_notes ?? null,
      );
    }
  }

  if (__DEV__) console.log('Pull exercises complete');
}

async function pullTemplates(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const db = await getDb();

  const { data: templates, error: tErr } = await supabase
    .from('templates')
    .select('*')
    .eq('user_id', session.user.id);

  if (tErr) { handleSyncError('pull templates', tErr); return; }
  if (!templates || templates.length === 0) return;

  const templateList = templates as PullTemplateRow[];
  const templateIds = templateList.map(t => t.id);

  // Upsert all templates
  for (const t of templateList) {
    await db.runAsync(
      `INSERT INTO templates (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, name=excluded.name, updated_at=excluded.updated_at`,
      t.id, t.user_id, t.name, t.created_at, t.updated_at,
    );
  }

  // Fetch all template_exercises in one query instead of per-template
  const { data: allTemplateExercises, error: teErr } = await supabase
    .from('template_exercises')
    .select('*')
    .in('template_id', templateIds)
    .order('sort_order');

  if (teErr) {
    handleSyncError('pull template_exercises', teErr);
  } else {
    // Group by template_id
    const teByTemplate = new Map<string, PullTemplateExerciseRow[]>();
    for (const te of (allTemplateExercises ?? []) as PullTemplateExerciseRow[]) {
      if (!teByTemplate.has(te.template_id)) teByTemplate.set(te.template_id, []);
      teByTemplate.get(te.template_id)!.push(te);
    }

    for (const t of templateList) {
      const teList = teByTemplate.get(t.id) ?? [];

      // Delete template_exercises removed by MCP
      if (teList.length > 0) {
        const placeholders = teList.map(() => '?').join(', ');
        await db.runAsync(
          `DELETE FROM template_exercises WHERE template_id = ? AND id NOT IN (${placeholders})`,
          t.id, ...teList.map(te => te.id),
        );
      } else {
        await db.runAsync('DELETE FROM template_exercises WHERE template_id = ?', t.id);
      }

      // Upsert each template_exercise, using Supabase rest_seconds + warmup_sets (MCP-editable)
      for (const te of teList) {
        await db.runAsync(
          `INSERT INTO template_exercises (id, template_id, exercise_id, sort_order, default_sets, warmup_sets, rest_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order, default_sets=excluded.default_sets, warmup_sets=excluded.warmup_sets, rest_seconds=excluded.rest_seconds`,
          te.id, te.template_id, te.exercise_id, te.sort_order, te.default_sets, te.warmup_sets ?? 0, te.rest_seconds ?? 150,
        );
      }
    }
  }

  if (__DEV__) console.log('Pull templates complete');
}

export async function pullExercisesAndTemplates(): Promise<void> {
  try {
    await pullExercises();   // exercises first (FK dependency)
    await pullTemplates();
  } catch (err) {
    handleSyncError('pullExercisesAndTemplates', err);
  }
}

// ─── Pull Workout History from Supabase ───

/** Finished workout row from Supabase */
interface PullWorkoutRow {
  id: string;
  user_id: string;
  template_id: string | null;
  upcoming_workout_id: string | null;
  started_at: string;
  finished_at: string;
  coach_notes: string | null;
  exercise_coach_notes: string | null;
  session_notes: string | null;
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
  target_weight: number | null;
  target_reps: number | null;
  target_rpe: number | null;
  exercise_order: number;
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

    if (wErr) { handleSyncError('pull workouts', wErr); return; }
    if (!workouts || workouts.length === 0) return;

    // Upsert workouts into local SQLite
    for (const w of workouts as PullWorkoutRow[]) {
      await db.runAsync(
        `INSERT INTO workouts (id, user_id, template_id, upcoming_workout_id, started_at, finished_at, coach_notes, exercise_coach_notes, session_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id=excluded.user_id, template_id=excluded.template_id,
           upcoming_workout_id=excluded.upcoming_workout_id,
           started_at=excluded.started_at, finished_at=excluded.finished_at,
           coach_notes=excluded.coach_notes, exercise_coach_notes=excluded.exercise_coach_notes, session_notes=excluded.session_notes`,
        w.id, w.user_id, w.template_id, w.upcoming_workout_id ?? null, w.started_at, w.finished_at, w.coach_notes, w.exercise_coach_notes, w.session_notes,
      );
    }

    // Fetch workout_sets for those workouts
    const workoutIds = (workouts as PullWorkoutRow[]).map(w => w.id);
    const { data: sets, error: sErr } = await supabase
      .from('workout_sets')
      .select('*')
      .in('workout_id', workoutIds);

    if (sErr) { handleSyncError('pull workout_sets', sErr); return; }

    for (const s of (sets ?? []) as PullWorkoutSetRow[]) {
      await db.runAsync(
        `INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe, is_completed, notes, target_weight, target_reps, target_rpe, exercise_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           workout_id=excluded.workout_id, exercise_id=excluded.exercise_id,
           set_number=excluded.set_number, reps=excluded.reps, weight=excluded.weight,
           tag=excluded.tag, rpe=excluded.rpe, is_completed=excluded.is_completed, notes=excluded.notes,
           target_weight=excluded.target_weight, target_reps=excluded.target_reps, target_rpe=excluded.target_rpe,
           exercise_order=excluded.exercise_order`,
        s.id, s.workout_id, s.exercise_id, s.set_number, s.reps, s.weight, s.tag, s.rpe, s.is_completed ? 1 : 0, s.notes,
        s.target_weight ?? null, s.target_reps ?? null, s.target_rpe ?? null, s.exercise_order ?? 0,
      );
    }

    if (__DEV__) console.log('Pull workout history complete');
  } catch (err) {
    handleSyncError('pullWorkoutHistory', err);
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

    if (wErr) { handleSyncError('pull upcoming_workouts', wErr); return; }

    // Always clear local state to match Supabase
    await clearLocalUpcomingWorkout();

    if (!workouts || workouts.length === 0) return;

    const workout = workouts[0];

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

    if (eErr) { handleSyncError('pull upcoming_workout_exercises', eErr); return; }

    const exerciseList = exercises ?? [];

    for (const ex of exerciseList) {
      await db.runAsync(
        'INSERT INTO upcoming_workout_exercises (id, upcoming_workout_id, exercise_id, sort_order, rest_seconds, notes) VALUES (?, ?, ?, ?, ?, ?)',
        ex.id, ex.upcoming_workout_id, ex.exercise_id, ex.sort_order, ex.rest_seconds, ex.notes,
      );
    }

    // Fetch all sets in one query instead of per-exercise
    if (exerciseList.length > 0) {
      const exerciseIds = exerciseList.map(ex => ex.id);
      const { data: allSets, error: sErr } = await supabase
        .from('upcoming_workout_sets')
        .select('*')
        .in('upcoming_exercise_id', exerciseIds)
        .order('set_number');

      if (sErr) {
        handleSyncError('pull upcoming_workout_sets', sErr);
      } else {
        for (const s of allSets ?? []) {
          await db.runAsync(
            'INSERT INTO upcoming_workout_sets (id, upcoming_exercise_id, set_number, target_weight, target_reps, target_rpe, tag) VALUES (?, ?, ?, ?, ?, ?, ?)',
            s.id, s.upcoming_exercise_id, s.set_number, s.target_weight, s.target_reps, s.target_rpe ?? null, s.tag ?? 'working',
          );
        }
      }
    }

    if (__DEV__) console.log('Pull upcoming workout complete');
  } catch (err) {
    handleSyncError('pullUpcomingWorkout', err);
  }
}
