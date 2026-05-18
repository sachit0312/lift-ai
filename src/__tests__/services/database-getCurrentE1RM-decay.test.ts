/**
 * Verifies the freshness-decay formula in getCurrentE1RM:
 *   decay = exp(-ln(2) * daysAgo / FRESHNESS_HALF_LIFE_DAYS)
 *
 * An old PR weighted by decay should yield a smaller "current" than a recent
 * submaximal lift if the old PR is old enough.
 */

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

jest.mock('../../utils/oneRepMax', () => {
  const actual = jest.requireActual('../../utils/oneRepMax');
  return {
    ...actual,
    calculateEstimated1RM: (w: number, r: number) => w * (1 + r / 30),
  };
});

const { getCurrentE1RM } = require('../../services/database');

describe('getCurrentE1RM freshness decay', () => {
  beforeEach(() => {
    __mockDb.getAllAsync.mockReset();
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.runAsync.mockResolvedValue({ changes: 0 } as any);
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('sanity: calculateEstimated1RM mock is intercepted by the database module', () => {
    const { calculateEstimated1RM } = require('../../utils/oneRepMax');
    // Mock formula: w * (1 + r/30) → 100 * (1 + 5/30) = 116.6...
    expect(calculateEstimated1RM(100, 5)).toBeCloseTo(100 * (1 + 5/30), 2);
  });

  it('returns null when no completed sets', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    expect(await getCurrentE1RM('ex1')).toBeNull();
  });

  it('returns decay-weighted best — old PR weighted less than recent submaximal', async () => {
    const now = Date.now();
    const oneYearAgo = new Date(now - 365 * 86400000).toISOString();
    const today = new Date(now).toISOString();

    __mockDb.getAllAsync.mockResolvedValueOnce([
      // Old PR: 300×5 ≈ raw 350 e1RM; ~365 days old; half-life 42 → ~6 half-lives → decay ≈ 0.015
      { exercise_id: 'ex1', weight: 300, reps: 5, rpe: 8, finished_at: oneYearAgo },
      // Recent submaximal: 150×5 ≈ raw 175 e1RM; today; decay ≈ 1.0
      { exercise_id: 'ex1', weight: 150, reps: 5, rpe: 8, finished_at: today },
    ]);

    const current = await getCurrentE1RM('ex1');
    expect(current).not.toBeNull();
    // The recent submaximal (~175) should beat the heavily-decayed old PR (~5)
    expect(current).toBeCloseTo(175, 0);
  });

  it('returns full raw value (decay ≈ 1) for today\'s sets', async () => {
    const today = new Date().toISOString();
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex1', weight: 200, reps: 5, rpe: 8, finished_at: today },
    ]);

    const current = await getCurrentE1RM('ex1');
    // Raw: 200 * (1 + 5/30) ≈ 233.3; decay today ≈ 1 → expect ≈ 233.3
    expect(current).toBeCloseTo(233.3, 0);
  });

  it('returns the maximum weighted value across multiple sets', async () => {
    const today = new Date().toISOString();
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex1', weight: 200, reps: 5, rpe: 8, finished_at: today },  // ~233.3
      { exercise_id: 'ex1', weight: 220, reps: 5, rpe: 8, finished_at: today },  // ~256.7 (higher)
      { exercise_id: 'ex1', weight: 180, reps: 5, rpe: 8, finished_at: today },  // ~210
    ]);
    const current = await getCurrentE1RM('ex1');
    expect(current).toBeCloseTo(256.7, 0);
  });

  it('approximately halves the weighted value at one half-life (42 days)', async () => {
    const halfLifeAgo = new Date(Date.now() - 42 * 86400000).toISOString();
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex1', weight: 200, reps: 5, rpe: 8, finished_at: halfLifeAgo },
    ]);
    const current = await getCurrentE1RM('ex1');
    // Raw ≈ 233.3; at one half-life decay is exactly 0.5 → expect ≈ 116.7
    expect(current).toBeCloseTo(233.3 * 0.5, 0);
  });
});
