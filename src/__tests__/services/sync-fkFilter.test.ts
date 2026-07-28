/**
 * pullWorkoutHistory drops any pulled workout_set whose exercise_id isn't present in the local
 * exercises table before inserting. foreign_keys=ON, and each write chunk is one transaction —
 * so a single orphan row (reachable if pullExercises bailed early and its wrapper swallowed the
 * error) would otherwise trip the FK constraint and roll back the entire chunk of workouts, not
 * just the offending set, leaving History empty with no user-visible explanation. These tests
 * pin: the orphan is skipped, its siblings still import, and handleSyncError names exactly how
 * many were skipped.
 */
import * as Sentry from '@sentry/react-native';
import { pullWorkoutHistory } from '../../services/sync';
import { supabase } from '../../services/supabase';

jest.mock('../../services/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, from: jest.fn() },
}));

const runAsyncCalls: any[][] = [];
let mockLocalExerciseIds: string[] = [];

jest.mock('../../services/database', () => ({
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn().mockImplementation((...args: any[]) => {
      runAsyncCalls.push(args);
      return Promise.resolve(undefined);
    }),
    getAllAsync: jest.fn().mockImplementation((sql: string) =>
      Promise.resolve(
        typeof sql === 'string' && sql.includes('FROM exercises') ? mockLocalExerciseIds.map((id) => ({ id })) : [],
      ),
    ),
    withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
  }),
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

function workoutRow(id: string) {
  return {
    id, user_id: 'user-1', template_id: null, upcoming_workout_id: null,
    started_at: 'x', finished_at: 'y', coach_notes: null, exercise_coach_notes: null,
    session_notes: null, planned_exercise_ids: null,
  };
}

function setRow(id: string, exerciseId: string) {
  return {
    id, workout_id: 'w-1', exercise_id: exerciseId, set_number: 1, reps: 5, weight: 100,
    tag: 'working', rpe: null, is_completed: true, notes: null,
    target_weight: null, target_reps: null, target_rpe: null, exercise_order: 1, programmed_order: null,
  };
}

/** Single-page `workouts` query chain — returns `rows` once, then empty (ends pagination). */
function buildWorkoutsQuery(rows: any[]) {
  let page = 0;
  const builder: any = {};
  builder.select = jest.fn().mockReturnValue(builder);
  builder.eq = jest.fn().mockReturnValue(builder);
  builder.not = jest.fn().mockReturnValue(builder);
  builder.order = jest.fn().mockReturnValue(builder);
  builder.range = jest.fn().mockImplementation(() => {
    const data = page === 0 ? rows : [];
    page++;
    return Promise.resolve({ data, error: null });
  });
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  runAsyncCalls.length = 0;
  mockLocalExerciseIds = [];
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
});

describe('pullWorkoutHistory FK pre-filter on workout_sets', () => {
  it('skips a set whose exercise_id is missing locally, imports its siblings, and reports the skipped count', async () => {
    mockLocalExerciseIds = ['ex-1', 'ex-2']; // 'ex-orphan' deliberately absent

    const workoutsBuilder = buildWorkoutsQuery([workoutRow('w-1')]);
    const sets = [
      setRow('ws-1', 'ex-1'),
      setRow('ws-2', 'ex-orphan'), // must be dropped — no local exercise row
      setRow('ws-3', 'ex-2'),
    ];
    const setsBuilder = { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: sets, error: null }) }) };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsBuilder;
      if (table === 'workout_sets') return setsBuilder;
      throw new Error(`unexpected table ${table}`);
    });

    await pullWorkoutHistory();

    const setInserts = runAsyncCalls.filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_sets'));
    expect(setInserts).toHaveLength(2);
    const insertedIds = setInserts.map((c) => c[1]); // `id` is the first bound param
    expect(insertedIds).toEqual(['ws-1', 'ws-3']);
    expect(insertedIds).not.toContain('ws-2');

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Skipped 1 set(s) referencing exercises missing locally' }),
    );
  });

  it('imports all sets and does not report to Sentry when every exercise_id resolves locally', async () => {
    mockLocalExerciseIds = ['ex-1', 'ex-2'];

    const workoutsBuilder = buildWorkoutsQuery([workoutRow('w-1')]);
    const sets = [setRow('ws-1', 'ex-1'), setRow('ws-2', 'ex-2')];
    const setsBuilder = { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: sets, error: null }) }) };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsBuilder;
      if (table === 'workout_sets') return setsBuilder;
      throw new Error(`unexpected table ${table}`);
    });

    await pullWorkoutHistory();

    const setInserts = runAsyncCalls.filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_sets'));
    expect(setInserts).toHaveLength(2);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('drops ALL sets (reports the full count) when no local exercises exist at all', async () => {
    mockLocalExerciseIds = []; // e.g. pullExercises bailed before this ran

    const workoutsBuilder = buildWorkoutsQuery([workoutRow('w-1')]);
    const sets = [setRow('ws-1', 'ex-1'), setRow('ws-2', 'ex-2')];
    const setsBuilder = { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: sets, error: null }) }) };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsBuilder;
      if (table === 'workout_sets') return setsBuilder;
      throw new Error(`unexpected table ${table}`);
    });

    await pullWorkoutHistory();

    const setInserts = runAsyncCalls.filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workout_sets'));
    expect(setInserts).toHaveLength(0);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Skipped 2 set(s) referencing exercises missing locally' }),
    );

    // The workout itself (no FK on exercise_id) still imports — only sets are gated.
    const workoutInserts = runAsyncCalls.filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workouts'));
    expect(workoutInserts).toHaveLength(1);
  });
});
