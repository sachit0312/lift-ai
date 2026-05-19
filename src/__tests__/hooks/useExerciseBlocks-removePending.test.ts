/**
 * Tests for Batch 2 Task 2: handleRemoveExercise must cancel pending
 * debounced set writes so they don't fire on already-deleted rows.
 */
import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
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

function makeBlock(setIds: string[]): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: 'ex-1', name: 'Bench' }),
    sets: setIds.map((id, i) => ({
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

describe('Batch 2 Task 2: handleRemoveExercise cancels pending writes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does NOT fire updateWorkoutSet on sets that were removed via handleRemoveExercise', async () => {
    const block = makeBlock(['s1', 's2']);
    const blocksRef = { current: [block] };
    const workoutRef = { current: { id: 'w1' } as any };
    const lastActiveBlockRef = { current: 0 };
    const debouncedSaveNotes = jest.fn();

    const { result } = renderHook(() =>
      useExerciseBlocks({ workoutRef, blocksRef, lastActiveBlockRef, debouncedSaveNotes }),
    );

    act(() => { result.current.setExerciseBlocks([block]); });

    // User types a weight into set s1 → schedules a debounced write
    act(() => {
      result.current.handleSetChange(0, 0, 'weight', '100');
    });
    // ADD: type into s2 as well so BOTH pending writes need to be cancelled
    act(() => {
      result.current.handleSetChange(0, 1, 'weight', '200');
    });

    // Stub Alert.alert to immediately invoke the "Remove" button
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const remove = (buttons ?? []).find(b => b.text === 'Remove');
      if (remove?.onPress) remove.onPress();
    });

    await act(async () => {
      await result.current.handleRemoveExercise(0);
    });

    // Advance past the 300ms debounce window
    act(() => { jest.advanceTimersByTime(500); });
    await act(async () => { await Promise.resolve(); });

    alertSpy.mockRestore();

    // deleteWorkoutSet should have been called for each set
    expect(db.deleteWorkoutSet).toHaveBeenCalledWith('s1');
    expect(db.deleteWorkoutSet).toHaveBeenCalledWith('s2');
    // updateWorkoutSet should NOT have been called with s1 (its pending write was cancelled)
    const updateCalls = (db.updateWorkoutSet as jest.Mock).mock.calls;
    expect(updateCalls.find(([id]) => id === 's1')).toBeUndefined();
    // BOTH s1 and s2 pending writes must have been cancelled
    expect(updateCalls.find(([id]) => id === 's2')).toBeUndefined();
  });
});
