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

/**
 * Build a chainable Supabase query builder mock.
 * Supports .select().eq().order().limit() and .upsert()
 */
function mockQueryBuilder(resolvedData: any = [], resolvedError: any = null) {
  const builder: any = {};
  builder.select = jest.fn().mockReturnValue(builder);
  builder.eq = jest.fn().mockReturnValue(builder);
  builder.in = jest.fn().mockReturnValue(builder);
  builder.not = jest.fn().mockReturnValue(builder);
  builder.order = jest.fn().mockReturnValue(builder);
  builder.limit = jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedError });
  builder.upsert = jest.fn().mockResolvedValue({ error: null });
  // Allow awaiting directly when no .limit() is called
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

// ─── Shared mock data ───

const MOCK_EXERCISE_ROW = {
  id: 'e1',
  name: 'Bench Press',
  type: 'weighted',
  muscle_groups: '["Chest"]',
  training_goal: 'hypertrophy',
  description: '',
};

const MOCK_UPCOMING_WORKOUT = {
  id: 'uw-1',
  date: '2026-02-14',
  template_id: 'tpl-1',
  notes: 'Push day',
  created_at: '2026-02-13T22:00:00Z',
  user_id: 'user-123',
};

const MOCK_UPCOMING_EXERCISES = [
  { id: 'uwe-1', upcoming_workout_id: 'uw-1', exercise_id: 'ex-1', sort_order: 0, rest_seconds: 90, notes: null },
  { id: 'uwe-2', upcoming_workout_id: 'uw-1', exercise_id: 'ex-2', sort_order: 1, rest_seconds: 120, notes: 'Go heavy' },
];

// ─── Tests ───

beforeEach(() => {
  mockFromHandlers = {};
  setupMockFrom();
});

// ============================================================
// syncToSupabase — network resilience
// ============================================================

