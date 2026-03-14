import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('../../services/database', () => ({
  getWorkoutHistory: jest.fn().mockResolvedValue([]),
  getWorkoutSets: jest.fn().mockResolvedValue([]),
  getAllExercises: jest.fn().mockResolvedValue([]),
  getBestE1RM: jest.fn().mockResolvedValue(null),
  getRecentExerciseHistory: jest.fn().mockResolvedValue([]),
  updateExerciseFormNotes: jest.fn().mockResolvedValue(undefined),
  updateExerciseMachineNotes: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

jest.mock('../../components/ExerciseDetailModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockModal = (props: any) => props.visible ? React.createElement(View, { testID: 'exercise-detail-modal' }) : null;
  MockModal.default = MockModal;
  return MockModal;
});

import { getWorkoutHistory, getWorkoutSets, getAllExercises } from '../../services/database';
import HistoryScreen from '../HistoryScreen';

const mockedGetWorkoutHistory = getWorkoutHistory as jest.Mock;
const mockedGetWorkoutSets = getWorkoutSets as jest.Mock;
const mockedGetAllExercises = getAllExercises as jest.Mock;

describe('HistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetWorkoutHistory.mockResolvedValue([]);
    mockedGetWorkoutSets.mockResolvedValue([]);
    mockedGetAllExercises.mockResolvedValue([]);
  });

  it('renders empty state when no workouts', async () => {
    const { getByText } = render(<HistoryScreen />);
    await waitFor(() => {
      expect(getByText('No Workouts Yet')).toBeTruthy();
    });
  });

  it('renders workout card with name and duration, no volume pill', async () => {
    mockedGetWorkoutHistory.mockResolvedValue([
      {
        id: 'w1',
        template_id: 't1',
        template_name: 'Push Day',
        started_at: '2026-01-15T10:00:00Z',
        finished_at: '2026-01-15T11:05:00Z',
        is_active: 0,
      },
    ]);

    const { getByText, queryByText } = render(<HistoryScreen />);
    await waitFor(() => {
      expect(getByText('Push Day')).toBeTruthy();
    });
    expect(queryByText(/lb/)).toBeNull();
  });

  it('expands workout to show only completed sets with tag badges', async () => {
    mockedGetWorkoutHistory.mockResolvedValue([
      {
        id: 'w1',
        template_id: 't1',
        template_name: 'Push Day',
        started_at: '2026-01-15T10:00:00Z',
        finished_at: '2026-01-15T11:00:00Z',
        is_active: 0,
      },
    ]);
    mockedGetAllExercises.mockResolvedValue([
      { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '' },
    ]);
    mockedGetWorkoutSets.mockResolvedValue([
      { id: 's1', workout_id: 'w1', exercise_id: 'ex1', set_number: 1, weight: 135, reps: 10, is_completed: true, tag: 'working' },
      { id: 's2', workout_id: 'w1', exercise_id: 'ex1', set_number: 2, weight: 95, reps: 8, is_completed: false, tag: 'warmup' },
      { id: 's3', workout_id: 'w1', exercise_id: 'ex1', set_number: 3, weight: 135, reps: 8, is_completed: true, tag: 'failure' },
    ]);

    const { getByText, queryByText } = render(<HistoryScreen />);
    await waitFor(() => {
      expect(getByText('Push Day')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Push Day'));
    });

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
    });

    expect(getByText(/135lb × 10/)).toBeTruthy();
    expect(getByText(/135lb × 8/)).toBeTruthy();
    expect(queryByText(/95lb × 8/)).toBeNull();
    expect(getByText('F')).toBeTruthy();
    expect(queryByText('W')).toBeNull();
  });

  it('tapping exercise name opens history modal', async () => {
    mockedGetWorkoutHistory.mockResolvedValue([
      {
        id: 'w1',
        template_id: 't1',
        template_name: 'Push Day',
        started_at: '2026-01-15T10:00:00Z',
        finished_at: '2026-01-15T11:00:00Z',
        is_active: 0,
      },
    ]);
    mockedGetAllExercises.mockResolvedValue([
      { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', description: '' },
    ]);
    mockedGetWorkoutSets.mockResolvedValue([
      { id: 's1', workout_id: 'w1', exercise_id: 'ex1', set_number: 1, weight: 135, reps: 10, is_completed: true, tag: 'working' },
    ]);

    const { getByText, getByTestId } = render(<HistoryScreen />);
    await waitFor(() => {
      expect(getByText('Push Day')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Push Day'));
    });

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Bench Press'));
    });

    await waitFor(() => {
      expect(getByTestId('exercise-detail-modal')).toBeTruthy();
    });
  });
});
