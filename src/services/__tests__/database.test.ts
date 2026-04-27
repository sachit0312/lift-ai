jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: null } })),
    },
  },
}));

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
  addWorkoutSet,
  addWorkoutSetsBatch,
  getWorkoutSets,
  setPlannedExerciseIds,
  getPlannedExerciseIds,
  insertSkippedPlaceholderSets,
} from '../database';
import type { TemplateUpdatePlan } from '../../utils/setDiff';
import type { SetTag } from '../../types/database';

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
      { exercise_id: 'ex-1', form_notes: 'form note', machine_notes: 'machine note' },
    ]);

    const result = await getUserExerciseNotes('ex-1');
    expect(result).toEqual({
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
      { exercise_id: 'ex-1', form_notes: 'form1', machine_notes: null },
      { exercise_id: 'ex-2', form_notes: null, machine_notes: 'machine2' },
    ]);

    const result = await getUserExerciseNotesBatch(['ex-1', 'ex-2']);
    expect(result.get('ex-1')).toEqual({ form_notes: 'form1', machine_notes: null });
    expect(result.get('ex-2')).toEqual({ form_notes: null, machine_notes: 'machine2' });
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

describe('addWorkoutSetsBatch', () => {
  it('persists programmed_order when provided', async () => {
    const w = await startWorkout(null);
    const [set] = await addWorkoutSetsBatch([
      {
        workout_id: w.id,
        exercise_id: 'ex-1',
        set_number: 1,
        reps: null,
        weight: null,
        tag: 'working',
        rpe: null,
        is_completed: false,
        notes: null,
        exercise_order: 3,
        programmed_order: 3,
      },
    ]);
    // Mock getWorkoutSets return with programmed_order included
    __mockDb.getAllAsync.mockResolvedValueOnce([
      {
        id: set.id,
        workout_id: w.id,
        exercise_id: 'ex-1',
        set_number: 1,
        reps: null,
        weight: null,
        tag: 'working',
        rpe: null,
        is_completed: 0,
        notes: null,
        target_weight: null,
        target_reps: null,
        target_rpe: null,
        exercise_order: 3,
        programmed_order: 3,
      },
    ]);
    const rows = await getWorkoutSets(w.id);
    expect(rows[0].id).toBe(set.id);
    expect(rows[0].exercise_order).toBe(3);
    expect(rows[0].programmed_order).toBe(3);
  });

  it('leaves programmed_order null when not provided', async () => {
    const w = await startWorkout(null);
    await addWorkoutSetsBatch([
      {
        workout_id: w.id,
        exercise_id: 'ex-2',
        set_number: 1,
        reps: null,
        weight: null,
        tag: 'working',
        rpe: null,
        is_completed: false,
        notes: null,
      },
    ]);
    __mockDb.getAllAsync.mockResolvedValueOnce([
      {
        id: 'set-x',
        workout_id: w.id,
        exercise_id: 'ex-2',
        set_number: 1,
        reps: null,
        weight: null,
        tag: 'working',
        rpe: null,
        is_completed: 0,
        notes: null,
        target_weight: null,
        target_reps: null,
        target_rpe: null,
        exercise_order: 0,
        programmed_order: null,
      },
    ]);
    const rows = await getWorkoutSets(w.id);
    expect(rows[0].programmed_order).toBeNull();
  });

  it('sends 15-column INSERT SQL including programmed_order', async () => {
    await addWorkoutSetsBatch([
      {
        workout_id: 'w-1',
        exercise_id: 'ex-1',
        set_number: 1,
        reps: 5,
        weight: 100,
        tag: 'working',
        rpe: null,
        is_completed: false,
        notes: null,
        programmed_order: 2,
      },
    ]);
    const insertCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_sets')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![0]).toContain('programmed_order');
    // 15 placeholders per row
    expect(insertCall![0]).toContain('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  });
});

describe('getWorkoutSets ORDER BY', () => {
  it('uses exercise_order, set_number without rowid', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    await getWorkoutSets('w-1');
    const call = __mockDb.getAllAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('workout_sets')
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain('ORDER BY exercise_order, set_number');
    expect(call![0]).not.toContain('rowid');
  });
});

describe('planned_exercise_ids', () => {
  it('round-trips a JSON array', async () => {
    const w = await startWorkout(null);
    await setPlannedExerciseIds(w.id, ['ex-a', 'ex-b', 'ex-c']);
    __mockDb.getFirstAsync.mockResolvedValueOnce({ planned_exercise_ids: '["ex-a","ex-b","ex-c"]' });
    const ids = await getPlannedExerciseIds(w.id);
    expect(ids).toEqual(['ex-a', 'ex-b', 'ex-c']);
  });

  it('stores null when called with null', async () => {
    const w = await startWorkout(null);
    await setPlannedExerciseIds(w.id, null);
    __mockDb.getFirstAsync.mockResolvedValueOnce({ planned_exercise_ids: null });
    const ids = await getPlannedExerciseIds(w.id);
    expect(ids).toBeNull();
  });

  it('returns null for a workout with no plan stored', async () => {
    const w = await startWorkout(null);
    __mockDb.getFirstAsync.mockResolvedValueOnce({ planned_exercise_ids: null });
    const ids = await getPlannedExerciseIds(w.id);
    expect(ids).toBeNull();
  });

  it('writes the correct UPDATE SQL for setPlannedExerciseIds', async () => {
    await setPlannedExerciseIds('w-99', ['ex-1', 'ex-2']);
    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('planned_exercise_ids')
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain('UPDATE workouts SET planned_exercise_ids');
    expect(call![1]).toBe('["ex-1","ex-2"]');
    expect(call![2]).toBe('w-99');
  });
});

describe('insertSkippedPlaceholderSets', () => {
  it('inserts one ghost row per skipped exercise', async () => {
    const w = await startWorkout(null);
    await insertSkippedPlaceholderSets(w.id, [
      { exercise_id: 'ex-skip-1', programmed_order: 2 },
      { exercise_id: 'ex-skip-2', programmed_order: 4 },
    ]);
    __mockDb.getAllAsync.mockResolvedValueOnce([
      {
        id: 'ghost-1',
        workout_id: w.id,
        exercise_id: 'ex-skip-1',
        set_number: 1,
        reps: 0,
        weight: 0,
        tag: 'working',
        rpe: null,
        is_completed: 0,
        notes: null,
        target_weight: null,
        target_reps: null,
        target_rpe: null,
        exercise_order: 0,
        programmed_order: 2,
      },
      {
        id: 'ghost-2',
        workout_id: w.id,
        exercise_id: 'ex-skip-2',
        set_number: 1,
        reps: 0,
        weight: 0,
        tag: 'working',
        rpe: null,
        is_completed: 0,
        notes: null,
        target_weight: null,
        target_reps: null,
        target_rpe: null,
        exercise_order: 0,
        programmed_order: 4,
      },
    ]);
    const rows = await getWorkoutSets(w.id);
    const skipRows = rows.filter(r => r.exercise_id.startsWith('ex-skip-'));
    expect(skipRows).toHaveLength(2);
    for (const r of skipRows) {
      expect(r.set_number).toBe(1);
      expect(r.reps).toBe(0);
      expect(r.weight).toBe(0);
      expect(r.tag).toBe('working');
      expect(r.rpe).toBeNull();
      expect(r.is_completed).toBe(false);
      expect(r.exercise_order).toBe(0);
    }
    const byOrder = new Map(skipRows.map(r => [r.exercise_id, r.programmed_order]));
    expect(byOrder.get('ex-skip-1')).toBe(2);
    expect(byOrder.get('ex-skip-2')).toBe(4);
    // Verify transaction was used
    expect(__mockDb.withTransactionAsync).toHaveBeenCalled();
    // Verify 2 INSERT calls were made
    const insertCalls = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_sets')
    );
    expect(insertCalls).toHaveLength(2);
  });

  it('no-ops on an empty array', async () => {
    const w = await startWorkout(null);
    await insertSkippedPlaceholderSets(w.id, []);
    const insertCalls = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_sets')
    );
    expect(insertCalls).toHaveLength(0);
  });
});

