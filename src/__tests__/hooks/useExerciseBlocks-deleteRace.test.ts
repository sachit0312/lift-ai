/**
 * Tests for Batch 2 Task 4: handleDeleteSet must drop concurrent calls
 * to avoid operating on stale blocksRef state.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useExerciseBlocks } from '../../hooks/useExerciseBlocks';
import type { ExerciseBlock } from '../../types/workout';
import { createMockExercise } from '../helpers/factories';

jest.mock('../../services/database', () => ({
  addWorkoutSet: jest.fn().mockResolvedValue({ id: 'new-set' }),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
  deleteWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/exerciseHistory', () => ({
  getExerciseHistoryData: jest.fn().mockResolvedValue({ previousSets: [], lastTime: null }),
}));

const db = require('../../services/database');

function makeBlock(): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: 'ex-1' }),
    sets: ['s1', 's2', 's3'].map((id, i) => ({
      id,
      exercise_id: 'ex-1',
      set_number: i + 1,
      weight: '',
      reps: '',
      rpe: '',
      tag: 'working',
      is_completed: false,
      previous: null,
      exercise_order: 1,
    })),
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: true,
    bestE1RM: undefined,
  };
}

describe('Batch 2 Task 4: handleDeleteSet rapid-succession guard', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('drops a second concurrent handleDeleteSet call (only one deleteWorkoutSet fires)', async () => {
    const block = makeBlock();
    const blocksRef = { current: [block] };

    const { result } = renderHook(() =>
      useExerciseBlocks({
        workoutRef: { current: { id: 'w1' } as any },
        blocksRef,
        lastActiveBlockRef: { current: 0 },
        debouncedSaveNotes: jest.fn(),
      }),
    );

    act(() => { result.current.setExerciseBlocks([block]); });

    // Fire two deletes in the same microtask
    await act(async () => {
      const p1 = result.current.handleDeleteSet(0, 0);
      const p2 = result.current.handleDeleteSet(0, 0);
      await Promise.all([p1, p2]);
    });

    // Only one delete should have fired for s1
    const deletesS1 = (db.deleteWorkoutSet as jest.Mock).mock.calls.filter(([id]) => id === 's1');
    expect(deletesS1.length).toBe(1);
  });
});
