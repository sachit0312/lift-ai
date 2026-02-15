import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { access_token: 'test-jwt-token-123' },
    user: { email: 'test@example.com' },
    loading: false,
  }),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn() },
  },
}));

jest.mock('../../services/database', () => ({
  getWorkoutHistory: jest.fn().mockResolvedValue([]),
  getPRsThisWeek: jest.fn().mockResolvedValue(0),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

import ProfileScreen from '../ProfileScreen';

describe('ProfileScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders profile title and user email', async () => {
    const { getByText } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(getByText('Profile')).toBeTruthy();
      expect(getByText('test@example.com')).toBeTruthy();
    });
  });

  it('renders stat cards', async () => {
    const { getByText } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(getByText('Total Workouts')).toBeTruthy();
      expect(getByText('This Month')).toBeTruthy();
      expect(getByText('Streak')).toBeTruthy();
    });
  });

  it('renders logout button', async () => {
    const { getByTestId } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(getByTestId('logout-btn')).toBeTruthy();
    });
  });

  it('shows PRs This Week card', async () => {
    const { getByText } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(getByText('PRs This Week')).toBeTruthy();
    });
  });

  it('does not show Week Volume or Avg Duration', async () => {
    const { queryByText } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(queryByText('Week Volume')).toBeNull();
      expect(queryByText('Avg Duration')).toBeNull();
    });
  });

  it('renders MCP token button', async () => {
    const { getByTestId } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(getByTestId('mcp-token-btn')).toBeTruthy();
    });
  });

  it('opens MCP token modal when button is tapped', async () => {
    const { getByTestId, getByText, queryByText } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(getByTestId('mcp-token-btn')).toBeTruthy();
    });

    // Modal should not be visible initially
    expect(queryByText('MCP API Token')).toBeNull();

    // Tap the button
    fireEvent.press(getByTestId('mcp-token-btn'));

    // Modal should now be visible
    await waitFor(() => {
      expect(getByText('MCP API Token')).toBeTruthy();
      expect(getByText('Copy Token')).toBeTruthy();
      expect(getByText('Done')).toBeTruthy();
    });
  });

  it('copies token to clipboard when Copy Token is tapped', async () => {
    const { getByTestId, getByText } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(getByTestId('mcp-token-btn')).toBeTruthy();
    });

    // Open modal
    fireEvent.press(getByTestId('mcp-token-btn'));

    await waitFor(() => {
      expect(getByText('Copy Token')).toBeTruthy();
    });

    // Tap copy button
    fireEvent.press(getByText('Copy Token'));

    // Verify clipboard was called with the token
    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('test-jwt-token-123');
    });

    // Button should show "Copied!"
    await waitFor(() => {
      expect(getByText('Copied!')).toBeTruthy();
    });
  });

  it('closes MCP token modal when Done is tapped', async () => {
    const { getByTestId, getByText, queryByText } = render(<ProfileScreen />);
    await waitFor(() => {
      expect(getByTestId('mcp-token-btn')).toBeTruthy();
    });

    // Open modal
    fireEvent.press(getByTestId('mcp-token-btn'));

    await waitFor(() => {
      expect(getByText('MCP API Token')).toBeTruthy();
    });

    // Tap Done button
    fireEvent.press(getByText('Done'));

    // Modal should be closed
    await waitFor(() => {
      expect(queryByText('MCP API Token')).toBeNull();
    });
  });
});
