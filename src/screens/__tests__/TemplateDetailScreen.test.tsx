import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../services/database', () => ({
  getTemplateExercises: jest.fn().mockResolvedValue([]),
  removeExerciseFromTemplate: jest.fn().mockResolvedValue(undefined),
  updateTemplateExerciseDefaults: jest.fn().mockResolvedValue(undefined),
  updateTemplate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/exerciseTypeColor', () => ({
  exerciseTypeColor: () => '#7C5CFC',
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
import { getTemplateExercises } from '../../services/database';

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

  it('renders exercise with rest timer pill', async () => {
    (getTemplateExercises as jest.Mock).mockResolvedValueOnce([
      {
        id: 'te1',
        template_id: 'tmpl-1',
        exercise_id: 'ex1',
        order: 0,
        default_sets: 4,
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

    const { getByText } = render(<TemplateDetailScreen />);

    await waitFor(() => {
      expect(getByText('Bench Press')).toBeTruthy();
    });
    expect(getByText('4 sets')).toBeTruthy();
    expect(getByText('120s rest')).toBeTruthy();
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
});
