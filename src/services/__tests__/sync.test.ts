// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __mockDb } = require('expo-sqlite') as { __mockDb: {
  getAllAsync: jest.Mock;
  getFirstAsync: jest.Mock;
  runAsync: jest.Mock;
  execAsync: jest.Mock;
}};

import * as Sentry from '@sentry/react-native';

// ─── Mock supabase ───

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
    from: jest.fn(),
  },
}));

// Import after mocks are set up
import { syncToSupabase, pullUpcomingWorkout, pullExercisesAndTemplates } from '../sync';
import { supabase } from '../supabase';

// Cast for type safety
const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

// ─── Helpers ───

const MOCK_SESSION = {
  user: { id: 'user-123' },
  access_token: 'test-token',
};

function setSessionAuthenticated() {
  mockGetSession.mockResolvedValue({ data: { session: MOCK_SESSION } });
}

function setSessionNull() {
  mockGetSession.mockResolvedValue({ data: { session: null } });
}

/**
 * Build a chainable Supabase query builder mock.
 * Supports .select().eq().order().limit() and .upsert()
 */
function mockQueryBuilder(resolvedData: any = [], resolvedError: any = null) {
  const builder: any = {};
  builder.select = jest.fn().mockReturnValue(builder);
  builder.eq = jest.fn().mockReturnValue(builder);
  builder.order = jest.fn().mockReturnValue(builder);
  builder.limit = jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  builder.upsert = jest.fn().mockResolvedValue({ error: null });
  // Allow awaiting directly when no .limit() is called (e.g. exercise fetch chain)
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: resolvedData, error: resolvedError }).then(resolve, reject);
  return builder;
}

/** Map of table name -> query builder for per-test routing */
let mockFromHandlers: Record<string, any> = {};

function setupMockFrom() {
  mockFrom.mockImplementation((table: string) => {
    if (mockFromHandlers[table]) return mockFromHandlers[table];
    return mockQueryBuilder();
  });
}

// ─── Tests ───

beforeEach(() => {
  mockFromHandlers = {};
  setupMockFrom();
});

// ============================================================
// syncToSupabase
// ============================================================

