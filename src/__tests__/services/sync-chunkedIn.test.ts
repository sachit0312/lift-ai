/**
 * Tests for Batch 4 Task 5: pullWorkoutHistory chunks the workout_sets
 * .in('workout_id', ...) query to ≤50 IDs to avoid PostgREST URL truncation.
 */
import { pullWorkoutHistory } from '../../services/sync';

const inCalls: unknown[][] = [];

jest.mock('../../services/database', () => ({
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
  }),
}));

jest.mock('../../services/supabase', () => {
  // Build a mock that records all .in('workout_id', ids) invocations
  const inFn = jest.fn((field: string, ids: unknown[]) => {
    inCalls.push([field, ids]);
    return { data: [], error: null };
  });

  // Generate 120 workouts so we expect 3 chunks (50 + 50 + 20)
  const manyWorkouts = Array.from({ length: 120 }, (_, i) => ({
    id: `w${i}`, user_id: 'u1', template_id: null, upcoming_workout_id: null,
    started_at: 'x', finished_at: 'y', coach_notes: null,
    exercise_coach_notes: null, session_notes: null, planned_exercise_ids: null,
  }));

  return {
    supabase: {
      auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              // pullWorkoutHistory chains .order('finished_at').order('id').range(...) — the
              // unique id tiebreaker is what keeps range pagination stable, so .order() has
              // to self-chain here rather than return a range-only object.
              order: jest.fn(function selfChain(): any {
                return {
                  order: selfChain,
                  range: jest.fn().mockReturnValue({ data: manyWorkouts, error: null }),
                };
              }),
            }),
          }),
          in: inFn,
        }),
      }),
    },
  };
});

describe('Batch 4 Task 5: chunked .in() on workout_sets', () => {
  beforeEach(() => { inCalls.length = 0; });

  it('chunks 120 workout IDs into 3 requests of size 50,50,20', async () => {
    await pullWorkoutHistory();
    const chunks = inCalls.filter(([field]) => field === 'workout_id');
    expect(chunks).toHaveLength(3);
    expect((chunks[0][1] as string[]).length).toBe(50);
    expect((chunks[1][1] as string[]).length).toBe(50);
    expect((chunks[2][1] as string[]).length).toBe(20);
  });

  it('grep invariant: pullWorkoutHistory uses a chunk size constant <= 50', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/sync.ts'),
      'utf8',
    );
    // Look for an obvious chunk-size literal or constant.
    expect(src).toMatch(/IN_CHUNK_SIZE\s*=\s*(50|[1-4][0-9])\b|workoutIds\.slice\(/);
  });

  it('bails on chunk error without processing subsequent chunks', async () => {
    let callCount = 0;
    const inErr = jest.fn((field: string, ids: unknown[]) => {
      callCount++;
      inCalls.push([field, ids]);
      if (callCount === 1) return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: { message: 'chunk failure' } });
    });

    const sud = require('../../services/supabase');
    const fromMock = sud.supabase.from as jest.Mock;
    fromMock.mockReset();
    fromMock.mockImplementation((table: string) => {
      if (table === 'workout_sets') {
        return { select: jest.fn().mockReturnValue({ in: inErr }) };
      }
      // workouts query — produce 120 rows for 3 chunks
      const manyWorkouts = Array.from({ length: 120 }, (_, i) => ({
        id: 'w' + i, user_id: 'u1', template_id: null, upcoming_workout_id: null,
        started_at: 'x', finished_at: 'y', coach_notes: null,
        exercise_coach_notes: null, session_notes: null, planned_exercise_ids: null,
      }));
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              // See the note on the other order mock: .order() must self-chain.
              order: jest.fn(function selfChain(): any {
                return {
                  order: selfChain,
                  range: jest.fn().mockReturnValue({ data: manyWorkouts, error: null }),
                };
              }),
            }),
          }),
        }),
      };
    });

    await pullWorkoutHistory();
    const setsChunks = inCalls.filter(([field]) => field === 'workout_id');
    // At most 2 chunks should have been attempted (1 OK + 1 fails → bail).
    expect(setsChunks.length).toBeLessThanOrEqual(2);
  });
});
