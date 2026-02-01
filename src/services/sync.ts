import { supabase } from './supabase';
import { getDb } from './database';

export async function syncToSupabase(): Promise<void> {
  try {
    const db = await getDb();

    // Exercises — parse muscle_groups from JSON string to array
    const exercises = await db.getAllAsync<any>('SELECT * FROM exercises');
    if (exercises.length > 0) {
      const parsed = exercises.map((e) => ({
        ...e,
        muscle_groups: JSON.parse(e.muscle_groups || '[]'),
      }));
      const { error } = await supabase.from('exercises').upsert(parsed, { onConflict: 'id' });
      if (error) console.error('Sync exercises error:', error);
    }

    // Templates
    const templates = await db.getAllAsync<any>('SELECT * FROM templates');
    if (templates.length > 0) {
      const { error } = await supabase.from('templates').upsert(templates, { onConflict: 'id' });
      if (error) console.error('Sync templates error:', error);
    }

    // Template exercises
    const templateExercises = await db.getAllAsync<any>('SELECT * FROM template_exercises');
    if (templateExercises.length > 0) {
      const { error } = await supabase.from('template_exercises').upsert(templateExercises, { onConflict: 'id' });
      if (error) console.error('Sync template_exercises error:', error);
    }

    // Workouts (only finished)
    const workouts = await db.getAllAsync<any>('SELECT * FROM workouts WHERE finished_at IS NOT NULL');
    if (workouts.length > 0) {
      const { error } = await supabase.from('workouts').upsert(workouts, { onConflict: 'id' });
      if (error) console.error('Sync workouts error:', error);
    }

    // Workout sets
    const workoutSets = await db.getAllAsync<any>('SELECT * FROM workout_sets');
    if (workoutSets.length > 0) {
      const { error } = await supabase.from('workout_sets').upsert(workoutSets, { onConflict: 'id' });
      if (error) console.error('Sync workout_sets error:', error);
    }

    console.log('Sync to Supabase complete');
  } catch (err) {
    console.error('syncToSupabase failed:', err);
  }
}

export async function pullUpcomingWorkout(): Promise<void> {
  try {
    const db = await getDb();

    // Fetch latest upcoming workout from Supabase
    const { data: workouts, error: wErr } = await supabase
      .from('upcoming_workouts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (wErr) {
      console.error('Pull upcoming_workouts error:', wErr);
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
        continue;
      }

      for (const s of sets ?? []) {
        await db.runAsync(
          'INSERT INTO upcoming_workout_sets (id, upcoming_exercise_id, set_number, target_weight, target_reps) VALUES (?, ?, ?, ?, ?)',
          s.id, s.upcoming_exercise_id, s.set_number, s.target_weight, s.target_reps,
        );
      }
    }

    console.log('Pull upcoming workout complete');
  } catch (err) {
    console.error('pullUpcomingWorkout failed:', err);
  }
}
