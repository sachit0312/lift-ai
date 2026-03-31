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
  getCurrentE1RM,
  getE1RMWithConfidence,
  stampExerciseOrder,
  applyWorkoutChangesToTemplate,
  upsertExerciseNote,
  getUserExerciseNotes,
  getUserExerciseNotesBatch,
  updateWorkoutCoachNotes,
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
      { id: '1', name: 'Squat', type: 'weighted', muscle_groups: '["quads","glutes"]', training_goal: 'strength', description: '', created_at: '2026-01-01', user_id: null },
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
  it('upserts notes via user_exercise_notes table', async () => {
    await updateExerciseNotes('ex-1', 'Focus on form');

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('user_exercise_notes')
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain('ON CONFLICT');
    expect(call![0]).toContain('notes');
  });

  it('clears notes when passed null', async () => {
    await updateExerciseNotes('ex-1', null);

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('user_exercise_notes')
    );
    expect(call).toBeDefined();
  });
});

describe('upsertExerciseNote', () => {
  it('inserts into user_exercise_notes with ON CONFLICT', async () => {
    const { upsertExerciseNote } = require('../database');
    await upsertExerciseNote('ex-1', 'form_notes', 'Keep elbows tucked');

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('user_exercise_notes')
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain('INSERT INTO user_exercise_notes');
    expect(call![0]).toContain('ON CONFLICT');
    expect(call![0]).toContain('form_notes');
  });
});

describe('getUserExerciseNotes', () => {
  it('returns null when no notes exist', async () => {
    const { getUserExerciseNotes } = require('../database');
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    const result = await getUserExerciseNotes('ex-1');
    expect(result).toBeNull();

    // Verify query filters by user_id
    const call = __mockDb.getAllAsync.mock.calls[0];
    expect(call[0]).toContain('WHERE user_id = ?');
    expect(call[1]).toBe('local');
  });

  it('returns notes when they exist', async () => {
    const { getUserExerciseNotes } = require('../database');
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', notes: 'coach note', form_notes: 'form note', machine_notes: 'machine note' },
    ]);

    const result = await getUserExerciseNotes('ex-1');
    expect(result).toEqual({
      notes: 'coach note',
      form_notes: 'form note',
      machine_notes: 'machine note',
    });
  });
});

describe('getUserExerciseNotesBatch', () => {
  it('returns empty map for empty input', async () => {
    const { getUserExerciseNotesBatch } = require('../database');
    const result = await getUserExerciseNotesBatch([]);
    expect(result).toEqual(new Map());
  });

  it('returns map of exercise notes', async () => {
    const { getUserExerciseNotesBatch } = require('../database');
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', notes: null, form_notes: 'form1', machine_notes: null },
      { exercise_id: 'ex-2', notes: null, form_notes: null, machine_notes: 'machine2' },
    ]);

    const result = await getUserExerciseNotesBatch(['ex-1', 'ex-2']);
    expect(result.get('ex-1')).toEqual({ notes: null, form_notes: 'form1', machine_notes: null });
    expect(result.get('ex-2')).toEqual({ notes: null, form_notes: null, machine_notes: 'machine2' });
  });
});

describe('getExerciseById', () => {
  it('returns parsed exercise when found', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'ex-1', name: 'Squat', type: 'weighted', muscle_groups: '["Quads","Glutes"]', training_goal: 'strength', description: 'Barbell squat', created_at: '2026-01-01', user_id: null },
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
        w_coach_notes: null, w_exercise_coach_notes: null, w_session_notes: null,
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

    // coach_notes and exercise_coach_notes should be present (null in this mock data)
    expect(result[0].workout.coach_notes).toBeNull();
    expect(result[0].workout.exercise_coach_notes).toBeNull();
  });
});

