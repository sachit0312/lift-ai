import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('../../services/database', () => ({
  getAllTemplates: jest.fn().mockResolvedValue([]),
  createTemplate: jest.fn().mockResolvedValue({ id: 't1', name: 'Test Template' }),
  deleteTemplate: jest.fn().mockResolvedValue(undefined),
  getTemplateExerciseCountsBatch: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('../../services/sync', () => ({
  deleteTemplateFromSupabase: jest.fn().mockResolvedValue(undefined),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

import { getAllTemplates } from '../../services/database';
import { deleteTemplateFromSupabase } from '../../services/sync';
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

  it('calls deleteTemplateFromSupabase when deleting a template', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    (getAllTemplates as jest.Mock).mockResolvedValue([
      { id: 't1', name: 'Push Day', created_at: '2025-01-01', updated_at: '2025-01-01' },
    ]);

    const { getByText } = render(<TemplatesScreen />);
    await waitFor(() => {
      expect(getByText('Push Day')).toBeTruthy();
    });

    // Long-press to trigger delete alert
    await act(async () => {
      fireEvent(getByText('Push Day'), 'longPress');
    });

    // Press the "Delete" button in the alert
    const alertCall = alertSpy.mock.calls[0];
    const buttons = alertCall[2] as any[];
    const deleteButton = buttons.find((btn: any) => btn.text === 'Delete');
    await act(async () => {
      deleteButton.onPress();
    });

    expect(deleteTemplateFromSupabase).toHaveBeenCalledWith('t1');

    alertSpy.mockRestore();
  });
});
