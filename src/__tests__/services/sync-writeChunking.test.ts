/**
 * pullWorkoutHistory commits history writes in WRITE_CHUNK_SIZE-row transactions rather than one
 * giant transaction spanning the whole import — a single transaction across tens of thousands of
 * inserts would hold the sole SQLite write connection through the entire import, blocking every
 * other read/write in the app for that whole window (see the comment in sync.ts above the write
 * phase). Workouts are written before sets so the FK from workout_sets.workout_id is satisfied
 * across chunk boundaries. These tests pin: multiple transactions are opened (not one), and every
 * workout commits before any set does.
 */
import { pullWorkoutHistory } from '../../services/sync';
import { supabase } from '../../services/supabase';

jest.mock('../../services/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, from: jest.fn() },
}));

let mockTransactionCount = 0;
const runLog: string[] = []; // 'workout' | 'set', in call order

jest.mock('../../services/database', () => ({
  // Faithful stand-in for the real serializing wrapper: still routes through the mock db's
  // withTransactionAsync, so transaction-boundary assertions keep working.
  runInTransaction: jest.fn(async (database: any, fn: () => Promise<any>) => {
    let result: any;
    await database.withTransactionAsync(async () => { result = await fn(); });
    return result;
  }),
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn().mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO workouts')) runLog.push('workout');
      else if (typeof sql === 'string' && sql.includes('INSERT INTO workout_sets')) runLog.push('set');
      return Promise.resolve(undefined);
    }),
    getAllAsync: jest.fn().mockImplementation((sql: string) =>
      Promise.resolve(typeof sql === 'string' && sql.includes('FROM exercises') ? [{ id: 'ex-1' }] : []),
    ),
    withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => {
      mockTransactionCount++;
      await cb();
    }),
  }),
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

const PULL_PAGE_SIZE = 200;
const WRITE_CHUNK_SIZE = 500;

function workoutRow(id: string) {
  return {
    id, user_id: 'user-1', template_id: null, upcoming_workout_id: null,
    started_at: 'x', finished_at: 'y', coach_notes: null, exercise_coach_notes: null,
    session_notes: null, planned_exercise_ids: null,
  };
}

function setRow(id: string, workoutId: string) {
  return {
    id, workout_id: workoutId, exercise_id: 'ex-1', set_number: 1, reps: 5, weight: 100,
    tag: 'working', rpe: null, is_completed: true, notes: null,
    target_weight: null, target_reps: null, target_rpe: null, exercise_order: 1, programmed_order: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTransactionCount = 0;
  runLog.length = 0;
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
});

describe('pullWorkoutHistory write-phase chunking', () => {
  it('commits 1200 workouts + 1200 sets across multiple WRITE_CHUNK_SIZE transactions, workouts before sets', async () => {
    const NUM_WORKOUTS = 1200; // > 2 * WRITE_CHUNK_SIZE, forces 3 write transactions per phase
    const allWorkouts = Array.from({ length: NUM_WORKOUTS }, (_, i) => workoutRow(`w-${i}`));
    const allSets = allWorkouts.map((w, i) => setRow(`ws-${i}`, w.id));

    // Page through: 6 full pages of 200 (=1200 total), then an empty page ends pagination.
    const workoutsBuilder: any = {};
    workoutsBuilder.select = jest.fn().mockReturnValue(workoutsBuilder);
    workoutsBuilder.eq = jest.fn().mockReturnValue(workoutsBuilder);
    workoutsBuilder.not = jest.fn().mockReturnValue(workoutsBuilder);
    workoutsBuilder.order = jest.fn().mockReturnValue(workoutsBuilder);
    workoutsBuilder.range = jest.fn().mockImplementation((from: number, to: number) => {
      const data = allWorkouts.slice(from, to + 1);
      return Promise.resolve({ data, error: null });
    });

    const setsBuilder = {
      select: jest.fn().mockReturnValue({
        in: jest.fn((_field: string, ids: string[]) =>
          Promise.resolve({ data: allSets.filter((s) => ids.includes(s.workout_id)), error: null }),
        ),
      }),
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsBuilder;
      if (table === 'workout_sets') return setsBuilder;
      throw new Error(`unexpected table ${table}`);
    });

    await pullWorkoutHistory();

    expect(runLog.filter((t) => t === 'workout')).toHaveLength(NUM_WORKOUTS);
    expect(runLog.filter((t) => t === 'set')).toHaveLength(NUM_WORKOUTS);

    // The workouts write phase runs to completion before any set is written — required
    // because workout_sets.workout_id has an FK dependency on workouts.id.
    const lastWorkoutIdx = runLog.lastIndexOf('workout');
    const firstSetIdx = runLog.indexOf('set');
    expect(lastWorkoutIdx).toBeLessThan(firstSetIdx);

    // 3 transactions for workouts (500 + 500 + 200) + 3 for sets (500 + 500 + 200) = 6 —
    // not one giant transaction spanning the whole 2400-row import.
    const expectedChunksPerPhase = Math.ceil(NUM_WORKOUTS / WRITE_CHUNK_SIZE);
    expect(mockTransactionCount).toBe(expectedChunksPerPhase * 2);

    // Sanity check on the page count implied by the fixture (6 full + 1 empty).
    expect(workoutsBuilder.range.mock.calls.length).toBe(NUM_WORKOUTS / PULL_PAGE_SIZE + 1);
  });
});