describe('updateWorkoutCoachNotes', () => {
  it('updates both coach_notes and exercise_coach_notes when non-null', async () => {
    await updateWorkoutCoachNotes('w-1', 'Great session', '{"ex-1":"Keep elbows in"}');

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE workouts SET coach_notes')
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain('coach_notes = ?');
    expect(call![0]).toContain('exercise_coach_notes = ?');
    expect(call![0]).toContain('WHERE id = ?');
    expect(call![1]).toBe('Great session');
    expect(call![2]).toBe('{"ex-1":"Keep elbows in"}');
    expect(call![3]).toBe('w-1');
  });

  it('updates with null values', async () => {
    await updateWorkoutCoachNotes('w-2', null, null);

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE workouts SET coach_notes')
    );
    expect(call).toBeDefined();
    expect(call![1]).toBeNull();
    expect(call![2]).toBeNull();
    expect(call![3]).toBe('w-2');
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
    // No RPE → ensemble blend. 120x5 should beat 100x10.
    // 120x5 ensemble ≈ 137.5, 100x10 ensemble ≈ 133.8
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 100, reps: 10, rpe: null },
      { exercise_id: 'ex-1', weight: 120, reps: 5, rpe: null },
    ]);

    const result = await getBestE1RM('ex-1');
    expect(result).toBeGreaterThan(135);
    expect(result).toBeLessThan(142);
  });

  it('accounts for RPE in e1RM calculation', async () => {
    // RPE 8 → table lookup: 5 reps @ RPE 8 = 81.1% → 120 / 0.811 ≈ 147.84
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 120, reps: 5, rpe: 8 },
    ]);

    const result = await getBestE1RM('ex-1');
    expect(result).toBeCloseTo(147.84, 0);
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

describe('getCurrentE1RM', () => {
  it('returns null when no completed sets exist', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    const result = await getCurrentE1RM('ex-1');
    expect(result).toBeNull();
  });

  it('returns freshness-weighted e1RM with recent sets valued higher', async () => {
    const now = new Date().toISOString();
    const sixWeeksAgo = new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString();

    // Recent set: 100x5 no RPE → ensemble ~114.6
    // Old set: 120x5 no RPE → ensemble ~137.5, but decayed by ~50% after 42 days ≈ 68.8
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 100, reps: 5, rpe: null, finished_at: now },
      { exercise_id: 'ex-1', weight: 120, reps: 5, rpe: null, finished_at: sixWeeksAgo },
    ]);

    const result = await getCurrentE1RM('ex-1');
    expect(result).not.toBeNull();
    // The recent 100x5 should win over the decayed 120x5
    expect(result).toBeGreaterThan(110);
    expect(result).toBeLessThan(120);
  });

  it('returns higher value when recent workout is strong', async () => {
    const now = new Date().toISOString();

    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 200, reps: 3, rpe: 8, finished_at: now },
    ]);

    const result = await getCurrentE1RM('ex-1');
    expect(result).not.toBeNull();
    // 200 / 0.863 ≈ 231.75, decay ≈ 1.0 for today → ~231.75
    expect(result).toBeGreaterThan(225);
  });
});

describe('getE1RMWithConfidence', () => {
  it('returns null when no completed sets exist', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    const result = await getE1RMWithConfidence('ex-1');
    expect(result).toBeNull();
  });

  it('returns E1RMResult with confidence tier for best set', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 200, reps: 3, rpe: 8 },
    ]);

    const result = await getE1RMWithConfidence('ex-1');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('high');
    expect(result!.method).toBe('rpe_table');
    expect(result!.value).toBeGreaterThan(200);
  });

  it('selects highest absolute e1RM across multiple sets', async () => {
    // Set 1: 200x3 @ RPE 8 → 200 / 0.863 ≈ 231.75 (high confidence)
    // Set 2: 100x12 no RPE → ensemble ~140 (low confidence)
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-1', weight: 200, reps: 3, rpe: 8 },
      { exercise_id: 'ex-1', weight: 100, reps: 12, rpe: null },
    ]);

    const result = await getE1RMWithConfidence('ex-1');
    expect(result).not.toBeNull();
    // The 200x3 set should win on raw value
    expect(result!.value).toBeGreaterThan(225);
    expect(result!.confidence).toBe('high');
  });
});
