/**
 * Tests for Batch 5 Task 4: getPRsThisWeek must count first-ever PRs
 * (exercises with no prior history), aligning with WorkoutScreen's PR badge.
 */

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

jest.mock('../../utils/oneRepMax', () => ({
  calculateEstimated1RM: (weight: number, reps: number) => weight * (1 + reps / 30),
}));

import { __mockDb } from '../../__mocks__/expo-sqlite';
const getAllAsync = __mockDb.getAllAsync;

const { getPRsThisWeek } = require('../../services/database');

describe('Batch 5 Task 4: first-ever PRs count', () => {
  beforeEach(() => {
    getAllAsync.mockReset();
    __mockDb.getFirstAsync.mockReset();
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('counts a brand-new exercise as a PR (no prior history)', async () => {
    // This-week sets — one exercise the user has never done before
    getAllAsync
      .mockResolvedValueOnce([
        { exercise_id: 'newEx', weight: 100, reps: 5, rpe: 8 },
      ])
      // Prior sets query returns empty (no prior history for newEx)
      .mockResolvedValueOnce([]);

    const count = await getPRsThisWeek();
    expect(count).toBe(1); // first-ever PR
  });

  it('counts a PR-beating week (weekBest > priorBest)', async () => {
    getAllAsync
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 200, reps: 5, rpe: 8 },
      ])
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 180, reps: 5, rpe: 8 },
      ]);

    expect(await getPRsThisWeek()).toBe(1);
  });

  it('does NOT count when weekBest is lower than priorBest', async () => {
    getAllAsync
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 150, reps: 5, rpe: 8 },
      ])
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 200, reps: 5, rpe: 8 },
      ]);

    expect(await getPRsThisWeek()).toBe(0);
  });

  it('handles mixed: one first-ever + one PR-beat + one regression = 2 PRs', async () => {
    getAllAsync
      .mockResolvedValueOnce([
        { exercise_id: 'newEx', weight: 100, reps: 5, rpe: 8 },
        { exercise_id: 'bench', weight: 200, reps: 5, rpe: 8 },
        { exercise_id: 'squat', weight: 150, reps: 5, rpe: 8 },
      ])
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 180, reps: 5, rpe: 8 },
        { exercise_id: 'squat', weight: 200, reps: 5, rpe: 8 },
      ]);

    expect(await getPRsThisWeek()).toBe(2);
  });
});
