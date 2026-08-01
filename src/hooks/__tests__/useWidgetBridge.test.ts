import { renderHook, act } from '@testing-library/react-native';
import { useWidgetBridge, type ExerciseBlock, type UseWidgetBridgeOptions } from '../useWidgetBridge';
import { createMockExercise } from '../../__tests__/helpers/factories';
import type { Exercise, SetTag } from '../../types/database';

// ─── Mocks ───

jest.mock('../../services/workoutBridge', () => ({
  syncStateToWidget: jest.fn(),
  clearWidgetState: jest.fn(),
}));

jest.mock('../../services/liveActivity', () => ({
  updateWorkoutActivityForSet: jest.fn().mockResolvedValue(undefined),
  updateWorkoutActivityForRest: jest.fn().mockResolvedValue(undefined),
  getCurrentMaxRestSeconds: jest.fn(() => 0),
}));

import { syncStateToWidget } from '../../services/workoutBridge';
import { updateWorkoutActivityForSet, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } from '../../services/liveActivity';

// ─── Helpers ───

function createBlock(overrides: Partial<ExerciseBlock> = {}): ExerciseBlock {
  const exercise = createMockExercise({ id: 'ex1', name: 'Bench Press' });
  return {
    exercise,
    sets: [
      {
        id: 'set1',
        exercise_id: exercise.id,
        set_number: 1,
        weight: '135',
        reps: '10',
        rpe: '',
        tag: 'working' as SetTag,
        is_completed: false,
        previous: null,
      },
      {
        id: 'set2',
        exercise_id: exercise.id,
        set_number: 2,
        weight: '',
        reps: '',
        rpe: '',
        tag: 'working' as SetTag,
        is_completed: false,
        previous: { weight: 130, reps: 8 },
      },
    ],
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 150,
    restEnabled: true,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<UseWidgetBridgeOptions> = {}): UseWidgetBridgeOptions {
  const blocks: ExerciseBlock[] = [createBlock()];
  return {
    blocksRef: { current: blocks },
    isResting: false,
    restEndTime: 0,
    restingExerciseId: '',
    ...overrides,
  };
}

// ─── Tests ───

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useWidgetBridge', () => {
  describe('buildWidgetState', () => {
    it('returns correct structure with exercise blocks', () => {
      const options = makeOptions();
      const { result } = renderHook(() => useWidgetBridge(options));

      const state = result.current.buildWidgetState(
        options.blocksRef.current,
        false,
        0,
      );

      expect(state.workoutActive).toBe(true);
      expect(state.isResting).toBe(false);
      expect(state.restEndTime).toBe(0);
      expect(state.current.exerciseName).toBe('Bench Press');
      expect(state.current.exerciseBlockIndex).toBe(0);
      expect(state.current.setNumber).toBe(1);
      expect(state.current.totalSets).toBe(2);
      expect(state.current.restSeconds).toBe(150);
      expect(state.current.restEnabled).toBe(true);
    });

    it('handles empty blocks gracefully', () => {
      const options = makeOptions();
      const { result } = renderHook(() => useWidgetBridge(options));

      const state = result.current.buildWidgetState([], false, 0);

      expect(state.workoutActive).toBe(true);
      expect(state.current.exerciseName).toBe('Workout');
      expect(state.current.exerciseBlockIndex).toBe(0);
      expect(state.current.setNumber).toBe(1);
      expect(state.current.totalSets).toBe(1);
    });

    it('finds first incomplete set starting from preferBlockIdx', () => {
      const block0 = createBlock({
        exercise: createMockExercise({ id: 'ex-a', name: 'Squat' }),
        sets: [
          { id: 's0', exercise_id: 'ex-a', set_number: 1, weight: '225', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
          { id: 's1', exercise_id: 'ex-a', set_number: 2, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });
      const block1 = createBlock({
        exercise: createMockExercise({ id: 'ex-b', name: 'Deadlift' }),
        sets: [
          { id: 's2', exercise_id: 'ex-b', set_number: 1, weight: '315', reps: '3', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });

      const options = makeOptions({ blocksRef: { current: [block0, block1] } });
      const { result } = renderHook(() => useWidgetBridge(options));

      // Starting from block 1, should find Deadlift's incomplete set
      const state = result.current.buildWidgetState([block0, block1], false, 0, 1);
      expect(state.current.exerciseName).toBe('Deadlift');
      expect(state.current.setNumber).toBe(1);
    });

    it('falls back to last block when all sets complete', () => {
      const block = createBlock({
        sets: [
          { id: 's0', exercise_id: 'ex1', set_number: 1, weight: '135', reps: '10', rpe: '', tag: 'working', is_completed: true, previous: null },
          { id: 's1', exercise_id: 'ex1', set_number: 2, weight: '135', reps: '10', rpe: '', tag: 'working', is_completed: true, previous: null },
        ],
      });
      const options = makeOptions({ blocksRef: { current: [block] } });
      const { result } = renderHook(() => useWidgetBridge(options));

      const state = result.current.buildWidgetState([block], false, 0);
      expect(state.current.exerciseBlockIndex).toBe(0);
      expect(state.current.setNumber).toBe(2); // Last completed set
    });

    it('includes rest state when resting', () => {
      const options = makeOptions();
      const { result } = renderHook(() => useWidgetBridge(options));

      const restEnd = Date.now() + 60000;
      const state = result.current.buildWidgetState(
        options.blocksRef.current,
        true,
        restEnd,
      );

      expect(state.isResting).toBe(true);
      expect(state.restEndTime).toBe(restEnd);
    });

  });

  describe('syncWidgetState', () => {
    it('calls syncStateToWidget with correct state', () => {
      const options = makeOptions();
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.syncWidgetState(options.blocksRef.current, false, 0);
      });

      expect(syncStateToWidget).toHaveBeenCalledTimes(1);
      const writtenState = (syncStateToWidget as jest.Mock).mock.calls[0][0];
      expect(writtenState.workoutActive).toBe(true);
      expect(writtenState.current.exerciseName).toBe('Bench Press');
      expect(writtenState.isResting).toBe(false);
    });

    it('calls updateWorkoutActivityForSet when not resting', () => {
      const options = makeOptions();
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.syncWidgetState(options.blocksRef.current, false, 0);
      });

      expect(updateWorkoutActivityForSet).toHaveBeenCalledWith(
        'Bench Press',
        1,
        2,
      );
      expect(updateWorkoutActivityForRest).not.toHaveBeenCalled();
    });

    it('calls updateWorkoutActivityForRest when resting', () => {
      const restEnd = Date.now() + 60000;
      const options = makeOptions({ isResting: true, restEndTime: restEnd });
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.syncWidgetState(undefined, true, restEnd);
      });

      expect(updateWorkoutActivityForRest).toHaveBeenCalledTimes(1);
      expect(updateWorkoutActivityForSet).not.toHaveBeenCalled();
    });

    it('uses blocksRef defaults when no blocks passed', () => {
      const options = makeOptions();
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.syncWidgetState();
      });

      expect(syncStateToWidget).toHaveBeenCalledTimes(1);
      const writtenState = (syncStateToWidget as jest.Mock).mock.calls[0][0];
      expect(writtenState.current.exerciseName).toBe('Bench Press');
    });

    it('propagates non-zero restMaxSeconds from liveActivity into widget state', () => {
      (getCurrentMaxRestSeconds as jest.Mock).mockReturnValueOnce(180);
      const options = makeOptions();
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.syncWidgetState(options.blocksRef.current, false, 0);
      });

      expect(syncStateToWidget).toHaveBeenCalledTimes(1);
      const writtenState = (syncStateToWidget as jest.Mock).mock.calls[0][0];
      expect(writtenState.restMaxSeconds).toBe(180);
    });
  });

  // ─── BUG: Wrong exercise name after auto-reorder during rest ───
  // When auto-reorder moves a completed exercise to the top, buildWidgetState
  // searches for "next incomplete set" starting from lastActiveBlockRef.
  // If all sets of the resting exercise are done, it finds a DIFFERENT exercise.
  // The widget/Live Activity then shows the wrong exercise name during rest.

  describe('exercise name after auto-reorder', () => {
    it('shows correct exercise when resting from fully-completed exercise after reorder', () => {
      // Scenario: 3 exercises. User completes ALL sets of Bench (originally at index 2).
      // Auto-reorder moved Bench to index 0. User is now resting from Bench.
      // restingExerciseName overrides the "next incomplete set" search result.
      const completedBench = createBlock({
        exercise: createMockExercise({ id: 'bench', name: 'Bench Press' }),
        sets: [
          { id: 'b1', exercise_id: 'bench', set_number: 1, weight: '185', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
          { id: 'b2', exercise_id: 'bench', set_number: 2, weight: '185', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
        ],
      });
      const incompleteSq = createBlock({
        exercise: createMockExercise({ id: 'sq', name: 'Squats' }),
        sets: [
          { id: 'sq1', exercise_id: 'sq', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });
      const incompleteRow = createBlock({
        exercise: createMockExercise({ id: 'row', name: 'Rows' }),
        sets: [
          { id: 'r1', exercise_id: 'row', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });

      const blocks = [completedBench, incompleteSq, incompleteRow];
      const options = makeOptions({ blocksRef: { current: blocks } });
      const { result } = renderHook(() => useWidgetBridge(options));

      // User is resting from Bench Press, whose sets are all complete. Anchor on its id.
      const restEnd = Date.now() + 120000;
      const state = result.current.buildWidgetState(blocks, true, restEnd, 0, 'bench');

      // The resting block wins over the "next incomplete set" search — and crucially the
      // counter comes from the SAME block. Overriding only the name used to render
      // "Bench Press · Set 1/1" where the 1/1 actually described Squats.
      expect(state.current.exerciseName).toBe('Bench Press');
      expect(state.current.setNumber).toBe(2);
      expect(state.current.totalSets).toBe(2);
    });

    it('syncWidgetState sends correct exercise to Live Activity during rest after reorder', () => {
      const completedBench = createBlock({
        exercise: createMockExercise({ id: 'bench', name: 'Bench Press' }),
        sets: [
          { id: 'b1', exercise_id: 'bench', set_number: 1, weight: '185', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
        ],
      });
      const incompleteSq = createBlock({
        exercise: createMockExercise({ id: 'sq', name: 'Squats' }),
        sets: [
          { id: 'sq1', exercise_id: 'sq', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });

      const blocks = [completedBench, incompleteSq];
      const options = makeOptions({ blocksRef: { current: blocks } });
      const { result } = renderHook(() => useWidgetBridge(options));

      result.current.lastActiveBlockRef.current = 0; // reorder put bench at 0

      const restEnd = Date.now() + 120000;
      act(() => {
        result.current.syncWidgetState(undefined, true, restEnd, 'bench', 120);
      });

      // The resting exercise id threads through, and the ABSOLUTE deadline is forwarded
      // verbatim rather than round-tripped through rounded remaining seconds.
      expect(updateWorkoutActivityForRest).toHaveBeenCalledWith(
        'Bench Press',
        restEnd,
        1,
        1,
        120,
      );
    });

    it('correct behavior: shows resting exercise when it still has incomplete sets', () => {
      // This case works correctly — exercise has 3 sets, only 1 completed.
      const partialBench = createBlock({
        exercise: createMockExercise({ id: 'bench', name: 'Bench Press' }),
        sets: [
          { id: 'b1', exercise_id: 'bench', set_number: 1, weight: '185', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
          { id: 'b2', exercise_id: 'bench', set_number: 2, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
          { id: 'b3', exercise_id: 'bench', set_number: 3, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });
      const incompleteSq = createBlock({
        exercise: createMockExercise({ id: 'sq', name: 'Squats' }),
        sets: [
          { id: 'sq1', exercise_id: 'sq', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });

      const blocks = [partialBench, incompleteSq];
      const options = makeOptions({ blocksRef: { current: blocks } });
      const { result } = renderHook(() => useWidgetBridge(options));

      const state = result.current.buildWidgetState(blocks, true, Date.now() + 120000, 0);

      // Works correctly — Bench still has incomplete sets
      expect(state.current.exerciseName).toBe('Bench Press');
      expect(state.current.setNumber).toBe(2);
    });
  });

  describe('incidental syncs while a rest is running', () => {
    // Bench is fully complete and the user is resting from it; Squats is the next incomplete
    // exercise. Any sync that fails to anchor on Bench will label the lock screen "Squats".
    function restingSetup() {
      const completedBench = createBlock({
        exercise: createMockExercise({ id: 'bench', name: 'Bench Press' }),
        sets: [
          { id: 'b1', exercise_id: 'bench', set_number: 1, weight: '185', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
        ],
      });
      const incompleteSq = createBlock({
        exercise: createMockExercise({ id: 'sq', name: 'Squats' }),
        sets: [
          { id: 'sq1', exercise_id: 'sq', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });
      const blocks = [completedBench, incompleteSq];
      const restEnd = Date.now() + 120000;
      const options = makeOptions({
        blocksRef: { current: blocks },
        isResting: true,
        restEndTime: restEnd,
        restingExerciseId: 'bench',
      });
      return { blocks, restEnd, options };
    }

    it('routes a sync with no explicit deadline to the label-only refresh', () => {
      const { options } = restingSetup();
      const { result } = renderHook(() => useWidgetBridge(options));

      // No isResting / restEnd args — this is what handleAddExerciseToWorkout and the
      // un-complete branch of handleToggleComplete do.
      act(() => { result.current.syncWidgetState(); });

      // Must NOT re-arm the countdown; the refresh path reuses the stored deadline instead.
      expect(updateWorkoutActivityForRest).not.toHaveBeenCalled();
      expect(updateWorkoutActivityForSet).toHaveBeenCalledTimes(1);
    });

    it('labels an incidental sync with the resting exercise, not the next incomplete one', () => {
      const { options } = restingSetup();
      const { result } = renderHook(() => useWidgetBridge(options));

      // lastActiveBlockRef points at Squats — the pre-fix fallback would have won here.
      result.current.lastActiveBlockRef.current = 1;
      act(() => { result.current.syncWidgetState(); });

      expect(updateWorkoutActivityForSet).toHaveBeenCalledWith('Bench Press', 1, 1);
    });

    it('falls back to the next incomplete exercise once the rest has ended', () => {
      const { blocks, options } = restingSetup();
      const { result } = renderHook(() =>
        useWidgetBridge({ ...options, isResting: false, restEndTime: 0, restingExerciseId: '' }),
      );

      act(() => { result.current.syncWidgetState(blocks); });

      expect(updateWorkoutActivityForSet).toHaveBeenCalledWith('Squats', 1, 1);
    });
  });
});