describe('getWorkoutSets — plan order preservation regression', () => {
  it('uses correct ORDER BY that excludes rowid dependency', async () => {
    // This test pins the fix for Issue 1 in spec
    // docs/superpowers/specs/2026-04-11-workout-ordering-integrity-design.md.
    //
    // Before the fix, getWorkoutSets used:
    //   ORDER BY exercise_order, rowid, set_number
    // The rowid tiebreaker caused scrambled order when Promise.all inserted
    // sets out of sequence.
    //
    // The fix uses:
    //   ORDER BY exercise_order, set_number
    // Dropping rowid dependency so order is always plan-determined, never
    // affected by insertion order.
    //
    // This test verifies the SQL query has the correct ORDER BY clause.
    // If someone reverts to rowid-based ordering, this fails.

    const workoutId = 'test-workout-123';

    // Mock the DB call to capture the SQL query
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    await getWorkoutSets(workoutId);

    // Verify getAllAsync was called with the correct ORDER BY clause
    // (no rowid, just exercise_order then set_number)
    expect(__mockDb.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY exercise_order, set_number'),
      workoutId,
    );

    // Also verify rowid is NOT in the ORDER BY
    const calls = __mockDb.getAllAsync.mock.calls;
    const lastCall = calls[calls.length - 1];
    const sql = lastCall[0] as string;
    // Exact match: nothing extra should trail after set_number in the ORDER BY.
    expect(sql).toMatch(/ORDER BY exercise_order, set_number(?!,)/);
    expect(sql).not.toMatch(/ORDER BY.*rowid/);
  });
});

