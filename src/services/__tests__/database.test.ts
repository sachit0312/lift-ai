import { __mockDb } from 'expo-sqlite';

import {
  createExercise,
  getAllExercises,
  createTemplate,
  startWorkout,
  updateWorkoutSet,
} from '../database';

beforeEach(() => {
  __mockDb.getAllAsync.mockClear();
  __mockDb.runAsync.mockClear();
  __mockDb.execAsync.mockClear();
});

describe('createExercise', () => {
  it('inserts exercise and returns it with generated id', async () => {
    const result = await createExercise({
      name: 'Bench Press',
      type: 'weighted',
      muscle_groups: ['chest', 'triceps'],
      training_goal: 'hypertrophy',
      description: '',
    });

    expect(result.name).toBe('Bench Press');
    expect(result.type).toBe('weighted');
    expect(result.muscle_groups).toEqual(['chest', 'triceps']);
    expect(result.id).toBeDefined();
  });
});

describe('getAllExercises', () => {
  it('returns parsed exercises with muscle_groups as array', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: '1', name: 'Squat', type: 'weighted', muscle_groups: '["quads","glutes"]', training_goal: 'strength', description: '', created_at: '2026-01-01', user_id: 'local' },
    ]);

    const result = await getAllExercises();
    expect(result).toHaveLength(1);
    expect(result[0].muscle_groups).toEqual(['quads', 'glutes']);
  });
});

describe('createTemplate', () => {
  it('inserts template and returns it', async () => {
    const result = await createTemplate('Push Day');
    expect(result.name).toBe('Push Day');
    expect(result.id).toBeDefined();
  });
});

describe('startWorkout', () => {
  it('creates workout with null template_id for empty workout', async () => {
    const result = await startWorkout(null);
    expect(result.template_id).toBeNull();
    expect(result.finished_at).toBeNull();
    expect(result.id).toBeDefined();
  });
});

describe('updateWorkoutSet', () => {
  it('does nothing when no updates provided', async () => {
    await updateWorkoutSet('set-1', {});
  });

  it('converts is_completed boolean to integer', async () => {
    await updateWorkoutSet('set-1', { is_completed: true });

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE workout_sets')
    );
    expect(call).toBeDefined();
    expect(call![1]).toBe(1);
  });
});
