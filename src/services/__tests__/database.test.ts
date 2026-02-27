// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __mockDb } = require('expo-sqlite') as { __mockDb: {
  getAllAsync: jest.Mock;
  getFirstAsync: jest.Mock;
  runAsync: jest.Mock;
  execAsync: jest.Mock;
  withTransactionAsync: jest.Mock;
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
  getLastPerformedByTemplate,
  getBestE1RM,
  stampExerciseOrder,
  applyWorkoutChangesToTemplate,
} from '../database';
import type { TemplateUpdatePlan } from '../../utils/setDiff';

beforeEach(() => {
  __mockDb.getAllAsync.mockClear();
  __mockDb.getFirstAsync.mockClear();
  __mockDb.runAsync.mockClear();
  __mockDb.execAsync.mockClear();
  __mockDb.withTransactionAsync.mockClear();
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

describe('getLastPerformedByTemplate', () => {
  it('returns empty object for empty input', async () => {
    const result = await getLastPerformedByTemplate([]);
    expect(result).toEqual({});
  });

  it('returns map of template_id to last performed date', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { template_id: 't1', last_performed: '2026-02-20T10:00:00Z' },
      { template_id: 't2', last_performed: '2026-02-18T10:00:00Z' },
    ]);

    const result = await getLastPerformedByTemplate(['t1', 't2', 't3']);
    expect(result).toEqual({
      t1: '2026-02-20T10:00:00Z',
      t2: '2026-02-18T10:00:00Z',
    });
    // t3 has no history, so it's not in the result
    expect(result['t3']).toBeUndefined();
  });

  it('queries with correct SQL pattern', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    await getLastPerformedByTemplate(['t1']);

    const query = __mockDb.getAllAsync.mock.calls[0][0] as string;
    expect(query).toContain('MAX(started_at)');
    expect(query).toContain('finished_at IS NOT NULL');
    expect(query).toContain('GROUP BY template_id');
  });
});

describe('getBestE1RM', () => {
  it('returns null when no completed sets exist', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    const result = await getBestE1RM('ex-1');
    expect(result).toBeNull();
  });

  it('returns the best estimated 1RM across all sets', async () => {
    // 100 * (1 + 10/30) = 133.33, 120 * (1 + 5/30) = 140
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 100, reps: 10, rpe: null },
      { exercise_id: 'ex-1', weight: 120, reps: 5, rpe: null },
    ]);

    const result = await getBestE1RM('ex-1');
    expect(result).toBeCloseTo(140, 1);
  });

  it('accounts for RPE in e1RM calculation', async () => {
    // RPE 8 means RIR=2, effective_reps = 5 + 2 = 7
    // 120 * (1 + 7/30) = 148
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 120, reps: 5, rpe: 8 },
    ]);

    const result = await getBestE1RM('ex-1');
    expect(result).toBeCloseTo(148, 1);
  });
});

describe('stampExerciseOrder', () => {
  it('updates exercise_order for each entry in a transaction', async () => {
    await stampExerciseOrder('w1', [
      { id: 'set-1', order: 1 },
      { id: 'set-2', order: 2 },
    ]);

    expect(__mockDb.withTransactionAsync).toHaveBeenCalled();
    expect(__mockDb.runAsync).toHaveBeenCalledTimes(2);
    expect(__mockDb.runAsync).toHaveBeenNthCalledWith(
      1,
      'UPDATE workout_sets SET exercise_order = ? WHERE id = ?',
      1, 'set-1',
    );
    expect(__mockDb.runAsync).toHaveBeenNthCalledWith(
      2,
      'UPDATE workout_sets SET exercise_order = ? WHERE id = ?',
      2, 'set-2',
    );
  });
});

describe('applyWorkoutChangesToTemplate', () => {
  it('applies set count changes', async () => {
    const plan: TemplateUpdatePlan = {
      templateId: 't1',
      setChanges: [{ templateExerciseId: 'te-1', sets: 4, warmup_sets: 2 }],
      reorderedTemplateExerciseIds: null,
    };

    await applyWorkoutChangesToTemplate(plan);

    const setUpdateCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE template_exercises SET default_sets')
    );
    expect(setUpdateCall).toBeDefined();
    expect(setUpdateCall![0]).toContain('default_sets = ?');
    expect(setUpdateCall![0]).toContain('warmup_sets = ?');
    expect(setUpdateCall![0]).toContain('WHERE id = ?');
    expect(setUpdateCall![1]).toBe(4);
    expect(setUpdateCall![2]).toBe(2);
    expect(setUpdateCall![3]).toBe('te-1');
  });

  it('applies reorder changes', async () => {
    const plan: TemplateUpdatePlan = {
      templateId: 't1',
      setChanges: [],
      reorderedTemplateExerciseIds: ['te-2', 'te-1'],
    };

    // Mock the SELECT query for existing template exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'te-1' },
      { id: 'te-2' },
      { id: 'te-3' },
    ]);

    await applyWorkoutChangesToTemplate(plan);

    // Filter for sort_order UPDATE calls
    const sortCalls = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('SET sort_order')
    );
    expect(sortCalls).toHaveLength(3);

    // Final order: te-2 (0), te-1 (1), te-3 (2) — reordered first, remainder appended
    expect(sortCalls[0]).toEqual([
      'UPDATE template_exercises SET sort_order = ? WHERE id = ? AND template_id = ?',
      0, 'te-2', 't1',
    ]);
    expect(sortCalls[1]).toEqual([
      'UPDATE template_exercises SET sort_order = ? WHERE id = ? AND template_id = ?',
      1, 'te-1', 't1',
    ]);
    expect(sortCalls[2]).toEqual([
      'UPDATE template_exercises SET sort_order = ? WHERE id = ? AND template_id = ?',
      2, 'te-3', 't1',
    ]);
  });

  it('applies both set changes and reorder atomically', async () => {
    const plan: TemplateUpdatePlan = {
      templateId: 't1',
      setChanges: [{ templateExerciseId: 'te-1', sets: 5 }],
      reorderedTemplateExerciseIds: ['te-2', 'te-1'],
    };

    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'te-1' },
      { id: 'te-2' },
    ]);

    await applyWorkoutChangesToTemplate(plan);

    // Transaction wraps everything
    expect(__mockDb.withTransactionAsync).toHaveBeenCalledTimes(1);

    // Set change UPDATE
    const setUpdateCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('default_sets = ?')
    );
    expect(setUpdateCall).toBeDefined();

    // Sort order UPDATEs
    const sortCalls = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('SET sort_order')
    );
    expect(sortCalls).toHaveLength(2);
  });
});
