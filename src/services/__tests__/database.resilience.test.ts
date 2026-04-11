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
  closeAsync: jest.Mock;
  withTransactionAsync: jest.Mock;
}};

import * as Sentry from '@sentry/react-native';
import {
  getAllExercises,
  getExerciseById,
  createExercise,
  getWorkoutHistory,
  clearAllLocalData,
  resetDatabase,
  DB_NAME,
  deleteWorkout,
  deleteTemplate,
  clearLocalUpcomingWorkout,
} from '../database';

beforeEach(() => {
  __mockDb.getAllAsync.mockClear();
  __mockDb.getFirstAsync.mockClear();
  __mockDb.runAsync.mockClear();
  __mockDb.execAsync.mockClear();
  __mockDb.closeAsync.mockClear();
  __mockDb.withTransactionAsync.mockClear();
  (Sentry.captureException as jest.Mock).mockClear();
});

// ─── DB Query Failures ───

describe('DB query failures', () => {
  it('getAllExercises — reports to Sentry and throws when getAllAsync fails', async () => {
    const error = new Error('DB read failure');
    __mockDb.getAllAsync.mockRejectedValueOnce(error);

    await expect(getAllExercises()).rejects.toThrow('DB read failure');
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('getExerciseById — reports to Sentry and throws when getAllAsync fails', async () => {
    const error = new Error('DB lookup failure');
    __mockDb.getAllAsync.mockRejectedValueOnce(error);

    await expect(getExerciseById('ex-1')).rejects.toThrow('DB lookup failure');
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('createExercise — reports to Sentry and propagates error when runAsync fails', async () => {
    const error = new Error('DB insert failure');
    __mockDb.runAsync.mockRejectedValueOnce(error);

    await expect(
      createExercise({
        name: 'Deadlift',
        type: 'weighted',
        muscle_groups: ['back'],
        training_goal: 'strength',
        description: '',
      })
    ).rejects.toThrow('DB insert failure');
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('getWorkoutHistory — reports to Sentry and throws when getAllAsync fails', async () => {
    const error = new Error('DB history failure');
    __mockDb.getAllAsync.mockRejectedValueOnce(error);

    await expect(getWorkoutHistory()).rejects.toThrow('DB history failure');
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});

// ─── Malformed Data Handling (safeJsonParse) ───

describe('malformed data handling', () => {
  it('invalid JSON in muscle_groups — returns empty array, does not crash', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([
      {
        id: '1', name: 'Curl', type: 'weighted',
        muscle_groups: '{not valid json!!!',
        training_goal: 'hypertrophy', description: '',
        created_at: '2026-01-01', user_id: null,
      },
    ]);

    const result = await getAllExercises();
    expect(result).toHaveLength(1);
    expect(result[0].muscle_groups).toEqual([]);
  });

  it('null muscle_groups field — returns empty array', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([
      {
        id: '2', name: 'Pullup', type: 'bodyweight',
        muscle_groups: null,
        training_goal: 'hypertrophy', description: '',
        created_at: '2026-01-01', user_id: null,
      },
    ]);

    const result = await getAllExercises();
    expect(result).toHaveLength(1);
    expect(result[0].muscle_groups).toEqual([]);
  });

  it('empty string muscle_groups — returns empty array', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([
      {
        id: '3', name: 'Dip', type: 'bodyweight',
        muscle_groups: '',
        training_goal: 'hypertrophy', description: '',
        created_at: '2026-01-01', user_id: null,
      },
    ]);

    const result = await getAllExercises();
    expect(result).toHaveLength(1);
    expect(result[0].muscle_groups).toEqual([]);
  });
});

// ─── Singleton Behavior ───

describe('getDb singleton', () => {
  it('returns the same database instance on multiple calls', async () => {
    // getDb is already initialized from prior test calls in this file.
    // We verify it returns the same mock db by calling two different
    // database functions and checking they both use the same mock.
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    await getAllExercises();
    await getWorkoutHistory();

    // Both calls went through the same __mockDb — if getDb() returned
    // different instances, the mock calls would not be registered here.
    const allCalls = __mockDb.getAllAsync.mock.calls;
    expect(allCalls.length).toBeGreaterThanOrEqual(2);

    // First call is the exercises query, second is the workouts query
    expect(allCalls[0][0]).toContain('exercises');
    expect(allCalls[1][0]).toContain('workouts');
  });

  it('schema is initialized once — execAsync called during first getDb, not on subsequent calls', async () => {
    // Since the module has already been loaded by other tests, getDb()
    // has already been called and the db singleton is cached.
    // We can verify that additional database operations do NOT trigger
    // another execAsync call for schema init.
    __mockDb.execAsync.mockClear();
    __mockDb.getAllAsync.mockResolvedValueOnce([]);

    await getAllExercises();

    // execAsync should NOT be called again (schema already initialized)
    expect(__mockDb.execAsync).not.toHaveBeenCalled();
  });
});

// ─── clearAllLocalData ───

describe('clearAllLocalData', () => {
  it('deletes tables in correct dependency order', async () => {
    await clearAllLocalData();

    const deleteCalls = __mockDb.runAsync.mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).startsWith('DELETE FROM'))
      .map((c: unknown[]) => {
        const match = (c[0] as string).match(/DELETE FROM (\w+)/);
        return match ? match[1] : null;
      });

    // Verify all 9 tables are cleared
    expect(deleteCalls).toHaveLength(9);

    // Verify dependency order:
    // 1. upcoming_workout_sets before upcoming_workout_exercises before upcoming_workouts
    const uSetsIdx = deleteCalls.indexOf('upcoming_workout_sets');
    const uExIdx = deleteCalls.indexOf('upcoming_workout_exercises');
    const uWorkoutsIdx = deleteCalls.indexOf('upcoming_workouts');
    expect(uSetsIdx).toBeLessThan(uExIdx);
    expect(uExIdx).toBeLessThan(uWorkoutsIdx);

    // 2. workout_sets before workouts
    const wSetsIdx = deleteCalls.indexOf('workout_sets');
    const wIdx = deleteCalls.indexOf('workouts');
    expect(wSetsIdx).toBeLessThan(wIdx);

    // 3. template_exercises before templates
    const teIdx = deleteCalls.indexOf('template_exercises');
    const tIdx = deleteCalls.indexOf('templates');
    expect(teIdx).toBeLessThan(tIdx);

    // 4. user_exercise_notes before exercises (notes depend on exercises)
    const unIdx = deleteCalls.indexOf('user_exercise_notes');
    const eIdx = deleteCalls.indexOf('exercises');
    expect(unIdx).toBeLessThan(eIdx);

    // 5. exercises is last (everything depends on it)
    expect(eIdx).toBe(deleteCalls.length - 1);

    // Verify the exact order matches the implementation
    expect(deleteCalls).toEqual([
      'upcoming_workout_sets',
      'upcoming_workout_exercises',
      'upcoming_workouts',
      'workout_sets',
      'workouts',
      'template_exercises',
      'templates',
      'user_exercise_notes',
      'exercises',
    ]);
  });

  it('does NOT use withTransactionAsync — safe for concurrent callers (sync pull loops)', async () => {
    await clearAllLocalData();
    expect(__mockDb.withTransactionAsync).not.toHaveBeenCalled();
  });
});

// ─── FK pragma and transaction integrity ───

describe('FK pragma and transaction integrity', () => {
  it('PRAGMA foreign_keys = ON is set during schema init', async () => {
    // Use jest.isolateModulesAsync to get a fresh module instance so that
    // initSchema runs and we can capture the execAsync call it makes.
    let fkPragmaWasSet = false;
    await jest.isolateModulesAsync(async () => {
      const sqliteMock = require('expo-sqlite') as typeof import('expo-sqlite') & { __mockDb: typeof __mockDb };
      // Clear before triggering init so we only see calls from this fresh load
      sqliteMock.__mockDb.execAsync.mockClear();
      const freshDb = require('../database') as typeof import('../database');
      // Trigger getDb() → initSchema()
      await freshDb.getAllExercises().catch(() => {});
      fkPragmaWasSet = sqliteMock.__mockDb.execAsync.mock.calls.some(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('PRAGMA foreign_keys = ON')
      );
    });
    expect(fkPragmaWasSet).toBe(true);
  });

  it('deleteWorkout wraps both deletes in a single transaction', async () => {
    await deleteWorkout('workout-123');
    expect(__mockDb.withTransactionAsync).toHaveBeenCalledTimes(1);

    // The two deletes must have been called inside the transaction callback
    const deleteCalls = __mockDb.runAsync.mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).startsWith('DELETE FROM'))
      .map((c: unknown[]) => {
        const match = (c[0] as string).match(/DELETE FROM (\w+)/);
        return match ? match[1] : null;
      });
    expect(deleteCalls).toContain('workout_sets');
    expect(deleteCalls).toContain('workouts');
    // Child (sets) deleted before parent (workout)
    expect(deleteCalls.indexOf('workout_sets')).toBeLessThan(deleteCalls.indexOf('workouts'));
  });

  it('deleteTemplate wraps both deletes in a single transaction', async () => {
    await deleteTemplate('template-456');
    expect(__mockDb.withTransactionAsync).toHaveBeenCalledTimes(1);

    const deleteCalls = __mockDb.runAsync.mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).startsWith('DELETE FROM'))
      .map((c: unknown[]) => {
        const match = (c[0] as string).match(/DELETE FROM (\w+)/);
        return match ? match[1] : null;
      });
    expect(deleteCalls).toContain('template_exercises');
    expect(deleteCalls).toContain('templates');
    // Child (template_exercises) deleted before parent (templates)
    expect(deleteCalls.indexOf('template_exercises')).toBeLessThan(deleteCalls.indexOf('templates'));
  });

  it('clearLocalUpcomingWorkout wraps all three deletes in a single transaction', async () => {
    await clearLocalUpcomingWorkout();
    expect(__mockDb.withTransactionAsync).toHaveBeenCalledTimes(1);

    const deleteCalls = __mockDb.runAsync.mock.calls
      .filter((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).startsWith('DELETE FROM'))
      .map((c: unknown[]) => {
        const match = (c[0] as string).match(/DELETE FROM (\w+)/);
        return match ? match[1] : null;
      });
    expect(deleteCalls).toHaveLength(3);
    expect(deleteCalls).toEqual([
      'upcoming_workout_sets',
      'upcoming_workout_exercises',
      'upcoming_workouts',
    ]);
  });
});

