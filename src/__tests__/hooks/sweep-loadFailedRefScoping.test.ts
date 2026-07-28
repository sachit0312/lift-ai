/**
 * Sweep test: loadFailedRef scoping in useWorkoutLifecycle.ts.
 *
 * Bug this pins (part 1 — retry, not permanent skip): loadState() has a focus-skip guard
 * that avoids re-running the expensive loadActiveWorkout() when the same workout is already
 * loaded (to protect in-flight debounced edits). Before loadFailedRef existed, a single
 * TRANSIENT failure (dropped connection, momentary SQLite hiccup) still set hasLoadedOnce and
 * left exerciseBlocks empty — every subsequent focus then took the skip path forever, because
 * the skip condition only checked hasLoadedOnce + prevWorkoutId match. The user was stuck on a
 * permanently blank exercise list with no way to recover for the rest of the session (short of
 * restarting the app). loadFailedRef distinguishes "successfully loaded a workout with no
 * exercises yet" from "the load threw" so the NEXT focus retries instead of skipping.
 *
 * Bug this pins (part 2 — flag must not outlive its workout): the flag describes the workout
 * we were last trying to load. activateWorkout() resets it to false whenever a new workout
 * becomes active (start/resume). If it didn't, a failure on an ABANDONED workout would force a
 * full loadActiveWorkout() on the very first focus of the NEXT workout — clobbering exactly the
 * in-flight debounced edits the skip-path exists to protect in the first place.
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
const mockGetWorkoutSets = jest.fn().mockResolvedValue([]);
const mockGetBulkExercises = jest.fn().mockResolvedValue([]);
const mockGetUserExerciseNotesBatch = jest.fn().mockResolvedValue(new Map());
const mockGetBestE1RM = jest.fn().mockResolvedValue(null);
const mockDeleteWorkout = jest.fn().mockResolvedValue(undefined);
const mockStartWorkout = jest.fn().mockResolvedValue({ id: 'w-B', started_at: new Date().toISOString() });

jest.mock('../../services/database', () => ({
  getActiveWorkout: (...args: unknown[]) => mockGetActiveWorkout(...args),
  getAllTemplates: (...args: unknown[]) => mockGetAllTemplates(...args),
  getLastPerformedByTemplate: (...args: unknown[]) => mockGetLastPerformedByTemplate(...args),
  getWorkoutSets: (...args: unknown[]) => mockGetWorkoutSets(...args),
  getBulkExercises: (...args: unknown[]) => mockGetBulkExercises(...args),
  getUserExerciseNotesBatch: (...args: unknown[]) => mockGetUserExerciseNotesBatch(...args),
  getBestE1RM: (...args: unknown[]) => mockGetBestE1RM(...args),
  deleteWorkout: (...args: unknown[]) => mockDeleteWorkout(...args),
  startWorkout: (...args: unknown[]) => mockStartWorkout(...args),
  finishWorkout: jest.fn().mockResolvedValue(undefined),
  stampExerciseOrder: jest.fn().mockResolvedValue(undefined),
  getPlannedExerciseIds: jest.fn().mockResolvedValue(null),
  insertSkippedPlaceholderSets: jest.fn().mockResolvedValue(undefined),
  setPlannedExerciseIds: jest.fn().mockResolvedValue(undefined),
  updateWorkoutSessionNotes: jest.fn().mockResolvedValue(undefined),
  getUpcomingWorkoutForToday: jest.fn().mockResolvedValue(null),
  getAllExercises: jest.fn().mockResolvedValue([]),
  addWorkoutSet: jest.fn().mockResolvedValue({ id: 'ws-1' }),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
  getTemplateExercises: jest.fn().mockResolvedValue([]),
  getUserExerciseNotes: jest.fn().mockResolvedValue(null),
  createExercise: jest.fn().mockResolvedValue({ id: 'ex-new' }),
  clearLocalUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
  updateWorkoutCoachNotes: jest.fn().mockResolvedValue(undefined),
  getUpcomingWorkoutById: jest.fn().mockResolvedValue(null),
  applyWorkoutChangesToTemplate: jest.fn().mockResolvedValue(undefined),
  addWorkoutSetsBatch: jest.fn().mockResolvedValue([{ id: 'ws-1' }]),
}));

jest.mock('../../utils/exerciseHistory', () => ({
  getExerciseHistoryData: jest.fn().mockResolvedValue({ previousSets: [], lastTime: null }),
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

// Capture the focus callback directly instead of wiring it through a real useEffect,
// so the test can invoke "another focus" on demand — independent of React's effect
// re-run rules (a `[]` dependency array would otherwise only ever fire once).
let focusCallback: (() => void) | null = null;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    focusCallback = cb;
  },
}));

async function refocus() {
  await act(async () => {
    focusCallback?.();
    await new Promise(resolve => setTimeout(resolve, 50));
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildOptions() {
  const workoutRef: React.MutableRefObject<any> = { current: null };
  const blocksRef = { current: [] as ExerciseBlock[] };

  return {
    workoutRef,
    setExerciseBlocks: jest.fn() as React.Dispatch<React.SetStateAction<ExerciseBlock[]>>,
    exerciseBlocks: [],
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

describe('loadFailedRef scoping (sweep)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    focusCallback = null;
    mockGetActiveWorkout.mockResolvedValue(null);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockGetWorkoutSets.mockResolvedValue([]);
    mockGetBulkExercises.mockResolvedValue([]);
    mockGetUserExerciseNotesBatch.mockResolvedValue(new Map());
    mockGetBestE1RM.mockResolvedValue(null);
  });

  it('retries loadActiveWorkout on the NEXT focus after a failure, instead of taking the skip path forever', async () => {
    const workoutA = createMockWorkout({ id: 'w-A', started_at: new Date().toISOString() });
    const exercise = createMockExercise({ id: 'ex-1' });

    mockGetActiveWorkout.mockResolvedValue(workoutA);
    // First loadActiveWorkout call throws (transient failure).
    mockGetWorkoutSets.mockRejectedValueOnce(new Error('sqlite hiccup'));

    const options = buildOptions();
    renderHook(() => useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]));

    // Initial focus (mount) — load fails.
    await refocus();

    expect(mockGetWorkoutSets).toHaveBeenCalledTimes(1);
    // setExerciseBlocks([]) called from the catch block on failure.
    expect(options.setExerciseBlocks).toHaveBeenCalledWith([]);

    // Second call succeeds this time.
    mockGetWorkoutSets.mockResolvedValueOnce([
      {
        id: 'set-1',
        exercise_id: 'ex-1',
        set_number: 1,
        weight: 100,
        reps: 10,
        rpe: null,
        tag: 'working',
        is_completed: false,
        exercise_order: 1,
      },
    ]);
    mockGetBulkExercises.mockResolvedValueOnce([exercise]);

    // Next focus, SAME workout id — must retry (not skip), because loadFailedRef is true.
    await refocus();

    expect(mockGetWorkoutSets).toHaveBeenCalledTimes(2);
    // This time it succeeded and populated real blocks.
    const populatedCall = (options.setExerciseBlocks as jest.Mock).mock.calls.find(
      ([blocks]) => Array.isArray(blocks) && blocks.length === 1,
    );
    expect(populatedCall).toBeDefined();

    // Third focus, same workout, now loadFailedRef should be false (load succeeded) —
    // the skip path should trigger and loadActiveWorkout must NOT run a third time.
    await refocus();

    expect(mockGetWorkoutSets).toHaveBeenCalledTimes(2);
  });

  it('clears loadFailedRef when a new workout is activated, so the fresh workout is not force-reloaded', async () => {
    const workoutA = createMockWorkout({ id: 'w-A', started_at: new Date().toISOString() });

    mockGetActiveWorkout.mockResolvedValue(workoutA);
    // loadActiveWorkout fails for workout A — loadFailedRef becomes true.
    mockGetWorkoutSets.mockRejectedValueOnce(new Error('sqlite hiccup'));

    const options = buildOptions();
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await refocus();
    expect(mockGetWorkoutSets).toHaveBeenCalledTimes(1);

    // Abandon workout A: cancel it (deletes it, clears loadFailedRef, and reloads state).
    // No active workout left after cancel.
    mockGetActiveWorkout.mockResolvedValue(null);
    await act(async () => {
      // handleCancelWorkout shows a confirmation Alert; invoke the destructive button
      // directly rather than driving the native Alert UI.
      const { Alert } = require('react-native');
      const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        const discard = ((buttons ?? []) as Array<{ text?: string; onPress?: () => void }>).find(
          (b) => b.text === 'Discard',
        );
        discard?.onPress?.();
      });
      result.current.handleCancelWorkout();
      await new Promise(resolve => setTimeout(resolve, 50));
      spy.mockRestore();
    });

    // Start a brand new workout B — activateWorkout() must reset loadFailedRef to false.
    const workoutB = createMockWorkout({ id: 'w-B', started_at: new Date().toISOString() });
    mockStartWorkout.mockResolvedValue(workoutB);
    await act(async () => {
      await result.current.handleStartEmpty();
    });

    // Now the active workout in the DB is B, matching workoutRef.current (set by activateWorkout).
    mockGetActiveWorkout.mockResolvedValue(workoutB);
    mockGetWorkoutSets.mockClear();

    // Next focus for the fresh workout B: since loadFailedRef was cleared by activateWorkout,
    // and prevWorkoutId (B, set by activateWorkout) === active.id (B), this must take the
    // skip path — NOT a forced full reload that would clobber in-flight edits on the new workout.
    await refocus();

    expect(mockGetWorkoutSets).not.toHaveBeenCalled();
  });
});
