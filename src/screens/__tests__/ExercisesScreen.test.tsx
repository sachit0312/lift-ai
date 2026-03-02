import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { getAllExercises } from '../../services/database';

jest.mock('../../services/database', () => ({
  getAllExercises: jest.fn().mockResolvedValue([
    { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', notes: null },
    { id: 'ex2', name: 'Squat', type: 'weighted', muscle_groups: ['Quads'], training_goal: 'strength', notes: null },
  ]),
  getExerciseHistory: jest.fn().mockResolvedValue([]),
  updateExercise: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  fireAndForgetSync: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

import ExercisesScreen from '../ExercisesScreen';

describe('ExercisesScreen', () => {
  it('renders exercise list with search', async () => {
    const { getByTestId, getByText } = render(<ExercisesScreen />);

    await waitFor(() => {
      expect(getByTestId('exercise-search')).toBeTruthy();
      expect(getByText('Bench Press')).toBeTruthy();
      expect(getByText('Squat')).toBeTruthy();
    });
  });

  it('shows empty list when no exercises', async () => {
    (getAllExercises as jest.Mock).mockResolvedValueOnce([]);

    const { queryByText, getByTestId } = render(<ExercisesScreen />);

    await waitFor(() => {
      expect(getByTestId('exercise-search')).toBeTruthy();
      expect(queryByText('Bench Press')).toBeNull();
    });
  });

  it('filters exercises by name search', async () => {
    const { getByTestId, getByText, queryByText } = render(<ExercisesScreen />);

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
      expect(getByText('Squat')).toBeTruthy();
    });

    fireEvent.changeText(getByTestId('exercise-search'), 'Bench');

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
      expect(queryByText('Squat')).toBeNull();
    });
  });

  it('filters exercises by muscle group', async () => {
    const { getByTestId, getByText, queryByText } = render(<ExercisesScreen />);

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
      expect(getByText('Squat')).toBeTruthy();
    });

    fireEvent.changeText(getByTestId('exercise-search'), 'Chest');

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
      expect(queryByText('Squat')).toBeNull();
    });
  });

  it('opens history modal when exercise tapped', async () => {
    const { getByText, getAllByText } = render(<ExercisesScreen />);

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
    });

    fireEvent.press(getByText('Bench Press'));

    // Modal should be visible - check for exercise name as title
    await waitFor(() => {
      // The modal title shows the exercise name
      const titles = getAllByText('Bench Press');
      expect(titles.length).toBeGreaterThan(1); // One in list, one in modal
    });
  });

  it('opens edit modal on long-press', async () => {
    const { getByText, getByTestId } = render(<ExercisesScreen />);

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
    });

    fireEvent(getByText('Bench Press'), 'longPress');

    await waitFor(() => {
      expect(getByText('Edit Exercise')).toBeTruthy();
      expect(getByTestId('edit-exercise-name')).toBeTruthy();
    });
  });
});