// ─── resetDatabase ───

describe('resetDatabase', () => {
  it('closes the database connection', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    await getAllExercises();
    __mockDb.closeAsync.mockClear();

    await resetDatabase();

    expect(__mockDb.closeAsync).toHaveBeenCalledTimes(1);
  });

  it('deletes the database file', async () => {
    const SQLite = require('expo-sqlite');
    jest.spyOn(SQLite, 'deleteDatabaseAsync');

    await resetDatabase();

    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledWith(DB_NAME);
  });

  it('reinitializes the database after deletion', async () => {
    __mockDb.execAsync.mockClear();

    await resetDatabase();

    // initSchema should have re-executed
    expect(__mockDb.execAsync).toHaveBeenCalled();

    // After reset, db operations should still work
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    const result = await getAllExercises();
    expect(result).toEqual([]);
  });

  it('survives closeAsync failure (corrupted DB)', async () => {
    __mockDb.closeAsync.mockRejectedValueOnce(new Error('DB corrupted'));

    await expect(resetDatabase()).resolves.toBeUndefined();
  });

  it('reports to Sentry and still resolves when deleteDatabaseAsync fails', async () => {
    const SQLite = require('expo-sqlite');
    jest.spyOn(SQLite, 'deleteDatabaseAsync').mockRejectedValueOnce(new Error('no space left'));
    (Sentry.captureException as jest.Mock).mockClear();

    // Should not throw — best-effort recovery proceeds with getDb()
    await expect(resetDatabase()).resolves.toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'no space left' }));
  });
});
