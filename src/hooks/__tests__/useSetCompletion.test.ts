import { renderHook, act } from '@testing-library/react-native';
import { useSetCompletion } from '../useSetCompletion';
import type { ExerciseBlock, LocalSet } from '../../types/workout';
import type { Exercise, UpcomingWorkoutExercise, UpcomingWorkoutSet } from '../../types/database';
import { createMockExercise } from '../../__tests__/helpers/factories';

// ─── Mocks ───

jest.mock('../../services/database', () => ({
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/oneRepMax', () => ({
  calculateE1RM: jest.fn(() => ({ value: 100, confidence: 'HIGH' })),
  getPRGatingMargin: jest.fn(() => 0),
}));

const { updateWorkoutSet } = jest.requireMock('../../services/database');

// ─── Helpers ───

/** Create a LocalSet with sensible defaults */
function makeSet(overrides: Partial<LocalSet> = {}): LocalSet {
  return {
    id: 'set-' + Math.random().toString(36).slice(2),
    exercise_id: '',
    set_number: 1,
    weight: '135',
    reps: '10',
    rpe: '',
    tag: 'working',
    is_completed: false,
    ...overrides,
  };
}

/** Create an ExerciseBlock with N sets, first `completedCount` marked complete */
function makeBlock(
  name: string,
  totalSets: number = 3,
  completedCount: number = 0,
  overrides: Partial<ExerciseBlock> = {},
): ExerciseBlock {
  const exercise = createMockExercise({ id: name.toLowerCase(), name });
  const sets: LocalSet[] = Array.from({ length: totalSets }, (_, i) => makeSet({
    id: `${name.toLowerCase()}-s${i}`,
    exercise_id: exercise.id,
    set_number: i + 1,
    is_completed: i < completedCount,
  }));
  return {
    exercise,
    sets,
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: false,
    ...overrides,
  };
}

/** Create a fully-completed block (all sets done) */
function makeCompletedBlock(name: string, totalSets: number = 3): ExerciseBlock {
  return makeBlock(name, totalSets, totalSets);
}