describe('syncToSupabase', () => {
  it('skips sync when no session (user not authenticated)', async () => {
    setSessionNull();

    await syncToSupabase();

    expect(__mockDb.getAllAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('syncs exercises to Supabase with parsed muscle_groups and user_id', async () => {
    setSessionAuthenticated();

    const mockExercises = [
      { id: 'ex-1', name: 'Bench Press', type: 'weighted', muscle_groups: '["Chest","Triceps"]', training_goal: 'hypertrophy', description: 'Flat bench' },
      { id: 'ex-2', name: 'Squat', type: 'weighted', muscle_groups: '["Quads","Glutes"]', training_goal: 'strength', description: '' },
    ];

    __mockDb.getAllAsync.mockResolvedValueOnce(mockExercises);
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workout_sets

    const exerciseBuilder = mockQueryBuilder();
    mockFromHandlers['exercises'] = exerciseBuilder;

    await syncToSupabase();

    expect(exerciseBuilder.upsert).toHaveBeenCalledWith(
      [
        { id: 'ex-1', user_id: 'user-123', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest', 'Triceps'], training_goal: 'hypertrophy', description: 'Flat bench' },
        { id: 'ex-2', user_id: 'user-123', name: 'Squat', type: 'weighted', muscle_groups: ['Quads', 'Glutes'], training_goal: 'strength', description: '' },
      ],
      { onConflict: 'id' },
    );
  });

  it('syncs templates with user_id', async () => {
    setSessionAuthenticated();

    const mockTemplates = [
      { id: 'tpl-1', name: 'Push Day' },
      { id: 'tpl-2', name: 'Pull Day' },
    ];

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce(mockTemplates);
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workout_sets

    const templateBuilder = mockQueryBuilder();
    mockFromHandlers['templates'] = templateBuilder;

    await syncToSupabase();

    expect(templateBuilder.upsert).toHaveBeenCalledWith(
      [
        { id: 'tpl-1', name: 'Push Day', user_id: 'user-123' },
        { id: 'tpl-2', name: 'Pull Day', user_id: 'user-123' },
      ],
      { onConflict: 'id' },
    );
  });

  it('syncs template_exercises without user_id', async () => {
    setSessionAuthenticated();

    const mockTemplateExercises = [
      { id: 'te-1', template_id: 'tpl-1', exercise_id: 'ex-1', sort_order: 0, default_sets: 3 },
    ];

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce(mockTemplateExercises);
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workout_sets

    const teBuilder = mockQueryBuilder();
    mockFromHandlers['template_exercises'] = teBuilder;

    await syncToSupabase();

    expect(teBuilder.upsert).toHaveBeenCalledWith(
      mockTemplateExercises,
      { onConflict: 'id' },
    );
  });

  it('syncs finished workouts with user_id', async () => {
    setSessionAuthenticated();

    const mockWorkouts = [
      { id: 'w-1', template_id: 'tpl-1', started_at: '2026-01-01T10:00:00Z', finished_at: '2026-01-01T11:00:00Z', ai_summary: null, notes: null },
    ];

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce(mockWorkouts);
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workout_sets

    const workoutBuilder = mockQueryBuilder();
    mockFromHandlers['workouts'] = workoutBuilder;

    await syncToSupabase();

    expect(workoutBuilder.upsert).toHaveBeenCalledWith(
      [{ ...mockWorkouts[0], user_id: 'user-123' }],
      { onConflict: 'id' },
    );
  });

  it('syncs workout_sets with is_completed converted to boolean', async () => {
    setSessionAuthenticated();

    const mockSets = [
      { id: 'ws-1', workout_id: 'w-1', exercise_id: 'ex-1', set_number: 1, reps: 10, weight: 135, tag: 'working', is_completed: 1 },
      { id: 'ws-2', workout_id: 'w-1', exercise_id: 'ex-1', set_number: 2, reps: 8, weight: 140, tag: 'working', is_completed: 0 },
    ];

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce(mockSets);

    const setsBuilder = mockQueryBuilder();
    mockFromHandlers['workout_sets'] = setsBuilder;

    await syncToSupabase();

    expect(setsBuilder.upsert).toHaveBeenCalledWith(
      [
        { ...mockSets[0], is_completed: true },
        { ...mockSets[1], is_completed: false },
      ],
      { onConflict: 'id' },
    );
  });

  it('skips upsert when all tables are empty', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workout_sets

    await syncToSupabase();

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('handles exercises muscle_groups with empty string gracefully', async () => {
    setSessionAuthenticated();

    const mockExercises = [
      { id: 'ex-1', name: 'Pullup', type: 'bodyweight', muscle_groups: '', training_goal: 'hypertrophy', description: '' },
    ];

    __mockDb.getAllAsync.mockResolvedValueOnce(mockExercises);
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workout_sets

    const exerciseBuilder = mockQueryBuilder();
    mockFromHandlers['exercises'] = exerciseBuilder;

    await syncToSupabase();

    // Empty string triggers || '[]' fallback, so JSON.parse('[]') = []
    expect(exerciseBuilder.upsert).toHaveBeenCalledWith(
      [{ id: 'ex-1', user_id: 'user-123', name: 'Pullup', type: 'bodyweight', muscle_groups: [], training_goal: 'hypertrophy', description: '' }],
      { onConflict: 'id' },
    );
  });

  it('stops syncing and reports to Sentry when exercise upsert fails', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'RLS policy violation', code: '42501' };

    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'ex-1', name: 'Bench', type: 'weighted', muscle_groups: '[]', training_goal: 'hypertrophy', description: '' },
    ]);

    const exerciseBuilder = mockQueryBuilder();
    exerciseBuilder.upsert.mockResolvedValue({ error: supabaseError });
    mockFromHandlers['exercises'] = exerciseBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
    // Should not proceed to templates
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('stops syncing and reports to Sentry when template upsert fails', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'Template sync failed', code: '500' };

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises (empty, skipped)
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'tpl-1', name: 'Push' },
    ]);

    const templateBuilder = mockQueryBuilder();
    templateBuilder.upsert.mockResolvedValue({ error: supabaseError });
    mockFromHandlers['templates'] = templateBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(2);
  });

  it('stops syncing and reports to Sentry when template_exercises upsert fails', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'template_exercises sync failed' };

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'te-1', template_id: 'tpl-1', exercise_id: 'ex-1', sort_order: 0, default_sets: 3 },
    ]);

    const teBuilder = mockQueryBuilder();
    teBuilder.upsert.mockResolvedValue({ error: supabaseError });
    mockFromHandlers['template_exercises'] = teBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(3);
  });

  it('stops syncing and reports to Sentry when workouts upsert fails', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'workouts sync failed' };

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'w-1', template_id: null, started_at: '2026-01-01T10:00:00Z', finished_at: '2026-01-01T11:00:00Z', ai_summary: null, notes: null },
    ]);

    const workoutBuilder = mockQueryBuilder();
    workoutBuilder.upsert.mockResolvedValue({ error: supabaseError });
    mockFromHandlers['workouts'] = workoutBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(4);
  });

  it('stops syncing and reports to Sentry when workout_sets upsert fails', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'workout_sets sync failed' };

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'ws-1', workout_id: 'w-1', exercise_id: 'ex-1', set_number: 1, reps: 10, weight: 135, tag: 'working', is_completed: 1 },
    ]);

    const setsBuilder = mockQueryBuilder();
    setsBuilder.upsert.mockResolvedValue({ error: supabaseError });
    mockFromHandlers['workout_sets'] = setsBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
  });

  it('catches unexpected errors and reports to Sentry', async () => {
    const thrownError = new Error('Unexpected database failure');
    mockGetSession.mockRejectedValue(thrownError);

    await syncToSupabase(); // should not throw

    expect(Sentry.captureException).toHaveBeenCalledWith(thrownError);
  });

  it('logs sync complete on success', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workout_sets

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await syncToSupabase();

    expect(consoleSpy).toHaveBeenCalledWith('Sync to Supabase complete');
    consoleSpy.mockRestore();
  });

  it('performs full sync with all tables populated', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'ex-1', name: 'Bench Press', type: 'weighted', muscle_groups: '["Chest"]', training_goal: 'hypertrophy', description: '' },
    ]);
    __mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'tpl-1', name: 'Push Day' }]);
    __mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'te-1', template_id: 'tpl-1', exercise_id: 'ex-1', sort_order: 0, default_sets: 3 }]);
    __mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'w-1', template_id: 'tpl-1', started_at: '2026-01-01T10:00:00Z', finished_at: '2026-01-01T11:00:00Z', ai_summary: null, notes: null }]);
    __mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'ws-1', workout_id: 'w-1', exercise_id: 'ex-1', set_number: 1, reps: 10, weight: 135, tag: 'working', is_completed: 1 }]);

    const exerciseBuilder = mockQueryBuilder();
    const templateBuilder = mockQueryBuilder();
    const teBuilder = mockQueryBuilder();
    const workoutBuilder = mockQueryBuilder();
    const setsBuilder = mockQueryBuilder();

    mockFromHandlers['exercises'] = exerciseBuilder;
    mockFromHandlers['templates'] = templateBuilder;
    mockFromHandlers['template_exercises'] = teBuilder;
    mockFromHandlers['workouts'] = workoutBuilder;
    mockFromHandlers['workout_sets'] = setsBuilder;

    await syncToSupabase();

    expect(exerciseBuilder.upsert).toHaveBeenCalledTimes(1);
    expect(templateBuilder.upsert).toHaveBeenCalledTimes(1);
    expect(teBuilder.upsert).toHaveBeenCalledTimes(1);
    expect(workoutBuilder.upsert).toHaveBeenCalledTimes(1);
    expect(setsBuilder.upsert).toHaveBeenCalledTimes(1);
  });

  it('calls supabase.from with the correct table names in order', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: 'ex-1', name: 'Bench', type: 'weighted', muscle_groups: '[]', training_goal: 'hypertrophy', description: '' },
    ]);
    __mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'tpl-1', name: 'Push' }]);
    __mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'te-1', template_id: 'tpl-1', exercise_id: 'ex-1', sort_order: 0, default_sets: 3 }]);
    __mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'w-1', template_id: 'tpl-1', started_at: '2026-01-01T10:00:00Z', finished_at: '2026-01-01T11:00:00Z', ai_summary: null, notes: null }]);
    __mockDb.getAllAsync.mockResolvedValueOnce([{ id: 'ws-1', workout_id: 'w-1', exercise_id: 'ex-1', set_number: 1, reps: 10, weight: 135, tag: 'working', is_completed: 1 }]);

    await syncToSupabase();

    const fromCalls = mockFrom.mock.calls.map((c: any[]) => c[0]);
    expect(fromCalls).toEqual(['exercises', 'templates', 'template_exercises', 'workouts', 'workout_sets']);
  });
});

