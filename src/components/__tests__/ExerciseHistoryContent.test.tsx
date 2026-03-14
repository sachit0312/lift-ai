import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { createMockExercise, createMockSession } from '../../__tests__/helpers/factories';

jest.mock('../../services/database', () => ({
  getExerciseHistory: jest.fn().mockResolvedValue([]),
  getCurrentE1RM: jest.fn().mockResolvedValue(null),
}));

jest.mock('react-native-chart-kit', () => {
  const { View } = require('react-native');
  return {
    LineChart: (props: any) => require('react').createElement(View, { testID: 'line-chart' }),
  };
});

import ExerciseHistoryContent from '../ExerciseHistoryContent';
import { getExerciseHistory, getCurrentE1RM } from '../../services/database';

const mockExercise = createMockExercise({ name: 'Bench Press' });

const threeSessions = [
  createMockSession('2026-01-20T10:00:00Z', [{ weight: 135, reps: 10 }]),
  createMockSession('2026-01-22T10:00:00Z', [{ weight: 145, reps: 8 }]),
  createMockSession('2026-01-25T10:00:00Z', [{ weight: 150, reps: 6 }]),
];

describe('ExerciseHistoryContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows no data message when no workout history', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([]);

    const { findByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText('No workout data yet')).toBeTruthy();
  });

  it('shows 2 more sessions needed message with 1 session', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-20T10:00:00Z', [{ weight: 135, reps: 10 }]),
    ]);

    const { findByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText('2 more sessions needed for chart')).toBeTruthy();
  });

  it('shows 1 more session needed message with 2 sessions', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-20T10:00:00Z', [{ weight: 135, reps: 10 }]),
      createMockSession('2026-01-22T10:00:00Z', [{ weight: 140, reps: 8 }]),
    ]);

    const { findByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText('1 more session needed for chart')).toBeTruthy();
  });

  it('hides PR banner when less than 3 sessions', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-20T10:00:00Z', [{ weight: 135, reps: 10 }]),
      createMockSession('2026-01-22T10:00:00Z', [{ weight: 140, reps: 8 }]),
    ]);

    const { queryByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    await waitFor(() => {
      expect(queryByText('Estimated 1RM')).toBeNull();
    });
  });

  it('shows PR banner and chart with sufficient data', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue(threeSessions);
    (getCurrentE1RM as jest.Mock).mockResolvedValue(180);

    const { findByText, findAllByText, getAllByTestId } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText('Estimated 1RM')).toBeTruthy();
    const lbElements = await findAllByText(/\d+ lb/);
    expect(lbElements.length).toBeGreaterThan(0);
    const oneRmElements = await findAllByText(/1RM/);
    expect(oneRmElements.length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(getAllByTestId('line-chart').length).toBeGreaterThan(0);
    });
    expect(await findByText('Recent Performances')).toBeTruthy();
  });

  it('shows all sets per session in recent performances', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-25T10:00:00Z', [
        { weight: 135, reps: 10, set_number: 1 },
        { weight: 145, reps: 8, set_number: 2 },
        { weight: 150, reps: 6, set_number: 3 },
      ]),
    ]);

    const { findByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText(/135lb × 10/)).toBeTruthy();
    expect(await findByText(/145lb × 8/)).toBeTruthy();
    expect(await findByText(/150lb × 6/)).toBeTruthy();
  });

  it('shows RPE as badge when present on a non-failure set', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-25T10:00:00Z', [
        { weight: 135, reps: 10, rpe: 8 },
      ]),
    ]);

    const { findByText, queryByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText('8')).toBeTruthy();
    expect(queryByText(/@ RPE/)).toBeNull();
  });

  it('shows tag badges for failure/drop sets but filters warmup from recents', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-25T10:00:00Z', [
        { weight: 100, reps: 10, tag: 'warmup', set_number: 1 },
        { weight: 135, reps: 8, tag: 'working', set_number: 2 },
        { weight: 135, reps: 5, tag: 'failure', set_number: 3 },
      ]),
    ]);

    const { findByText, queryByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText('F')).toBeTruthy();
    expect(queryByText('W')).toBeNull();
  });

  it('excludes all-warmup sessions from recent performances', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      createMockSession('2026-01-25T10:00:00Z', [
        { weight: 60, reps: 10, tag: 'warmup', set_number: 1 },
      ]),
      createMockSession('2026-01-22T10:00:00Z', [
        { weight: 135, reps: 8, tag: 'working', set_number: 1 },
      ]),
    ]);

    const { findByText, queryByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText(/135lb × 8/)).toBeTruthy();
    expect(queryByText(/60lb × 10/)).toBeNull();
  });

  it('shows volume chart with 3+ sessions', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue(threeSessions);

    const { findByText, findAllByTestId } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByText('Volume Progression')).toBeTruthy();
    const charts = await findAllByTestId('line-chart');
    expect(charts.length).toBe(2);
  });

  it('shows plateau badge when 1RM unchanged for 5 sessions', async () => {
    const plateauSessions = [
      createMockSession('2026-01-20T10:00:00Z', [{ weight: 180, reps: 5 }]),
      createMockSession('2026-01-18T10:00:00Z', [{ weight: 180, reps: 5 }]),
      createMockSession('2026-01-16T10:00:00Z', [{ weight: 180, reps: 5 }]),
      createMockSession('2026-01-14T10:00:00Z', [{ weight: 180, reps: 5 }]),
      createMockSession('2026-01-12T10:00:00Z', [{ weight: 180, reps: 5 }]),
      createMockSession('2026-01-08T10:00:00Z', [{ weight: 240, reps: 1 }]),
      createMockSession('2026-01-05T10:00:00Z', [{ weight: 250, reps: 1 }]),
    ];

    (getExerciseHistory as jest.Mock).mockResolvedValue(plateauSessions);

    const { findByTestId, findByText } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    expect(await findByTestId('plateau-badge')).toBeTruthy();
    expect(await findByText(/Plateau/)).toBeTruthy();
  });

  it('does not show plateau badge when improving', async () => {
    const improvingSessions = [
      createMockSession('2026-01-10T10:00:00Z', [{ weight: 135, reps: 5 }]),
      createMockSession('2026-01-12T10:00:00Z', [{ weight: 145, reps: 5 }]),
      createMockSession('2026-01-14T10:00:00Z', [{ weight: 155, reps: 5 }]),
      createMockSession('2026-01-16T10:00:00Z', [{ weight: 165, reps: 5 }]),
      createMockSession('2026-01-18T10:00:00Z', [{ weight: 175, reps: 5 }]),
      createMockSession('2026-01-20T10:00:00Z', [{ weight: 185, reps: 5 }]),
    ];

    (getExerciseHistory as jest.Mock).mockResolvedValue(improvingSessions);

    const { queryByTestId } = render(
      <ExerciseHistoryContent exercise={mockExercise} />
    );

    await waitFor(() => {
      expect(queryByTestId('plateau-badge')).toBeNull();
    });
  });

  it('renders session cards with dates and testIDs', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue([
      {
        workout: { id: 'w1', started_at: '2024-01-15T10:00:00Z' },
        sets: [
          { id: 's1', set_number: 1, weight: 135, reps: 8, is_completed: true, tag: 'working', rpe: null, notes: null },
          { id: 's2', set_number: 2, weight: 145, reps: 6, is_completed: true, tag: 'working', rpe: null, notes: null },
        ],
      },
      {
        workout: { id: 'w2', started_at: '2024-01-12T10:00:00Z' },
        sets: [
          { id: 's3', set_number: 1, weight: 130, reps: 10, is_completed: true, tag: 'working', rpe: null, notes: null },
        ],
      },
      {
        workout: { id: 'w3', started_at: '2024-01-08T10:00:00Z' },
        sets: [
          { id: 's4', set_number: 1, weight: 125, reps: 12, is_completed: true, tag: 'working', rpe: null, notes: null },
        ],
      },
    ]);

    const { getByTestId } = render(
      <ExerciseHistoryContent exercise={createMockExercise()} />
    );

    await waitFor(() => {
      expect(getByTestId('session-row-0')).toBeTruthy();
      expect(getByTestId('session-date-0')).toBeTruthy();
    });
  });
});
