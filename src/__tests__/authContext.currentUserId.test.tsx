import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { Text } from 'react-native';

// --- Mocks (must be before imports) ---

const mockSetCurrentUserId = jest.fn();
const mockClearAllLocalData = jest.fn().mockResolvedValue(undefined);
const mockMigrateExerciseNotesToUserTable = jest.fn().mockResolvedValue(undefined);

jest.mock('../services/database', () => ({
  setCurrentUserId: (...args: any[]) => mockSetCurrentUserId(...args),
  clearAllLocalData: (...args: any[]) => mockClearAllLocalData(...args),
  migrateExerciseNotesToUserTable: (...args: any[]) => mockMigrateExerciseNotesToUserTable(...args),
}));

jest.mock('../services/sync', () => ({
  pullExercisesAndTemplates: jest.fn().mockResolvedValue(undefined),
  pullWorkoutHistory: jest.fn().mockResolvedValue(undefined),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
}));

// Authoritative mock session the test controls
let mockInitialSession: any = null;
const authStateListeners: Array<(event: string, session: any) => void> = [];

jest.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: mockInitialSession } })),
      onAuthStateChange: jest.fn((cb: (event: string, session: any) => void) => {
        authStateListeners.push(cb);
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
  },
}));

jest.mock('@sentry/react-native', () => ({
  setUser: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Imported AFTER mocks
import { AuthProvider } from '../contexts/AuthContext';

function Child() {
  return <Text testID="child">ok</Text>;
}

describe('AuthContext -> currentUserId propagation', () => {
  beforeEach(() => {
    mockSetCurrentUserId.mockClear();
    mockClearAllLocalData.mockClear();
    mockMigrateExerciseNotesToUserTable.mockClear();
    mockInitialSession = null;
    authStateListeners.length = 0;
  });

  it('sets currentUserId to session.user.id on cold start with restored session', async () => {
    mockInitialSession = { user: { id: 'user-123', email: 't@t.com' } };

    const { findByTestId } = render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await findByTestId('child');
    await waitFor(() => {
      expect(mockSetCurrentUserId).toHaveBeenCalledWith('user-123');
    });
  });

  it('leaves currentUserId as the real id when both getSession and INITIAL_SESSION fire', async () => {
    mockInitialSession = { user: { id: 'user-123', email: 't@t.com' } };

    const { findByTestId } = render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await findByTestId('child');
    await waitFor(() => expect(authStateListeners.length).toBeGreaterThan(0));

    await act(async () => {
      authStateListeners[0]('INITIAL_SESSION', { user: { id: 'user-123' } });
    });

    // Every setCurrentUserId call must be the real id — 'local' never wins.
    const calls = mockSetCurrentUserId.mock.calls.map((c: any[]) => c[0]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((id: string) => id === 'user-123')).toBe(true);
  });

  it('sets currentUserId to "local" on cold start without a session', async () => {
    mockInitialSession = null;

    const { findByTestId } = render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await findByTestId('child');
    await waitFor(() => {
      expect(mockSetCurrentUserId).toHaveBeenCalledWith('local');
    });
  });

  it('sets currentUserId on INITIAL_SESSION event', async () => {
    mockInitialSession = null;

    render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await waitFor(() => expect(authStateListeners.length).toBeGreaterThan(0));

    await act(async () => {
      authStateListeners[0]('INITIAL_SESSION', { user: { id: 'user-456' } });
    });

    expect(mockSetCurrentUserId).toHaveBeenCalledWith('user-456');
  });

  it('does not call clearAllLocalData on INITIAL_SESSION even when user id is new', async () => {
    mockInitialSession = null; // previousUserIdRef starts null

    render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await waitFor(() => expect(authStateListeners.length).toBeGreaterThan(0));
    mockClearAllLocalData.mockClear();

    await act(async () => {
      authStateListeners[0]('INITIAL_SESSION', { user: { id: 'user-new' } });
    });

    expect(mockClearAllLocalData).not.toHaveBeenCalled();
  });

  it('sets currentUserId on TOKEN_REFRESHED without re-running clearAllLocalData', async () => {
    mockInitialSession = { user: { id: 'user-abc' } };

    render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await waitFor(() => expect(authStateListeners.length).toBeGreaterThan(0));
    mockClearAllLocalData.mockClear();
    mockSetCurrentUserId.mockClear();

    await act(async () => {
      authStateListeners[0]('TOKEN_REFRESHED', { user: { id: 'user-abc' } });
    });

    expect(mockSetCurrentUserId).toHaveBeenCalledWith('user-abc');
    expect(mockClearAllLocalData).not.toHaveBeenCalled();
  });

  it('resets currentUserId to "local" on SIGNED_OUT', async () => {
    mockInitialSession = { user: { id: 'user-xyz' } };

    render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await waitFor(() => expect(authStateListeners.length).toBeGreaterThan(0));
    mockSetCurrentUserId.mockClear();

    await act(async () => {
      authStateListeners[0]('SIGNED_OUT', null);
    });

    expect(mockSetCurrentUserId).toHaveBeenCalledWith('local');
  });
});
