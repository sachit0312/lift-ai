/**
 * Tests for Batch 6 Task 4: getE1RMSummary returns best, current, and confidence
 * in one query — replaces three separate JOIN scans at the call site.
 */

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

jest.mock('../../utils/oneRepMax', () => ({
  calculateEstimated1RM: (w: number, r: number) => w * (1 + r / 30),
  calculateE1RM: (w: number, r: number) => ({ value: w * (1 + r / 30), confidence: 'HIGH', margin: 0 }),
  FRESHNESS_HALF_LIFE_DAYS: 42,
}));

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;
const { getE1RMSummary } = require('../../services/database');

describe('Batch 6 Task 4: getE1RMSummary single-scan', () => {
  beforeEach(() => {
    __mockDb.getAllAsync.mockReset();
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.runAsync.mockResolvedValue({ changes: 0 } as any);
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('returns null when there are no completed sets for the exercise', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    const result = await getE1RMSummary('ex-bench');
    expect(result).toBeNull();
  });

  it('returns best (raw), current (decay-weighted), and confidence in ONE getAllAsync call', async () => {
    const today = new Date().toISOString();
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-bench', weight: 200, reps: 5, rpe: 8, finished_at: today },
      { exercise_id: 'ex-bench', weight: 180, reps: 8, rpe: 9, finished_at: today },
    ]);

    const result = await getE1RMSummary('ex-bench');
    expect(result).not.toBeNull();
    expect(result!.best).toBeGreaterThan(0);
    expect(result!.current).toBeGreaterThan(0);
    expect(result!.confidence).not.toBeNull();
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('current value is less than best when the highest set is old', async () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year ago
    __mockDb.getAllAsync.mockResolvedValueOnce([
      // Old heaviest lift — high raw value, low decay-weighted
      { exercise_id: 'ex-bench', weight: 300, reps: 5, rpe: 8, finished_at: old },
      // Recent lighter lift
      { exercise_id: 'ex-bench', weight: 150, reps: 5, rpe: 8, finished_at: recent },
    ]);

    const result = await getE1RMSummary('ex-bench');
    expect(result).not.toBeNull();
    expect(result!.best).toBeGreaterThan(result!.current!); // old PR > current capacity
  });
});
