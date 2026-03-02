import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// ─── Mocks ───

jest.mock('../../services/database', () => ({
  getActiveWorkout: jest.fn().mockResolvedValue(null),
  getAllTemplates: jest.fn().mockResolvedValue([]),
  getTemplateExercises: jest.fn().mockResolvedValue([]),
  startWorkout: jest.fn().mockResolvedValue({
    id: 'w1',
    started_at: new Date().toISOString(),
    finished_at: null,
    template_id: null,
  }),
  finishWorkout: jest.fn().mockResolvedValue(undefined),
  addWorkoutSet: jest.fn().mockImplementation(async (params: any) => ({
    id: `ws-${params.set_number}`,
    ...params,
  })),
  addWorkoutSetsBatch: jest.fn().mockImplementation(async (sets: any[]) =>
    sets.map((s: any, i: number) => ({ id: `ws-${s.set_number}`, ...s })),
  ),
  getWorkoutSets: jest.fn().mockResolvedValue([]),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
  deleteWorkoutSet: jest.fn().mockResolvedValue(undefined),
  deleteWorkout: jest.fn().mockResolvedValue(undefined),
  getExerciseHistory: jest.fn().mockResolvedValue([]),
  getExerciseById: jest.fn().mockResolvedValue(null),
  getAllExercises: jest.fn().mockResolvedValue([
    { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', notes: null },
  ]),
  getBulkExercises: jest.fn().mockResolvedValue([]),
  getUpcomingWorkoutForToday: jest.fn().mockResolvedValue(null),
  createExercise: jest.fn().mockResolvedValue({ id: 'new-ex', name: 'Test Exercise', type: 'weighted', muscle_groups: [], training_goal: 'hypertrophy', description: '', notes: null }),
  updateExerciseNotes: jest.fn().mockResolvedValue(undefined),
  getLastPerformedByTemplate: jest.fn().mockResolvedValue({}),
  getBestE1RM: jest.fn().mockResolvedValue(null),
  stampExerciseOrder: jest.fn().mockResolvedValue(undefined),
  applyWorkoutChangesToTemplate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  fireAndForgetSync: jest.fn(),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
  pullExercisesAndTemplates: jest.fn().mockResolvedValue(undefined),
  pullWorkoutHistory: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/liveActivity', () => ({
  adjustRestTimerActivity: jest.fn(),
  stopRestTimerActivity: jest.fn(),
  requestNotificationPermissions: jest.fn(),
  getRestTimerRemainingSeconds: jest.fn().mockReturnValue(null),
  startWorkoutActivity: jest.fn(),
  updateWorkoutActivityForSet: jest.fn(),
  updateWorkoutActivityForRest: jest.fn(),
  stopWorkoutActivity: jest.fn(),
  scheduleTimerEndNotification: jest.fn(),
  scheduleRestNotification: jest.fn(),
  cancelTimerEndNotification: jest.fn(),
}));

jest.mock('../../services/workoutBridge', () => ({
  syncStateToWidget: jest.fn(),
  startPolling: jest.fn(),
  stopPolling: jest.fn(),
  clearWidgetState: jest.fn(),
  getWidgetRestState: jest.fn().mockReturnValue(null),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

import {
  startWorkout,
  addWorkoutSet,
  addWorkoutSetsBatch,
  getAllExercises,
  updateWorkoutSet,
  updateExerciseNotes,
  deleteWorkout,
  deleteWorkoutSet,
  getAllTemplates,
  getTemplateExercises,
  getExerciseHistory,
  getUpcomingWorkoutForToday,
  getExerciseById,
  finishWorkout,
  stampExerciseOrder,
  applyWorkoutChangesToTemplate,
} from '../../services/database';

import {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  requestNotificationPermissions,
  getRestTimerRemainingSeconds,
  updateWorkoutActivityForRest,
} from '../../services/liveActivity';
import {
  syncStateToWidget,
  startPolling,
  stopPolling,
  clearWidgetState,
  getWidgetRestState,
} from '../../services/workoutBridge';
import WorkoutScreen from '../WorkoutScreen';

describe('WorkoutScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders idle state with Start Empty Workout button', async () => {
    const { getByTestId } = render(<WorkoutScreen />);
    await waitFor(() => {
      expect(getByTestId('start-empty-workout')).toBeTruthy();
    });
  });

  it('starts an empty workout and shows finish button', async () => {
    const { getByTestId } = render(<WorkoutScreen />);

    await waitFor(() => {
      expect(getByTestId('start-empty-workout')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId('start-empty-workout'));
    });

    await waitFor(() => {
      expect(getByTestId('finish-workout-btn')).toBeTruthy();
    });
  });

  it('adds exercise and toggles checkbox to complete set', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    // Start empty workout
    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Open add exercise modal
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });

    // Tap Bench Press
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });

    // Wait for set row to appear
    await waitFor(() => expect(getByTestId('check-0-0')).toBeTruthy());

    // Enter weight and reps
    await act(async () => {
      fireEvent.changeText(getByTestId('weight-0-0'), '135');
      fireEvent.changeText(getByTestId('reps-0-0'), '10');
    });

    // Toggle checkbox
    await act(async () => { fireEvent.press(getByTestId('check-0-0')); });

    // Verify set marked completed via updateWorkoutSet call
    expect(updateWorkoutSet).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      is_completed: true,
    }));

    // Verify sets progress shows 1/1
    await waitFor(() => {
      const progress = getByTestId('sets-progress');
      expect(progress).toBeTruthy();
      // Children are [1, "/", 1, " sets"]
      const children = progress.props.children;
      expect(children).toContain(1);
      expect(children[0]).toBe(1); // completed
      expect(children[2]).toBe(1); // total
    });
  });

  it('opens finish confirmation modal when at least one set is completed', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Add exercise
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });

    // Wait for set row and complete a set
    await waitFor(() => expect(getByTestId('check-0-0')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(getByTestId('weight-0-0'), '135');
      fireEvent.changeText(getByTestId('reps-0-0'), '10');
    });
    await act(async () => { fireEvent.press(getByTestId('check-0-0')); });

    // Tap finish
    await act(async () => { fireEvent.press(getByTestId('finish-workout-btn')); });

    await waitFor(() => {
      expect(getByText('Finish Workout')).toBeTruthy();
    });
  });

  it('blocks finishing workout with 0 completed sets', async () => {
    // Mock Alert.alert to track calls
    const mockAlert = jest.spyOn(require('react-native').Alert, 'alert');

    const { getByTestId, getByText } = render(<WorkoutScreen />);

    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Add exercise but don't complete any sets
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });

    // Wait for set row
    await waitFor(() => expect(getByTestId('check-0-0')).toBeTruthy());

    // Tap finish without completing any sets
    await act(async () => { fireEvent.press(getByTestId('finish-workout-btn')); });

    // Should show alert about no sets completed
    expect(mockAlert).toHaveBeenCalledWith('No Sets Completed', 'Complete at least one set before finishing.');

    mockAlert.mockRestore();
  });

  it('shows create exercise form in add-exercise modal', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    // Start empty workout
    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Open add exercise modal
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });

    // Tap the create toggle
    await waitFor(() => expect(getByText('Create New Exercise')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Create New Exercise')); });

    // Verify form fields appear
    await waitFor(() => {
      expect(getByText('Name')).toBeTruthy();
      expect(getByText('Muscle Groups')).toBeTruthy();
    });
  });

  it('header shows two-row layout with timer and progress', async () => {
    const { getByTestId } = render(<WorkoutScreen />);

    // Start empty workout
    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Verify sets-progress exists and shows 0/0 sets
    await waitFor(() => {
      const progress = getByTestId('sets-progress');
      expect(progress).toBeTruthy();
      const children = progress.props.children;
      expect(children[0]).toBe(0);
      expect(children[2]).toBe(0);
    });
  });

  it('blocks set completion when weight is empty', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    // Start empty workout
    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Add exercise
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });

    // Wait for set row
    await waitFor(() => expect(getByTestId('check-0-0')).toBeTruthy());

    // Enter only reps, not weight
    await act(async () => { fireEvent.changeText(getByTestId('reps-0-0'), '10'); });

    // Clear previous calls
    (updateWorkoutSet as jest.Mock).mockClear();

    // Try to complete set
    await act(async () => { fireEvent.press(getByTestId('check-0-0')); });

    // Should NOT call updateWorkoutSet with is_completed: true
    expect(updateWorkoutSet).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ is_completed: true }),
    );
  });

  it('blocks set completion when reps is empty', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    // Start empty workout
    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Add exercise
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });

    // Wait for set row
    await waitFor(() => expect(getByTestId('check-0-0')).toBeTruthy());

    // Enter only weight, not reps
    await act(async () => { fireEvent.changeText(getByTestId('weight-0-0'), '135'); });

    // Clear previous calls
    (updateWorkoutSet as jest.Mock).mockClear();

    // Try to complete set
    await act(async () => { fireEvent.press(getByTestId('check-0-0')); });

    // Should NOT call updateWorkoutSet with is_completed: true
    expect(updateWorkoutSet).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ is_completed: true }),
    );
  });

  it('shows rest timer toggle in exercise block', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    // Start empty workout
    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Add exercise
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });

    // Wait for rest timer toggle to appear
    await waitFor(() => {
      expect(getByTestId('rest-timer-toggle-0')).toBeTruthy();
    });
  });

  it('renders swipeable set rows', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });

    // Add an exercise
    await waitFor(() => expect(getByTestId('add-exercise-btn')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });

    // Tap Bench Press
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });

    // The set row should be wrapped in Swipeable
    await waitFor(() => {
      expect(getByTestId('swipeable-set-0-0')).toBeTruthy();
    });
  });

  it('shows remove exercise button in action row', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    // Start empty workout
    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Add exercise
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });

    // Wait for remove exercise button to appear
    await waitFor(() => expect(getByTestId('remove-exercise-0')).toBeTruthy());
  });

  // ─── Helper: start workout with exercise ───
  async function startWorkoutWithExercise(renderResult: ReturnType<typeof render>) {
    const { getByTestId, getByText } = renderResult;
    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });
    await waitFor(() => expect(getByText('Bench Press')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('Bench Press')); });
    await waitFor(() => expect(getByTestId('check-0-0')).toBeTruthy());
  }

  // ─── Helper: start workout from template ───
  async function startWorkoutFromTemplate(
    renderResult: ReturnType<typeof render>,
    opts: {
      exercises?: Array<{ id: string; name: string; workingSets: number; warmupSets?: number; restSeconds?: number }>;
    } = {},
  ) {
    const exercises = opts.exercises ?? [
      { id: 'ex1', name: 'Squat', workingSets: 3, warmupSets: 0, restSeconds: 150 },
    ];

    const template = { id: 'tpl-1', name: 'Test Template', created_at: new Date().toISOString() };

    const exerciseObjects = exercises.map(e => ({
      id: e.id, name: e.name, type: 'weighted' as const, muscle_groups: ['Quads'], training_goal: 'hypertrophy', description: '', notes: null,
    }));

    const templateExercises = exercises.map((e, i) => ({
      id: `te-${i}`,
      template_id: 'tpl-1',
      exercise_id: e.id,
      order: i,
      default_sets: e.workingSets,
      warmup_sets: e.warmupSets ?? 0,
      rest_seconds: e.restSeconds ?? 150,
      exercise: exerciseObjects[i],
    }));

    // Mock getAllTemplates for idle screen (called twice: loadState + loadUpcomingWorkoutInBackground)
    (getAllTemplates as jest.Mock)
      .mockResolvedValueOnce([template])   // loadState
      .mockResolvedValueOnce([template]);  // loadUpcomingWorkoutInBackground

    // Mock getTemplateExercises: called 1st for preview modal, 2nd for handleStartFromTemplate
    (getTemplateExercises as jest.Mock)
      .mockResolvedValueOnce(templateExercises)  // preview
      .mockResolvedValueOnce(templateExercises); // start

    // Mock startWorkout to return workout with template_id
    (startWorkout as jest.Mock).mockResolvedValueOnce({
      id: 'w1',
      started_at: new Date().toISOString(),
      finished_at: null,
      template_id: 'tpl-1',
    });

    // Mock getAllExercises
    (getAllExercises as jest.Mock).mockResolvedValueOnce(exerciseObjects);

    const { getByTestId, getByText } = renderResult;

    // Wait for template card to appear
    await waitFor(() => expect(getByText('Test Template')).toBeTruthy());

    // Tap the template card to open preview
    await act(async () => { fireEvent.press(getByText('Test Template')); });

    // Wait for preview modal's "Start Workout" button
    await waitFor(() => expect(getByTestId('start-from-template-btn')).toBeTruthy());

    // Start from template
    await act(async () => { fireEvent.press(getByTestId('start-from-template-btn')); });

    // Wait for active workout state
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());
  }

  // ─── Helper: finish workout flow ───
  async function finishWorkoutFlow(renderResult: ReturnType<typeof render>) {
    const { getByTestId, getByText, getAllByText } = renderResult;
    await act(async () => { fireEvent.press(getByTestId('finish-workout-btn')); });
    await waitFor(() => expect(getByText('Finish Workout')).toBeTruthy());
    const finishButtons = getAllByText('Finish');
    await act(async () => { fireEvent.press(finishButtons[finishButtons.length - 1]); });
  }

  // ─── Batch 1: Set Tag Cycling ───

  describe('set tag cycling', () => {
    it('cycles set tag to warmup on first tap and clears RPE', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });

      expect(updateWorkoutSet).toHaveBeenCalledWith('ws-1', expect.objectContaining({ tag: 'warmup', rpe: null }));
    });

    it('cycles through full tag sequence with correct RPE side effects', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // working → warmup (RPE cleared)
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      expect(updateWorkoutSet).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ tag: 'warmup', rpe: null }));

      // warmup → failure (RPE nulled — failure is implicitly RPE 10)
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      expect(updateWorkoutSet).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ tag: 'failure', rpe: null }));

      // failure → drop (RPE preserved, no rpe key in update)
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      expect(updateWorkoutSet).toHaveBeenLastCalledWith('ws-1', { tag: 'drop' });

      // drop → working (RPE preserved, no rpe key in update)
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      expect(updateWorkoutSet).toHaveBeenLastCalledWith('ws-1', { tag: 'working' });
    });

    it('renders badge text for tagged set', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Cycle to warmup
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });

      // Badge should show "W"
      await waitFor(() => {
        expect(result.getByText('W')).toBeTruthy();
      });
    });

    it('hides RPE input for warmup sets', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Cycle to warmup
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });

      // RPE element should exist (spacer) but not be a TextInput
      await waitFor(() => {
        const rpeEl = result.getByTestId('rpe-0-0');
        // Warmup RPE is a View spacer, not a TextInput — no onChangeText prop
        expect(rpeEl.props.onChangeText).toBeUndefined();
      });
    });

    it('hides RPE input for failure sets (empty view like warmup)', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Cycle to warmup, then failure
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });

      // RPE element should be a View spacer (no onChangeText), no "10" text
      await waitFor(() => {
        const rpeEl = result.getByTestId('rpe-0-0');
        expect(rpeEl.props.onChangeText).toBeUndefined();
      });
    });

    it('restores editable RPE when cycling from failure to drop', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Cycle: working → warmup → failure → drop
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });

      // RPE should be editable again (TextInput with onChangeText)
      await waitFor(() => {
        const rpeEl = result.getByTestId('rpe-0-0');
        expect(rpeEl.props.onChangeText).toBeDefined();
      });
    });

    it('RPE cleared when cycling failure to drop (editable, empty)', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Cycle: working → warmup → failure (RPE nulled) → drop (editable, empty)
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });

      // RPE should be editable TextInput with empty value (failure didn't set it)
      await waitFor(() => {
        const rpeEl = result.getByTestId('rpe-0-0');
        expect(rpeEl.props.onChangeText).toBeDefined();
        expect(rpeEl.props.value).toBe('');
      });
    });
  });

  // ─── Live Activity integration ───

  describe('Live Activity integration', () => {
    it('requests notification permissions on mount', async () => {
      render(<WorkoutScreen />);

      await waitFor(() => {
        expect(requestNotificationPermissions).toHaveBeenCalled();
      });
    });

    it('updates Live Activity for rest when rest timer starts', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Enter weight and reps
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });

      // Complete the set (triggers rest timer via syncWidgetState → updateWorkoutActivityForRest)
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      expect(updateWorkoutActivityForRest).toHaveBeenCalledWith(
        'Bench Press',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('stops Live Activity when rest timer is dismissed', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Complete a set to start rest timer
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Wait for rest timer to appear, then skip
      await waitFor(() => expect(result.getByText('Skip')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByText('Skip')); });

      expect(stopRestTimerActivity).toHaveBeenCalled();
    });

    it('adjusts Live Activity when +15s is pressed', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Complete a set to start rest timer
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Wait for rest timer and press +15s
      await waitFor(() => expect(result.getByText('+15s')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByText('+15s')); });

      expect(adjustRestTimerActivity).toHaveBeenCalledWith(15);
    });
  });

  // ─── Batch 1: Rest Timer Auto-Start ───

  describe('rest timer auto-start', () => {
    it('shows rest timer bar after completing a set with rest enabled', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Enter weight and reps
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });

      // Complete the set
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Rest timer bar should appear (rest is enabled by default)
      await waitFor(() => {
        expect(result.getByText(/Rest —/)).toBeTruthy();
      });
    });

    it('does not show rest timer when rest is toggled off', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Toggle rest timer off
      await act(async () => { fireEvent.press(result.getByTestId('rest-timer-toggle-0')); });

      // Verify "Off" is displayed
      await waitFor(() => {
        expect(result.getByText('Off')).toBeTruthy();
      });

      // Enter weight and reps
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });

      // Complete the set
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Rest timer bar should NOT appear
      await waitFor(() => {
        expect(result.queryByText(/Rest —/)).toBeNull();
      });
    });
  });

  // ─── Batch 1: Exercise Notes ───

  describe('exercise notes', () => {
    it('toggles notes textarea on/off when Notes button is tapped', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Notes should not be visible initially (no sticky notes on the mock exercise)
      expect(result.queryByTestId('exercise-notes-0')).toBeNull();

      // Tap Notes button
      await act(async () => { fireEvent.press(result.getByText('Notes')); });

      // Notes textarea should appear
      await waitFor(() => {
        expect(result.getByTestId('exercise-notes-0')).toBeTruthy();
      });

      // Tap again to hide
      await act(async () => { fireEvent.press(result.getByText('Hide Notes')); });

      await waitFor(() => {
        expect(result.queryByTestId('exercise-notes-0')).toBeNull();
      });
    });

    it('calls updateExerciseNotes after debounce when typing in notes', async () => {
      jest.useFakeTimers();
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Show notes
      await act(async () => { fireEvent.press(result.getByText('Notes')); });
      await waitFor(() => expect(result.getByTestId('exercise-notes-0')).toBeTruthy());

      // Type in notes
      await act(async () => {
        fireEvent.changeText(result.getByTestId('exercise-notes-0'), 'Focus on form');
      });

      // Should NOT be called immediately (debounced)
      expect(updateExerciseNotes).not.toHaveBeenCalled();

      // Advance past debounce delay
      act(() => { jest.advanceTimersByTime(500); });

      expect(updateExerciseNotes).toHaveBeenCalledWith('ex1', 'Focus on form');

      jest.useRealTimers();
    });

    it('debounces multiple keystrokes', async () => {
      jest.useFakeTimers();
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Show notes
      await act(async () => { fireEvent.press(result.getByText('Notes')); });
      await waitFor(() => expect(result.getByTestId('exercise-notes-0')).toBeTruthy());

      // Type rapidly
      await act(async () => { fireEvent.changeText(result.getByTestId('exercise-notes-0'), 'a'); });
      await act(async () => { fireEvent.changeText(result.getByTestId('exercise-notes-0'), 'ab'); });
      await act(async () => { fireEvent.changeText(result.getByTestId('exercise-notes-0'), 'abc'); });
      await act(async () => { fireEvent.changeText(result.getByTestId('exercise-notes-0'), 'abcd'); });
      await act(async () => { fireEvent.changeText(result.getByTestId('exercise-notes-0'), 'abcde'); });

      // Should NOT be called yet
      expect(updateExerciseNotes).not.toHaveBeenCalled();

      // Advance past debounce delay
      act(() => { jest.advanceTimersByTime(500); });

      // Should be called once with the final value
      expect(updateExerciseNotes).toHaveBeenCalledTimes(1);
      expect(updateExerciseNotes).toHaveBeenCalledWith('ex1', 'abcde');

      jest.useRealTimers();
    });

    it('flushes pending notes on finish', async () => {
      jest.useFakeTimers();
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Show notes and type (but don't advance timers — debounce pending)
      await act(async () => { fireEvent.press(result.getByText('Notes')); });
      await waitFor(() => expect(result.getByTestId('exercise-notes-0')).toBeTruthy());
      await act(async () => {
        fireEvent.changeText(result.getByTestId('exercise-notes-0'), 'Pending note');
      });

      // Complete a set so we can finish
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Dismiss rest timer if it appears
      try {
        await waitFor(() => expect(result.getByText('Skip')).toBeTruthy(), { timeout: 500 });
        await act(async () => { fireEvent.press(result.getByText('Skip')); });
      } catch {
        // No rest timer, that's fine
      }

      // Notes should NOT have been saved yet (debounce not fired)
      expect(updateExerciseNotes).not.toHaveBeenCalled();

      // Press finish
      await act(async () => { fireEvent.press(result.getByTestId('finish-workout-btn')); });

      // Confirm in finish modal
      await waitFor(() => expect(result.getByText('Finish Workout')).toBeTruthy());
      const finishButtons = result.getAllByText('Finish');
      await act(async () => { fireEvent.press(finishButtons[finishButtons.length - 1]); });

      // flushPendingNotes should have saved the pending notes
      expect(updateExerciseNotes).toHaveBeenCalledWith('ex1', 'Pending note');

      jest.useRealTimers();
    });

    it('clears pending notes on cancel', async () => {
      jest.useFakeTimers();
      const mockAlert = jest.spyOn(require('react-native').Alert, 'alert');

      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Show notes and type (but don't advance timers — debounce pending)
      await act(async () => { fireEvent.press(result.getByText('Notes')); });
      await waitFor(() => expect(result.getByTestId('exercise-notes-0')).toBeTruthy());
      await act(async () => {
        fireEvent.changeText(result.getByTestId('exercise-notes-0'), 'Should not save');
      });

      // Press cancel button
      await act(async () => { fireEvent.press(result.getByTestId('cancel-workout-btn')); });

      // Simulate pressing "Discard" in the alert
      const alertCall = mockAlert.mock.calls[0];
      const buttons = alertCall[2] as Array<{ text: string; onPress?: () => void }>;
      const discardButton = buttons.find(b => b.text === 'Discard');
      await act(async () => { discardButton?.onPress?.(); });

      // Advance timers to ensure debounce would have fired
      act(() => { jest.advanceTimersByTime(1000); });

      // Notes should NOT have been saved (cleared on cancel)
      expect(updateExerciseNotes).not.toHaveBeenCalled();

      mockAlert.mockRestore();
      jest.useRealTimers();
    });

    it('pre-expands notes when exercise has sticky notes', async () => {
      // Override getAllExercises to return exercise with existing notes
      (getAllExercises as jest.Mock).mockResolvedValueOnce([
        { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', notes: 'Existing note' },
      ]);

      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Notes should be pre-expanded because exercise has sticky notes
      await waitFor(() => {
        expect(result.getByTestId('exercise-notes-0')).toBeTruthy();
        expect(result.getByDisplayValue('Existing note')).toBeTruthy();
      });
    });
  });

  // ─── Batch 3: Cancel Workout ───

  describe('cancel workout', () => {
    it('shows cancel confirmation alert when X button is pressed', async () => {
      const mockAlert = jest.spyOn(require('react-native').Alert, 'alert');
      const result = render(<WorkoutScreen />);

      await waitFor(() => expect(result.getByTestId('start-empty-workout')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByTestId('start-empty-workout')); });
      await waitFor(() => expect(result.getByTestId('finish-workout-btn')).toBeTruthy());

      // Tap cancel button
      await act(async () => { fireEvent.press(result.getByTestId('cancel-workout-btn')); });

      expect(mockAlert).toHaveBeenCalledWith(
        'Cancel Workout',
        'Discard this workout? All progress will be lost.',
        expect.any(Array),
      );

      mockAlert.mockRestore();
    });

    it('discards workout when Discard is confirmed', async () => {
      const mockAlert = jest.spyOn(require('react-native').Alert, 'alert');
      const result = render(<WorkoutScreen />);

      await waitFor(() => expect(result.getByTestId('start-empty-workout')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByTestId('start-empty-workout')); });
      await waitFor(() => expect(result.getByTestId('finish-workout-btn')).toBeTruthy());

      // Tap cancel button
      await act(async () => { fireEvent.press(result.getByTestId('cancel-workout-btn')); });

      // Simulate pressing "Discard" in the alert
      const alertCall = mockAlert.mock.calls[0];
      const buttons = alertCall[2] as Array<{ text: string; onPress?: () => void }>;
      const discardButton = buttons.find(b => b.text === 'Discard');

      await act(async () => {
        discardButton?.onPress?.();
      });

      // Should delete the workout
      expect(deleteWorkout).toHaveBeenCalledWith('w1');

      // Should return to idle state
      await waitFor(() => {
        expect(result.getByTestId('start-empty-workout')).toBeTruthy();
      });

      mockAlert.mockRestore();
    });

    it('keeps workout active when Keep Going is pressed', async () => {
      const mockAlert = jest.spyOn(require('react-native').Alert, 'alert');
      const result = render(<WorkoutScreen />);

      await waitFor(() => expect(result.getByTestId('start-empty-workout')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByTestId('start-empty-workout')); });
      await waitFor(() => expect(result.getByTestId('finish-workout-btn')).toBeTruthy());

      // Tap cancel button
      await act(async () => { fireEvent.press(result.getByTestId('cancel-workout-btn')); });

      // Simulate pressing "Keep Going" in the alert
      const alertCall = mockAlert.mock.calls[0];
      const buttons = alertCall[2] as Array<{ text: string; style?: string }>;
      const keepGoingButton = buttons.find(b => b.text === 'Keep Going');

      // "Keep Going" has style: 'cancel' which means it just dismisses
      expect(keepGoingButton).toBeDefined();
      expect(keepGoingButton!.style).toBe('cancel');

      // Workout should still be active
      expect(result.getByTestId('finish-workout-btn')).toBeTruthy();

      mockAlert.mockRestore();
    });
  });

  // ─── Batch 3: Long-press set to delete ───

  describe('long-press set to delete', () => {
    it('deletes set on long-press when there are 2+ sets', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Add a second set
      await act(async () => { fireEvent.press(result.getByText('Add Set')); });

      // Wait for second set
      await waitFor(() => expect(result.getByTestId('check-0-1')).toBeTruthy());

      // Long-press first set tag
      await act(async () => { fireEvent(result.getByTestId('set-tag-0-0'), 'longPress'); });

      // deleteWorkoutSet should be called
      expect(deleteWorkoutSet).toHaveBeenCalledWith('ws-1');
    });

    it('does not delete the last remaining set on long-press', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Only one set exists - long-press should not delete
      await act(async () => { fireEvent(result.getByTestId('set-tag-0-0'), 'longPress'); });

      // deleteWorkoutSet should NOT be called
      expect(deleteWorkoutSet).not.toHaveBeenCalled();
    });
  });

  // ─── Batch 3: Template card starts workout via preview modal ───

  describe('template preview modal', () => {
    const pushDayTemplate = { id: 't1', name: 'Push Day', user_id: 'local', created_at: '2026-01-01', updated_at: '2026-01-01' };
    const benchExercise = { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', notes: null, user_id: 'local', created_at: '2026-01-01' };
    const templateExercises = [
      {
        id: 'te1', template_id: 't1', exercise_id: 'ex1', order: 1, default_sets: 3, warmup_sets: 0, rest_seconds: 90,
        exercise: benchExercise,
      },
    ];

    it('shows preview modal with exercises on template tap', async () => {
      (getAllTemplates as jest.Mock).mockResolvedValue([pushDayTemplate]);
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce(templateExercises);

      const result = render(<WorkoutScreen />);

      // Wait for template to appear
      await waitFor(() => expect(result.getByText('Push Day')).toBeTruthy());

      // Tap template card
      await act(async () => { fireEvent.press(result.getByText('Push Day')); });

      // Preview modal should show template name and exercise
      await waitFor(() => {
        expect(result.getByText('Bench Press')).toBeTruthy();
        expect(result.getByText('3 sets · Chest')).toBeTruthy();
        expect(result.getByTestId('start-from-template-btn')).toBeTruthy();
      });

      // Workout should NOT have started yet
      expect(startWorkout).not.toHaveBeenCalled();
    });

    it('starts workout when Start Workout is pressed in preview', async () => {
      (getAllTemplates as jest.Mock).mockResolvedValue([pushDayTemplate]);
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce(templateExercises);
      // Second call for when handleStartFromTemplate calls getTemplateExercises
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce(templateExercises);
      (startWorkout as jest.Mock).mockResolvedValueOnce({
        id: 'w1', started_at: new Date().toISOString(), finished_at: null, template_id: 't1',
      });

      const result = render(<WorkoutScreen />);

      // Wait for template and tap it
      await waitFor(() => expect(result.getByText('Push Day')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByText('Push Day')); });

      // Wait for preview modal, then tap Start Workout
      await waitFor(() => expect(result.getByTestId('start-from-template-btn')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByTestId('start-from-template-btn')); });

      // Active workout should start
      await waitFor(() => {
        expect(result.getByTestId('finish-workout-btn')).toBeTruthy();
      });

      expect(startWorkout).toHaveBeenCalledWith('t1');
    });

    it('closes modal on Cancel without starting workout', async () => {
      (getAllTemplates as jest.Mock).mockResolvedValue([pushDayTemplate]);
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce(templateExercises);

      const result = render(<WorkoutScreen />);

      // Wait for template and tap it
      await waitFor(() => expect(result.getByText('Push Day')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByText('Push Day')); });

      // Wait for preview modal
      await waitFor(() => expect(result.getByTestId('start-from-template-btn')).toBeTruthy());

      // Tap Cancel
      await act(async () => { fireEvent.press(result.getByText('Cancel')); });

      // Modal should close, workout should not start
      await waitFor(() => {
        expect(result.queryByTestId('start-from-template-btn')).toBeNull();
      });
      expect(startWorkout).not.toHaveBeenCalled();
    });

    it('shows empty state when template has no exercises', async () => {
      (getAllTemplates as jest.Mock).mockResolvedValue([pushDayTemplate]);
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce([]);

      const result = render(<WorkoutScreen />);

      // Wait for template and tap it
      await waitFor(() => expect(result.getByText('Push Day')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByText('Push Day')); });

      // Empty state message should appear
      await waitFor(() => {
        expect(result.getByText('No exercises in this template')).toBeTruthy();
      });
    });

    it('displays exercise sets and muscle groups', async () => {
      const multiExercises = [
        {
          id: 'te1', template_id: 't1', exercise_id: 'ex1', order: 1, default_sets: 3, warmup_sets: 0, rest_seconds: 90,
          exercise: { ...benchExercise, muscle_groups: ['Chest', 'Triceps'] },
        },
      ];
      (getAllTemplates as jest.Mock).mockResolvedValue([pushDayTemplate]);
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce(multiExercises);

      const result = render(<WorkoutScreen />);

      await waitFor(() => expect(result.getByText('Push Day')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByText('Push Day')); });

      await waitFor(() => {
        expect(result.getByText('3 sets · Chest, Triceps')).toBeTruthy();
      });
    });

    it('shows template card testID', async () => {
      (getAllTemplates as jest.Mock).mockResolvedValue([pushDayTemplate]);

      const result = render(<WorkoutScreen />);

      await waitFor(() => {
        expect(result.getByTestId('template-card-t1')).toBeTruthy();
      });
    });
  });

  // ─── Batch 2A: Previous Set Data ───

  describe('previous set data', () => {
    it('shows previous data as input placeholders when history exists', async () => {
      // Mock getExerciseHistory to return previous session data
      (getExerciseHistory as jest.Mock).mockResolvedValue([{
        workout: { id: 'w-prev', started_at: '2026-01-01', finished_at: '2026-01-01' },
        sets: [{ set_number: 1, weight: 135, reps: 10, is_completed: true, tag: 'working' }],
      }]);

      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Previous data should appear as placeholder in weight input
      await waitFor(() => {
        const weightInput = result.getByTestId('weight-0-0');
        expect(weightInput.props.placeholder).toBe('135');
      });

      // Reset mock
      (getExerciseHistory as jest.Mock).mockResolvedValue([]);
    });

    it('shows empty placeholder when no previous data exists', async () => {
      // Default mock already returns empty array for getExerciseHistory
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Weight input should have empty placeholder
      await waitFor(() => {
        const weightInput = result.getByTestId('weight-0-0');
        expect(weightInput.props.placeholder).toBe('');
      });
    });

    it('uses previous data as input placeholders', async () => {
      (getExerciseHistory as jest.Mock).mockResolvedValue([{
        workout: { id: 'w-prev', started_at: '2026-01-01', finished_at: '2026-01-01' },
        sets: [{ set_number: 1, weight: 225, reps: 5, is_completed: true, tag: 'working' }],
      }]);

      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Weight input should have placeholder "225"
      await waitFor(() => {
        const weightInput = result.getByTestId('weight-0-0');
        expect(weightInput.props.placeholder).toBe('225');
      });

      // Reps input should have placeholder "5"
      await waitFor(() => {
        const repsInput = result.getByTestId('reps-0-0');
        expect(repsInput.props.placeholder).toBe('5');
      });

      // Reset mock
      (getExerciseHistory as jest.Mock).mockResolvedValue([]);
    });
  });

  // ─── Batch 2B: Upcoming Workout TARGET Column ───

  describe('upcoming workout target placeholders', () => {
    const mockExercise = { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', notes: null, user_id: 'local', created_at: '2026-01-01' };
    const upcomingData = {
      workout: { id: 'uw1', date: '2026-02-07', template_id: null, notes: 'Test workout', created_at: '2026-02-07' },
      exercises: [{
        id: 'ue1', upcoming_workout_id: 'uw1', exercise_id: 'ex1', order: 1, rest_seconds: 90, notes: null,
        exercise: mockExercise,
        sets: [{ id: 'us1', upcoming_exercise_id: 'ue1', set_number: 1, target_weight: 185, target_reps: 8 }],
      }],
    };

    async function startUpcomingWorkout(result: ReturnType<typeof render>) {
      await waitFor(() => expect(result.getByTestId('start-upcoming-workout')).toBeTruthy());
      await act(async () => {
        fireEvent.press(result.getByTestId('start-upcoming-workout'));
      });
    }

    afterEach(() => {
      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(null);
      (getExerciseById as jest.Mock).mockResolvedValue(null);
    });

    it('shows target weight as placeholder in LBS input', async () => {
      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(upcomingData);
      (getExerciseById as jest.Mock).mockResolvedValue(mockExercise);

      const result = render(<WorkoutScreen />);
      await startUpcomingWorkout(result);

      await waitFor(() => {
        const weightInput = result.getByTestId('weight-0-0');
        expect(weightInput.props.placeholder).toBe('185');
      });
    });

    it('shows target reps as placeholder in REPS input', async () => {
      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(upcomingData);
      (getExerciseById as jest.Mock).mockResolvedValue(mockExercise);

      const result = render(<WorkoutScreen />);
      await startUpcomingWorkout(result);

      await waitFor(() => {
        const repsInput = result.getByTestId('reps-0-0');
        expect(repsInput.props.placeholder).toBe('8');
      });
    });

    it('uses purple placeholder color for target values', async () => {
      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(upcomingData);
      (getExerciseById as jest.Mock).mockResolvedValue(mockExercise);

      const result = render(<WorkoutScreen />);
      await startUpcomingWorkout(result);

      await waitFor(() => {
        const weightInput = result.getByTestId('weight-0-0');
        expect(weightInput.props.placeholderTextColor).toBe('rgba(124, 92, 252, 0.45)');
      });
    });

    it('does not show separate TARGET column header', async () => {
      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(upcomingData);
      (getExerciseById as jest.Mock).mockResolvedValue(mockExercise);

      const result = render(<WorkoutScreen />);
      await startUpcomingWorkout(result);

      await waitFor(() => {
        expect(result.getByTestId('weight-0-0')).toBeTruthy();
      });
      expect(result.queryByText('TARGET')).toBeNull();
    });

    it('falls back to previous data placeholder when no target exists', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Regular workout should use muted previous data placeholder color
      const weightInput = result.getByTestId('weight-0-0');
      expect(weightInput.props.placeholderTextColor).toBe('rgba(107, 107, 114, 0.5)');
    });
  });

  // ─── RPE Tracking ───

  describe('RPE tracking', () => {
    it('renders RPE column header in set row', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      await waitFor(() => {
        expect(result.getByText('RPE')).toBeTruthy();
      });
    });

    it('renders RPE input with correct testID', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      await waitFor(() => {
        expect(result.getByTestId('rpe-0-0')).toBeTruthy();
      });
    });

    it('calls updateWorkoutSet when RPE value is changed', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      await waitFor(() => expect(result.getByTestId('rpe-0-0')).toBeTruthy());

      // Clear previous calls from set creation
      (updateWorkoutSet as jest.Mock).mockClear();

      await act(async () => {
        fireEvent.changeText(result.getByTestId('rpe-0-0'), '8');
      });

      expect(updateWorkoutSet).toHaveBeenCalledWith('ws-1', { rpe: 8 });
    });

    it('RPE input shows placeholder dash', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      await waitFor(() => {
        const rpeInput = result.getByTestId('rpe-0-0');
        expect(rpeInput.props.placeholder).toBe('—');
      });
    });
  });

  // ─── AppState rest timer resync ───

  describe('AppState rest timer resync', () => {
    let appStateCallbacks: Array<(state: string) => void>;
    const mockRemove = jest.fn();

    // Helper to fire all captured AppState callbacks
    const fireAppState = (state: string) => {
      for (const cb of appStateCallbacks) {
        cb(state);
      }
    };

    beforeEach(() => {
      appStateCallbacks = [];
      // Capture ALL AppState listener callbacks (hook + component may each register one)
      const { AppState } = require('react-native');
      jest.spyOn(AppState, 'addEventListener').mockImplementation((...args: unknown[]) => {
        const [event, callback] = args as [string, (state: string) => void];
        if (event === 'change') {
          appStateCallbacks.push(callback);
        }
        return { remove: mockRemove };
      });
    });

    it('rest timer bar remains visible on foreground return when still resting', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Enter weight and reps, complete a set to start rest timer
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Verify rest timer is showing
      await waitFor(() => {
        expect(result.getByText(/Rest —/)).toBeTruthy();
      });

      // Widget state says still resting (timer hasn't expired)
      (getWidgetRestState as jest.Mock).mockReturnValue(null);

      await act(async () => {
        fireAppState('active');
      });

      // Rest bar should still be showing (timer hasn't expired)
      await waitFor(() => {
        expect(result.getByText(/Rest —/)).toBeTruthy();
      });
    });

    it('does not call getRestTimerRemainingSeconds when no rest timer is running', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // No rest timer started — restRef.current is null
      (getRestTimerRemainingSeconds as jest.Mock).mockClear();

      // Simulate returning from background
      await act(async () => {
        fireAppState('active');
      });

      // Should NOT query Live Activity state since no JS timer is running
      expect(getRestTimerRemainingSeconds).not.toHaveBeenCalled();
    });

    it('dismisses rest timer when widget says rest was skipped while backgrounded', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Start rest timer by completing a set
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Verify rest timer is showing
      await waitFor(() => {
        expect(result.getByText(/Rest —/)).toBeTruthy();
      });

      (stopRestTimerActivity as jest.Mock).mockClear();

      // Widget says rest was skipped while backgrounded
      (getWidgetRestState as jest.Mock).mockReturnValue({ isResting: false, restEndTime: 0 });

      await act(async () => {
        fireAppState('active');
      });

      // Rest timer bar should be dismissed
      await waitFor(() => {
        expect(result.queryByText(/Rest —/)).toBeNull();
      });

      // Live Activity should be stopped
      expect(stopRestTimerActivity).toHaveBeenCalled();
    });

    it('auto-dismisses rest timer if widget reports expired while backgrounded', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Enter weight and reps, complete a set to start rest timer
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Verify rest timer is showing
      await waitFor(() => {
        expect(result.getByText(/Rest —/)).toBeTruthy();
      });

      // Clear mocks so we can check stopRestTimerActivity was called by resync
      (stopRestTimerActivity as jest.Mock).mockClear();

      // Widget says rest ended (not resting anymore) — similar to timer naturally expiring
      // while backgrounded and the widget updating its state
      (getWidgetRestState as jest.Mock).mockReturnValue({ isResting: false, restEndTime: 0 });

      await act(async () => {
        fireAppState('active');
      });

      // Rest timer bar should be dismissed
      await waitFor(() => {
        expect(result.queryByText(/Rest —/)).toBeNull();
      });

      // Live Activity should be stopped
      expect(stopRestTimerActivity).toHaveBeenCalled();
    });
  });

  describe('widget bridge integration', () => {
    it('starts polling when workout is activated', async () => {
      const result = render(<WorkoutScreen />);

      await waitFor(() => expect(result.getByTestId('start-empty-workout')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByTestId('start-empty-workout')); });
      await waitFor(() => expect(result.getByTestId('finish-workout-btn')).toBeTruthy());

      expect(startPolling).toHaveBeenCalled();
    });

    it('syncs widget state when exercise is added to workout', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      expect(syncStateToWidget).toHaveBeenCalled();
    });

    it('stops polling when workout is cancelled', async () => {
      const mockAlert = jest.spyOn(require('react-native').Alert, 'alert');
      const result = render(<WorkoutScreen />);

      await waitFor(() => expect(result.getByTestId('start-empty-workout')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByTestId('start-empty-workout')); });
      await waitFor(() => expect(result.getByTestId('finish-workout-btn')).toBeTruthy());

      (stopPolling as jest.Mock).mockClear();

      // Tap cancel button
      await act(async () => { fireEvent.press(result.getByTestId('cancel-workout-btn')); });

      // Simulate pressing "Discard" in the alert
      const alertCall = mockAlert.mock.calls[0];
      const buttons = alertCall[2] as Array<{ text: string; onPress?: () => void }>;
      const discardButton = buttons.find(b => b.text === 'Discard');

      await act(async () => { discardButton?.onPress?.(); });

      expect(stopPolling).toHaveBeenCalled();

      mockAlert.mockRestore();
    });

    it('stops polling and clears widget state on finish', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Complete a set so we can finish
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      (stopPolling as jest.Mock).mockClear();
      (clearWidgetState as jest.Mock).mockClear();

      // Tap finish
      await act(async () => { fireEvent.press(result.getByTestId('finish-workout-btn')); });

      // Confirm in the modal — title is "Finish Workout", confirm button is "Finish"
      await waitFor(() => expect(result.getByText('Finish Workout')).toBeTruthy());
      const finishButtons = result.getAllByText('Finish');
      await act(async () => { fireEvent.press(finishButtons[finishButtons.length - 1]); });

      await waitFor(() => {
        expect(stopPolling).toHaveBeenCalled();
      });
      expect(clearWidgetState).toHaveBeenCalled();
    });

    it('syncs widget state when exercise is added mid-workout', async () => {
      const result = render(<WorkoutScreen />);

      await waitFor(() => expect(result.getByTestId('start-empty-workout')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByTestId('start-empty-workout')); });
      await waitFor(() => expect(result.getByTestId('finish-workout-btn')).toBeTruthy());

      (syncStateToWidget as jest.Mock).mockClear();

      // Add exercise
      await act(async () => { fireEvent.press(result.getByTestId('add-exercise-btn')); });
      await waitFor(() => expect(result.getByText('Bench Press')).toBeTruthy());
      await act(async () => { fireEvent.press(result.getByText('Bench Press')); });

      await waitFor(() => {
        expect(syncStateToWidget).toHaveBeenCalled();
      });
    });

  });

  // ─── Batch 3 Review: stampExerciseOrder on finish ───

  describe('finish workout', () => {
    it('calls stampExerciseOrder with correct entries on finish', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Complete a set
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Dismiss rest timer if it appears
      try {
        await waitFor(() => expect(result.getByText('Skip')).toBeTruthy(), { timeout: 500 });
        await act(async () => { fireEvent.press(result.getByText('Skip')); });
      } catch {}

      await finishWorkoutFlow(result);

      // Wait for summary screen to confirm finish completed
      await waitFor(() => expect(result.getByText('Workout Complete!')).toBeTruthy());

      expect(stampExerciseOrder).toHaveBeenCalledWith('w1', [
        { id: 'ws-1', order: 1 },
      ]);
    });
  });

  // ─── Batch 3 Review: F2 auto-reorder ───

  describe('F2 auto-reorder', () => {
    it('reorders out-of-position exercise on first set completion', async () => {
      const LayoutAnimation = require('react-native').LayoutAnimation;
      const configureNextSpy = jest.spyOn(LayoutAnimation, 'configureNext');

      const result = render(<WorkoutScreen />);
      await startWorkoutFromTemplate(result, {
        exercises: [
          { id: 'ex-squat', name: 'Squat', workingSets: 1 },
          { id: 'ex-bench', name: 'Bench Press', workingSets: 1 },
        ],
      });

      // Wait for both exercises to be rendered
      await waitFor(() => expect(result.getByTestId('check-1-0')).toBeTruthy());

      const callCountBefore = configureNextSpy.mock.calls.length;

      // Fill weight+reps for Bench (blockIdx=1), complete it
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-1-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-1-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-1-0')); });

      // LayoutAnimation should have been called for reorder
      expect(configureNextSpy.mock.calls.length).toBeGreaterThan(callCountBefore);

      configureNextSpy.mockRestore();
    });

    it('completing subsequent sets does NOT re-trigger reorder', async () => {
      const LayoutAnimation = require('react-native').LayoutAnimation;
      const configureNextSpy = jest.spyOn(LayoutAnimation, 'configureNext');

      const result = render(<WorkoutScreen />);
      await startWorkoutFromTemplate(result, {
        exercises: [
          { id: 'ex-squat', name: 'Squat', workingSets: 2 },
          { id: 'ex-bench', name: 'Bench Press', workingSets: 2 },
        ],
      });

      // Wait for both exercises
      await waitFor(() => expect(result.getByTestId('check-1-0')).toBeTruthy());

      // Complete first set of Bench (out of position -> triggers reorder)
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-1-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-1-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-1-0')); });

      const callCountAfterFirst = configureNextSpy.mock.calls.length;

      // Dismiss rest timer if present
      try {
        await waitFor(() => expect(result.getByText('Skip')).toBeTruthy(), { timeout: 500 });
        await act(async () => { fireEvent.press(result.getByText('Skip')); });
      } catch {}

      // Now complete second set of Bench (now at position 0 after reorder)
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-1'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-1'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-1')); });

      // LayoutAnimation should NOT have been called again for reorder
      expect(configureNextSpy.mock.calls.length).toBe(callCountAfterFirst);

      configureNextSpy.mockRestore();
    });

    it('no reorder when exercise already in position', async () => {
      const LayoutAnimation = require('react-native').LayoutAnimation;
      const configureNextSpy = jest.spyOn(LayoutAnimation, 'configureNext');

      const result = render(<WorkoutScreen />);
      await startWorkoutFromTemplate(result, {
        exercises: [
          { id: 'ex-squat', name: 'Squat', workingSets: 1 },
          { id: 'ex-bench', name: 'Bench Press', workingSets: 1 },
        ],
      });

      // Wait for first exercise
      await waitFor(() => expect(result.getByTestId('check-0-0')).toBeTruthy());

      // Complete first set of Squat (position 0 — already first)
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });

      const callCountBefore = configureNextSpy.mock.calls.length;

      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // LayoutAnimation should NOT have been called for reorder
      expect(configureNextSpy.mock.calls.length).toBe(callCountBefore);

      configureNextSpy.mockRestore();
    });
  });

  // ─── Batch 3 Review: F5 template update prompt ───

  describe('F5 template update prompt', () => {
    it('shows Template Changes Detected when working sets added', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutFromTemplate(result, {
        exercises: [{ id: 'ex1', name: 'Squat', workingSets: 3 }],
      });

      // Mock getTemplateExercises for confirmFinish
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce([{
        id: 'te-0', template_id: 'tpl-1', exercise_id: 'ex1', order: 0,
        default_sets: 3, warmup_sets: 0, rest_seconds: 150,
        exercise: { id: 'ex1', name: 'Squat', type: 'weighted', muscle_groups: ['Quads'], training_goal: 'hypertrophy', description: '', notes: null },
      }]);

      // Add a set (now 4 working sets vs original 3)
      await act(async () => { fireEvent.press(result.getByText('Add Set')); });
      await waitFor(() => expect(result.getByTestId('check-0-3')).toBeTruthy());

      // Complete at least one set
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '100');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Dismiss rest timer if present
      try {
        await waitFor(() => expect(result.getByText('Skip')).toBeTruthy(), { timeout: 500 });
        await act(async () => { fireEvent.press(result.getByText('Skip')); });
      } catch {}

      // Finish workout
      await finishWorkoutFlow(result);

      // Summary should show template changes
      await waitFor(() => {
        expect(result.getByText('Template Changes Detected')).toBeTruthy();
        expect(result.getByText('Update Template')).toBeTruthy();
      });
    });

    it('Update Template calls applyWorkoutChangesToTemplate after confirmation', async () => {
      const mockAlert = jest.spyOn(require('react-native').Alert, 'alert');

      const result = render(<WorkoutScreen />);
      await startWorkoutFromTemplate(result, {
        exercises: [{ id: 'ex1', name: 'Squat', workingSets: 3 }],
      });

      // Mock getTemplateExercises for confirmFinish
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce([{
        id: 'te-0', template_id: 'tpl-1', exercise_id: 'ex1', order: 0,
        default_sets: 3, warmup_sets: 0, rest_seconds: 150,
        exercise: { id: 'ex1', name: 'Squat', type: 'weighted', muscle_groups: ['Quads'], training_goal: 'hypertrophy', description: '', notes: null },
      }]);

      // Add a set
      await act(async () => { fireEvent.press(result.getByText('Add Set')); });
      await waitFor(() => expect(result.getByTestId('check-0-3')).toBeTruthy());

      // Complete one set
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '100');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Dismiss rest timer
      try {
        await waitFor(() => expect(result.getByText('Skip')).toBeTruthy(), { timeout: 500 });
        await act(async () => { fireEvent.press(result.getByText('Skip')); });
      } catch {}

      await finishWorkoutFlow(result);

      // Wait for summary with template changes
      await waitFor(() => expect(result.getByText('Update Template')).toBeTruthy());

      // Press "Update Template" — triggers Alert.alert confirmation
      await act(async () => { fireEvent.press(result.getByText('Update Template')); });

      // Find the "Update Template?" alert and invoke the "Update" button
      const alertCall = mockAlert.mock.calls.find(
        (c: any[]) => c[0] === 'Update Template?'
      );
      expect(alertCall).toBeDefined();
      const buttons = alertCall![2] as Array<{ text: string; onPress?: () => void }>;
      const updateButton = buttons.find(b => b.text === 'Update');
      await act(async () => { await updateButton?.onPress?.(); });

      expect(applyWorkoutChangesToTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: 'tpl-1' }),
      );

      mockAlert.mockRestore();
    });

    it('dismissing summary with pending changes shows discard confirmation', async () => {
      const mockAlert = jest.spyOn(require('react-native').Alert, 'alert');

      const result = render(<WorkoutScreen />);
      await startWorkoutFromTemplate(result, {
        exercises: [{ id: 'ex1', name: 'Squat', workingSets: 3 }],
      });

      // Mock getTemplateExercises for confirmFinish
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce([{
        id: 'te-0', template_id: 'tpl-1', exercise_id: 'ex1', order: 0,
        default_sets: 3, warmup_sets: 0, rest_seconds: 150,
        exercise: { id: 'ex1', name: 'Squat', type: 'weighted', muscle_groups: ['Quads'], training_goal: 'hypertrophy', description: '', notes: null },
      }]);

      // Add a set
      await act(async () => { fireEvent.press(result.getByText('Add Set')); });
      await waitFor(() => expect(result.getByTestId('check-0-3')).toBeTruthy());

      // Complete one set
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '100');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      // Dismiss rest timer
      try {
        await waitFor(() => expect(result.getByText('Skip')).toBeTruthy(), { timeout: 500 });
        await act(async () => { fireEvent.press(result.getByText('Skip')); });
      } catch {}

      await finishWorkoutFlow(result);

      // Wait for summary with template changes
      await waitFor(() => expect(result.getByText('Template Changes Detected')).toBeTruthy());

      // Press "Done" — triggers "Discard Template Changes?" alert
      await act(async () => { fireEvent.press(result.getByText('Done')); });

      // Verify discard confirmation alert was shown
      const discardCall = mockAlert.mock.calls.find(
        (c: any[]) => c[0] === 'Discard Template Changes?'
      );
      expect(discardCall).toBeDefined();

      // Invoke "Discard" to actually dismiss
      const buttons = discardCall![2] as Array<{ text: string; onPress?: () => void }>;
      const discardButton = buttons.find(b => b.text === 'Discard');
      await act(async () => { discardButton?.onPress?.(); });

      // Should NOT have called applyWorkoutChangesToTemplate
      expect(applyWorkoutChangesToTemplate).not.toHaveBeenCalled();

      // Should return to idle state
      await waitFor(() => expect(result.getByTestId('start-empty-workout')).toBeTruthy());

      mockAlert.mockRestore();
    });
  });

});
