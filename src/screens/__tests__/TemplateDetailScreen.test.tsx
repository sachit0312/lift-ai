import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

jest.mock('../../services/database', () => ({
  getTemplateExercises: jest.fn().mockResolvedValue([]),
  removeExerciseFromTemplate: jest.fn().mockResolvedValue(undefined),
  updateTemplateExerciseDefaults: jest.fn().mockResolvedValue(undefined),
  updateTemplateExerciseOrder: jest.fn().mockResolvedValue(undefined),
  updateTemplate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  deleteTemplateExerciseFromSupabase: jest.fn().mockResolvedValue(undefined),
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: mockNavigate, setOptions: jest.fn() }),
  useRoute: () => ({ params: { templateId: 'tmpl-1', templateName: 'Push Day' } }),
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

import TemplateDetailScreen from '../TemplateDetailScreen';
import { getTemplateExercises, removeExerciseFromTemplate, updateTemplateExerciseDefaults } from '../../services/database';
import { deleteTemplateExerciseFromSupabase } from '../../services/sync';

describe('TemplateDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders template name without TEMPLATE NAME label', async () => {
    const { getByText, queryByText } = render(<TemplateDetailScreen />);

    await waitFor(() => {
      expect(getByText('Push Day')).toBeTruthy();
    });
    expect(queryByText('TEMPLATE NAME')).toBeNull();
  });

  it('renders exercise with sets and rest stepper values', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 0,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByText, getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
    });
    // New vertical layout shows value in stepper label
    expect(getByTestId('sets-value-0')).toHaveTextContent('4 working');
    expect(getByTestId('rest-value-0')).toHaveTextContent('2:00 rest');
  });

  it('renders empty state when no exercises', async () => {
    const { getByText } = render(<TemplateDetailScreen />);

    await waitFor(() => {
      expect(getByText('No exercises yet')).toBeTruthy();
    });
  });

  it('shows add exercise button', async () => {
    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => {
      expect(getByTestId('template-add-exercise-btn')).toBeTruthy();
    });
  });

  it('renders inline stepper controls for sets and rest', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 0,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => {
      // Sets stepper: barbell icon with - and + buttons
      expect(getByTestId('sets-decrease-0')).toBeTruthy();
      expect(getByTestId('sets-value-0')).toBeTruthy();
      expect(getByTestId('sets-increase-0')).toBeTruthy();

      // Rest stepper: timer icon with - and + buttons
      expect(getByTestId('rest-decrease-0')).toBeTruthy();
      expect(getByTestId('rest-value-0')).toBeTruthy();
      expect(getByTestId('rest-increase-0')).toBeTruthy();
    });
  });

  it('increments sets when + is pressed', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 0,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => expect(getByTestId('sets-value-0')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('sets-increase-0'));
    });

    await waitFor(() => {
      expect(updateTemplateExerciseDefaults).toHaveBeenCalledWith(
        'te1',
        expect.objectContaining({ sets: 5 })
      );
    });
  });

  it('decrements sets when - is pressed (minimum 1)', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 2,
        warmup_sets: 0,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => expect(getByTestId('sets-value-0')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('sets-decrease-0'));
    });

    await waitFor(() => {
      expect(updateTemplateExerciseDefaults).toHaveBeenCalledWith(
        'te1',
        expect.objectContaining({ sets: 1 })
      );
    });
  });

  it('adjusts rest by 15 seconds when +/- pressed', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 0,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => expect(getByTestId('rest-value-0')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('rest-increase-0'));
    });

    await waitFor(() => {
      expect(updateTemplateExerciseDefaults).toHaveBeenCalledWith(
        'te1',
        expect.objectContaining({ rest_seconds: 135 })
      );
    });
  });

  it('decrements rest by 15 seconds (minimum 15)', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 0,
        rest_seconds: 30,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => expect(getByTestId('rest-value-0')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('rest-decrease-0'));
    });

    await waitFor(() => {
      expect(updateTemplateExerciseDefaults).toHaveBeenCalledWith(
        'te1',
        expect.objectContaining({ rest_seconds: 15 })
      );
    });
  });

  it('renders warmup stepper with 0 warmup value', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 0,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => {
      expect(getByTestId('warmup-value-0')).toHaveTextContent('0 warmup');
    });
  });

  it('increments warmup sets when + is pressed', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 1,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => expect(getByTestId('warmup-value-0')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('warmup-increase-0'));
    });

    await waitFor(() => {
      expect(updateTemplateExerciseDefaults).toHaveBeenCalledWith(
        'te1',
        expect.objectContaining({ warmup_sets: 2 })
      );
    });
  });

  it('decrements warmup sets when - is pressed (minimum 0)', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 0,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const { getByTestId } = render(<TemplateDetailScreen />);

    await waitFor(() => expect(getByTestId('warmup-value-0')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId('warmup-decrease-0'));
    });

    // Should not call update since warmup is already at 0
    expect(updateTemplateExerciseDefaults).not.toHaveBeenCalled();
  });

  it('calls deleteTemplateExerciseFromSupabase when removing an exercise', async () => {
    // Mock Alert.alert to auto-press the "Remove" button
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(
      ((...args: any[]) => {
        const buttons = args[2] as any[];
        const removeBtn = buttons?.find((b: any) => b.text === 'Remove');
        removeBtn?.onPress?.();
      }) as any,
    );

    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
        warmup_sets: 0,
        rest_seconds: 120,
        exercise: {
          id: 'ex1',
          user_id: 'local',
          name: 'Bench Press',
          type: 'weighted',
          muscle_groups: ['Chest'],
          training_goal: 'hypertrophy',
          description: '',
          created_at: '2026-01-01',
        },
      },
    ]);

    const tree = render(<TemplateDetailScreen />);
    await waitFor(() => expect(tree.getByText('Bench Press')).toBeTruthy());

    await act(async () => {
      fireEvent.press(tree.getByTestId('remove-btn-0'));
    });

    await waitFor(() => {
      expect(deleteTemplateExerciseFromSupabase).toHaveBeenCalledWith('te1');
    });

    alertSpy.mockRestore();
  });
});
