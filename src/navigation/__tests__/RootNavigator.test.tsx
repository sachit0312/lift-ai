import React from 'react';
import { render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { ActivityIndicator } from 'react-native';

// Mock theme to avoid circular dependency (sharedStyles.ts <-> index.ts)
jest.mock('../../theme', () => ({
  colors: {
    background: '#09090B',
    surface: '#131316',
    surfaceLight: '#1C1C21',
    border: '#2A2A30',
    primary: '#7C5CFC',
    primaryLight: '#9B85FF',
    primaryDim: '#5A47D9',
    accent: '#FF6B6B',
    success: '#52C77C',
    warning: '#FFB74D',
    error: '#F05252',
    text: '#F5F5F5',
    textSecondary: '#A1A1A6',
    textMuted: '#6B6B72',
    white: '#FFFFFF',
    black: '#000000',
    overlay: 'rgba(0,0,0,0.6)',
  },
  spacing: { xxs: 2, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  fontSize: { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28, title: 34, hero: 42 },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  borderRadius: { sm: 6, md: 10, lg: 16, xl: 24, full: 9999 },
  modalStyles: {},
}));

// Mock heavy screen components as lightweight placeholders
jest.mock('../../screens/LoginScreen', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => <Text>Login</Text>,
  };
});

jest.mock('../../screens/SignupScreen', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => <Text>Signup</Text>,
  };
});

jest.mock('../TabNavigator', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => <Text>TabNavigator</Text>,
  };
});

// Mock useAuth so each test can control session/loading
const mockUseAuth = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import RootNavigator from '../RootNavigator';

describe('RootNavigator', () => {
  it('shows ActivityIndicator when loading is true', () => {
    mockUseAuth.mockReturnValue({ session: null, loading: true, syncing: false });

    const { UNSAFE_getByType, queryByText } = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    const indicator = UNSAFE_getByType(ActivityIndicator);
    expect(indicator).toBeTruthy();
    expect(indicator.props.size).toBe('large');
    expect(queryByText('Login')).toBeNull();
    expect(queryByText('TabNavigator')).toBeNull();
  });

  it('shows ActivityIndicator when syncing is true', () => {
    mockUseAuth.mockReturnValue({
      session: { access_token: 'test-token', user: { id: 'user-1' } },
      loading: false,
      syncing: true,
    });

    const { UNSAFE_getByType, queryByText } = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    const indicator = UNSAFE_getByType(ActivityIndicator);
    expect(indicator).toBeTruthy();
    expect(queryByText('Login')).toBeNull();
    expect(queryByText('TabNavigator')).toBeNull();
  });

  it('shows Login screen when session is null and loading is false', () => {
    mockUseAuth.mockReturnValue({ session: null, loading: false, syncing: false });

    const { getByText } = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    expect(getByText('Login')).toBeTruthy();
  });

  it('shows TabNavigator when session exists and loading is false', () => {
    mockUseAuth.mockReturnValue({
      session: { access_token: 'test-token', user: { id: 'user-1' } },
      loading: false,
      syncing: false,
    });

    const { getByText } = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    expect(getByText('TabNavigator')).toBeTruthy();
  });

  it('does not render Login or Signup when logged in', () => {
    mockUseAuth.mockReturnValue({
      session: { access_token: 'test-token', user: { id: 'user-1' } },
      loading: false,
      syncing: false,
    });

    const { queryByText } = render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );

    expect(queryByText('Login')).toBeNull();
    expect(queryByText('Signup')).toBeNull();
    expect(queryByText('TabNavigator')).toBeTruthy();
  });
});
