import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { act } from 'react';
import ExercisePickerScreen from '../ExercisePickerScreen';
import { getAllExercises, createExercise, addExerciseToTemplate } from '../../services/database';

jest.mock('../../services/database', () => ({
  getAllExercises: jest.fn().mockResolvedValue([]),
  createExercise: jest.fn().mockResolvedValue({ id: 'new-1', name: 'Test' }),
  addExerciseToTemplate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
}));

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ params: { templateId: 'tmpl-1' } }),
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: (props: any) => {
      const mockReactLocal = require('react');
      return mockReactLocal.createElement(Text, props, props.name);
    },
  };
});

describe('ExercisePickerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAllExercises as jest.Mock).mockResolvedValue([]);
  });

  it('renders search bar', async () => {
    const { getByPlaceholderText } = render(<ExercisePickerScreen />);
    await waitFor(() => {
      expect(getByPlaceholderText(/Search/)).toBeTruthy();
    });
  });

  it('toggles muscle group chip selection', async () => {
    const { getByTestId } = render(<ExercisePickerScreen />);

    // Open the create form
    await act(async () => {
      fireEvent.press(getByTestId('create-exercise-toggle'));
    });

    const chestChip = getByTestId('muscle-Chest');

    // Select
    await act(async () => {
      fireEvent.press(chestChip);
    });

    // Deselect (should not throw)
    await act(async () => {
      fireEvent.press(chestChip);
    });
  });

  it('shows validation error for empty name', async () => {
    const { getByTestId, getByText } = render(<ExercisePickerScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('create-exercise-toggle'));
    });

    await act(async () => {
      fireEvent.press(getByTestId('save-exercise-btn'));
    });

    expect(getByText('Exercise name is required')).toBeTruthy();
  });

  it('filters exercises by search', async () => {
    (getAllExercises as jest.Mock).mockResolvedValue([
      { id: '1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '' },
      { id: '2', name: 'Squat', type: 'weighted', muscle_groups: ['Quads'], training_goal: 'hypertrophy', description: '' },
    ]);

    const { getByPlaceholderText, getByText, queryByText } = render(<ExercisePickerScreen />);

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
      expect(getByText('Squat')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.changeText(getByPlaceholderText(/Search/), 'bench');
    });

    expect(getByText('Bench Press')).toBeTruthy();
    expect(queryByText('Squat')).toBeNull();
  });
});
