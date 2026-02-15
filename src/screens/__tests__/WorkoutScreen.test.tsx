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
  getWorkoutSets: jest.fn().mockResolvedValue([]),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
  deleteWorkoutSet: jest.fn().mockResolvedValue(undefined),
  deleteWorkout: jest.fn().mockResolvedValue(undefined),
  getExerciseHistory: jest.fn().mockResolvedValue([]),
  getExerciseById: jest.fn().mockResolvedValue(null),
  getAllExercises: jest.fn().mockResolvedValue([
    { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', notes: null },
  ]),
  getUpcomingWorkoutForToday: jest.fn().mockResolvedValue(null),
  createExercise: jest.fn().mockResolvedValue({ id: 'new-ex', name: 'Test Exercise', type: 'weighted', muscle_groups: [], training_goal: 'hypertrophy', description: '', notes: null }),
  updateExerciseNotes: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/liveActivity', () => ({
  startRestTimerActivity: jest.fn(),
  adjustRestTimerActivity: jest.fn(),
  stopRestTimerActivity: jest.fn(),
  requestNotificationPermissions: jest.fn(),
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
} from '../../services/database';

import {
  startRestTimerActivity,
  adjustRestTimerActivity,
  stopRestTimerActivity,
  requestNotificationPermissions,
} from '../../services/liveActivity';
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

  // ─── Batch 1: Set Tag Cycling ───

  describe('set tag cycling', () => {
    it('cycles set tag to warmup on first tap', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });

      expect(updateWorkoutSet).toHaveBeenCalledWith('ws-1', expect.objectContaining({ tag: 'warmup' }));
    });

    it('cycles through full tag sequence: working → warmup → failure → drop → working', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // working → warmup
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      expect(updateWorkoutSet).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ tag: 'warmup' }));

      // warmup → failure
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      expect(updateWorkoutSet).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ tag: 'failure' }));

      // failure → drop
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      expect(updateWorkoutSet).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ tag: 'drop' }));

      // drop → working
      await act(async () => { fireEvent.press(result.getByTestId('set-tag-0-0')); });
      expect(updateWorkoutSet).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ tag: 'working' }));
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
  });

  // ─── Live Activity integration ───

  describe('Live Activity integration', () => {
    it('requests notification permissions on mount', async () => {
      render(<WorkoutScreen />);

      await waitFor(() => {
        expect(requestNotificationPermissions).toHaveBeenCalled();
      });
    });

    it('starts Live Activity when rest timer starts', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // Enter weight and reps
      await act(async () => {
        fireEvent.changeText(result.getByTestId('weight-0-0'), '135');
        fireEvent.changeText(result.getByTestId('reps-0-0'), '10');
      });

      // Complete the set (triggers rest timer)
      await act(async () => { fireEvent.press(result.getByTestId('check-0-0')); });

      expect(startRestTimerActivity).toHaveBeenCalledWith(
        expect.any(Number),
        'Bench Press',
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

  // ─── Batch 3: Template card starts workout ───

  describe('template card starts workout', () => {
    it('starts workout from template and shows exercise blocks', async () => {
      // Setup: return a template in idle state
      (getAllTemplates as jest.Mock).mockResolvedValueOnce([
        { id: 't1', name: 'Push Day', user_id: 'local', created_at: '2026-01-01', updated_at: '2026-01-01' },
      ]);
      // Mock getTemplateExercises to return an exercise
      (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
        {
          id: 'te1', template_id: 't1', exercise_id: 'ex1', order: 1, default_sets: 3, rest_seconds: 90,
          exercise: { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', notes: null, user_id: 'local', created_at: '2026-01-01' },
        },
      ]);
      (startWorkout as jest.Mock).mockResolvedValueOnce({
        id: 'w1', started_at: new Date().toISOString(), finished_at: null, template_id: 't1',
      });

      const result = render(<WorkoutScreen />);

      // Wait for template to appear
      await waitFor(() => expect(result.getByText('Push Day')).toBeTruthy());

      // Tap template card
      await act(async () => { fireEvent.press(result.getByText('Push Day')); });

      // Active workout should start
      await waitFor(() => {
        expect(result.getByTestId('finish-workout-btn')).toBeTruthy();
      });

      // startWorkout should have been called with template id
      expect(startWorkout).toHaveBeenCalledWith('t1');
    });
  });

  // ─── Batch 2A: Previous Set Data ───

  describe('previous set data', () => {
    it('shows previous data in PREV column when history exists', async () => {
      // Mock getExerciseHistory to return previous session data
      (getExerciseHistory as jest.Mock).mockResolvedValue([{
        workout: { id: 'w-prev', started_at: '2026-01-01', finished_at: '2026-01-01' },
        sets: [{ set_number: 1, weight: 135, reps: 10, is_completed: true, tag: 'working' }],
      }]);

      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // PREV column should show "135×10"
      await waitFor(() => {
        expect(result.getByText('135×10')).toBeTruthy();
      });

      // Reset mock
      (getExerciseHistory as jest.Mock).mockResolvedValue([]);
    });

    it('shows dash when no previous data exists', async () => {
      // Default mock already returns empty array for getExerciseHistory
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // PREV column should show "—" (em dash)
      await waitFor(() => {
        expect(result.getByText('—')).toBeTruthy();
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

  describe('upcoming workout TARGET column', () => {
    it('shows TARGET header when started from upcoming workout', async () => {
      const mockExercise = { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', notes: null, user_id: 'local', created_at: '2026-01-01' };
      const upcomingData = {
        workout: { id: 'uw1', date: '2026-02-07', template_id: null, notes: 'Test workout', created_at: '2026-02-07' },
        exercises: [{
          id: 'ue1', upcoming_workout_id: 'uw1', exercise_id: 'ex1', order: 1, rest_seconds: 90, notes: null,
          exercise: mockExercise,
          sets: [{ id: 'us1', upcoming_exercise_id: 'ue1', set_number: 1, target_weight: 185, target_reps: 8 }],
        }],
      };

      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(upcomingData);
      (getExerciseById as jest.Mock).mockResolvedValue(mockExercise);

      const result = render(<WorkoutScreen />);

      // Wait for upcoming workout card to render
      await waitFor(() => expect(result.getByTestId('start-upcoming-workout')).toBeTruthy());

      // Press the upcoming card TouchableOpacity directly via testID
      await act(async () => {
        fireEvent.press(result.getByTestId('start-upcoming-workout'));
      });

      // TARGET header should be visible
      await waitFor(() => {
        expect(result.getByText('TARGET')).toBeTruthy();
      });

      // Reset mocks
      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(null);
      (getExerciseById as jest.Mock).mockResolvedValue(null);
    });

    it('does not show TARGET header for regular workout', async () => {
      const result = render(<WorkoutScreen />);
      await startWorkoutWithExercise(result);

      // TARGET header should NOT be visible
      expect(result.queryByText('TARGET')).toBeNull();
    });

    it('displays target weight×reps in target cell', async () => {
      const mockExercise = { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '', notes: null, user_id: 'local', created_at: '2026-01-01' };
      const upcomingData = {
        workout: { id: 'uw1', date: '2026-02-07', template_id: null, notes: null, created_at: '2026-02-07' },
        exercises: [{
          id: 'ue1', upcoming_workout_id: 'uw1', exercise_id: 'ex1', order: 1, rest_seconds: 90, notes: null,
          exercise: mockExercise,
          sets: [{ id: 'us1', upcoming_exercise_id: 'ue1', set_number: 1, target_weight: 185, target_reps: 8 }],
        }],
      };

      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(upcomingData);
      (getExerciseById as jest.Mock).mockResolvedValue(mockExercise);

      const result = render(<WorkoutScreen />);

      // Wait for upcoming workout card to render
      await waitFor(() => expect(result.getByTestId('start-upcoming-workout')).toBeTruthy());

      // Press the upcoming card TouchableOpacity directly via testID
      await act(async () => {
        fireEvent.press(result.getByTestId('start-upcoming-workout'));
      });

      // Target cell should show "185×8"
      await waitFor(() => {
        expect(result.getByText('185×8')).toBeTruthy();
      });

      // Reset mocks
      (getUpcomingWorkoutForToday as jest.Mock).mockResolvedValue(null);
      (getExerciseById as jest.Mock).mockResolvedValue(null);
    });
  });
});