/** Standard hook setup returning everything needed for assertions */
function setup(initialBlocks: ExerciseBlock[]) {
  const blocksRef = { current: initialBlocks };
  const setExerciseBlocks = jest.fn();
  const upcomingTargetsRef = { current: null as (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null };
  const prSetIdsRef = { current: new Set<string>() };
  const originalBestE1RMRef = { current: new Map<string, number | undefined>() };
  const currentBestE1RMRef = { current: new Map<string, number | undefined>() };
  const lastActiveBlockRef = { current: 0 };
  const startRestTimer = jest.fn();
  const syncWidgetState = jest.fn();
  const onConfetti = jest.fn();

  const { result } = renderHook(() => useSetCompletion({
    blocksRef,
    setExerciseBlocks,
    upcomingTargetsRef,
    prSetIdsRef,
    originalBestE1RMRef,
    currentBestE1RMRef,
    lastActiveBlockRef,
    workoutRef: { current: null },
    startRestTimer,
    syncWidgetState,
    onConfetti,
  }));

  /** Execute the state updater that was passed to setExerciseBlocks */
  function applyStateUpdate(prev: ExerciseBlock[]): ExerciseBlock[] {
    const lastCall = setExerciseBlocks.mock.calls[setExerciseBlocks.mock.calls.length - 1];
    const updater = lastCall[0];
    return typeof updater === 'function' ? updater(prev) : updater;
  }

  return {
    result,
    blocksRef,
    setExerciseBlocks,
    lastActiveBlockRef,
    startRestTimer,
    syncWidgetState,
    applyStateUpdate,
  };
}

/** Extract exercise names in order from blocks */
function names(blocks: ExerciseBlock[]): string[] {
  return blocks.map(b => b.exercise.name);
}

// ─── Tests ───

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useSetCompletion – auto-reorder', () => {
  it('moves exercise from bottom to top when no blocks are completed', () => {
    const blocks = [makeBlock('A'), makeBlock('B'), makeBlock('C'), makeBlock('D')];
    const { result, setExerciseBlocks, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(3, 0); // Complete first set of D
    });

    expect(setExerciseBlocks).toHaveBeenCalledTimes(1);
    const newBlocks = applyStateUpdate(blocks);
    expect(names(newBlocks)).toEqual(['D', 'A', 'B', 'C']);
    expect(newBlocks[0].sets[0].is_completed).toBe(true);
  });

  it('moves exercise below fully-completed blocks', () => {
    const blocks = [
      makeCompletedBlock('A'),
      makeCompletedBlock('B'),
      makeBlock('C'),
      makeBlock('D'),
      makeBlock('E'),
    ];
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(4, 0); // Complete first set of E
    });

    const newBlocks = applyStateUpdate(blocks);
    // E should go to position 2 (below A✓ and B✓)
    expect(names(newBlocks)).toEqual(['A', 'B', 'E', 'C', 'D']);
  });

  it('does not reorder when exercise is already at correct position', () => {
    const blocks = [
      makeCompletedBlock('A'),
      makeBlock('B'), // B is already at top of incomplete (position 1)
      makeBlock('C'),
    ];
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(1, 0); // Complete first set of B
    });

    const newBlocks = applyStateUpdate(blocks);
    // No reorder — B stays at position 1
    expect(names(newBlocks)).toEqual(['A', 'B', 'C']);
    expect(newBlocks[1].sets[0].is_completed).toBe(true);
  });

  it('does not reorder on second set completion (prevCompletedCount > 0)', () => {
    const blocks = [
      makeBlock('A'),
      makeBlock('B', 3, 1), // B already has 1 completed set
      makeBlock('C'),
    ];
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(1, 1); // Complete second set of B
    });

    const newBlocks = applyStateUpdate(blocks);
    // No reorder — B was already in-progress
    expect(names(newBlocks)).toEqual(['A', 'B', 'C']);
    expect(newBlocks[1].sets[1].is_completed).toBe(true);
  });

  it('does not reorder when un-completing a set', () => {
    const blocks = [
      makeBlock('A'),
      makeBlock('B', 3, 1), // B has 1 completed set
      makeBlock('C'),
    ];
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(1, 0); // UN-complete first set of B
    });

    const newBlocks = applyStateUpdate(blocks);
    expect(names(newBlocks)).toEqual(['A', 'B', 'C']);
    expect(newBlocks[1].sets[0].is_completed).toBe(false);
  });

  it('moves exercise to position 0 when first block is in-progress (not fully completed)', () => {
    // A has 1/3 sets done (in-progress, NOT fully completed)
    const blocks = [
      makeBlock('A', 3, 1),
      makeBlock('B'),
      makeBlock('C'),
      makeBlock('D'),
    ];
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(3, 0); // Complete first set of D
    });

    const newBlocks = applyStateUpdate(blocks);
    // preCheckCompleted = 0 (A is NOT fully complete), so D goes to 0
    expect(names(newBlocks)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('handles sequential reorders — each new exercise goes to top of incomplete', () => {
    const blocks = [makeBlock('A'), makeBlock('B'), makeBlock('C'), makeBlock('D'), makeBlock('E')];
    const { result, setExerciseBlocks, applyStateUpdate, blocksRef } = setup(blocks);

    // Step 1: Complete first set of E → E moves to 0
    act(() => { result.current.handleToggleComplete(4, 0); });
    const after1 = applyStateUpdate(blocks);
    expect(names(after1)).toEqual(['E', 'A', 'B', 'C', 'D']);

    // Update blocksRef for next call (simulating React render cycle)
    blocksRef.current = after1;
    setExerciseBlocks.mockClear();

    // Step 2: Complete first set of D (now at index 4) → D moves to 0
    act(() => { result.current.handleToggleComplete(4, 0); });
    const after2 = applyStateUpdate(after1);
    expect(names(after2)).toEqual(['D', 'E', 'A', 'B', 'C']);
  });

  it('respects completed blocks during sequential reorders', () => {
    const blocks = [
      makeCompletedBlock('A'),
      makeBlock('B'),
      makeBlock('C'),
      makeBlock('D'),
    ];
    const { result, setExerciseBlocks, applyStateUpdate, blocksRef } = setup(blocks);

    // Step 1: Complete first set of D → D goes to position 1 (below completed A)
    act(() => { result.current.handleToggleComplete(3, 0); });
    const after1 = applyStateUpdate(blocks);
    expect(names(after1)).toEqual(['A', 'D', 'B', 'C']);

    // Update blocksRef
    blocksRef.current = after1;
    setExerciseBlocks.mockClear();

    // Step 2: Complete first set of C (now at index 3) → C goes to position 1
    act(() => { result.current.handleToggleComplete(3, 0); });
    const after2 = applyStateUpdate(after1);
    expect(names(after2)).toEqual(['A', 'C', 'D', 'B']);
  });

  it('shows reorder toast with exercise name', () => {
    const blocks = [makeBlock('A'), makeBlock('B'), makeBlock('Deadlift')];
    const { result } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(2, 0);
    });

    expect(result.current.reorderToast).toBe('Deadlift');
  });

  it('does not show reorder toast when no reorder occurs', () => {
    const blocks = [makeBlock('A'), makeBlock('B')];
    const { result } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0); // A is already at position 0
    });

    expect(result.current.reorderToast).toBeNull();
  });

  it('updates lastActiveBlockRef to reorder insertion point', () => {
    const blocks = [
      makeCompletedBlock('A'),
      makeBlock('B'),
      makeBlock('C'),
    ];
    const { result, lastActiveBlockRef } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(2, 0); // C moves to position 1
    });

    expect(lastActiveBlockRef.current).toBe(1);
  });

  it('updates lastActiveBlockRef to blockIdx when no reorder', () => {
    const blocks = [makeBlock('A'), makeBlock('B')];
    const { result, lastActiveBlockRef } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    expect(lastActiveBlockRef.current).toBe(0);
  });
});

