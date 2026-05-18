/**
 * Tests for Batch 5 Task 2: getExerciseHistory must surface exercise_order,
 * programmed_order, and target_* columns from workout_sets instead of
 * hardcoding them to defaults.
 */

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

import { __mockDb } from '../../__mocks__/expo-sqlite';
const getAllAsync = __mockDb.getAllAsync;

const { getExerciseHistory } = require('../../services/database');

describe('Batch 5 Task 2: getExerciseHistory surfaces all columns', () => {
  beforeEach(() => {
    getAllAsync.mockReset();
    __mockDb.getFirstAsync.mockReset();
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('returns exercise_order, programmed_order, and target_* from the underlying row', async () => {
    // 1st call: workout IDs
    getAllAsync.mockResolvedValueOnce([{ id: 'w1' }]);
    // 2nd call: joined rows with the new s_* columns
    getAllAsync.mockResolvedValueOnce([
      {
        w_id: 'w1', w_user_id: 'u1', w_template_id: null,
        w_upcoming_workout_id: null,
        w_started_at: 't1', w_finished_at: 't2',
        w_coach_notes: null, w_exercise_coach_notes: null, w_session_notes: null,
        s_id: 's1', s_workout_id: 'w1', s_exercise_id: 'ex1',
        s_set_number: 1, s_reps: 5, s_weight: 100,
        s_tag: 'working', s_rpe: 8, s_is_completed: 1, s_notes: null,
        s_target_weight: 95, s_target_reps: 5, s_target_rpe: 8,
        s_exercise_order: 2, s_programmed_order: 1,
      },
    ]);

    const result = await getExerciseHistory('ex1', 5);

    expect(result).toHaveLength(1);
    expect(result[0].sets).toHaveLength(1);
    const set = result[0].sets[0];
    expect(set.exercise_order).toBe(2);
    expect(set.programmed_order).toBe(1);
    expect(set.target_weight).toBe(95);
    expect(set.target_reps).toBe(5);
    expect(set.target_rpe).toBe(8);
  });

  it('grep invariant: getExerciseHistory SELECT includes the five columns', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/database.ts'),
      'utf8',
    );
    // Locate the getExerciseHistory body and check the JOIN SELECT
    const fnMatch = src.match(/export function getExerciseHistory[\s\S]*?(?=export function|\Z)/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toMatch(/ws\.exercise_order\s+as\s+s_exercise_order/);
    expect(fnBody).toMatch(/ws\.programmed_order\s+as\s+s_programmed_order/);
    expect(fnBody).toMatch(/ws\.target_weight\s+as\s+s_target_weight/);
    expect(fnBody).toMatch(/ws\.target_reps\s+as\s+s_target_reps/);
    expect(fnBody).toMatch(/ws\.target_rpe\s+as\s+s_target_rpe/);
  });
});
