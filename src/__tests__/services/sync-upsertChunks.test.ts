/**
 * upsertInChunks batches pushed rows into fixed-size upsert requests (UPSERT_CHUNK_SIZE = 500)
 * so a single sync doesn't send an unbounded payload as history grows — the full local corpus is
 * re-pushed on every sync trigger. These tests pin:
 *  - >500 rows produce multiple upsert calls, correctly sliced
 *  - a failing chunk is reported to Sentry but does NOT stop the loop — later chunks still push
 *  - when the workouts push fails (workoutsOk=false), the workout_sets push is skipped entirely,
 *    including the local SELECT that would feed it (FK dependency: sets reference workout_id,
 *    so pushing sets whose parent workout row never landed would violate the FK on the server)
 */
import * as Sentry from '@sentry/react-native';
import { syncToSupabase } from '../../services/sync';
import { supabase } from '../../services/supabase';
import { getDb } from '../../services/database';

jest.mock('../../services/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, from: jest.fn() },
}));

let mockTableData: Record<string, any[]> = {};

jest.mock('../../services/database', () => ({
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockImplementation((sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve([]);
      if (sql.includes('FROM exercises')) return Promise.resolve(mockTableData.exercises ?? []);
      if (sql.includes('FROM user_exercise_notes')) return Promise.resolve(mockTableData.notes ?? []);
      if (sql.includes('FROM template_exercises')) return Promise.resolve(mockTableData.templateExercises ?? []);
      if (sql.includes('FROM templates')) return Promise.resolve(mockTableData.templates ?? []);
      if (sql.includes('FROM workout_sets')) return Promise.resolve(mockTableData.workoutSets ?? []);
      if (sql.includes('FROM workouts')) return Promise.resolve(mockTableData.workouts ?? []);
      return Promise.resolve([]);
    }),
    withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
  }),
  getCurrentUserId: jest.fn().mockReturnValue('user-1'),
  isSyncReadyForGeneration: jest.fn().mockReturnValue(true),
  clearLocalUpcomingWorkout: jest.fn(),
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

function workoutRow(id: string) {
  return {
    id, template_id: null, upcoming_workout_id: null, started_at: 'x', finished_at: 'y',
    coach_notes: null, exercise_coach_notes: null, session_notes: null, planned_exercise_ids: null,
  };
}

function setRow(id: string) {
  return {
    id, workout_id: 'w-1', exercise_id: 'ex-1', set_number: 1, reps: 5, weight: 100,
    tag: 'working', rpe: null, is_completed: 1, notes: null,
    target_weight: null, target_reps: null, target_rpe: null, exercise_order: 1, programmed_order: null,
  };
}

/** A `from(table)` handler whose `.upsert()` resolves per-call-index from `errorsByCallIndex`. */
function chunkTrackingBuilder(errorsByCallIndex: Record<number, any> = {}) {
  const upsert = jest.fn().mockImplementation(() => {
    const idx = upsert.mock.calls.length - 1;
    return Promise.resolve({ error: errorsByCallIndex[idx] ?? null });
  });
  return { upsert };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTableData = {};
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
});

describe('upsertInChunks (exercised via syncToSupabase push)', () => {
  it('splits >500 rows into correctly-sliced upsert batches', async () => {
    mockTableData.workouts = Array.from({ length: 1200 }, (_, i) => workoutRow(`w-${i}`));

    const workoutsBuilder = chunkTrackingBuilder();
    mockFrom.mockImplementation((table: string) => (table === 'workouts' ? workoutsBuilder : chunkTrackingBuilder()));

    await syncToSupabase();

    expect(workoutsBuilder.upsert).toHaveBeenCalledTimes(3);
    const batchSizes = workoutsBuilder.upsert.mock.calls.map((c: any[]) => c[0].length);
    expect(batchSizes).toEqual([500, 500, 200]);
    // Slice boundaries: batch 2 starts at w-500, batch 3 ends at w-1199.
    expect(workoutsBuilder.upsert.mock.calls[1][0][0].id).toBe('w-500');
    expect(workoutsBuilder.upsert.mock.calls[2][0][199].id).toBe('w-1199');
  });

  it('reports a failing chunk to Sentry but still pushes the remaining chunks', async () => {
    mockTableData.workouts = Array.from({ length: 1200 }, (_, i) => workoutRow(`w-${i}`));

    const chunkError = { message: 'chunk 2 failed' };
    const workoutsBuilder = chunkTrackingBuilder({ 1: chunkError }); // 2nd call (index 1) fails
    mockFrom.mockImplementation((table: string) => (table === 'workouts' ? workoutsBuilder : chunkTrackingBuilder()));

    await syncToSupabase();

    // All 3 chunks attempted despite the middle one failing — one failure must not abort the loop.
    expect(workoutsBuilder.upsert).toHaveBeenCalledTimes(3);
    expect(Sentry.captureException).toHaveBeenCalledWith(chunkError);
  });

  it('skips the workout_sets push (and its local SELECT) entirely when the workouts push fails', async () => {
    mockTableData.workouts = [workoutRow('w-1')];
    mockTableData.workoutSets = [setRow('ws-1')];

    const workoutsBuilder = chunkTrackingBuilder({ 0: { message: 'workouts push failed' } });
    mockFrom.mockImplementation((table: string) => (table === 'workouts' ? workoutsBuilder : chunkTrackingBuilder()));

    await syncToSupabase();

    expect(mockFrom).not.toHaveBeenCalledWith('workout_sets');

    // The SELECT that would have fed the push never ran either — the whole block is gated
    // behind `if (workoutsOk)`, not just the upsert call.
    const db = await getDb();
    const getAllAsyncMock = db.getAllAsync as jest.Mock;
    const setsQueried = getAllAsyncMock.mock.calls.some(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM workout_sets'),
    );
    expect(setsQueried).toBe(false);
  });
});