describe('useSetCompletion – completion & validation', () => {
  it('marks set as completed and persists to DB', () => {
    const blocks = [makeBlock('A')];
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    const newBlocks = applyStateUpdate(blocks);
    expect(newBlocks[0].sets[0].is_completed).toBe(true);
    expect(updateWorkoutSet).toHaveBeenCalledWith(
      blocks[0].sets[0].id,
      expect.objectContaining({ is_completed: true }),
    );
  });

  it('rejects completion when weight is empty', () => {
    const blocks = [makeBlock('A', 3, 0, {})];
    // Clear weight on the first set
    blocks[0].sets[0] = { ...blocks[0].sets[0], weight: '', reps: '10' };
    const { result, setExerciseBlocks } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    // Should NOT call setExerciseBlocks — validation failed
    expect(setExerciseBlocks).not.toHaveBeenCalled();
    expect(result.current.validationErrors).toHaveProperty('0-0', true);
  });

  it('rejects completion when reps is empty', () => {
    const blocks = [makeBlock('A')];
    blocks[0].sets[0] = { ...blocks[0].sets[0], weight: '135', reps: '' };
    const { result, setExerciseBlocks } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    expect(setExerciseBlocks).not.toHaveBeenCalled();
    expect(result.current.validationErrors).toHaveProperty('0-0', true);
  });

  it('clears validation error after 2 seconds', () => {
    jest.useFakeTimers();
    const blocks = [makeBlock('A')];
    blocks[0].sets[0] = { ...blocks[0].sets[0], weight: '', reps: '' };
    const { result } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });
    expect(result.current.validationErrors).toHaveProperty('0-0', true);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.validationErrors).not.toHaveProperty('0-0');
    jest.useRealTimers();
  });

  it('un-completes a previously completed set', () => {
    const blocks = [makeBlock('A', 3, 1)]; // First set already completed
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0); // Un-complete
    });

    const newBlocks = applyStateUpdate(blocks);
    expect(newBlocks[0].sets[0].is_completed).toBe(false);
    expect(updateWorkoutSet).toHaveBeenCalledWith(
      blocks[0].sets[0].id,
      expect.objectContaining({ is_completed: false }),
    );
  });

  it('starts rest timer when restEnabled and set completed', () => {
    const blocks = [makeBlock('A', 3, 0, { restEnabled: true, restSeconds: 120 })];
    const { result, startRestTimer, syncWidgetState } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    expect(startRestTimer).toHaveBeenCalledWith(120, 'A');
    expect(syncWidgetState).not.toHaveBeenCalled();
  });

  it('syncs widget state when rest not enabled', () => {
    const blocks = [makeBlock('A', 3, 0, { restEnabled: false })];
    const { result, syncWidgetState, startRestTimer } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    expect(startRestTimer).not.toHaveBeenCalled();
    expect(syncWidgetState).toHaveBeenCalled();
  });
});

describe('useSetCompletion – auto-fill', () => {
  it('fills weight from upcoming target on completion', () => {
    const blocks = [makeBlock('A')];
    blocks[0].sets[0] = { ...blocks[0].sets[0], weight: '', reps: '10' };

    const targetExercise = {
      id: 'ue-1',
      upcoming_workout_id: 'uw-1',
      exercise_id: blocks[0].exercise.id,
      order: 1,
      rest_seconds: 90,
      notes: null,
      exercise: blocks[0].exercise,
      sets: [{ id: 'us-1', upcoming_exercise_id: 'ue-1', set_number: 1, target_weight: 200, target_reps: 8 }],
    };

    // Setup with upcoming targets
    const blocksRef = { current: blocks };
    const setExerciseBlocks = jest.fn();
    const { result } = renderHook(() => useSetCompletion({
      blocksRef,
      setExerciseBlocks,
      upcomingTargetsRef: { current: [targetExercise] as any },
      prSetIdsRef: { current: new Set<string>() },
      originalBestE1RMRef: { current: new Map<string, number | undefined>() },
      currentBestE1RMRef: { current: new Map<string, number | undefined>() },
      lastActiveBlockRef: { current: 0 },
      workoutRef: { current: null },
      startRestTimer: jest.fn(),
      syncWidgetState: jest.fn(),
      onConfetti: jest.fn(),
    }));

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    const updater = setExerciseBlocks.mock.calls[0][0];
    const newBlocks = updater(blocks);
    expect(newBlocks[0].sets[0].weight).toBe('200');
    expect(newBlocks[0].sets[0].is_completed).toBe(true);
  });

  it('fills weight from previous data when no target', () => {
    const blocks = [makeBlock('A')];
    blocks[0].sets[0] = {
      ...blocks[0].sets[0],
      weight: '',
      reps: '10',
      previous: { weight: 185, reps: 8 },
    };
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    const newBlocks = applyStateUpdate(blocks);
    expect(newBlocks[0].sets[0].weight).toBe('185');
  });

  it('does not overwrite user-entered weight', () => {
    const blocks = [makeBlock('A')];
    blocks[0].sets[0] = {
      ...blocks[0].sets[0],
      weight: '225', // User already entered this
      reps: '10',
      previous: { weight: 185, reps: 8 },
    };
    const { result, applyStateUpdate } = setup(blocks);

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    const newBlocks = applyStateUpdate(blocks);
    expect(newBlocks[0].sets[0].weight).toBe('225');
  });
});
