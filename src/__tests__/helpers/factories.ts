import type { Exercise, WorkoutSet, Workout, UpcomingWorkout, UpcomingWorkoutExercise, UpcomingWorkoutSet } from '../../types/database';

export function createMockExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-' + Math.random().toString(36).slice(2),
    user_id: 'local',
    name: 'Test Exercise',
    type: 'weighted',
    muscle_groups: ['Chest'],
    training_goal: 'hypertrophy',
    description: '',
    notes: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockWorkoutSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: 'set-' + Math.random().toString(36).slice(2),
    workout_id: 'w1',
    exercise_id: 'ex1',
    set_number: 1,
    weight: 135,
    reps: 10,
    tag: 'working',
    rpe: null,
    is_completed: true,
    notes: null,
    ...overrides,
  };
}

export function createMockWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'w-' + Math.random().toString(36).slice(2),
    user_id: 'local',
    template_id: null,
    upcoming_workout_id: null,
    started_at: new Date().toISOString(),
    finished_at: new Date(Date.now() + 3600000).toISOString(),
    ai_summary: null,
    session_notes: null,
    ...overrides,
  };
}

export function createMockSession(date: string, sets: Partial<WorkoutSet>[] = [{}]) {
  return {
    workout: {
      id: 'w-' + Math.random().toString(36).slice(2),
      started_at: date,
      finished_at: new Date(new Date(date).getTime() + 3600000).toISOString(),
    },
    sets: sets.map((s, i) => createMockWorkoutSet({ set_number: i + 1, ...s })),
  };
}

export function createMockUpcomingWorkout(overrides: {
  workout?: Partial<UpcomingWorkout>;
  exercises?: Array<{
    exercise: Exercise;
    sets?: Array<Partial<UpcomingWorkoutSet>>;
    rest_seconds?: number;
    notes?: string | null;
  }>;
} = {}) {
  const workoutId = 'uw-' + Math.random().toString(36).slice(2);
  const workout: UpcomingWorkout = {
    id: workoutId,
    date: new Date().toISOString().split('T')[0],
    template_id: null,
    notes: null,
    created_at: new Date().toISOString(),
    ...overrides.workout,
  };

  const exercises: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] = (overrides.exercises ?? []).map((exDef, idx) => {
    const ueId = 'ue-' + Math.random().toString(36).slice(2);
    return {
      id: ueId,
      upcoming_workout_id: workoutId,
      exercise_id: exDef.exercise.id,
      order: idx + 1,
      rest_seconds: exDef.rest_seconds ?? 90,
      notes: exDef.notes ?? null,
      exercise: exDef.exercise,
      sets: (exDef.sets ?? [{ set_number: 1, target_weight: 135, target_reps: 10 }]).map((s, sIdx) => ({
        id: 'us-' + Math.random().toString(36).slice(2),
        upcoming_exercise_id: ueId,
        set_number: s.set_number ?? sIdx + 1,
        target_weight: s.target_weight ?? 135,
        target_reps: s.target_reps ?? 10,
        ...s,
      })),
    };
  });

  return { workout, exercises };
}
