import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: jest.fn().mockResolvedValue({ data: null, error: null }),
    },
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn().mockReturnValue('workout-enhanced://redirect'),
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

import { supabase } from '../../services/supabase';
import LoginScreen from '../LoginScreen';

const mockNavigation = { navigate: jest.fn() } as any;
const mockRoute = { params: {} } as any;

describe('LoginScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders email and password inputs', () => {
    const { getByTestId } = render(
      <LoginScreen navigation={mockNavigation} route={mockRoute} />,
    );
    expect(getByTestId('login-email')).toBeTruthy();
    expect(getByTestId('login-password')).toBeTruthy();
  });

  it('shows error for empty fields', async () => {
    const { getByTestId, getByText } = render(
      <LoginScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('login-btn'));
    });

    expect(getByText('Please enter email and password.')).toBeTruthy();
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('calls signInWithPassword on submit', async () => {
    const { getByTestId } = render(
      <LoginScreen navigation={mockNavigation} route={mockRoute} />,
    );

    await act(async () => {
      fireEvent.changeText(getByTestId('login-email'), 'test@test.com');
      fireEvent.changeText(getByTestId('login-password'), 'password123');
    });

    await act(async () => {
      fireEvent.press(getByTestId('login-btn'));
    });

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@test.com',
      password: 'password123',
    });
  });

  it('navigates to Signup on link press', () => {
    const { getByText } = render(
      <LoginScreen navigation={mockNavigation} route={mockRoute} />,
    );

    fireEvent.press(getByText('Sign Up'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Signup');
  });
});
