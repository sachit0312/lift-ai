import type { Exercise, WorkoutSet, Workout } from '../../types/database';

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
    started_at: new Date().toISOString(),
    finished_at: new Date(Date.now() + 3600000).toISOString(),
    ai_summary: null,
    notes: null,
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
