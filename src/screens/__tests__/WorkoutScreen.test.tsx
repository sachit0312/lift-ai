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
    { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '' },
  ]),
  getUpcomingWorkoutForToday: jest.fn().mockResolvedValue(null),
  createExercise: jest.fn().mockResolvedValue({ id: 'new-ex', name: 'Test Exercise', type: 'weighted', muscle_groups: [], training_goal: 'hypertrophy', description: '' }),
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

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: (props: any) => {
      const r = require('react');
      return r.createElement(Text, props, props.name);
    },
  };
});

import {
  startWorkout,
  addWorkoutSet,
  getAllExercises,
  updateWorkoutSet,
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

  it('opens finish confirmation modal', async () => {
    const { getByTestId, getByText } = render(<WorkoutScreen />);

    await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
    await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });
    await waitFor(() => expect(getByTestId('finish-workout-btn')).toBeTruthy());

    // Tap finish
    await act(async () => { fireEvent.press(getByTestId('finish-workout-btn')); });

    await waitFor(() => {
      expect(getByText('Finish Workout')).toBeTruthy();
    });
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
});
