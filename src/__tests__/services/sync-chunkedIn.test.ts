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
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({ data: manyWorkouts, error: null }),
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
});
