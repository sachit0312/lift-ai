import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';
import { Text, View, Linking } from 'react-native';

// --- Mocks (must be before imports) ---

// Mock react-native-safe-area-context with SafeAreaInsetsContext for bottom tabs
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const SafeAreaInsetsContext = React.createContext(insets);
  return {
    SafeAreaProvider: ({ children }: any) =>
      React.createElement(SafeAreaInsetsContext.Provider, { value: insets }, children),
    SafeAreaView: ({ children, ...props }: any) =>
      React.createElement(View, props, children),
    SafeAreaInsetsContext,
    useSafeAreaInsets: () => insets,
  };
});

// Mock AuthContext so useAuth returns a logged-in session (renders TabNavigator)
jest.mock('../contexts/AuthContext', () => {
  const React = require('react');
  return {
    AuthProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useAuth: jest.fn(() => ({
      session: { user: { id: 'u1' } },
      user: { id: 'u1', email: 'test@test.com' },
      loading: false,
    })),
  };
});

// Mock all screen components as lightweight text placeholders
jest.mock('../screens/WorkoutScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'WorkoutScreen'),
  };
});

jest.mock('../screens/TemplatesScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'TemplatesScreen'),
  };
});

jest.mock('../screens/TemplateDetailScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'TemplateDetailScreen'),
  };
});

jest.mock('../screens/ExercisePickerScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'ExercisePickerScreen'),
  };
});

jest.mock('../screens/ExercisesScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'ExercisesScreen'),
  };
});

jest.mock('../screens/HistoryScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'HistoryScreen'),
  };
});

jest.mock('../screens/ProfileScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'ProfileScreen'),
  };
});

jest.mock('../screens/LoginScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'LoginScreen'),
  };
});

jest.mock('../screens/SignupScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(Text, null, 'SignupScreen'),
  };
});

// Mock services
jest.mock('../services/database', () => ({
  clearAllLocalData: jest.fn().mockResolvedValue(undefined),
  getAllTemplates: jest.fn().mockResolvedValue([]),
  getAllExercises: jest.fn().mockResolvedValue([]),
  getWorkoutHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/sync', () => ({
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
  },
}));

// Sentry is mocked globally via moduleNameMapper; import to assert on calls
import * as Sentry from '@sentry/react-native';

// Import App (Sentry.wrap is a passthrough in the mock, so default export is the App component)
import App from '../../App';

// --- Tests ---

describe('Deep link handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('navigates to Workout tab when deep link liftai://workout is received', async () => {
    // Mock getInitialURL to simulate opening the app via deep link
    const getInitialURLSpy = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('liftai://workout');

    const { getByText } = render(<App />);

    await waitFor(() => {
      expect(getByText('WorkoutScreen')).toBeTruthy();
    });

    getInitialURLSpy.mockRestore();
  });

  it('does not crash on an unknown deep link path', async () => {
    const getInitialURLSpy = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('liftai://unknown-path');

    // Should render without throwing
    const { toJSON } = render(<App />);

    await waitFor(() => {
      expect(toJSON()).not.toBeNull();
    });

    getInitialURLSpy.mockRestore();
  });

  it('does not crash when getInitialURL returns null (no deep link)', async () => {
    const getInitialURLSpy = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);

    const { toJSON } = render(<App />);

    await waitFor(() => {
      expect(toJSON()).not.toBeNull();
    });

    getInitialURLSpy.mockRestore();
  });
});

describe('Navigation breadcrumbs via Sentry', () => {
  // getActiveRouteName and handleNavigationStateChange are module-scoped in App.tsx
  // (not exported), so we test them indirectly. React Navigation's onStateChange
  // only fires on state *changes* (not initial render). We trigger a tab navigation
  // to verify Sentry.addBreadcrumb is called with the correct route name.

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls Sentry.addBreadcrumb when user navigates between tabs', async () => {
    const getInitialURLSpy = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);

    const { getByText } = render(<App />);

    // Wait for initial render to settle
    await waitFor(() => {
      expect(getByText('WorkoutScreen')).toBeTruthy();
    });

    // Navigate to another tab to trigger onStateChange
    const historyTab = getByText('History');
    await act(async () => {
      fireEvent.press(historyTab);
    });

    await waitFor(() => {
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'navigation',
          level: 'info',
        })
      );
    });

    getInitialURLSpy.mockRestore();
  });

  it('breadcrumb message contains "Navigated to" with the route name', async () => {
    const getInitialURLSpy = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);

    const { getByText } = render(<App />);

    await waitFor(() => {
      expect(getByText('WorkoutScreen')).toBeTruthy();
    });

    // Navigate to History tab
    const historyTab = getByText('History');
    await act(async () => {
      fireEvent.press(historyTab);
    });

    await waitFor(() => {
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Navigated to'),
        })
      );
    });

    getInitialURLSpy.mockRestore();
  });

  it('breadcrumb includes the destination route name after tab switch', async () => {
    const getInitialURLSpy = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);

    const { getByText } = render(<App />);

    await waitFor(() => {
      expect(getByText('WorkoutScreen')).toBeTruthy();
    });

    // Navigate to Profile tab
    const profileTab = getByText('Profile');
    await act(async () => {
      fireEvent.press(profileTab);
    });

    await waitFor(() => {
      const calls = (Sentry.addBreadcrumb as jest.Mock).mock.calls;
      const hasProfileBreadcrumb = calls.some(
        ([arg]: [any]) =>
          arg.category === 'navigation' &&
          arg.message?.includes('Profile')
      );
      expect(hasProfileBreadcrumb).toBe(true);
    });

    getInitialURLSpy.mockRestore();
  });
});
