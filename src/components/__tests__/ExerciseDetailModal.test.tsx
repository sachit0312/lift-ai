import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';
import { createMockExercise } from '../../__tests__/helpers/factories';

jest.mock('../../services/database', () => ({
  updateExerciseFormNotes: jest.fn().mockResolvedValue(undefined),
  updateExerciseMachineNotes: jest.fn().mockResolvedValue(undefined),
  getUserExerciseNotes: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/sync', () => ({
  fireAndForgetSync: jest.fn(),
}));

jest.mock('../ExerciseHistoryContent', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(View, { testID: 'exercise-history-content' }),
  };
});

import ExerciseDetailModal from '../ExerciseDetailModal';
import {
  updateExerciseFormNotes,
  updateExerciseMachineNotes,
  getUserExerciseNotes,
} from '../../services/database';

const defaultExercise = createMockExercise({
  name: 'Bench Press',
  type: 'weighted',
  muscle_groups: ['Chest', 'Triceps'],
});

describe('ExerciseDetailModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('renders form notes textarea with initial value from exercise', async () => {
    const exercise = createMockExercise({});
    (getUserExerciseNotes as jest.Mock).mockResolvedValueOnce({ notes: null, form_notes: 'Keep elbows tucked', machine_notes: null });

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
    const exercise = createMockExercise({});
    (getUserExerciseNotes as jest.Mock).mockResolvedValueOnce({ notes: null, form_notes: null, machine_notes: 'Seat 5' });

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

  it('shows Details and History tab buttons', async () => {
    const { findByTestId } = render(
      <ExerciseDetailModal visible={true} exercise={defaultExercise} onClose={jest.fn()} />
    );
    expect(await findByTestId('tab-details')).toBeTruthy();
    expect(await findByTestId('tab-history')).toBeTruthy();
  });

  it('keeps both tabs mounted (no re-fetch on switch)', async () => {
    const { findByTestId } = render(
      <ExerciseDetailModal visible={true} exercise={defaultExercise} onClose={jest.fn()} />
    );
    // Both tabs always mounted — history content exists in tree even on Details tab
    expect(await findByTestId('tab-details')).toBeTruthy();
    expect(await findByTestId('exercise-history-content')).toBeTruthy();
    // Form notes accessible
    expect(await findByTestId('form-notes-input')).toBeTruthy();
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

      expect(updateExerciseFormNotes).not.toHaveBeenCalled();

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

      expect(updateExerciseMachineNotes).not.toHaveBeenCalled();

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

      fireEvent.changeText(formInput, 'Hinge at hips');
      fireEvent.changeText(machineInput, 'Bar pad position 3');

      expect(updateExerciseFormNotes).not.toHaveBeenCalled();
      expect(updateExerciseMachineNotes).not.toHaveBeenCalled();

      unmount();

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
});