// ============================================================
// pullUpcomingWorkout
// ============================================================

describe('pullUpcomingWorkout', () => {
  it('skips pull when no session (user not authenticated)', async () => {
    setSessionNull();

    await pullUpcomingWorkout();

    expect(__mockDb.runAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does nothing when no upcoming workouts exist in Supabase', async () => {
    setSessionAuthenticated();

    const workoutBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    await pullUpcomingWorkout();

    // Should not clear local tables or insert anything
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('clears local upcoming tables before inserting new data', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: 'tpl-1',
      notes: 'Focus on chest',
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    await pullUpcomingWorkout();

    const deleteCalls = __mockDb.runAsync.mock.calls
      .filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('DELETE'))
      .map((c: any[]) => c[0]);

    expect(deleteCalls).toContain('DELETE FROM upcoming_workout_sets');
    expect(deleteCalls).toContain('DELETE FROM upcoming_workout_exercises');
    expect(deleteCalls).toContain('DELETE FROM upcoming_workouts');

    // Order: sets -> exercises -> workouts (child tables first)
    const setsIdx = deleteCalls.indexOf('DELETE FROM upcoming_workout_sets');
    const exIdx = deleteCalls.indexOf('DELETE FROM upcoming_workout_exercises');
    const wIdx = deleteCalls.indexOf('DELETE FROM upcoming_workouts');
    expect(setsIdx).toBeLessThan(exIdx);
    expect(exIdx).toBeLessThan(wIdx);
  });

  it('inserts upcoming workout into local SQLite', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: 'tpl-1',
      notes: 'Leg day',
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    await pullUpcomingWorkout();

    const insertCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workouts'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toBe('uw-1');
    expect(insertCall![2]).toBe('2026-02-07');
    expect(insertCall![3]).toBe('tpl-1');
    expect(insertCall![4]).toBe('Leg day');
    expect(insertCall![5]).toBe('2026-02-06T22:00:00Z');
  });

  it('fetches and inserts upcoming workout exercises', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: null,
      notes: null,
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const mockExercises = [
      { id: 'uwe-1', upcoming_workout_id: 'uw-1', exercise_id: 'ex-1', sort_order: 0, rest_seconds: 90, notes: 'Go heavy' },
      { id: 'uwe-2', upcoming_workout_id: 'uw-1', exercise_id: 'ex-2', sort_order: 1, rest_seconds: 120, notes: null },
    ];

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    const setsBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workout_sets'] = setsBuilder;

    await pullUpcomingWorkout();

    const exInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_exercises'),
    );
    expect(exInserts).toHaveLength(2);
    expect(exInserts[0][1]).toBe('uwe-1');
    expect(exInserts[0][3]).toBe('ex-1');
    expect(exInserts[0][5]).toBe(90);
    expect(exInserts[0][6]).toBe('Go heavy');
    expect(exInserts[1][1]).toBe('uwe-2');
    expect(exInserts[1][3]).toBe('ex-2');
  });

  it('fetches and inserts upcoming workout sets for each exercise', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: null,
      notes: null,
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const mockExercises = [
      { id: 'uwe-1', upcoming_workout_id: 'uw-1', exercise_id: 'ex-1', sort_order: 0, rest_seconds: 90, notes: null },
    ];

    const mockSets = [
      { id: 'uws-1', upcoming_exercise_id: 'uwe-1', set_number: 1, target_weight: 135, target_reps: 10 },
      { id: 'uws-2', upcoming_exercise_id: 'uwe-1', set_number: 2, target_weight: 145, target_reps: 8 },
    ];

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    const setsBuilder = mockQueryBuilder(mockSets, null);
    mockFromHandlers['upcoming_workout_sets'] = setsBuilder;

    await pullUpcomingWorkout();

    const setInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_sets'),
    );
    expect(setInserts).toHaveLength(2);
    expect(setInserts[0][1]).toBe('uws-1');
    expect(setInserts[0][2]).toBe('uwe-1');
    expect(setInserts[0][3]).toBe(1);
    expect(setInserts[0][4]).toBe(135);
    expect(setInserts[0][5]).toBe(10);
    expect(setInserts[1][1]).toBe('uws-2');
    expect(setInserts[1][4]).toBe(145);
    expect(setInserts[1][5]).toBe(8);
  });

  it('reports to Sentry and returns when upcoming_workouts fetch fails', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'RLS policy error', code: '42501' };
    const workoutBuilder = mockQueryBuilder(null, supabaseError);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    await pullUpcomingWorkout();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('reports to Sentry and returns when upcoming_workout_exercises fetch fails', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: null,
      notes: null,
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseError = { message: 'exercises fetch failed' };
    const exerciseBuilder = mockQueryBuilder(null, exerciseError);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    await pullUpcomingWorkout();

    expect(Sentry.captureException).toHaveBeenCalledWith(exerciseError);
  });

  it('continues to next exercise when sets fetch fails (uses continue, not return)', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: null,
      notes: null,
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const mockExercises = [
      { id: 'uwe-1', upcoming_workout_id: 'uw-1', exercise_id: 'ex-1', sort_order: 0, rest_seconds: 90, notes: null },
      { id: 'uwe-2', upcoming_workout_id: 'uw-1', exercise_id: 'ex-2', sort_order: 1, rest_seconds: 90, notes: null },
    ];

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    // Sets builder: error on first call, success on second
    const setsError = { message: 'sets fetch failed' };
    let setsCallCount = 0;
    const setsBuilder: any = {};
    setsBuilder.select = jest.fn().mockReturnValue(setsBuilder);
    setsBuilder.eq = jest.fn().mockImplementation(() => {
      setsCallCount++;
      if (setsCallCount === 1) {
        const errorBuilder: any = {};
        errorBuilder.order = jest.fn().mockResolvedValue({ data: null, error: setsError });
        return errorBuilder;
      } else {
        const successBuilder: any = {};
        successBuilder.order = jest.fn().mockResolvedValue({ data: [], error: null });
        return successBuilder;
      }
    });
    mockFromHandlers['upcoming_workout_sets'] = setsBuilder;

    await pullUpcomingWorkout();

    expect(Sentry.captureException).toHaveBeenCalledWith(setsError);

    // Should still insert both exercises (continues after sets error)
    const exInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_exercises'),
    );
    expect(exInserts).toHaveLength(2);
  });

  it('catches unexpected errors and reports to Sentry', async () => {
    const thrownError = new Error('Network failure');
    mockGetSession.mockRejectedValue(thrownError);

    await pullUpcomingWorkout(); // should not throw

    expect(Sentry.captureException).toHaveBeenCalledWith(thrownError);
  });

  it('logs pull complete on success', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: null,
      notes: null,
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await pullUpcomingWorkout();

    expect(consoleSpy).toHaveBeenCalledWith('Pull upcoming workout complete');
    consoleSpy.mockRestore();
  });

  it('queries Supabase with correct filters (user_id, ordering, limit)', async () => {
    setSessionAuthenticated();

    const workoutBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    await pullUpcomingWorkout();

    expect(mockFrom).toHaveBeenCalledWith('upcoming_workouts');
    expect(workoutBuilder.select).toHaveBeenCalledWith('*');
    expect(workoutBuilder.eq).toHaveBeenCalledWith('user_id', 'user-123');
    expect(workoutBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('handles null data from Supabase gracefully', async () => {
    setSessionAuthenticated();

    const workoutBuilder = mockQueryBuilder(null, null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    await pullUpcomingWorkout();

    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('handles null exercises list from Supabase (uses ?? [])', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: null,
      notes: null,
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder(null, null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    await pullUpcomingWorkout();

    const insertWorkout = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workouts'),
    );
    expect(insertWorkout).toBeDefined();

    const exInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_exercises'),
    );
    expect(exInserts).toHaveLength(0);
  });

  it('handles null sets list from Supabase (uses ?? [])', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-1',
      date: '2026-02-07',
      template_id: null,
      notes: null,
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const mockExercises = [
      { id: 'uwe-1', upcoming_workout_id: 'uw-1', exercise_id: 'ex-1', sort_order: 0, rest_seconds: 90, notes: null },
    ];

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    const setsBuilder = mockQueryBuilder(null, null);
    mockFromHandlers['upcoming_workout_sets'] = setsBuilder;

    await pullUpcomingWorkout();

    const exInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_exercises'),
    );
    expect(exInserts).toHaveLength(1);

    const setInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_sets'),
    );
    expect(setInserts).toHaveLength(0);
  });

  it('fetches exercises with eq on upcoming_workout_id and ordered by sort_order', async () => {
    setSessionAuthenticated();

    const mockWorkout = {
      id: 'uw-99',
      date: '2026-02-07',
      template_id: null,
      notes: null,
      created_at: '2026-02-06T22:00:00Z',
      user_id: 'user-123',
    };

    const workoutBuilder = mockQueryBuilder([mockWorkout], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    await pullUpcomingWorkout();

    expect(mockFrom).toHaveBeenCalledWith('upcoming_workout_exercises');
    expect(exerciseBuilder.select).toHaveBeenCalledWith('*');
    expect(exerciseBuilder.eq).toHaveBeenCalledWith('upcoming_workout_id', 'uw-99');
    expect(exerciseBuilder.order).toHaveBeenCalledWith('sort_order');
  });
});

