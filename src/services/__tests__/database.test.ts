// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __mockDb } = require('expo-sqlite') as { __mockDb: {
  getAllAsync: jest.Mock;
  getFirstAsync: jest.Mock;
  runAsync: jest.Mock;
  execAsync: jest.Mock;
}};

import {
  createExercise,
  getAllExercises,
  createTemplate,
  startWorkout,
  updateWorkoutSet,
  getPRsThisWeek,
  updateExerciseNotes,
  getExerciseById,
} from '../database';

beforeEach(() => {
  __mockDb.getAllAsync.mockClear();
  __mockDb.getFirstAsync.mockClear();
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

describe('getPRsThisWeek', () => {
  it('returns 0 when no workouts', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    const result = await getPRsThisWeek();
    expect(result).toBe(0);
  });

  it('counts exercise where this week beats prior', async () => {
    // First call: week sets — one exercise with weight=100, reps=10 (e1RM = 100 * (1 + 10/30) = 133.33)
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 100, reps: 10 },
    ]);
    // Second call: prior sets — lower 1RM (weight=80, reps=10) (e1RM = 80 * (1 + 10/30) = 106.67)
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 80, reps: 10 },
    ]);

    const result = await getPRsThisWeek();
    expect(result).toBe(1);
  });

  it('returns 0 when this week does not beat prior', async () => {
    // First call: week sets — lower 1RM (e1RM = 80 * (1 + 10/30) = 106.67)
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 80, reps: 10 },
    ]);
    // Second call: prior sets — higher 1RM (e1RM = 100 * (1 + 10/30) = 133.33)
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 100, reps: 10 },
    ]);

    const result = await getPRsThisWeek();
    expect(result).toBe(0);
  });
});

describe('updateExerciseNotes', () => {
  it('updates notes with correct SQL', async () => {
    await updateExerciseNotes('ex-1', 'Focus on form');

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE exercises SET notes')
    );
    expect(call).toBeDefined();
    expect(call![1]).toBe('Focus on form');
    expect(call![2]).toBe('ex-1');
  });

  it('clears notes when passed null', async () => {
    await updateExerciseNotes('ex-1', null);

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE exercises SET notes')
    );
    expect(call).toBeDefined();
    expect(call![1]).toBeNull();
    expect(call![2]).toBe('ex-1');
  });
});

describe('getExerciseById', () => {
  it('returns parsed exercise when found', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'ex-1', name: 'Squat', type: 'weighted', muscle_groups: '["Quads","Glutes"]', training_goal: 'strength', description: 'Barbell squat', created_at: '2026-01-01', user_id: 'local', notes: null },
    ]);

    const result = await getExerciseById('ex-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('ex-1');
    expect(result!.name).toBe('Squat');
    expect(result!.muscle_groups).toEqual(['Quads', 'Glutes']);
  });

  it('returns null when exercise not found', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    const result = await getExerciseById('nonexistent');
    expect(result).toBeNull();
  });
});
