/**
 * Sweep test: session notes debounce is FLUSHED (not just cleared) on unmount.
 *
 * Bug this pins: handleSessionNotesChange sets workoutNotes state and schedules a 500ms
 * debounced updateWorkoutSessionNotes() write. If the screen unmounts within that window —
 * e.g. sign-out swaps RootNavigator to the AuthStack, or any other authPhase transition that
 * tears down WorkoutScreen — the old cleanup only cleared the pending timer. Whatever the user
 * had typed in the last 500ms was silently discarded and never reached SQLite (or Supabase).
 * The fix reads workoutNotesRef.current (kept in sync with the workoutNotes state on every
 * render, immune to React's async batching) in the unmount cleanup and performs the write
 * directly, exactly like confirmFinish's session-notes flush.
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
const mockUpdateWorkoutSessionNotes = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/database', () => ({
  getActiveWorkout: (...args: unknown[]) => mockGetActiveWorkout(...args),
  getAllTemplates: (...args: unknown[]) => mockGetAllTemplates(...args),
  getLastPerformedByTemplate: (...args: unknown[]) => mockGetLastPerformedByTemplate(...args),
  updateWorkoutSessionNotes: (...args: unknown[]) => mockUpdateWorkoutSessionNotes(...args),
  finishWorkout: jest.fn().mockResolvedValue(undefined),
  stampExerciseOrder: jest.fn().mockResolvedValue(undefined),
  getPlannedExerciseIds: jest.fn().mockResolvedValue(null),
  insertSkippedPlaceholderSets: jest.fn().mockResolvedValue(undefined),
  setPlannedExerciseIds: jest.fn().mockResolvedValue(undefined),
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

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(cb, []);
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBlock(): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: 'ex-1' }),
    sets: [
      {
        id: 'set-1',
        exercise_id: 'ex-1',
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

function buildOptions(workoutId = 'w-notes') {
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

describe('session notes debounce flush on unmount (sweep)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveWorkout.mockResolvedValue(null);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockUpdateWorkoutSessionNotes.mockResolvedValue(undefined);
  });

  it('flushes the in-flight session-notes text (read from workoutNotesRef) to the DB on unmount', async () => {
    const workoutId = 'w-unmount-flush';
    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
    mockGetActiveWorkout.mockResolvedValue(workout);

    const options = buildOptions(workoutId);
    const { result, unmount } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    // Let initial load settle.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // Type session notes — arms the 500ms debounce, but does not fire yet.
    act(() => {
      result.current.handleSessionNotesChange('in-flight notes at unmount');
    });

    expect(mockUpdateWorkoutSessionNotes).not.toHaveBeenCalled();

    // Unmount BEFORE the 500ms debounce fires (e.g. sign-out swapping the navigator).
    unmount();

    // Flush the microtask queue so the fire-and-forget write inside the cleanup resolves.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The in-flight text must have been written, not silently dropped.
    expect(mockUpdateWorkoutSessionNotes).toHaveBeenCalledTimes(1);
    expect(mockUpdateWorkoutSessionNotes).toHaveBeenCalledWith(workoutId, 'in-flight notes at unmount');
  });

  it('does not write anything on unmount when there is no pending debounce (notes already flushed)', async () => {
    const workoutId = 'w-unmount-clean';
    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
    mockGetActiveWorkout.mockResolvedValue(workout);

    const options = buildOptions(workoutId);
    const { unmount } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // No notes typed — no timer armed — unmount should be a no-op for session notes.
    unmount();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockUpdateWorkoutSessionNotes).not.toHaveBeenCalled();
  });
});