// ─── Test 9: getPlannedExerciseIds with malformed JSON ──────────────────────

describe('getPlannedExerciseIds — malformed/non-array JSON', () => {
  it('returns null when the stored value is not valid JSON', async () => {
    __mockDb.getFirstAsync.mockResolvedValueOnce({ planned_exercise_ids: 'not-valid-json' });
    const ids = await getPlannedExerciseIds('w-bad');
    expect(ids).toBeNull();
  });

  it('returns null when the stored value is valid JSON but not an array', async () => {
    // JSON.parse('"just-a-string"') → "just-a-string" (a string, not an array)
    __mockDb.getFirstAsync.mockResolvedValueOnce({ planned_exercise_ids: '"just-a-string"' });
    const ids = await getPlannedExerciseIds('w-str');
    expect(ids).toBeNull();
  });
});

// ─── Test 10: setPlannedExerciseIds with empty array round-trip ─────────────

describe('planned_exercise_ids — empty array round-trip', () => {
  it('returns empty array (not null) when stored as []', async () => {
    const w = await startWorkout(null);
    await setPlannedExerciseIds(w.id, []);

    // Verify the WRITE path persisted '[]' (not 'null' or undefined) via runAsync
    const writeCalls = __mockDb.runAsync.mock.calls;
    const setCall = writeCalls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE workouts') && c[0].includes('planned_exercise_ids')
    );
    expect(setCall).toBeDefined();
    expect(setCall![1]).toBe('[]');  // first binding: JSON.stringify([]) = '[]'

    __mockDb.getFirstAsync.mockResolvedValueOnce({ planned_exercise_ids: '[]' });
    const ids = await getPlannedExerciseIds(w.id);
    expect(ids).toEqual([]);
    expect(ids).not.toBeNull();
  });
});

// ─── Test 14: addWorkoutSet persists exercise_order and programmed_order ────

describe('addWorkoutSet — field persistence', () => {
  it('includes exercise_order and programmed_order in the INSERT SQL', async () => {
    await addWorkoutSet({
      workout_id: 'w-1',
      exercise_id: 'ex-1',
      set_number: 1,
      reps: null,
      weight: null,
      tag: 'working',
      rpe: null,
      is_completed: false,
      notes: null,
      exercise_order: 5,
      programmed_order: null,
    });

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_sets'),
    );
    expect(call).toBeDefined();
    // Column list must include both columns
    expect(call![0]).toContain('exercise_order');
    expect(call![0]).toContain('programmed_order');
    // exercise_order = 5 should be at the correct binding position
    const bindings = call!.slice(1);
    expect(bindings).toContain(5);
    // programmed_order = null
    const lastBinding = bindings[bindings.length - 1];
    expect(lastBinding).toBeNull();
  });
});