describe('syncToSupabase resilience', () => {
  it('handles network offline: getSession throws TypeError without crashing', async () => {
    const networkError = new TypeError('Network request failed');
    mockGetSession.mockRejectedValue(networkError);

    await syncToSupabase(); // should not throw

    expect(Sentry.captureException).toHaveBeenCalledWith(networkError);
    expect(__mockDb.getAllAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('handles network offline: exercise upsert returns network error — reports to Sentry and returns early', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([MOCK_EXERCISE_ROW]);

    const networkError = { message: 'FetchError: Network request failed', code: 'NETWORK_ERROR' };
    const exerciseBuilder = mockQueryBuilder();
    exerciseBuilder.upsert.mockResolvedValue({ error: networkError });
    mockFromHandlers['exercises'] = exerciseBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(networkError);
    // Should return early — no further getAllAsync calls for templates, etc.
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('handles timeout error from Supabase exercises upsert — reports to Sentry', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([MOCK_EXERCISE_ROW]);

    const timeoutError = { code: 'PGRST301', message: 'timeout' };
    const exerciseBuilder = mockQueryBuilder();
    exerciseBuilder.upsert.mockResolvedValue({ error: timeoutError });
    mockFromHandlers['exercises'] = exerciseBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(timeoutError);
    // Early return — templates not fetched
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('handles RLS violation from upsert — reports to Sentry', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([MOCK_EXERCISE_ROW]);

    const rlsError = { code: '42501', message: 'insufficient_privilege' };
    const exerciseBuilder = mockQueryBuilder();
    exerciseBuilder.upsert.mockResolvedValue({ error: rlsError });
    mockFromHandlers['exercises'] = exerciseBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(rlsError);
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('partial failure: exercises upsert fails, later tables NOT attempted (early return)', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([MOCK_EXERCISE_ROW]);

    const exerciseError = { message: 'connection reset', code: 'XX000' };
    const exerciseBuilder = mockQueryBuilder();
    exerciseBuilder.upsert.mockResolvedValue({ error: exerciseError });
    mockFromHandlers['exercises'] = exerciseBuilder;

    const templateBuilder = mockQueryBuilder();
    mockFromHandlers['templates'] = templateBuilder;
    const teBuilder = mockQueryBuilder();
    mockFromHandlers['template_exercises'] = teBuilder;
    const workoutBuilder = mockQueryBuilder();
    mockFromHandlers['workouts'] = workoutBuilder;
    const setsBuilder = mockQueryBuilder();
    mockFromHandlers['workout_sets'] = setsBuilder;

    await syncToSupabase();

    expect(Sentry.captureException).toHaveBeenCalledWith(exerciseError);
    // Only exercises getAllAsync was called, not templates/template_exercises/workouts/sets
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(1);
    // Templates, template_exercises, workouts, workout_sets upsert never called
    expect(templateBuilder.upsert).not.toHaveBeenCalled();
    expect(teBuilder.upsert).not.toHaveBeenCalled();
    expect(workoutBuilder.upsert).not.toHaveBeenCalled();
    expect(setsBuilder.upsert).not.toHaveBeenCalled();
  });

  it('empty database: no data in any table — completes without error, no upserts sent', async () => {
    setSessionAuthenticated();

    __mockDb.getAllAsync.mockResolvedValueOnce([]); // exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // templates
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // template_exercises
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workouts
    __mockDb.getAllAsync.mockResolvedValueOnce([]); // workout_sets

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await syncToSupabase();

    // No upserts should have been called — empty arrays are skipped
    expect(mockFrom).not.toHaveBeenCalled();
    // Should still log completion
    expect(consoleSpy).toHaveBeenCalledWith('Sync to Supabase complete');
    // No Sentry errors
    expect(Sentry.captureException).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('malformed getSession response: session is undefined — returns early without error', async () => {
    mockGetSession.mockResolvedValue({ data: { session: undefined } });

    await syncToSupabase();

    // Session is falsy, so should return early
    expect(__mockDb.getAllAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

// ============================================================
// pullUpcomingWorkout — network resilience
// ============================================================

describe('pullUpcomingWorkout resilience', () => {
  it('handles network offline: getSession throws TypeError without crashing', async () => {
    const networkError = new TypeError('Network request failed');
    mockGetSession.mockRejectedValue(networkError);

    await pullUpcomingWorkout(); // should not throw

    expect(Sentry.captureException).toHaveBeenCalledWith(networkError);
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('Supabase query returns error for upcoming_workouts — reports to Sentry and returns', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'relation "upcoming_workouts" does not exist', code: '42P01' };
    const workoutBuilder = mockQueryBuilder(null, supabaseError);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    await pullUpcomingWorkout();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
    // Should not attempt any local DB writes
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('Supabase returns null data for upcoming_workouts — handles gracefully without crash', async () => {
    setSessionAuthenticated();

    const workoutBuilder = mockQueryBuilder(null, null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    await pullUpcomingWorkout();

    // null data means no workouts — should return early, no local writes
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('exercises query fails but workout fetch succeeded — reports to Sentry and returns', async () => {
    setSessionAuthenticated();

    const workoutBuilder = mockQueryBuilder([MOCK_UPCOMING_WORKOUT], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseError = { message: 'timeout on upcoming_workout_exercises', code: 'PGRST301' };
    const exerciseBuilder = mockQueryBuilder(null, exerciseError);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    await pullUpcomingWorkout();

    expect(Sentry.captureException).toHaveBeenCalledWith(exerciseError);

    // Should have cleared local tables and inserted the workout before the exercise fetch error
    const deleteCalls = __mockDb.runAsync.mock.calls
      .filter((c: any[]) => typeof c[0] === 'string' && c[0].startsWith('DELETE'))
      .map((c: any[]) => c[0]);
    expect(deleteCalls).toContain('DELETE FROM upcoming_workout_sets');
    expect(deleteCalls).toContain('DELETE FROM upcoming_workout_exercises');
    expect(deleteCalls).toContain('DELETE FROM upcoming_workouts');

    // Workout was inserted before exercise fetch
    const workoutInsert = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workouts'),
    );
    expect(workoutInsert).toBeDefined();
  });

  it('batch sets query fails — reports to Sentry, exercises still inserted', async () => {
    setSessionAuthenticated();

    const workoutBuilder = mockQueryBuilder([MOCK_UPCOMING_WORKOUT], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder(MOCK_UPCOMING_EXERCISES, null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    // Batch sets fetch returns error
    const setsError = { message: 'connection timeout on sets fetch', code: 'PGRST301' };
    const setsBuilder = mockQueryBuilder(null, setsError);
    mockFromHandlers['upcoming_workout_sets'] = setsBuilder;

    await pullUpcomingWorkout();

    // Should report the sets error
    expect(Sentry.captureException).toHaveBeenCalledWith(setsError);

    // Both exercises should still be inserted (sets error doesn't block exercise inserts)
    const exInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_exercises'),
    );
    expect(exInserts).toHaveLength(2);

    // No sets should be inserted since batch query failed
    const setInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_sets'),
    );
    expect(setInserts).toHaveLength(0);
  });

  it('SQLite insert fails during local write — reports to Sentry', async () => {
    setSessionAuthenticated();

    const workoutBuilder = mockQueryBuilder([MOCK_UPCOMING_WORKOUT], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    // Simulate SQLite failure on INSERT INTO upcoming_workouts
    const sqliteError = new Error('SQLite disk I/O error');
    __mockDb.runAsync
      .mockResolvedValueOnce({ changes: 0 }) // DELETE upcoming_workout_sets
      .mockResolvedValueOnce({ changes: 0 }) // DELETE upcoming_workout_exercises
      .mockResolvedValueOnce({ changes: 0 }) // DELETE upcoming_workouts
      .mockRejectedValueOnce(sqliteError);   // INSERT INTO upcoming_workouts throws

    await pullUpcomingWorkout(); // should not throw

    expect(Sentry.captureException).toHaveBeenCalledWith(sqliteError);
  });

  it('empty upcoming workout with no exercises — handles gracefully', async () => {
    setSessionAuthenticated();

    const workoutBuilder = mockQueryBuilder([MOCK_UPCOMING_WORKOUT], null);
    mockFromHandlers['upcoming_workouts'] = workoutBuilder;

    // Empty exercises list
    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['upcoming_workout_exercises'] = exerciseBuilder;

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await pullUpcomingWorkout();

    // Workout should be inserted
    const workoutInsert = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workouts'),
    );
    expect(workoutInsert).toBeDefined();
    expect(workoutInsert![1]).toBe('uw-1');

    // No exercise inserts
    const exInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_exercises'),
    );
    expect(exInserts).toHaveLength(0);

    // No set inserts
    const setInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO upcoming_workout_sets'),
    );
    expect(setInserts).toHaveLength(0);

    // Should log completion
    expect(consoleSpy).toHaveBeenCalledWith('Pull upcoming workout complete');
    // No errors reported
    expect(Sentry.captureException).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

// ============================================================
// pullExercisesAndTemplates — network resilience
// ============================================================

describe('pullExercisesAndTemplates resilience', () => {
  it('handles network offline: getSession throws TypeError without crashing', async () => {
    const networkError = new TypeError('Network request failed');
    mockGetSession.mockRejectedValue(networkError);

    await pullExercisesAndTemplates(); // should not throw

    expect(Sentry.captureException).toHaveBeenCalledWith(networkError);
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('Supabase exercises query returns error — reports to Sentry and returns early from pullExercises', async () => {
    setSessionAuthenticated();

    const supabaseError = { message: 'exercises table not found', code: '42P01' };
    const exerciseBuilder = mockQueryBuilder(null, supabaseError);
    mockFromHandlers['exercises'] = exerciseBuilder;

    // Templates should still be attempted
    const templateBuilder = mockQueryBuilder([], null);
    mockFromHandlers['templates'] = templateBuilder;

    await pullExercisesAndTemplates();

    expect(Sentry.captureException).toHaveBeenCalledWith(supabaseError);
    // No exercise inserts
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('Supabase template_exercises batch query error — reports to Sentry, templates still inserted', async () => {
    setSessionAuthenticated();

    const exerciseBuilder = mockQueryBuilder([], null);
    mockFromHandlers['exercises'] = exerciseBuilder;

    const mockTemplates = [
      { id: 'tpl-1', user_id: 'user-123', name: 'Push', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      { id: 'tpl-2', user_id: 'user-123', name: 'Pull', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
    ];

    const templateBuilder = mockQueryBuilder(mockTemplates, null);
    mockFromHandlers['templates'] = templateBuilder;

    // Batch template_exercises fetch returns error
    const teError = { message: 'timeout on template_exercises', code: 'PGRST301' };
    const teBuilder = mockQueryBuilder(null, teError);
    mockFromHandlers['template_exercises'] = teBuilder;

    await pullExercisesAndTemplates();

    expect(Sentry.captureException).toHaveBeenCalledWith(teError);

    // Both templates should be upserted (template_exercises error doesn't block template upserts)
    const tplInserts = __mockDb.runAsync.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO templates'),
    );
    expect(tplInserts).toHaveLength(2);
  });
});