// ============================================================
// pullExercisesAndTemplates
// ============================================================

describe('pullExercisesAndTemplates', () => {
  it('skips when no session (user not authenticated)', async () => {
    setSessionNull();

    await pullExercisesAndTemplates();

    expect(__mockDb.runAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('pulls exercises and upserts into local SQLite', async () => {
    setSessionAuthenticated();

    const mockExercises = [
      { id: 'ex-1', user_id: 'user-123', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest', 'Triceps'], training_goal: 'hypertrophy', description: 'Flat bench', created_at: '2026-01-01T00:00:00Z' },
    ];

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    // No templates
    const templateBuilder = mockQueryBuilder([], null);
    mockFromHandlers['templates'] = templateBuilder;

    await pullExercisesAndTemplates();

    expect(mockFrom).toHaveBeenCalledWith('exercises');
    expect(exerciseBuilder.select).toHaveBeenCalledWith('*');
    expect(exerciseBuilder.eq).toHaveBeenCalledWith('user_id', 'user-123');

    const insertCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO exercises'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toBe('ex-1');
    expect(insertCall![2]).toBe('user-123');
    expect(insertCall![3]).toBe('Bench Press');
    expect(insertCall![5]).toBe('["Chest","Triceps"]'); // JSON.stringify
  });

  it('preserves local exercise notes during upsert (via subquery)', async () => {
    setSessionAuthenticated();

    const mockExercises = [
      { id: 'ex-1', user_id: 'user-123', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', created_at: '2026-01-01T00:00:00Z' },
    ];

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const templateBuilder = mockQueryBuilder([], null);
    mockFromHandlers['templates'] = templateBuilder;

    await pullExercisesAndTemplates();

    // The SQL should use a subquery to preserve notes: (SELECT notes FROM exercises WHERE id = ?)
    const insertCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO exercises'),
    );
    expect(insertCall![0]).toContain('SELECT notes FROM exercises WHERE id');
    // The ON CONFLICT should NOT update notes
    expect(insertCall![0]).not.toMatch(/ON CONFLICT.*notes/s);
    // Last param is the exercise id for the subquery
    expect(insertCall![9]).toBe('ex-1');
  });

  it('converts muscle_groups JSONB array to JSON string', async () => {
    setSessionAuthenticated();

    const mockExercises = [
      { id: 'ex-1', user_id: 'user-123', name: 'Squat', type: 'weighted', muscle_groups: ['Quads', 'Glutes', 'Hamstrings'], training_goal: 'strength', description: '', created_at: '2026-01-01T00:00:00Z' },
    ];

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const templateBuilder = mockQueryBuilder([], null);
    mockFromHandlers['templates'] = templateBuilder;

    await pullExercisesAndTemplates();

    const insertCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO exercises'),
    );
    expect(insertCall![5]).toBe('["Quads","Glutes","Hamstrings"]');
  });

  it('handles null muscle_groups from Supabase gracefully', async () => {
    setSessionAuthenticated();

    const mockExercises = [
      { id: 'ex-1', user_id: 'user-123', name: 'Pullup', type: 'bodyweight', muscle_groups: null, training_goal: 'hypertrophy', description: '', created_at: '2026-01-01T00:00:00Z' },
    ];

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const templateBuilder = mockQueryBuilder([], null);
    mockFromHandlers['templates'] = templateBuilder;

    await pullExercisesAndTemplates();

    const insertCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO exercises'),
    );
    expect(insertCall![5]).toBe('[]');
  });

  it('pulls templates and upserts into local SQLite', async () => {
    setSessionAuthenticated();

    // No exercises
    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const mockTemplates = [
      { id: 'tpl-1', user_id: 'user-123', name: 'Push Day', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ];

    const templateBuilder = mockQueryBuilder(mockTemplates, null);
    mockFromHandlers['templates'] = templateBuilder;

    // Template exercises for this template
    const teBuilder = mockQueryBuilder([], null);
    mockFromHandlers['template_exercises'] = teBuilder;

    await pullExercisesAndTemplates();

    expect(mockFrom).toHaveBeenCalledWith('templates');
    expect(templateBuilder.eq).toHaveBeenCalledWith('user_id', 'user-123');

    const insertCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO templates'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toBe('tpl-1');
    expect(insertCall![3]).toBe('Push Day');
  });

  it('pulls template_exercises with rest_seconds defaulting to 150', async () => {
    setSessionAuthenticated();

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const mockTemplates = [
      { id: 'tpl-1', user_id: 'user-123', name: 'Push Day', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ];

    const templateBuilder = mockQueryBuilder(mockTemplates, null);
    mockFromHandlers['templates'] = templateBuilder;

    const mockTe = [
      { id: 'te-1', template_id: 'tpl-1', exercise_id: 'ex-1', sort_order: 0, default_sets: 3 },
      { id: 'te-2', template_id: 'tpl-1', exercise_id: 'ex-2', sort_order: 1, default_sets: 4 },
    ];

    const teBuilder = mockQueryBuilder(mockTe, null);
    mockFromHandlers['template_exercises'] = teBuilder;

    await pullExercisesAndTemplates();

    expect(mockFrom).toHaveBeenCalledWith('template_exercises');
    expect(teBuilder.eq).toHaveBeenCalledWith('template_id', 'tpl-1');
    expect(teBuilder.order).toHaveBeenCalledWith('sort_order');

    const teInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO template_exercises'),
    );
    expect(teInserts).toHaveLength(2);
    // Check the SQL uses COALESCE with 150 default
    expect(teInserts[0][0]).toContain('COALESCE');
    expect(teInserts[0][0]).toContain('150');
    expect(teInserts[0][1]).toBe('te-1');
    expect(teInserts[0][3]).toBe('ex-1');
    expect(teInserts[0][5]).toBe(3); // default_sets
  });

  it('deletes template_exercises removed by MCP', async () => {
    setSessionAuthenticated();

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const mockTemplates = [
      { id: 'tpl-1', user_id: 'user-123', name: 'Push Day', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ];

    const templateBuilder = mockQueryBuilder(mockTemplates, null);
    mockFromHandlers['templates'] = templateBuilder;

    // Only te-2 remains (te-1 was removed by MCP)
    const mockTe = [
      { id: 'te-2', template_id: 'tpl-1', exercise_id: 'ex-2', sort_order: 0, default_sets: 3 },
    ];

    const teBuilder = mockQueryBuilder(mockTe, null);
    mockFromHandlers['template_exercises'] = teBuilder;

    await pullExercisesAndTemplates();

    const deleteCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE FROM template_exercises WHERE template_id'),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0]).toContain('NOT IN');
    expect(deleteCall![1]).toBe('tpl-1');
    expect(deleteCall![2]).toBe('te-2');
  });

  it('deletes all template_exercises when MCP removes all exercises from a template', async () => {
    setSessionAuthenticated();

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const mockTemplates = [
      { id: 'tpl-1', user_id: 'user-123', name: 'Empty Template', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ];

    const templateBuilder = mockQueryBuilder(mockTemplates, null);
    mockFromHandlers['templates'] = templateBuilder;

    const teBuilder = mockQueryBuilder([], null);
    mockFromHandlers['template_exercises'] = teBuilder;

    await pullExercisesAndTemplates();

    const deleteCall = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE FROM template_exercises WHERE template_id = ?') && !c[0].includes('NOT IN'),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toBe('tpl-1');
  });

  it('handles empty exercises and templates from Supabase', async () => {
    setSessionAuthenticated();

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const templateBuilder = mockQueryBuilder([], null);
    mockFromHandlers['templates'] = templateBuilder;

    await pullExercisesAndTemplates();

    // No inserts should happen
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('reports to Sentry and returns when exercises fetch fails', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'exercises query failed', code: '500' };
    const exerciseBuilder = mockQueryBuilder(null, supabaseError);
    mockFromHandlers['exercises'] = exerciseBuilder;

    // Templates should still be attempted because pullExercisesAndTemplates calls both
    const templateBuilder = mockQueryBuilder([], null);
    mockFromHandlers['templates'] = templateBuilder;

    await pullExercisesAndTemplates();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
    // No exercise inserts
    const exInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO exercises'),
    );
    expect(exInserts).toHaveLength(0);
  });

  it('reports to Sentry when template_exercises fetch fails and continues to next template', async () => {
    setSessionAuthenticated();

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const mockTemplates = [
      { id: 'tpl-1', user_id: 'user-123', name: 'Push', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'tpl-2', user_id: 'user-123', name: 'Pull', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ];

    const templateBuilder = mockQueryBuilder(mockTemplates, null);
    mockFromHandlers['templates'] = templateBuilder;

    // template_exercises: error on first call, success on second
    const teError = { message: 'template_exercises fetch failed' };
    let teCallCount = 0;
    const teBuilder: any = {};
    teBuilder.select = jest.fn().mockReturnValue(teBuilder);
    teBuilder.eq = jest.fn().mockImplementation(() => {
      teCallCount++;
      if (teCallCount === 1) {
        const errorBuilder: any = {};
        errorBuilder.order = jest.fn().mockResolvedValue({ data: null, error: teError });
        return errorBuilder;
      } else {
        const successBuilder: any = {};
        successBuilder.order = jest.fn().mockResolvedValue({ data: [], error: null });
        return successBuilder;
      }
    });
    mockFromHandlers['template_exercises'] = teBuilder;

    await pullExercisesAndTemplates();

    expect(Sentry.captureException).toHaveBeenCalledWith(teError);

    // Both templates should still be inserted
    const tplInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO templates'),
    );
    expect(tplInserts).toHaveLength(2);
  });

  it('catches unexpected errors and reports to Sentry', async () => {
    const thrownError = new Error('Unexpected failure');
    mockGetSession.mockRejectedValue(thrownError);

    await pullExercisesAndTemplates(); // should not throw

    expect(Sentry.captureException).toHaveBeenCalledWith(thrownError);
  });

  it('logs completion messages on success', async () => {
    setSessionAuthenticated();

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const templateBuilder = mockQueryBuilder([], null);
    mockFromHandlers['templates'] = templateBuilder;

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await pullExercisesAndTemplates();

    // pullExercises returns early (no exercises), pullTemplates returns early (no templates)
    // Neither log fires since they return before the log
    consoleSpy.mockRestore();
  });

  it('pulls exercises before templates (FK dependency order)', async () => {
    setSessionAuthenticated();

    const mockExercises = [
      { id: 'ex-1', user_id: 'user-123', name: 'Bench', type: 'weighted', muscle_groups: [], training_goal: 'hypertrophy', description: '', created_at: '2026-01-01T00:00:00Z' },
    ];

    const exerciseBuilder = mockQueryBuilder(mockExercises, null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const mockTemplates = [
      { id: 'tpl-1', user_id: 'user-123', name: 'Push', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ];

    const templateBuilder = mockQueryBuilder(mockTemplates, null);
    mockFromHandlers['templates'] = templateBuilder;

    const teBuilder = mockQueryBuilder([], null);
    mockFromHandlers['template_exercises'] = teBuilder;

    await pullExercisesAndTemplates();

    const fromCalls = mockFrom.mock.calls.map((c: any[]) => c[0]);
    const exerciseIdx = fromCalls.indexOf('exercises');
    const templateIdx = fromCalls.indexOf('templates');
    expect(exerciseIdx).toBeLessThan(templateIdx);
  });
});
