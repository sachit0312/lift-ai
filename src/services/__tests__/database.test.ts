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
  getExerciseHistory,
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

describe('getExerciseHistory', () => {
  it('skips workouts with only uncompleted sets for the exercise', async () => {
    // First call: workout ID query — should only find workouts with completed sets
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'w-old' },
    ]);
    // Second call: JOIN query for sets
    __mockDb.getAllAsync.mockResolvedValueOnce([
      {
        w_id: 'w-old', w_user_id: 'u1', w_template_id: null,
        w_started_at: '2026-02-04T10:00:00Z', w_finished_at: '2026-02-04T11:00:00Z',
        w_ai_summary: null, w_notes: null,
        s_id: 's1', s_workout_id: 'w-old', s_exercise_id: 'ex-1',
        s_set_number: 1, s_reps: 3, s_weight: 2,
        s_tag: null, s_rpe: null, s_is_completed: 1, s_notes: null,
      },
    ]);

    const result = await getExerciseHistory('ex-1', 1);

    // Verify the first query includes is_completed = 1 filter
    const workoutIdQuery = __mockDb.getAllAsync.mock.calls[0][0] as string;
    expect(workoutIdQuery).toContain('is_completed = 1');

    expect(result).toHaveLength(1);
    expect(result[0].workout.id).toBe('w-old');
    expect(result[0].sets).toHaveLength(1);
    expect(result[0].sets[0].weight).toBe(2);
    expect(result[0].sets[0].reps).toBe(3);
  });
});
