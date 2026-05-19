jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;
const { stampExerciseOrder } = require('../../services/database');

describe('Batch 6 Task 5: stampExerciseOrder batched UPDATE', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockReset();
    __mockDb.runAsync.mockResolvedValue({ changes: 0 } as any);
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('issues exactly ONE UPDATE for N entries (CASE WHEN, not N separate UPDATEs)', async () => {
    const entries = [
      { id: 's1', order: 1 },
      { id: 's2', order: 2 },
      { id: 's3', order: 3 },
      { id: 's4', order: 4 },
    ];
    await stampExerciseOrder('w1', entries);

    const updateCalls = __mockDb.runAsync.mock.calls.filter((call: unknown[]) =>
      typeof call[0] === 'string' && /UPDATE workout_sets SET exercise_order/i.test(call[0] as string),
    );
    expect(updateCalls.length).toBe(1);
    // The single statement should use CASE WHEN
    expect(updateCalls[0][0]).toMatch(/CASE\s+id\s+WHEN/i);
  });

  it('returns early without issuing any UPDATE on empty entries', async () => {
    await stampExerciseOrder('w1', []);
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('binds each (id, order) pair correctly into the CASE WHEN', async () => {
    await stampExerciseOrder('w1', [{ id: 's1', order: 1 }, { id: 's2', order: 2 }]);
    const call = __mockDb.runAsync.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && /UPDATE workout_sets SET exercise_order/i.test(c[0] as string),
    );
    expect(call).toBeDefined();
    // SQL is param 0; the rest are binds. For 2 entries: 2 (CASE WHEN ?) + 2 (THEN ?) + 2 (IN (?, ?)) + trailing workoutId.
    expect(call!.slice(1)).toEqual(['s1', 1, 's2', 2, 's1', 's2', 'w1']);
  });

  it('chunks input at MAX_PER_CHUNK = 300 (301 entries → 2 calls)', async () => {
    const entries = Array.from({ length: 301 }, (_, i) => ({ id: `s${i}`, order: i + 1 }));
    await stampExerciseOrder('w1', entries);

    const updateCalls = __mockDb.runAsync.mock.calls.filter((call: unknown[]) =>
      typeof call[0] === 'string' && /UPDATE workout_sets SET exercise_order/i.test(call[0] as string),
    );
    expect(updateCalls.length).toBe(2);
  });
});
