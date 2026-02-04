import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { createMockExercise, createMockSession } from '../../__tests__/helpers/factories';

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

const mockExercise = createMockExercise({ name: 'Bench Press' });

const threeSessions = [
  createMockSession('2026-01-20T10:00:00Z', [{ weight: 135, reps: 10 }]),
  createMockSession('2026-01-22T10:00:00Z', [{ weight: 145, reps: 8 }]),
  createMockSession('2026-01-25T10:00:00Z', [{ weight: 150, reps: 6 }]),
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

  it('shows no data message when no workout history', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([]);

    const { findByText } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    expect(await findByText('No workout data yet')).toBeTruthy();
  });

  it('shows 2 more sessions needed message with 1 session', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-20T10:00:00Z', [{ weight: 135, reps: 10 }]),
    ]);

    const { findByText } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    expect(await findByText('2 more sessions needed for chart')).toBeTruthy();
  });

  it('shows 1 more session needed message with 2 sessions', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-20T10:00:00Z', [{ weight: 135, reps: 10 }]),
      createMockSession('2026-01-22T10:00:00Z', [{ weight: 140, reps: 8 }]),
    ]);

    const { findByText } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    expect(await findByText('1 more session needed for chart')).toBeTruthy();
  });

  it('hides PR banner when less than 3 sessions', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-20T10:00:00Z', [{ weight: 135, reps: 10 }]),
      createMockSession('2026-01-22T10:00:00Z', [{ weight: 140, reps: 8 }]),
    ]);

    const { queryByText } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    await waitFor(() => {
      expect(queryByText('Personal Record')).toBeNull();
    });
  });

  it('shows PR banner and chart with sufficient data', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue(threeSessions);

    const { findByText, findAllByText, getByTestId } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    expect(await findByText('Personal Record')).toBeTruthy();
    expect(await findByText(/\d+ lb/)).toBeTruthy();
    const oneRmElements = await findAllByText(/1RM/);
    expect(oneRmElements.length).toBeGreaterThan(0);
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
      createMockSession('2024-01-15T10:00:00Z', [
        { weight: 135, reps: 10 },
        { weight: 145, reps: 8 },
        { weight: 135, reps: 6 },
      ]),
    ]);

    const { getByText } = render(
      <ExerciseHistoryModal visible={true} exercise={mockExercise} onClose={jest.fn()} />
    );

    await waitFor(() => {
      // 145 × 8 has highest e1RM: 145 * (1 + 8/30) = 145 * 1.267 = 183.7
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
