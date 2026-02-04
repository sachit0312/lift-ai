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
} from '../../services/database';

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
});
