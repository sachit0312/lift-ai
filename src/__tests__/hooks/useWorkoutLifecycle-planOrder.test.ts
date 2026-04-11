/**
 * Tests for Task 5: programmedOrder threading through start paths.
 *
 * Verifies that handleStartFromTemplate passes array index as programmedOrder
 * to buildExerciseBlock (which calls addWorkoutSetsBatch) and persists the
 * planned exercise ID list via setPlannedExerciseIds.
 * Verifies that handleStartFromUpcoming does the same.
 * Verifies that handleStartEmpty does NOT call setPlannedExerciseIds
 * (DB default NULL is sufficient).
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
const mockSetPlannedExerciseIds = jest.fn().mockResolvedValue(undefined);
const mockStartWorkout = jest.fn().mockResolvedValue({ id: 'w1', started_at: new Date().toISOString() });
const mockGetTemplateExercises = jest.fn().mockResolvedValue([]);
const mockAddWorkoutSetsBatch = jest.fn().mockResolvedValue([{ id: 'ws-1' }]);
const mockAddWorkoutSet = jest.fn().mockResolvedValue({ id: 'ws-new' });
const mockGetBestE1RM = jest.fn().mockResolvedValue(null);
const mockGetUserExerciseNotes = jest.fn().mockResolvedValue(null);
const mockGetUpcomingWorkoutForToday = jest.fn().mockResolvedValue(null);

jest.mock('../../services/database', () => ({
  getActiveWorkout: (...args: unknown[]) => mockGetActiveWorkout(...args),
  getAllTemplates: (...args: unknown[]) => mockGetAllTemplates(...args),
  getLastPerformedByTemplate: (...args: unknown[]) => mockGetLastPerformedByTemplate(...args),
  finishWorkout: jest.fn().mockResolvedValue(undefined),
  stampExerciseOrder: (...args: unknown[]) => mockStampExerciseOrder(...args),
  setPlannedExerciseIds: (...args: unknown[]) => mockSetPlannedExerciseIds(...args),
  getPlannedExerciseIds: jest.fn().mockResolvedValue(null),
  insertSkippedPlaceholderSets: jest.fn().mockResolvedValue(undefined),
  startWorkout: (...args: unknown[]) => mockStartWorkout(...args),
  getTemplateExercises: (...args: unknown[]) => mockGetTemplateExercises(...args),
  addWorkoutSetsBatch: (...args: unknown[]) => mockAddWorkoutSetsBatch(...args),
  getBestE1RM: (...args: unknown[]) => mockGetBestE1RM(...args),
  getUserExerciseNotes: (...args: unknown[]) => mockGetUserExerciseNotes(...args),
  updateWorkoutSessionNotes: jest.fn().mockResolvedValue(undefined),
  getUpcomingWorkoutForToday: (...args: unknown[]) => mockGetUpcomingWorkoutForToday(...args),
  getWorkoutSets: jest.fn().mockResolvedValue([]),
  deleteWorkout: jest.fn().mockResolvedValue(undefined),
  getAllExercises: jest.fn().mockResolvedValue([]),
  addWorkoutSet: (...args: unknown[]) => mockAddWorkoutSet(...args),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
  getBulkExercises: jest.fn().mockResolvedValue([]),
  getUserExerciseNotesBatch: jest.fn().mockResolvedValue(new Map()),
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

function buildOptions(workoutId = 'w1') {
  const workout = createMockWorkout({ id: workoutId, started_at: new Date().toISOString() });
  const workoutRef = { current: workout };
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useWorkoutLifecycle — plan order (Task 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveWorkout.mockResolvedValue(null);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockStartWorkout.mockResolvedValue({ id: 'w1', started_at: new Date().toISOString() });
    mockSetPlannedExerciseIds.mockResolvedValue(undefined);
    mockGetBestE1RM.mockResolvedValue(null);
    mockGetUserExerciseNotes.mockResolvedValue(null);
    mockGetUpcomingWorkoutForToday.mockResolvedValue(null);
  });

  it('handleStartFromTemplate passes index as programmedOrder and persists planned IDs', async () => {
    const exA = createMockExercise({ id: 'ex-a', name: 'Exercise A' });
    const exB = createMockExercise({ id: 'ex-b', name: 'Exercise B' });
    const exC = createMockExercise({ id: 'ex-c', name: 'Exercise C' });

    mockGetTemplateExercises.mockResolvedValue([
      { exercise_id: 'ex-a', exercise: exA, default_sets: 3, warmup_sets: 0, rest_seconds: 90, sort_order: 0 },
      { exercise_id: 'ex-b', exercise: exB, default_sets: 3, warmup_sets: 0, rest_seconds: 90, sort_order: 1 },
      { exercise_id: 'ex-c', exercise: exC, default_sets: 3, warmup_sets: 0, rest_seconds: 90, sort_order: 2 },
    ]);

    // addWorkoutSetsBatch returns one inserted set per call
    mockAddWorkoutSetsBatch
      .mockResolvedValueOnce([{ id: 'ws-a-1' }, { id: 'ws-a-2' }, { id: 'ws-a-3' }])
      .mockResolvedValueOnce([{ id: 'ws-b-1' }, { id: 'ws-b-2' }, { id: 'ws-b-3' }])
      .mockResolvedValueOnce([{ id: 'ws-c-1' }, { id: 'ws-c-2' }, { id: 'ws-c-3' }]);

    const options = buildOptions();
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    // Wait for initial load
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.handleStartFromTemplate({ id: 't1', name: 'Test Template', user_id: 'u1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    });

    // addWorkoutSetsBatch was called 3 times (once per exercise)
    expect(mockAddWorkoutSetsBatch).toHaveBeenCalledTimes(3);

    // Check programmed_order and exercise_order for each call (1-indexed from 0-indexed array position)
    const call0Sets = mockAddWorkoutSetsBatch.mock.calls[0][0];
    expect(call0Sets[0]).toMatchObject({ programmed_order: 1, exercise_order: 1 });

    const call1Sets = mockAddWorkoutSetsBatch.mock.calls[1][0];
    expect(call1Sets[0]).toMatchObject({ programmed_order: 2, exercise_order: 2 });

    const call2Sets = mockAddWorkoutSetsBatch.mock.calls[2][0];
    expect(call2Sets[0]).toMatchObject({ programmed_order: 3, exercise_order: 3 });

    // setPlannedExerciseIds called with workout id and ordered exercise IDs
    expect(mockSetPlannedExerciseIds).toHaveBeenCalledWith('w1', ['ex-a', 'ex-b', 'ex-c']);
  });

  it('handleStartEmpty does NOT call setPlannedExerciseIds (DB default NULL is sufficient)', async () => {
    const options = buildOptions();
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.handleStartEmpty();
    });

    // The DB column defaults to NULL, so no explicit write is needed.
    // confirmFinish guards with `if (plannedIds && plannedIds.length > 0)`.
    expect(mockSetPlannedExerciseIds).not.toHaveBeenCalled();
  });
});

// ─── Test #8: handleStartFromUpcoming plan threading ─────────────────────────

describe('useWorkoutLifecycle — handleStartFromUpcoming plan order (Test 8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveWorkout.mockResolvedValue(null);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockStartWorkout.mockResolvedValue({ id: 'w1', started_at: new Date().toISOString() });
    mockSetPlannedExerciseIds.mockResolvedValue(undefined);
    mockGetBestE1RM.mockResolvedValue(null);
    mockGetUserExerciseNotes.mockResolvedValue(null);
    mockGetUpcomingWorkoutForToday.mockResolvedValue(null);
  });

  it('passes index as programmedOrder and persists planned IDs before Promise.all', async () => {
    const exA = createMockExercise({ id: 'ex-a', name: 'Exercise A' });
    const exB = createMockExercise({ id: 'ex-b', name: 'Exercise B' });
    const exC = createMockExercise({ id: 'ex-c', name: 'Exercise C' });

    const mockUpcoming = {
      workout: { id: 'up-1', template_id: null, notes: null },
      exercises: [
        { exercise_id: 'ex-a', exercise: exA, sets: [{ set_number: 1, tag: 'working', target_weight: null, target_reps: null, target_rpe: null }], rest_seconds: 90, notes: null },
        { exercise_id: 'ex-b', exercise: exB, sets: [{ set_number: 1, tag: 'working', target_weight: null, target_reps: null, target_rpe: null }], rest_seconds: 90, notes: null },
        { exercise_id: 'ex-c', exercise: exC, sets: [{ set_number: 1, tag: 'working', target_weight: null, target_reps: null, target_rpe: null }], rest_seconds: 90, notes: null },
      ],
    };

    // Return the upcoming workout from loadState
    mockGetUpcomingWorkoutForToday.mockResolvedValue(mockUpcoming);

    mockAddWorkoutSetsBatch
      .mockResolvedValueOnce([{ id: 'ws-a-1' }])
      .mockResolvedValueOnce([{ id: 'ws-b-1' }])
      .mockResolvedValueOnce([{ id: 'ws-c-1' }]);

    const options = buildOptions();
    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    // Wait for initial loadState to set upcomingWorkout
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.handleStartFromUpcoming();
    });

    // addWorkoutSetsBatch called once per exercise with correct programmed_order
    expect(mockAddWorkoutSetsBatch).toHaveBeenCalledTimes(3);

    const call0Sets = mockAddWorkoutSetsBatch.mock.calls[0][0];
    expect(call0Sets[0]).toMatchObject({ programmed_order: 1, exercise_order: 1 });

    const call1Sets = mockAddWorkoutSetsBatch.mock.calls[1][0];
    expect(call1Sets[0]).toMatchObject({ programmed_order: 2, exercise_order: 2 });

    const call2Sets = mockAddWorkoutSetsBatch.mock.calls[2][0];
    expect(call2Sets[0]).toMatchObject({ programmed_order: 3, exercise_order: 3 });

    // setPlannedExerciseIds called with workout id and ordered exercise IDs
    expect(mockSetPlannedExerciseIds).toHaveBeenCalledWith('w1', ['ex-a', 'ex-b', 'ex-c']);
  });
});

// ─── Test: handleAddExerciseToWorkout exercise_order collision fix ────────────

jest.mock('../../utils/exerciseHistory', () => ({
  getExerciseHistoryData: jest.fn().mockResolvedValue({ previousSets: [], lastTime: null }),
}));

describe('useWorkoutLifecycle — handleAddExerciseToWorkout exercise_order (Fix #1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveWorkout.mockResolvedValue(null);
    mockGetAllTemplates.mockResolvedValue([]);
    mockGetLastPerformedByTemplate.mockResolvedValue({});
    mockGetBestE1RM.mockResolvedValue(null);
    mockGetUserExerciseNotes.mockResolvedValue(null);
    mockGetUpcomingWorkoutForToday.mockResolvedValue(null);
    mockAddWorkoutSet.mockResolvedValue({ id: 'ws-new' });
  });

  it('assigns exercise_order: 4 and programmed_order: null when blocks have orders [1,2,3]', async () => {
    const exA = createMockExercise({ id: 'ex-a' });
    const exB = createMockExercise({ id: 'ex-b' });
    const exC = createMockExercise({ id: 'ex-c' });
    const exD = createMockExercise({ id: 'ex-d', name: 'Exercise D' });

    const makeLocalBlock = (exercise: ReturnType<typeof createMockExercise>, order: number): ExerciseBlock => ({
      exercise,
      sets: [{ id: `s-${exercise.id}`, exercise_id: exercise.id, set_number: 1, weight: '', reps: '', rpe: '', tag: 'working' as const, is_completed: false, previous: null, exercise_order: order }],
      lastTime: null, machineNotesExpanded: false, machineNotes: '', restSeconds: 90, restEnabled: true,
    });

    const workout = createMockWorkout({ id: 'w1', started_at: new Date().toISOString() });
    const blocks = [makeLocalBlock(exA, 1), makeLocalBlock(exB, 2), makeLocalBlock(exC, 3)];
    const workoutRef = { current: workout };
    const blocksRef = { current: blocks };

    const options = {
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
    mockGetActiveWorkout.mockResolvedValue(workout);

    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.handleOpenAddExercise();
    });

    await act(async () => {
      await result.current.handleAddExerciseToWorkout(exD);
    });

    const addCall = mockAddWorkoutSet.mock.calls[0]?.[0];
    expect(addCall).toBeDefined();
    expect(addCall.exercise_order).toBe(4);
    expect(addCall.programmed_order).toBeNull();
  });

  it('assigns exercise_order: 4 (max+1) when blocks have gaps [order 1, order 3] after a remove', async () => {
    const exA = createMockExercise({ id: 'ex-a' });
    const exC = createMockExercise({ id: 'ex-c' });
    const exD = createMockExercise({ id: 'ex-d', name: 'Exercise D' });

    const makeLocalBlock = (exercise: ReturnType<typeof createMockExercise>, order: number): ExerciseBlock => ({
      exercise,
      sets: [{ id: `s-${exercise.id}`, exercise_id: exercise.id, set_number: 1, weight: '', reps: '', rpe: '', tag: 'working' as const, is_completed: false, previous: null, exercise_order: order }],
      lastTime: null, machineNotesExpanded: false, machineNotes: '', restSeconds: 90, restEnabled: true,
    });

    const workout = createMockWorkout({ id: 'w1', started_at: new Date().toISOString() });
    // Simulate post-remove gap: ex-b (order 2) was deleted, remaining blocks have orders [1, 3]
    const blocks = [makeLocalBlock(exA, 1), makeLocalBlock(exC, 3)];
    const workoutRef = { current: workout };
    const blocksRef = { current: blocks };

    const options = {
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
    mockGetActiveWorkout.mockResolvedValue(workout);

    const { result } = renderHook(() =>
      useWorkoutLifecycle(options as Parameters<typeof useWorkoutLifecycle>[0]),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.handleOpenAddExercise();
    });

    await act(async () => {
      await result.current.handleAddExerciseToWorkout(exD);
    });

    const addCall = mockAddWorkoutSet.mock.calls[0]?.[0];
    expect(addCall).toBeDefined();
    // With gap [1, 3], length+1 would be 3 (collision), max+1 must be 4
    expect(addCall.exercise_order).toBe(4);
    expect(addCall.programmed_order).toBeNull();
  });
});
