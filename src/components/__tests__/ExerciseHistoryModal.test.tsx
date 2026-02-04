import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

jest.mock('../../services/database', () => ({
  getExerciseHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock('react-native-chart-kit', () => {
  const { View } = require('react-native');
  return {
    LineChart: (props: any) => require('react').createElement(View, { testID: 'line-chart' }),
  };
});

import ExerciseHistoryModal from '../ExerciseHistoryModal';
import { getExerciseHistory } from '../../services/database';

const mockExercise = {
  id: 'ex1',
  user_id: 'local',
  name: 'Bench Press',
  type: 'weighted' as const,
  muscle_groups: ['Chest'],
  training_goal: 'hypertrophy' as const,
  description: '',
  created_at: '2026-01-01',
  notes: null,
};

const threeSessions = [
  {
    workout: { id: 'w1', started_at: '2026-01-20T10:00:00Z', finished_at: '2026-01-20T11:00:00Z' },
    sets: [{ id: 's1', workout_id: 'w1', exercise_id: 'ex1', set_number: 1, weight: 135, reps: 10, tag: 'working', rpe: null, is_completed: true, notes: null }],
  },
  {
    workout: { id: 'w2', started_at: '2026-01-22T10:00:00Z', finished_at: '2026-01-22T11:00:00Z' },
    sets: [{ id: 's2', workout_id: 'w2', exercise_id: 'ex1', set_number: 1, weight: 145, reps: 8, tag: 'working', rpe: null, is_completed: true, notes: null }],
  },
  {
    workout: { id: 'w3', started_at: '2026-01-25T10:00:00Z', finished_at: '2026-01-25T11:00:00Z' },
    sets: [{ id: 's3', workout_id: 'w3', exercise_id: 'ex1', set_number: 1, weight: 150, reps: 6, tag: 'working', rpe: null, is_completed: true, notes: null }],
  },
];

describe('ExerciseHistoryModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when exercise is null', () => {
    const { toJSON } = render(
      <ExerciseHistoryModal visible={true} exercise={null} onClose={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });

  it('shows no-data message when insufficient history', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      {
        workout: { id: 'w1', started_at: '2026-01-20T10:00:00Z', finished_at: '2026-01-20T11:00:00Z' },
        sets: [{ id: 's1', workout_id: 'w1', exercise_id: 'ex1', set_number: 1, weight: 135, reps: 10, tag: 'working', rpe: null, is_completed: true, notes: null }],
      },
    ]);

    const { findByText } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    expect(await findByText(/Not enough data for chart/)).toBeTruthy();
  });

  it('shows PR banner and chart with sufficient data', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue(threeSessions);

    const { findByText, getByTestId } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    expect(await findByText(/PR:/)).toBeTruthy();
    await waitFor(() => {
      expect(getByTestId('line-chart')).toBeTruthy();
    });
    expect(await findByText('Recent Performances')).toBeTruthy();
  });

  it('shows recent sessions with best set', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue(threeSessions);

    const { findByText } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    expect(await findByText('Best: 150lb × 6')).toBeTruthy();
  });

  it('shows best set per session in recent performances', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      {
        workout: { id: 'w1', started_at: '2024-01-15T10:00:00Z', finished_at: '2024-01-15T11:00:00Z' },
        sets: [
          { id: 's1', workout_id: 'w1', exercise_id: 'ex1', set_number: 1, weight: 135, reps: 10, tag: 'working', rpe: null, is_completed: true, notes: null },
          { id: 's2', workout_id: 'w1', exercise_id: 'ex1', set_number: 2, weight: 145, reps: 8, tag: 'working', rpe: null, is_completed: true, notes: null },
          { id: 's3', workout_id: 'w1', exercise_id: 'ex1', set_number: 3, weight: 135, reps: 6, tag: 'working', rpe: null, is_completed: true, notes: null },
        ],
      },
    ]);

    const { getByText } = render(
      <ExerciseHistoryModal
        visible={true}
        exercise={mockExercise}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      // 145 × 8 has highest e1RM: 145 * (1 + 8/30) = 145 * 1.267 = 183.7
      // 135 × 10 = 135 * 1.333 = 180.0
      // 135 × 6 = 135 * 1.2 = 162.0
      expect(getByText(/Best: 145lb × 8/)).toBeTruthy();
    });
  });

  it('close button calls onClose', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([]);
    const onClose = jest.fn();

    const { findByText } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={onClose} />
    );

    const closeIcon = await findByText('close');
    fireEvent.press(closeIcon);
    expect(onClose).toHaveBeenCalled();
  });
});
