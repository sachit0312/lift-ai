/**
 * Sweep test: confirmFinish() re-entrancy guard in useWorkoutLifecycle.ts.
 *
 * Bug this pins: the Finish modal closes immediately, but the work underneath awaits
 * SQLite (and previously an unbounded network call). On a slow connection the app looked
 * frozen and a second tap on "Finish" re-entered confirmFinish() while the first call was
 * still in flight. insertSkippedPlaceholderSets() inserts a fresh uuid() row per skipped
 * exercise with NO dedupe against a concurrent call, so a double-entry produced duplicate
 * ghost rows. Those ghost rows sync to Supabase and get double-reported to the AI coach as
 * two separate "skipped exercise" events for the same workout.
 *
 * Also verifies:
 *  - the guard releases in `finally`, so a THROWN error still lets the next tap retry
 *    (rather than permanently wedging Finish), and
 *  - a thrown error surfaces the "Finish Failed" Alert instead of failing silently.
 */
import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
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
const mockFinishWorkout = jest.fn();

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

/** Flush the current microtask queue N times — enough to drain the awaited
 *  chain (getPlannedExerciseIds -> insertSkippedPlaceholderSets -> stampExerciseOrder ->
 *  finishWorkout) without relying on fake timers, since none of those calls use setTimeout. */
async function flushMicrotasks(times = 20) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('confirmFinish re-entrancy guard (sweep)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveWorkout.mockResolvedValue(null);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockStampExerciseOrder.mockResolvedValue(undefined);
    mockGetPlannedExerciseIds.mockResolvedValue(null);
    mockInsertSkippedPlaceholderSets.mockResolvedValue(undefined);
  });

  it('runs the finish work exactly ONCE when confirmFinish is tapped twice before the first resolves', async () => {
    const workoutId = 'w-reentrancy';
    // A planned exercise absent from blocks so insertSkippedPlaceholderSets is exercised —
    // this is the call whose duplication actually causes double-reported ghost rows.
    mockGetPlannedExerciseIds.mockResolvedValue(['ex-a', 'ex-b']);
    const blocks = [makeBlock('ex-a')]; // ex-b missing -> one ghost row expected

    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
    mockGetActiveWorkout.mockResolvedValue(workout);

    // Simulate a slow DB call: finishWorkout doesn't resolve until we say so.
    let resolveFinishWorkout: (() => void) | undefined;
    mockFinishWorkout.mockImplementation(
      () => new Promise<void>((resolve) => { resolveFinishWorkout = resolve; }),
    );

    const options = buildOptions(workoutId, blocks);
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    // Let initial load settle
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      // Two taps before the first resolves — the guard must block the second entirely.
      p1 = result.current.confirmFinish();
      p2 = result.current.confirmFinish();
    });

    // Drain the awaited chain up to the point finishWorkout is invoked and parked.
    await act(async () => {
      await flushMicrotasks();
    });

    // The re-entrant tap must not have run any of the finish work a second time,
    // even while the first call is still pending on the slow DB call.
    expect(mockGetPlannedExerciseIds).toHaveBeenCalledTimes(1);
    expect(mockInsertSkippedPlaceholderSets).toHaveBeenCalledTimes(1);
    expect(mockInsertSkippedPlaceholderSets).toHaveBeenCalledWith(workoutId, [
      { exercise_id: 'ex-b', programmed_order: 2 },
    ]);
    expect(mockStampExerciseOrder).toHaveBeenCalledTimes(1);

    // Now let the slow call complete and both confirmFinish() promises settle.
    await act(async () => {
      resolveFinishWorkout?.();
      await Promise.all([p1, p2]);
    });

    expect(mockFinishWorkout).toHaveBeenCalledTimes(1);
    // Still exactly once after both promises have fully settled.
    expect(mockInsertSkippedPlaceholderSets).toHaveBeenCalledTimes(1);
  });

  it('releases the guard in `finally` so a retry after a genuine failure still runs the finish work', async () => {
    const workoutId = 'w-retry';
    mockGetPlannedExerciseIds.mockResolvedValue(null);
    const blocks = [makeBlock('ex-a')];
    const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
    mockGetActiveWorkout.mockResolvedValue(workout);

    // First call: finishWorkout throws.
    mockFinishWorkout.mockRejectedValueOnce(new Error('network down'));

    const options = buildOptions(workoutId, blocks);
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    // First tap fails.
    await act(async () => {
      await result.current.confirmFinish();
    });

    // A thrown error must surface the "Finish Failed" alert rather than fail silently.
    expect(alertSpy).toHaveBeenCalledWith(
      'Finish Failed',
      expect.stringContaining('try again'),
    );
    expect(mockFinishWorkout).toHaveBeenCalledTimes(1);

    // Second call (the retry) must actually run — proves the guard was released in `finally`.
    mockFinishWorkout.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.confirmFinish();
    });

    expect(mockFinishWorkout).toHaveBeenCalledTimes(2);
    alertSpy.mockRestore();
  });
});
