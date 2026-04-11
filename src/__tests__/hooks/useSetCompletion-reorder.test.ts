/**
 * Tests for Task 7: auto-reorder persistence via stampExerciseOrder.
 *
 * When completing the first set of an out-of-position exercise (auto-reorder),
 * stampExerciseOrder must be fired with the new block positions so that a
 * reload after the reorder preserves the user's sequence rather than
 * reverting to the original plan order.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useSetCompletion } from '../../hooks/useSetCompletion';
import type { ExerciseBlock, LocalSet } from '../../types/workout';
import type { Workout } from '../../types/database';
import { createMockExercise } from '../helpers/factories';

const mockStampExerciseOrder = jest.fn().mockResolvedValue(undefined);
const mockUpdateWorkoutSet = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/database', () => ({
  updateWorkoutSet: (...args: unknown[]) => mockUpdateWorkoutSet(...args),
  stampExerciseOrder: (...args: unknown[]) => mockStampExerciseOrder(...args),
}));

jest.mock('../../utils/oneRepMax', () => ({
  calculateE1RM: jest.fn().mockReturnValue({ value: 0, confidence: 'LOW' }),
  getPRGatingMargin: jest.fn().mockReturnValue(0.03),
}));

// ─── Helpers ───

function makeSet(overrides: Partial<LocalSet> = {}): LocalSet {
  return {
    id: `set-${Math.random().toString(36).slice(2)}`,
    exercise_id: 'ex-1',
    set_number: 1,
    weight: '100',
    reps: '10',
    rpe: '',
    tag: 'working',
    is_completed: false,
    previous: null,
    ...overrides,
  };
}

function makeBlock(exerciseId: string, sets: LocalSet[]): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: exerciseId }),
    sets,
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: false,
    bestE1RM: undefined,
  };
}

function makeWorkout(id: string): Workout {
  return {
    id,
    started_at: new Date().toISOString(),
    finished_at: null,
    duration_seconds: null,
    upcoming_workout_id: null,
    session_notes: null,
    coach_notes: null,
    exercise_coach_notes: null,
  } as unknown as Workout;
}

function makeOptions(blocks: ExerciseBlock[], workoutId: string) {
  const blocksRef = { current: blocks };
  const setExerciseBlocks = jest.fn();
  const upcomingTargetsRef = { current: null };
  const prSetIdsRef = { current: new Set<string>() };
  const originalBestE1RMRef = { current: new Map<string, number | undefined>() };
  const currentBestE1RMRef = { current: new Map<string, number | undefined>() };
  const lastActiveBlockRef = { current: 0 };
  const workoutRef: { current: Workout | null } = { current: makeWorkout(workoutId) };
  const startRestTimer = jest.fn();
  const syncWidgetState = jest.fn();
  const onConfetti = jest.fn();

  return {
    blocksRef,
    setExerciseBlocks,
    upcomingTargetsRef,
    prSetIdsRef,
    originalBestE1RMRef,
    currentBestE1RMRef,
    lastActiveBlockRef,
    workoutRef,
    startRestTimer,
    syncWidgetState,
    onConfetti,
  };
}

// ─── Tests ───

describe('useSetCompletion — auto-reorder DB persistence (Task 7)', () => {
  beforeEach(() => {
    mockStampExerciseOrder.mockClear();
    mockUpdateWorkoutSet.mockClear();
  });

  it('calls stampExerciseOrder with new block positions when auto-reorder triggers', () => {
    // Starting blocks: [A, B, C] — all uncompleted
    const setA = makeSet({ id: 'sa-1', exercise_id: 'ex-a', set_number: 1 });
    const setB = makeSet({ id: 'sb-1', exercise_id: 'ex-b', set_number: 1 });
    const setC = makeSet({ id: 'sc-1', exercise_id: 'ex-c', set_number: 1 });
    const blockA = makeBlock('ex-a', [setA]);
    const blockB = makeBlock('ex-b', [setB]);
    const blockC = makeBlock('ex-c', [setC]);

    const blocks = [blockA, blockB, blockC];
    const options = makeOptions(blocks, 'w1');

    const { result } = renderHook(() => useSetCompletion(options));

    // Complete first set of C (blockIdx=2, setIdx=0) — out of position → triggers reorder
    act(() => {
      result.current.handleToggleComplete(2, 0);
    });

    // Auto-reorder should move C to index 0 → new order [C, A, B]
    expect(mockStampExerciseOrder).toHaveBeenCalledTimes(1);

    const [calledWorkoutId, calledEntries] = mockStampExerciseOrder.mock.calls[0];
    expect(calledWorkoutId).toBe('w1');

    // C's sets should have order 1, A's sets order 2, B's sets order 3
    expect(calledEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sc-1', order: 1 }),
        expect.objectContaining({ id: 'sa-1', order: 2 }),
        expect.objectContaining({ id: 'sb-1', order: 3 }),
      ])
    );
    expect(calledEntries).toHaveLength(3);
  });

  it('does not call stampExerciseOrder when the exercise is already at the top position', () => {
    // Starting blocks: [A, B] — complete first set of A (blockIdx=0, already at top)
    const setA = makeSet({ id: 'sa-1', exercise_id: 'ex-a', set_number: 1 });
    const setB = makeSet({ id: 'sb-1', exercise_id: 'ex-b', set_number: 1 });
    const blockA = makeBlock('ex-a', [setA]);
    const blockB = makeBlock('ex-b', [setB]);

    const blocks = [blockA, blockB];
    const options = makeOptions(blocks, 'w1');

    const { result } = renderHook(() => useSetCompletion(options));

    // Complete first set of A (blockIdx=0) — already at position 0, no reorder needed
    act(() => {
      result.current.handleToggleComplete(0, 0);
    });

    expect(mockStampExerciseOrder).not.toHaveBeenCalled();
  });

  it('does not call stampExerciseOrder on subsequent set completions for same exercise', () => {
    // Start with B already having its first set completed (so reorder already happened)
    const setA = makeSet({ id: 'sa-1', exercise_id: 'ex-a', set_number: 1 });
    const setB1 = makeSet({ id: 'sb-1', exercise_id: 'ex-b', set_number: 1, is_completed: true });
    const setB2 = makeSet({ id: 'sb-2', exercise_id: 'ex-b', set_number: 2 });
    const blockA = makeBlock('ex-a', [setA]);
    const blockB = makeBlock('ex-b', [setB1, setB2]);

    // After first reorder, blocks are [B, A]
    const blocks = [blockB, blockA];
    const options = makeOptions(blocks, 'w1');

    const { result } = renderHook(() => useSetCompletion(options));

    // Complete second set of B (now blockIdx=0, setIdx=1) — prevCompletedCount=1, no reorder
    act(() => {
      result.current.handleToggleComplete(0, 1);
    });

    expect(mockStampExerciseOrder).not.toHaveBeenCalled();
  });

  it('does not call stampExerciseOrder when workoutRef is null', () => {
    const setA = makeSet({ id: 'sa-1', exercise_id: 'ex-a', set_number: 1 });
    const setB = makeSet({ id: 'sb-1', exercise_id: 'ex-b', set_number: 1 });
    const blockA = makeBlock('ex-a', [setA]);
    const blockB = makeBlock('ex-b', [setB]);

    const blocks = [blockA, blockB];
    const options = makeOptions(blocks, 'w1');
    // Simulate no active workout
    options.workoutRef.current = null;

    const { result } = renderHook(() => useSetCompletion(options));

    // Complete first set of B (blockIdx=1) — would reorder, but workoutRef is null
    act(() => {
      result.current.handleToggleComplete(1, 0);
    });

    expect(mockStampExerciseOrder).not.toHaveBeenCalled();
  });
});
