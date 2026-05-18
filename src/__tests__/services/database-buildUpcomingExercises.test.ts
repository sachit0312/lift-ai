/**
 * Tests for Batch 5 Task 1: buildUpcomingExercises must batch the
 * upcoming_workout_sets fetch into a single IN query, not N per-exercise queries.
 */

// Mock supabase to bypass the env-var check that throws at import time.
jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

// Reuse the global expo-sqlite mock — the moduleNameMapper points to
// src/__mocks__/expo-sqlite.ts, and we read its __mockDb to control return values.
import { __mockDb } from '../../__mocks__/expo-sqlite';
const getAllAsync = __mockDb.getAllAsync;

const { getUpcomingWorkoutForToday } = require('../../services/database');

describe('Batch 5 Task 1: buildUpcomingExercises batched fetch', () => {
  beforeEach(() => {
    getAllAsync.mockReset();
    // Also reset getFirstAsync since initSchema may invoke it.
    __mockDb.getFirstAsync.mockReset();
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('issues exactly ONE upcoming_workout_sets query for N upcoming exercises', async () => {
    // 1st call: upcoming_workouts for today
    // 2nd call: upcoming_workout_exercises JOIN exercises (N rows)
    // 3rd call: SHOULD BE a single IN query, NOT N separate queries
    const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    getAllAsync
      .mockResolvedValueOnce([{ id: 'uw1', date: today, name: 'Today', notes: null, template_id: null, created_at: 't' }]) // upcoming_workouts
      .mockResolvedValueOnce([
        { id: 'ue1', upcoming_workout_id: 'uw1', exercise_id: 'ex1', sort_order: 0, rest_seconds: 90, notes: null, e_id: 'ex1', e_user_id: null, e_name: 'A', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
        { id: 'ue2', upcoming_workout_id: 'uw1', exercise_id: 'ex2', sort_order: 1, rest_seconds: 90, notes: null, e_id: 'ex2', e_user_id: null, e_name: 'B', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
        { id: 'ue3', upcoming_workout_id: 'uw1', exercise_id: 'ex3', sort_order: 2, rest_seconds: 90, notes: null, e_id: 'ex3', e_user_id: null, e_name: 'C', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
      ])
      // ONE batched sets query (the fix). Pre-fix this would be 3 separate calls.
      .mockResolvedValueOnce([
        { id: 's1', upcoming_exercise_id: 'ue1', set_number: 1, target_weight: 100, target_reps: 5, target_rpe: 8, tag: 'working' },
        { id: 's2', upcoming_exercise_id: 'ue2', set_number: 1, target_weight: 200, target_reps: 5, target_rpe: 8, tag: 'working' },
        { id: 's3', upcoming_exercise_id: 'ue3', set_number: 1, target_weight: 300, target_reps: 5, target_rpe: 8, tag: 'working' },
      ]);

    const result = await getUpcomingWorkoutForToday();

    expect(result).not.toBeNull();
    expect(result!.exercises).toHaveLength(3);
    // The third call (sets) should be a SINGLE IN query.
    const setsCallCount = getAllAsync.mock.calls.filter(call => /upcoming_workout_sets/i.test(call[0] as string)).length;
    expect(setsCallCount).toBe(1);
  });

  it('groups returned sets back to their parent exercise correctly', async () => {
    const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    getAllAsync
      .mockResolvedValueOnce([{ id: 'uw1', date: today, name: 'Today', notes: null, template_id: null, created_at: 't' }])
      .mockResolvedValueOnce([
        { id: 'ue1', upcoming_workout_id: 'uw1', exercise_id: 'ex1', sort_order: 0, rest_seconds: 90, notes: null, e_id: 'ex1', e_user_id: null, e_name: 'A', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
        { id: 'ue2', upcoming_workout_id: 'uw1', exercise_id: 'ex2', sort_order: 1, rest_seconds: 90, notes: null, e_id: 'ex2', e_user_id: null, e_name: 'B', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
      ])
      .mockResolvedValueOnce([
        // Deliberately out of order — grouping must still partition correctly.
        { id: 's2a', upcoming_exercise_id: 'ue2', set_number: 1, target_weight: 200, target_reps: 5, target_rpe: 8, tag: 'working' },
        { id: 's1a', upcoming_exercise_id: 'ue1', set_number: 1, target_weight: 100, target_reps: 5, target_rpe: 8, tag: 'working' },
        { id: 's1b', upcoming_exercise_id: 'ue1', set_number: 2, target_weight: 100, target_reps: 5, target_rpe: 8, tag: 'working' },
      ]);

    const result = await getUpcomingWorkoutForToday();
    expect(result!.exercises[0].sets).toHaveLength(2); // ue1
    expect(result!.exercises[1].sets).toHaveLength(1); // ue2
    expect(result!.exercises[0].sets.map((s: { set_number: number }) => s.set_number)).toEqual([1, 2]); // sorted within group
  });
});
