import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('../../services/database', () => ({
  getAllTemplates: jest.fn().mockResolvedValue([]),
  createTemplate: jest.fn().mockResolvedValue({ id: 't1', name: 'Test Template' }),
  deleteTemplate: jest.fn().mockResolvedValue(undefined),
  getTemplateExerciseCount: jest.fn().mockResolvedValue(0),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: (props: any) => {
      const r = require('react');
      return r.createElement(Text, props, props.name);
    },
  };
});

import { getAllTemplates } from '../../services/database';
import TemplatesScreen from '../TemplatesScreen';

describe('TemplatesScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders empty state when no templates', async () => {
    const { getByText } = render(<TemplatesScreen />);
    await waitFor(() => {
      expect(getByText('No Templates Yet')).toBeTruthy();
    });
  });

  it('renders template list', async () => {
    (getAllTemplates as jest.Mock).mockResolvedValue([
      { id: 't1', name: 'Push Day', created_at: '2025-01-01', updated_at: '2025-01-01' },
      { id: 't2', name: 'Pull Day', created_at: '2025-01-01', updated_at: '2025-01-01' },
    ]);

    const { getByText } = render(<TemplatesScreen />);
    await waitFor(() => {
      expect(getByText('Push Day')).toBeTruthy();
      expect(getByText('Pull Day')).toBeTruthy();
    });
  });

  it('renders FAB button', async () => {
    const { getByTestId } = render(<TemplatesScreen />);
    await waitFor(() => {
      expect(getByTestId('create-template-fab')).toBeTruthy();
    });
  });
});
