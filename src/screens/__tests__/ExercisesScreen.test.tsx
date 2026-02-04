import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../services/database', () => ({
  getAllExercises: jest.fn().mockResolvedValue([
    { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', notes: null },
    { id: 'ex2', name: 'Squat', type: 'weighted', muscle_groups: ['Quads'], training_goal: 'strength', notes: null },
  ]),
  getExerciseHistory: jest.fn().mockResolvedValue([]),
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
});
