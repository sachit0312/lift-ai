/**
 * Tests for FIX-3: ghost rows for skipped planned exercises.
 *
 * Verifies that confirmFinish inserts placeholder sets for any exercise that
 * was in the plan (planned_exercise_ids) but absent from the live blocks at
 * finish time (removed or never engaged with), and that this happens BEFORE
 * stampExerciseOrder.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useWorkoutLifecycle } from '../../hooks/useWorkoutLifecycle';
import { createMockWorkout, createMockExercise } from '../helpers/factories';
import type { ExerciseBlock } from '../../types/workout';
import type React from 'react';

// ─── Database mock ───────────────────────────────────────────────────────────

const mockGetActiveWorkout = jest.fn().mockResolvedValue(null);
const mockGetAllTemplates = jest.fn().mockResolvedValue([]);
const mockGetLastPerformedByTemplate = jest.fn().mockResolvedValue({});
const mockStampExerciseOrder = jest.fn().mockResolvedValue(undefined);
const mockGetPlannedExerciseIds = jest.fn().mockResolvedValue(null);
const mockInsertSkippedPlaceholderSets = jest.fn().mockResolvedValue(undefined);
const mockFinishWorkout = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/database', () => ({
  getActiveWorkout: (...args: unknown[]) => mockGetActiveWorkout(...args),
  getAllTemplates: (...args: unknown[]) => mockGetAllTemplates(...args),
  getLastPerformedByTemplate: (...args: unknown[]) => mockGetLastPerformedByTemplate(...args),
  finishWorkout: (...args: unknown[]) => mockFinishWorkout(...args),
  stampExerciseOrder: (...args: unknown[]) => mockStampExerciseOrder(...args),
  getPlannedExerciseIds: (...args: unknown[]) => mockGetPlannedExerciseIds(...args),
  insertSkippedPlaceholderSets: (...args: unknown[]) => mockInsertSkippedPlaceholderSets(...args),
  setPlannedExerciseIds: jest.fn().mockResolvedValue(undefined),
  updateWorkoutSessionNotes: jest.fn().mockResolvedValue(undefined),
  getUpcomingWorkoutForToday: jest.fn().mockResolvedValue(null),
  getWorkoutSets: jest.fn().mockResolvedValue([]),
  deleteWorkout: jest.fn().mockResolvedValue(undefined),
  getAllExercises: jest.fn().mockResolvedValue([]),
  startWorkout: jest.fn().mockResolvedValue({ id: 'w1', started_at: new Date().toISOString() }),
  addWorkoutSet: jest.fn().mockResolvedValue({ id: 'ws-1' }),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
  getTemplateExercises: jest.fn().mockResolvedValue([]),
  getBulkExercises: jest.fn().mockResolvedValue([]),
  getUserExerciseNotes: jest.fn().mockResolvedValue(null),
  getUserExerciseNotesBatch: jest.fn().mockResolvedValue(new Map()),
  getBestE1RM: jest.fn().mockResolvedValue(null),
  createExercise: jest.fn().mockResolvedValue({ id: 'ex-new' }),
  clearLocalUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
  updateWorkoutCoachNotes: jest.fn().mockResolvedValue(undefined),
  getUpcomingWorkoutById: jest.fn().mockResolvedValue(null),
  applyWorkoutChangesToTemplate: jest.fn().mockResolvedValue(undefined),
  addWorkoutSetsBatch: jest.fn().mockResolvedValue([{ id: 'ws-1' }]),
}));

jest.mock('../../services/sync', () => ({
  fireAndForgetSync: jest.fn(),
  pushTemplateOrderToSupabase: jest.fn(),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
  pullExercisesAndTemplates: jest.fn().mockResolvedValue(undefined),
  pullWorkoutHistory: jest.fn().mockResolvedValue(undefined),
  deleteUpcomingWorkoutFromSupabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/liveActivity', () => ({
  requestNotificationPermissions: jest.fn(),
  startWorkoutActivity: jest.fn(),
  stopWorkoutActivity: jest.fn(),
}));

jest.mock('../../services/workoutBridge', () => ({
  clearWidgetState: jest.fn(),
  syncStateToWidget: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(cb, []);
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBlock(exerciseId: string): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: exerciseId }),
    sets: [
      {
        id: `set-${exerciseId}`,
        exercise_id: exerciseId,
        set_number: 1,
        weight: '100',
        reps: '10',
        rpe: '',
        tag: 'working' as const,
        is_completed: true,
        previous: null,
      },
    ],
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: true,
    bestE1RM: undefined,
  };
}

function buildOptions(workoutId: string, blocks: ExerciseBlock[]) {
  const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
  const workoutRef = { current: workout };
  const blocksRef = { current: blocks };

  return {
    workoutRef,
    setExerciseBlocks: jest.fn() as React.Dispatch<React.SetStateAction<ExerciseBlock[]>>,
    exerciseBlocks: blocks,
    blocksRef,
    originalBestE1RMRef: { current: new Map<string, number | undefined>() },
    currentBestE1RMRef: { current: new Map<string, number | undefined>() },
    prSetIdsRef: { current: new Set<string>() },
    lastActiveBlockRef: { current: 0 },
    syncWidgetState: jest.fn(),
    dismissRest: jest.fn(),
    debouncedSaveNotes: jest.fn(),
    flushPendingNotes: jest.fn().mockResolvedValue(undefined),
    clearPendingNotes: jest.fn(),
    flushPendingSetWrites: jest.fn(),
    clearPendingSetWrites: jest.fn(),
    startWorkoutActivity: jest.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useWorkoutLifecycle — skipped exercises ghost rows (FIX-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveWorkout.mockResolvedValue(null);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockStampExerciseOrder.mockResolvedValue(undefined);
    mockFinishWorkout.mockResolvedValue(undefined);
    mockInsertSkippedPlaceholderSets.mockResolvedValue(undefined);
  });

  it('inserts ghost row for removed planned exercise and does so before stampExerciseOrder', async () => {
    const workoutId = 'w1';
    // Plan: ex-a, ex-b, ex-c. Blocks only have ex-a and ex-c (ex-b was removed).
    mockGetPlannedExerciseIds.mockResolvedValue(['ex-a', 'ex-b', 'ex-c']);

    const blocks = [makeBlock('ex-a'), makeBlock('ex-c')];
    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
    mockGetActiveWorkout.mockResolvedValue(workout);

    const options = buildOptions(workoutId, blocks);
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    // Wait for initial load
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.confirmFinish();
    });

    // insertSkippedPlaceholderSets called with the missing exercise at programmed_order 2
    expect(mockInsertSkippedPlaceholderSets).toHaveBeenCalledWith(workoutId, [
      { exercise_id: 'ex-b', programmed_order: 2 },
    ]);

    // Ghost insert must have happened BEFORE stampExerciseOrder
    expect(mockInsertSkippedPlaceholderSets.mock.invocationCallOrder[0]).toBeLessThan(
      mockStampExerciseOrder.mock.invocationCallOrder[0],
    );
  });

  it('inserts no ghost rows when plan is null, but still calls stampExerciseOrder', async () => {
    const workoutId = 'w1';
    mockGetPlannedExerciseIds.mockResolvedValue(null);

    const blocks = [makeBlock('ex-a')];
    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
    mockGetActiveWorkout.mockResolvedValue(workout);

    const options = buildOptions(workoutId, blocks);
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.confirmFinish();
    });

    expect(mockInsertSkippedPlaceholderSets).not.toHaveBeenCalled();
    expect(mockStampExerciseOrder).toHaveBeenCalledWith(workoutId, expect.any(Array));
  });

  it('inserts no ghost rows when all planned exercises are present', async () => {
    const workoutId = 'w1';
    mockGetPlannedExerciseIds.mockResolvedValue(['ex-a', 'ex-b']);

    const blocks = [makeBlock('ex-a'), makeBlock('ex-b')];
    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
    mockGetActiveWorkout.mockResolvedValue(workout);

    const options = buildOptions(workoutId, blocks);
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.confirmFinish();
    });

    expect(mockInsertSkippedPlaceholderSets).not.toHaveBeenCalled();
    expect(mockStampExerciseOrder).toHaveBeenCalledWith(workoutId, expect.any(Array));
  });
});

// ─── Test 13: confirmFinish early-return when workoutRef.current is null ────

describe('confirmFinish — early return with null workoutRef (Test 13)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveWorkout.mockResolvedValue(null);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockGetPlannedExerciseIds.mockResolvedValue(null);
  });

  it('does not call insertSkippedPlaceholderSets or stampExerciseOrder when no active workout', async () => {
    // Build options WITHOUT activating a workout — workoutRef.current stays null
    const options = buildOptions('w-null', []);
    // Override: ensure no active workout is loaded
    mockGetActiveWorkout.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // confirmFinish with no active workout should be a no-op
    await act(async () => {
      await result.current.confirmFinish();
    });

    expect(mockInsertSkippedPlaceholderSets).not.toHaveBeenCalled();
    expect(mockStampExerciseOrder).not.toHaveBeenCalled();
  });
});
