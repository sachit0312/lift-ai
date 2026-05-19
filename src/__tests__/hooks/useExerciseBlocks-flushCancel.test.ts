/**
 * Verifies that flushPendingSetWrites coalesces pending debounced writes
 * to SQLite, and that clearPendingSetWrites discards them without writing.
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
    sets: [
      { id: 's1', exercise_id: 'ex-1', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null, exercise_order: 1 },
      { id: 's2', exercise_id: 'ex-1', set_number: 2, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null, exercise_order: 1 },
    ],
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: true,
    bestE1RM: undefined,
  };
}

describe('useExerciseBlocks flush/cancel semantics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function setup() {
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
    return { result };
  }

  it('flushPendingSetWrites coalesces multiple field updates into ONE writeAsync per set', () => {
    const { result } = setup();

    // Three rapid keystrokes for set s1, all coalesce in the 300ms debounce window
    act(() => {
      result.current.handleSetChange(0, 0, 'weight', '100');
      result.current.handleSetChange(0, 0, 'weight', '110');
      result.current.handleSetChange(0, 0, 'reps', '5');
    });

    // No DB write yet — within debounce
    expect(db.updateWorkoutSet).not.toHaveBeenCalled();

    // Flush before the timer fires
    act(() => {
      result.current.flushPendingSetWrites();
    });

    // Exactly ONE write, with the coalesced final values
    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(db.updateWorkoutSet).toHaveBeenCalledWith('s1', expect.objectContaining({
      weight: 110,
      reps: 5,
    }));
  });

  it('clearPendingSetWrites discards pending writes without calling updateWorkoutSet', () => {
    const { result } = setup();

    act(() => {
      result.current.handleSetChange(0, 0, 'weight', '100');
      result.current.handleSetChange(0, 1, 'reps', '5');
    });

    act(() => {
      result.current.clearPendingSetWrites();
    });

    // Advance timers past the debounce window — writes should NOT fire
    act(() => { jest.advanceTimersByTime(500); });

    expect(db.updateWorkoutSet).not.toHaveBeenCalled();
  });

  it('writes still fire automatically after 300ms if not explicitly flushed/cleared', () => {
    const { result } = setup();

    act(() => {
      result.current.handleSetChange(0, 0, 'weight', '100');
    });

    expect(db.updateWorkoutSet).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(350); });

    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(db.updateWorkoutSet).toHaveBeenCalledWith('s1', expect.objectContaining({ weight: 100 }));
  });
});
