/**
 * Tests for Batch 4 Task 4: pullWorkoutHistory must serialize JSONB columns
 * (planned_exercise_ids, exercise_coach_notes) via JSON.stringify before
 * binding to SQLite TEXT columns.
 *
 * Supabase returns these as parsed JS values (array, object); naive binding
 * coerces them to "[object Object]" or "a,b,c" via toString.
 */
import { pullWorkoutHistory } from '../../services/sync';

// Capture all db.runAsync invocations so we can inspect what was bound.
const runAsyncCalls: unknown[][] = [];

jest.mock('../../services/database', () => ({
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn((...args: unknown[]) => {
      runAsyncCalls.push(args);
      return Promise.resolve();
    }),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
  }),
}));

jest.mock('../../services/supabase', () => {
  const inFn = jest.fn().mockReturnValue({ data: [], error: null });
  const notFn = jest.fn().mockReturnValue({ in: inFn });
  const workoutPage = {
    data: [
      {
        id: 'w1',
        user_id: 'u1',
        template_id: null,
        upcoming_workout_id: null,
        started_at: '2026-05-17T10:00:00Z',
        finished_at: '2026-05-17T11:00:00Z',
        coach_notes: null,
        // JSONB columns arrive as parsed JS values, NOT strings
        exercise_coach_notes: { 'ex-bench': 'good form' },
        session_notes: null,
        planned_exercise_ids: ['ex-bench', 'ex-squat'],
      },
    ],
    error: null,
  };
  // pullWorkoutHistory chains .order('finished_at').order('id').range(...) — the unique id
  // tiebreaker keeps range pagination stable, so .order() must self-chain.
  const orderFn: any = jest.fn(function selfChain(): any {
    return { order: selfChain, range: jest.fn().mockReturnValue(workoutPage) };
  });
  return {
    supabase: {
      auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({ order: orderFn }),
          }),
          in: inFn,
        }),
      }),
    },
  };
});

describe('Batch 4 Task 4: JSONB round-trip on pull', () => {
  beforeEach(() => { runAsyncCalls.length = 0; });

  it('serializes planned_exercise_ids as JSON string before binding to SQLite', async () => {
    await pullWorkoutHistory();
    const workoutsInsert = runAsyncCalls.find((args) =>
      typeof args[0] === 'string' && (args[0] as string).startsWith('INSERT INTO workouts'),
    );
    expect(workoutsInsert).toBeDefined();
    // The bind params start at index 1. planned_exercise_ids is the LAST param
    // per the existing INSERT shape (10 columns).
    const plannedBind = workoutsInsert![10];
    expect(typeof plannedBind).toBe('string');
    expect(plannedBind).toBe('["ex-bench","ex-squat"]');
  });

  it('serializes exercise_coach_notes as JSON string', async () => {
    await pullWorkoutHistory();
    const workoutsInsert = runAsyncCalls.find((args) =>
      typeof args[0] === 'string' && (args[0] as string).startsWith('INSERT INTO workouts'),
    );
    // exercise_coach_notes is param index 8 in the existing column order.
    const ecnBind = workoutsInsert![8];
    expect(typeof ecnBind).toBe('string');
    expect(ecnBind).toBe('{"ex-bench":"good form"}');
  });

  it('leaves null values null (not the string "null")', async () => {
    // Re-mock with null values for these fields
    const supabaseMock = require('../../services/supabase').supabase;
    (supabaseMock.from as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          not: jest.fn().mockReturnValue({
            // .order() self-chains for the same reason as the module-level mock above.
            order: jest.fn(function selfChain(): any {
              return {
                order: selfChain,
                range: jest.fn().mockReturnValue({
                  data: [{
                    id: 'w2', user_id: 'u1', template_id: null, upcoming_workout_id: null,
                    started_at: 'x', finished_at: 'y', coach_notes: null,
                    exercise_coach_notes: null, session_notes: null, planned_exercise_ids: null,
                  }],
                  error: null,
                }),
              };
            }),
          }),
        }),
      }),
    });

    runAsyncCalls.length = 0;
    await pullWorkoutHistory();
    const workoutsInsert = runAsyncCalls.find((args) =>
      typeof args[0] === 'string' && (args[0] as string).startsWith('INSERT INTO workouts'),
    );
    expect(workoutsInsert).toBeDefined();
    expect(workoutsInsert![8]).toBeNull();
    expect(workoutsInsert![10]).toBeNull();
  });
});

describe('Batch 4 Task 4: serializer helpers', () => {
  it('textToJsonb: null stays null', () => {
    const { textToJsonb } = require('../../services/sync');
    expect(textToJsonb(null)).toBeNull();
  });
  it('textToJsonb: valid JSON string parses to original value', () => {
    const { textToJsonb } = require('../../services/sync');
    expect(textToJsonb('["a","b"]')).toEqual(['a', 'b']);
    expect(textToJsonb('{"x":1}')).toEqual({ x: 1 });
  });
  it('textToJsonb: invalid JSON returns null defensively', () => {
    const { textToJsonb } = require('../../services/sync');
    expect(textToJsonb('not-json')).toBeNull();
  });
  it('jsonbToText: passes through an already-stringified value', () => {
    const { jsonbToText } = require('../../services/sync');
    expect(jsonbToText('["a","b"]')).toBe('["a","b"]'); // already a string — no double-encode
  });
});
