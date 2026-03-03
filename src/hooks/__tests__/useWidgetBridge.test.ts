import { renderHook, act } from '@testing-library/react-native';
import { useWidgetBridge, type ExerciseBlock, type UseWidgetBridgeOptions } from '../useWidgetBridge';
import { createMockExercise } from '../../__tests__/helpers/factories';
import type { Exercise, Workout, SetTag } from '../../types/database';

// ─── Mocks ───

jest.mock('../../services/workoutBridge', () => ({
  syncStateToWidget: jest.fn(),
  startPolling: jest.fn(),
  stopPolling: jest.fn(),
  clearWidgetState: jest.fn(),
}));

jest.mock('../../services/liveActivity', () => ({
  updateWorkoutActivityForSet: jest.fn(),
  updateWorkoutActivityForRest: jest.fn(),
}));

import { syncStateToWidget, startPolling } from '../../services/workoutBridge';
import { updateWorkoutActivityForSet, updateWorkoutActivityForRest } from '../../services/liveActivity';

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
    notesExpanded: false,
    notes: '',
    restSeconds: 150,
    restEnabled: true,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<UseWidgetBridgeOptions> = {}): UseWidgetBridgeOptions {
  const blocks: ExerciseBlock[] = [createBlock()];
  return {
    blocksRef: { current: blocks },
    workoutRef: { current: { id: 'w1', user_id: 'u1', template_id: null, upcoming_workout_id: null, started_at: new Date().toISOString(), finished_at: null, ai_summary: null, session_notes: null } as Workout },
    isResting: false,
    restEndTime: 0,
    onDismissRest: jest.fn(),
    onAdjustRest: jest.fn(),
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
  });

  describe('handleWidgetActions', () => {
    it('dispatches skipRest correctly', () => {
      const onDismissRest = jest.fn();
      const options = makeOptions({ onDismissRest });
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.handleWidgetActions([
          { type: 'skipRest', ts: Date.now() },
        ]);
      });

      // onDismissRest (dismissRest → endRest → onRestEnd) handles the widget sync
      expect(onDismissRest).toHaveBeenCalledTimes(1);
    });

    it('dispatches adjustRest with fromWidget flag', () => {
      const onAdjustRest = jest.fn();
      const options = makeOptions({ onAdjustRest });
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.handleWidgetActions([
          { type: 'adjustRest', delta: 15, ts: Date.now() },
        ]);
      });

      expect(onAdjustRest).toHaveBeenCalledWith(15, { fromWidget: true });
    });

    it('skips Live Activity update on syncWidgetState after widget adjustRest', () => {
      const onAdjustRest = jest.fn();
      const restEnd = Date.now() + 60000;
      const options = makeOptions({ onAdjustRest, isResting: true, restEndTime: restEnd });
      const { result } = renderHook(() => useWidgetBridge(options));

      // Simulate widget adjustRest action (sets skip flag internally)
      act(() => {
        result.current.handleWidgetActions([
          { type: 'adjustRest', delta: 15, ts: Date.now() },
        ]);
      });

      jest.clearAllMocks();

      // Next syncWidgetState should write to UserDefaults but skip Live Activity
      act(() => {
        result.current.syncWidgetState(undefined, true, restEnd);
      });

      expect(syncStateToWidget).toHaveBeenCalledTimes(1);
      // Live Activity update already sent by adjustRestTimerActivity in useRestTimer;
      // syncWidgetState must not send a second update (would cause flicker).
      expect(updateWorkoutActivityForRest).not.toHaveBeenCalled();
      expect(updateWorkoutActivityForSet).not.toHaveBeenCalled();
    });

    it('skip flag does not suppress set-entry update when adjustment ends rest', () => {
      const onAdjustRest = jest.fn();
      const restEnd = Date.now() + 5000; // only 5s left
      const options = makeOptions({ onAdjustRest, isResting: true, restEndTime: restEnd });
      const { result } = renderHook(() => useWidgetBridge(options));

      // Widget sends -15s which would zero the timer
      act(() => {
        result.current.handleWidgetActions([
          { type: 'adjustRest', delta: -15, ts: Date.now() },
        ]);
      });

      jest.clearAllMocks();

      // endRest fires syncWidgetState with isResting=false — must NOT be skipped
      act(() => {
        result.current.syncWidgetState(undefined, false, 0);
      });

      expect(syncStateToWidget).toHaveBeenCalledTimes(1);
      // Set-entry update MUST fire so lock screen switches from rest to set view
      expect(updateWorkoutActivityForSet).toHaveBeenCalledTimes(1);
      expect(updateWorkoutActivityForRest).not.toHaveBeenCalled();
    });

    it('skip flag resets after one syncWidgetState call', () => {
      const onAdjustRest = jest.fn();
      const restEnd = Date.now() + 60000;
      const options = makeOptions({ onAdjustRest, isResting: true, restEndTime: restEnd });
      const { result } = renderHook(() => useWidgetBridge(options));

      // Trigger widget action (sets skip flag)
      act(() => {
        result.current.handleWidgetActions([
          { type: 'adjustRest', delta: 15, ts: Date.now() },
        ]);
      });

      // First sync — skips Live Activity
      act(() => {
        result.current.syncWidgetState(undefined, true, restEnd);
      });

      jest.clearAllMocks();

      // Second sync — should update Live Activity normally
      act(() => {
        result.current.syncWidgetState(undefined, true, restEnd);
      });

      expect(updateWorkoutActivityForRest).toHaveBeenCalledTimes(1);
    });

    it('ignores actions when no active workout', () => {
      const onDismissRest = jest.fn();
      const options = makeOptions({
        workoutRef: { current: null },
        onDismissRest,
      });
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.handleWidgetActions([
          { type: 'skipRest', ts: Date.now() },
        ]);
      });

      expect(onDismissRest).not.toHaveBeenCalled();
    });
  });

  describe('startWidgetPolling', () => {
    it('calls startPolling with handleWidgetActions', () => {
      const options = makeOptions();
      const { result } = renderHook(() => useWidgetBridge(options));

      act(() => {
        result.current.startWidgetPolling();
      });

      expect(startPolling).toHaveBeenCalledTimes(1);
      expect(typeof (startPolling as jest.Mock).mock.calls[0][0]).toBe('function');
    });
  });
});
