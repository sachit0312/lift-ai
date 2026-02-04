import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    session: null,
    user: { email: 'test@example.com' },
    loading: false,
  }),
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
});
