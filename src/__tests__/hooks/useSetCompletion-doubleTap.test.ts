/**
 * Tests for FIX-3: double-tap guard in useSetCompletion.
 *
 * Verifies that two rapid calls to handleToggleComplete for the same set
 * result in only ONE state update and ONE startRestTimer call.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useSetCompletion } from '../../hooks/useSetCompletion';
import type { ExerciseBlock, LocalSet } from '../../types/workout';
import { createMockExercise } from '../helpers/factories';

jest.mock('../../services/database', () => ({
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/oneRepMax', () => ({
  calculateE1RM: jest.fn().mockReturnValue({ value: 0, confidence: 'LOW' }),
  getPRGatingMargin: jest.fn().mockReturnValue(0.03),
}));

function makeSet(overrides: Partial<LocalSet> = {}): LocalSet {
  return {
    id: 'set-1',
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

function makeBlock(sets: LocalSet[]): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: 'ex-1' }),
    sets,
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: true,
    bestE1RM: undefined,
  };
}

describe('useSetCompletion — double-tap guard (FIX-3)', () => {
  it('only calls startRestTimer once when handleToggleComplete is called twice in rapid succession', () => {
    const set = makeSet();
    const block = makeBlock([set]);

    const blocksRef = { current: [block] };
    const setExerciseBlocks = jest.fn();
    const upcomingTargetsRef = { current: null };
    const prSetIdsRef = { current: new Set<string>() };
    const originalBestE1RMRef = { current: new Map<string, number | undefined>() };
    const currentBestE1RMRef = { current: new Map<string, number | undefined>() };
    const lastActiveBlockRef = { current: 0 };
    const startRestTimer = jest.fn();
    const syncWidgetState = jest.fn();
    const onConfetti = jest.fn();

    const { result } = renderHook(() =>
      useSetCompletion({
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
      }),
    );

    act(() => {
      // Two rapid taps — both before React re-renders
      result.current.handleToggleComplete(0, 0);
      result.current.handleToggleComplete(0, 0);
    });

    // setExerciseBlocks should only be called once (second tap was blocked)
    expect(setExerciseBlocks).toHaveBeenCalledTimes(1);

    // startRestTimer should only fire once (not stacked twice)
    expect(startRestTimer).toHaveBeenCalledTimes(1);
  });

  it('allows a second toggle after the guard is cleared (un-complete after complete)', () => {
    const set = makeSet();
    const block = makeBlock([set]);

    const blocksRef = { current: [block] };
    const setExerciseBlocks = jest.fn();
    const upcomingTargetsRef = { current: null };
    const prSetIdsRef = { current: new Set<string>() };
    const originalBestE1RMRef = { current: new Map<string, number | undefined>() };
    const currentBestE1RMRef = { current: new Map<string, number | undefined>() };
    const lastActiveBlockRef = { current: 0 };
    const startRestTimer = jest.fn();
    const syncWidgetState = jest.fn();
    const onConfetti = jest.fn();

    const { result } = renderHook(() =>
      useSetCompletion({
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
      }),
    );

    // First tap — goes through
    act(() => {
      result.current.handleToggleComplete(0, 0);
    });
    expect(setExerciseBlocks).toHaveBeenCalledTimes(1);

    // Simulate React re-render: update blocksRef to reflect completed set
    const completedSet = makeSet({ is_completed: true });
    blocksRef.current = [makeBlock([completedSet])];

    // Second tap — un-completing; should go through because guard was cleared
    act(() => {
      result.current.handleToggleComplete(0, 0);
    });
    expect(setExerciseBlocks).toHaveBeenCalledTimes(2);
  });

  it('releases the guard on validation failure so user can retry after fixing inputs', () => {
    // Set with no weight/reps — will fail validation
    const set = makeSet({ weight: '', reps: '' });
    const block = makeBlock([set]);

    const blocksRef = { current: [block] };
    const setExerciseBlocks = jest.fn();
    const upcomingTargetsRef = { current: null };
    const prSetIdsRef = { current: new Set<string>() };
    const originalBestE1RMRef = { current: new Map<string, number | undefined>() };
    const currentBestE1RMRef = { current: new Map<string, number | undefined>() };
    const lastActiveBlockRef = { current: 0 };
    const startRestTimer = jest.fn();
    const syncWidgetState = jest.fn();
    const onConfetti = jest.fn();

    const { result } = renderHook(() =>
      useSetCompletion({
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
      }),
    );

    // First attempt — validation failure (no weight/reps)
    act(() => {
      result.current.handleToggleComplete(0, 0);
    });
    expect(setExerciseBlocks).not.toHaveBeenCalled();
    expect(result.current.validationErrors['0-0']).toBe(true);

    // Simulate user filling in values and trying again
    const filledSet = makeSet({ weight: '50', reps: '8' });
    blocksRef.current = [makeBlock([filledSet])];

    act(() => {
      result.current.handleToggleComplete(0, 0);
    });
    // Guard was released on validation failure, so this attempt succeeds
    expect(setExerciseBlocks).toHaveBeenCalledTimes(1);
  });
});
