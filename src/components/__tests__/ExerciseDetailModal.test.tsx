import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';
import { createMockExercise } from '../../__tests__/helpers/factories';

jest.mock('../../services/database', () => ({
  getBestE1RM: jest.fn().mockResolvedValue(null),
  getRecentExerciseHistory: jest.fn().mockResolvedValue([]),
  updateExerciseFormNotes: jest.fn().mockResolvedValue(undefined),
  updateExerciseMachineNotes: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  fireAndForgetSync: jest.fn(),
}));

jest.mock('../ExerciseHistoryModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) =>
      props.visible
        ? React.createElement(View, { testID: 'exercise-history-modal' })
        : null,
  };
});

import ExerciseDetailModal from '../ExerciseDetailModal';
import {
  getBestE1RM,
  getRecentExerciseHistory,
  updateExerciseFormNotes,
  updateExerciseMachineNotes,
} from '../../services/database';

const defaultExercise = createMockExercise({
  name: 'Bench Press',
  type: 'weighted',
  muscle_groups: ['Chest', 'Triceps'],
});

describe('ExerciseDetailModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getBestE1RM as jest.Mock).mockResolvedValue(null);
    (getRecentExerciseHistory as jest.Mock).mockResolvedValue([]);
  });

  it('renders nothing when exercise is null', () => {
    const { toJSON } = render(
      <ExerciseDetailModal visible={true} exercise={null} onClose={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders header with exercise name, type badge, and muscle groups', async () => {
    const { getByText } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={defaultExercise}
        onClose={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
      expect(getByText('weighted')).toBeTruthy();
      expect(getByText('Chest, Triceps')).toBeTruthy();
    });
  });

  it('shows loading indicator then content', async () => {
    let resolveE1RM!: (v: number | null) => void;
    let resolveHistory!: (v: any[]) => void;
    (getBestE1RM as jest.Mock).mockReturnValue(
      new Promise((r) => (resolveE1RM = r))
    );
    (getRecentExerciseHistory as jest.Mock).mockReturnValue(
      new Promise((r) => (resolveHistory = r))
    );

    const { queryByText, UNSAFE_queryByType } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={defaultExercise}
        onClose={jest.fn()}
      />
    );

    const { ActivityIndicator } = require('react-native');
    // Loading state: ActivityIndicator shown, form notes section not yet
    expect(UNSAFE_queryByType(ActivityIndicator)).toBeTruthy();
    expect(queryByText('Form Notes')).toBeNull();

    // Resolve promises
    await act(async () => {
      resolveE1RM(null);
      resolveHistory([]);
    });

    // Content should now be visible
    await waitFor(() => {
      expect(UNSAFE_queryByType(ActivityIndicator)).toBeNull();
      expect(queryByText('Form Notes')).toBeTruthy();
    });
  });

  it('shows e1RM banner when bestE1RM is available', async () => {
    (getBestE1RM as jest.Mock).mockResolvedValue(225);

    const { findByText } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={defaultExercise}
        onClose={jest.fn()}
      />
    );

    expect(await findByText('225 lb')).toBeTruthy();
  });

  it('hides e1RM banner when bestE1RM is null', async () => {
    (getBestE1RM as jest.Mock).mockResolvedValue(null);

    const { queryByText, findByText } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={defaultExercise}
        onClose={jest.fn()}
      />
    );

    // Wait for loading to finish
    await findByText('Form Notes');
    expect(queryByText(/lb/)).toBeNull();
  });

  it('renders form notes textarea with initial value from exercise', async () => {
    const exercise = createMockExercise({ form_notes: 'Keep elbows tucked' });

    const { findByTestId } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={exercise}
        onClose={jest.fn()}
      />
    );

    const input = await findByTestId('form-notes-input');
    expect(input.props.value).toBe('Keep elbows tucked');
  });

  it('renders machine notes textarea with initial value from exercise', async () => {
    const exercise = createMockExercise({ machine_notes: 'Seat 5' });

    const { findByTestId } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={exercise}
        onClose={jest.fn()}
      />
    );

    const input = await findByTestId('machine-notes-input');
    expect(input.props.value).toBe('Seat 5');
  });

  it('shows "Synced with coach" badge on form notes section', async () => {
    const { findByText } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={defaultExercise}
        onClose={jest.fn()}
      />
    );

    expect(await findByText('Synced with coach')).toBeTruthy();
  });

  it('shows "Private" badge on machine notes section', async () => {
    const { findByText } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={defaultExercise}
        onClose={jest.fn()}
      />
    );

    expect(await findByText('Private')).toBeTruthy();
  });

  it('renders recent history entries', async () => {
    (getRecentExerciseHistory as jest.Mock).mockResolvedValue([
      { date: '2026-03-01T10:00:00Z', setCount: 4, bestSet: '185 x 5' },
      { date: '2026-02-25T10:00:00Z', setCount: 3, bestSet: '175 x 8' },
    ]);

    const { findByText } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={defaultExercise}
        onClose={jest.fn()}
      />
    );

    expect(await findByText('Mar 1')).toBeTruthy();
    expect(await findByText('4 sets')).toBeTruthy();
    expect(await findByText('185 x 5')).toBeTruthy();
    expect(await findByText('Feb 25')).toBeTruthy();
    expect(await findByText('3 sets')).toBeTruthy();
    expect(await findByText('175 x 8')).toBeTruthy();
  });

  describe('debounced saves', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('debounces form notes save and calls onExerciseUpdated', async () => {
      const onExerciseUpdated = jest.fn();
      const exercise = createMockExercise({ name: 'Squat' });

      const { findByTestId } = render(
        <ExerciseDetailModal
          visible={true}
          exercise={exercise}
          onClose={jest.fn()}
          onExerciseUpdated={onExerciseUpdated}
        />
      );

      const input = await findByTestId('form-notes-input');
      fireEvent.changeText(input, 'New form note');

      // Not yet called
      expect(updateExerciseFormNotes).not.toHaveBeenCalled();

      // Advance past debounce
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(updateExerciseFormNotes).toHaveBeenCalledWith(
        exercise.id,
        'New form note'
      );
      expect(onExerciseUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ form_notes: 'New form note' })
      );
    });

    it('debounces machine notes save and calls onExerciseUpdated', async () => {
      const onExerciseUpdated = jest.fn();
      const exercise = createMockExercise({ name: 'Lat Pulldown' });

      const { findByTestId } = render(
        <ExerciseDetailModal
          visible={true}
          exercise={exercise}
          onClose={jest.fn()}
          onExerciseUpdated={onExerciseUpdated}
        />
      );

      const input = await findByTestId('machine-notes-input');
      fireEvent.changeText(input, 'Pin 7');

      // Not yet called
      expect(updateExerciseMachineNotes).not.toHaveBeenCalled();

      // Advance past debounce
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(updateExerciseMachineNotes).toHaveBeenCalledWith(
        exercise.id,
        'Pin 7'
      );
      expect(onExerciseUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ machine_notes: 'Pin 7' })
      );
    });

    it('flushes pending notes on close', async () => {
      const exercise = createMockExercise({ name: 'Deadlift' });
      const onClose = jest.fn();

      const { findByTestId, unmount } = render(
        <ExerciseDetailModal
          visible={true}
          exercise={exercise}
          onClose={onClose}
          onExerciseUpdated={jest.fn()}
        />
      );

      const formInput = await findByTestId('form-notes-input');
      const machineInput = await findByTestId('machine-notes-input');

      // Type into both without advancing timers
      fireEvent.changeText(formInput, 'Hinge at hips');
      fireEvent.changeText(machineInput, 'Bar pad position 3');

      // Neither should be persisted yet
      expect(updateExerciseFormNotes).not.toHaveBeenCalled();
      expect(updateExerciseMachineNotes).not.toHaveBeenCalled();

      // Unmount triggers cleanup effect which calls flushPending
      unmount();

      // Both should be flushed
      expect(updateExerciseFormNotes).toHaveBeenCalledWith(
        exercise.id,
        'Hinge at hips'
      );
      expect(updateExerciseMachineNotes).toHaveBeenCalledWith(
        exercise.id,
        'Bar pad position 3'
      );
    });
  });

  it('opens ExerciseHistoryModal when "See all" is pressed', async () => {
    (getRecentExerciseHistory as jest.Mock).mockResolvedValue([
      { date: '2026-03-01T10:00:00Z', setCount: 4, bestSet: '185 x 5' },
    ]);

    const { findByText, queryByTestId } = render(
      <ExerciseDetailModal
        visible={true}
        exercise={defaultExercise}
        onClose={jest.fn()}
      />
    );

    // "See all" should appear since there's history
    const seeAllBtn = await findByText('See all');
    expect(queryByTestId('exercise-history-modal')).toBeNull();

    fireEvent.press(seeAllBtn);

    await waitFor(() => {
      expect(queryByTestId('exercise-history-modal')).toBeTruthy();
    });
  });
});
