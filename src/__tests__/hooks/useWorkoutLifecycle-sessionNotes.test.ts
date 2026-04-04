/**
 * Tests for FIX-1: session notes ref in useWorkoutLifecycle.
 *
 * Verifies that confirmFinish uses workoutNotesRef.current (always up-to-date)
 * rather than the workoutNotes React state (which may lag due to async batching).
 */
import { renderHook, act } from '@testing-library/react-native';
import { useWorkoutLifecycle } from '../../hooks/useWorkoutLifecycle';
import { createMockWorkout, createMockExercise } from '../helpers/factories';
import type { ExerciseBlock } from '../../types/workout';
import type React from 'react';

// ─── Database mock ───────────────────────────────────────────────────────────

// These must be named with the `mock` prefix to be accessible inside jest.mock()
const mockFinishWorkout = jest.fn().mockResolvedValue(undefined);
const mockGetActiveWorkout = jest.fn().mockResolvedValue(null);
const mockGetAllTemplates = jest.fn().mockResolvedValue([]);
const mockGetLastPerformedByTemplate = jest.fn().mockResolvedValue({});
const mockStampExerciseOrder = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/database', () => ({
  getActiveWorkout: (...args: unknown[]) => mockGetActiveWorkout(...args),
  getAllTemplates: (...args: unknown[]) => mockGetAllTemplates(...args),
  getLastPerformedByTemplate: (...args: unknown[]) => mockGetLastPerformedByTemplate(...args),
  finishWorkout: (...args: unknown[]) => mockFinishWorkout(...args),
  stampExerciseOrder: (...args: unknown[]) => mockStampExerciseOrder(...args),
  updateWorkoutSessionNotes: jest.fn().mockResolvedValue(undefined),
  getUpcomingWorkoutForToday: jest.fn().mockResolvedValue(null),
  getWorkoutSets: jest.fn().mockResolvedValue([]),
  deleteWorkout: jest.fn().mockResolvedValue(undefined),
  getAllExercises: jest.fn().mockResolvedValue([]),
  startWorkout: jest.fn().mockResolvedValue({ id: 'w-default', started_at: new Date().toISOString() }),
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

function makeBlock(exerciseId = 'ex-1'): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: exerciseId }),
    sets: [
      {
        id: 'set-1',
        exercise_id: exerciseId,
        set_number: 1,
        weight: '100',
        reps: '10',
        rpe: '',
        tag: 'working',
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

function buildOptions(workoutId = 'w-1') {
  const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
  const workoutRef = { current: workout };
  const block = makeBlock();
  const blocksRef = { current: [block] };

  return {
    workoutRef,
    setExerciseBlocks: jest.fn() as React.Dispatch<React.SetStateAction<ExerciseBlock[]>>,
    exerciseBlocks: [block],
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

describe('useWorkoutLifecycle — session notes ref (FIX-1)', () => {
  it('flushes the latest session notes text to finishWorkout even when called immediately after typing', async () => {
    const workoutId = 'w-notes-test';
    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });

    // Return the active workout from DB so loadState populates workoutRef
    mockGetActiveWorkout.mockResolvedValue(workout);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockStampExerciseOrder.mockResolvedValue(undefined);
    mockFinishWorkout.mockResolvedValue(undefined);

    const options = buildOptions(workoutId);

    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    // Wait for initial load (loadState + loadActiveWorkout)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Simulate typing session notes — sets workoutNotes state + schedules 500ms debounce
    act(() => {
      result.current.handleSessionNotesChange('my notes typed fast');
    });

    // Immediately confirm finish (before the 500ms debounce fires).
    // Without FIX-1, finishWorkout would receive '' or an earlier stale state value.
    await act(async () => {
      await result.current.confirmFinish();
    });

    // finishWorkout must receive the latest notes, not stale state
    expect(mockFinishWorkout).toHaveBeenCalledWith(workoutId, 'my notes typed fast');
  });

  it('passes undefined to finishWorkout when no notes were entered', async () => {
    const workoutId = 'w-empty-notes';
    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });

    mockGetActiveWorkout.mockResolvedValue(workout);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockStampExerciseOrder.mockResolvedValue(undefined);
    mockFinishWorkout.mockResolvedValue(undefined);

    const options = buildOptions(workoutId);

    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // No notes typed — confirmFinish should pass undefined (not empty string)
    await act(async () => {
      await result.current.confirmFinish();
    });

    expect(mockFinishWorkout).toHaveBeenCalledWith(workoutId, undefined);
  });
});
