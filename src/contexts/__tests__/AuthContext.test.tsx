import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { Text } from 'react-native';

// --- Mocks (must be before imports) ---

// Track the onAuthStateChange callback so tests can fire auth events
let authStateCallback: ((event: string, session: any) => Promise<void>) | null = null;
const mockUnsubscribe = jest.fn();

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn((cb: any) => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      }),
    },
  },
}));

jest.mock('../../services/database', () => ({
  clearAllLocalData: jest.fn().mockResolvedValue(undefined),
  setCurrentUserId: jest.fn(),
  migrateExerciseNotesToUserTable: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
  pullExercisesAndTemplates: jest.fn().mockResolvedValue(undefined),
  pullWorkoutHistory: jest.fn().mockResolvedValue(undefined),
}));

// Sentry is mocked globally via moduleNameMapper, but we import it to assert on calls
import * as Sentry from '@sentry/react-native';
import { supabase } from '../../services/supabase';
import { clearAllLocalData, setCurrentUserId, migrateExerciseNotesToUserTable } from '../../services/database';
import { pullUpcomingWorkout, pullExercisesAndTemplates, pullWorkoutHistory } from '../../services/sync';
import { AuthProvider, useAuth } from '../AuthContext';

// --- Helpers ---

function makeSession(userId: string, email: string) {
  return {
    user: { id: userId, email },
    access_token: 'mock-token',
    refresh_token: 'mock-refresh',
  };
}

/** A consumer component that renders the auth context values for assertions. */
function AuthConsumer() {
  const { session, user, loading, syncing } = useAuth();
  return (
    <>
      <Text testID="loading">{String(loading)}</Text>
      <Text testID="syncing">{String(syncing)}</Text>
      <Text testID="user-email">{user?.email ?? 'none'}</Text>
      <Text testID="user-id">{user?.id ?? 'none'}</Text>
      <Text testID="has-session">{session ? 'yes' : 'no'}</Text>
    </>
  );
}

// --- Tests ---

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authStateCallback = null;
    // Default: getSession resolves with no session
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
    });
  });

  // ---------------------------------------------------------------
  // 1. AuthProvider renders children
  // ---------------------------------------------------------------
  it('renders children', async () => {
    const { getByText } = render(
      <AuthProvider>
        <Text>Hello Child</Text>
      </AuthProvider>,
    );

    expect(getByText('Hello Child')).toBeTruthy();

    // Wait for async getSession to settle to avoid act() warning
    await waitFor(() => {});
  });

  // ---------------------------------------------------------------
  // 2. useAuth throws when used outside AuthProvider
  // ---------------------------------------------------------------
  it('throws when useAuth is used outside AuthProvider', () => {
    // Silence the expected error output from React and the thrown error
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const BadConsumer = () => {
      useAuth();
      return null;
    };

    expect(() => render(<BadConsumer />)).toThrow(
      'useAuth must be used within an AuthProvider',
    );

    (console.error as jest.Mock).mockRestore();
  });

  // ---------------------------------------------------------------
  // 3. loading starts as true, becomes false after getSession resolves
  // ---------------------------------------------------------------
  it('loading starts as true and becomes false after auth state resolves', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    // After getSession resolves, loading should be false
    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });
  });

  // ---------------------------------------------------------------
  // 4. useAuth returns session, user, loading from initial getSession
  // ---------------------------------------------------------------
  it('returns session and user from initial getSession', async () => {
    const mockSession = makeSession('user-123', 'test@example.com');
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: mockSession },
    });

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    expect(getByTestId('has-session').props.children).toBe('yes');
    expect(getByTestId('user-email').props.children).toBe('test@example.com');
    expect(getByTestId('user-id').props.children).toBe('user-123');
  });

  // ---------------------------------------------------------------
  // 5. Returns no session when getSession returns null
  // ---------------------------------------------------------------
  it('returns null session when no user is logged in', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    expect(getByTestId('has-session').props.children).toBe('no');
    expect(getByTestId('user-email').props.children).toBe('none');
  });

  // ---------------------------------------------------------------
  // 6. Session is updated on SIGNED_IN event
  // ---------------------------------------------------------------
  it('updates session on SIGNED_IN event', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    // Wait for initial load
    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    // Initially no session
    expect(getByTestId('has-session').props.children).toBe('no');

    // Fire SIGNED_IN event
    const newSession = makeSession('user-456', 'new@example.com');
    await act(async () => {
      await authStateCallback!('SIGNED_IN', newSession);
    });

    expect(getByTestId('has-session').props.children).toBe('yes');
    expect(getByTestId('user-email').props.children).toBe('new@example.com');
    expect(getByTestId('user-id').props.children).toBe('user-456');
  });

  // ---------------------------------------------------------------
  // 7. Session is cleared on SIGNED_OUT event
  // ---------------------------------------------------------------
  it('clears session on SIGNED_OUT event', async () => {
    const mockSession = makeSession('user-123', 'test@example.com');
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: mockSession },
    });

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('has-session').props.children).toBe('yes');
    });

    // Fire SIGNED_OUT event
    await act(async () => {
      await authStateCallback!('SIGNED_OUT', null);
    });

    expect(getByTestId('has-session').props.children).toBe('no');
    expect(getByTestId('user-email').props.children).toBe('none');
  });

  // ---------------------------------------------------------------
  // 8. Sentry user context is set on initial getSession with a user
  // ---------------------------------------------------------------
  it('sets Sentry user context on initial session load', async () => {
    const mockSession = makeSession('user-123', 'test@example.com');
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: mockSession },
    });

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(Sentry.setUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        id: 'user-123',
      });
    });
  });

  // ---------------------------------------------------------------
  // 9. Sentry user context is set on SIGNED_IN event
  // ---------------------------------------------------------------
  it('sets Sentry user context on SIGNED_IN event', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    jest.clearAllMocks(); // Clear any Sentry calls from initial load

    const newSession = makeSession('user-789', 'login@example.com');
    await act(async () => {
      await authStateCallback!('SIGNED_IN', newSession);
    });

    expect(Sentry.setUser).toHaveBeenCalledWith({
      email: 'login@example.com',
      id: 'user-789',
    });
  });

  // ---------------------------------------------------------------
  // 10. Sentry user context is cleared on SIGNED_OUT event
  // ---------------------------------------------------------------
  it('clears Sentry user context on SIGNED_OUT event', async () => {
    const mockSession = makeSession('user-123', 'test@example.com');
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: mockSession },
    });

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('has-session').props.children).toBe('yes');
    });

    jest.clearAllMocks();

    await act(async () => {
      await authStateCallback!('SIGNED_OUT', null);
    });

    expect(Sentry.setUser).toHaveBeenCalledWith(null);
    expect(setCurrentUserId).toHaveBeenCalledWith('local');
  });

  // ---------------------------------------------------------------
  // 11. clearAllLocalData and pullUpcomingWorkout called on SIGNED_IN
  //     with a new user (different from previous)
  // ---------------------------------------------------------------
  it('calls clearAllLocalData and pullUpcomingWorkout on SIGNED_IN with new user', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    // Previous user is null (no initial session), new user signs in
    const newSession = makeSession('user-new', 'new@example.com');
    await act(async () => {
      await authStateCallback!('SIGNED_IN', newSession);
    });

    expect(setCurrentUserId).toHaveBeenCalledWith('user-new');
    expect(clearAllLocalData).toHaveBeenCalledTimes(1);
    expect(pullExercisesAndTemplates).toHaveBeenCalledTimes(1);
    expect(pullWorkoutHistory).toHaveBeenCalledTimes(1);
    expect(migrateExerciseNotesToUserTable).toHaveBeenCalledTimes(1);
    expect(migrateExerciseNotesToUserTable).toHaveBeenCalledWith('user-new');
    expect(pullUpcomingWorkout).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------
  // 12. clearAllLocalData/pullUpcomingWorkout NOT called on token
  //     refresh (same user ID)
  // ---------------------------------------------------------------
  it('does NOT call clearAllLocalData on SIGNED_IN when user ID is the same (token refresh)', async () => {
    const mockSession = makeSession('user-123', 'test@example.com');
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: mockSession },
    });

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('has-session').props.children).toBe('yes');
    });

    jest.clearAllMocks();

    // Fire SIGNED_IN with the SAME user ID (simulates token refresh)
    const refreshedSession = makeSession('user-123', 'test@example.com');
    await act(async () => {
      await authStateCallback!('SIGNED_IN', refreshedSession);
    });

    expect(clearAllLocalData).not.toHaveBeenCalled();
    expect(pullExercisesAndTemplates).not.toHaveBeenCalled();
    expect(pullWorkoutHistory).not.toHaveBeenCalled();
    expect(pullUpcomingWorkout).not.toHaveBeenCalled();
    expect(getByTestId('syncing').props.children).toBe('false');
  });

  // ---------------------------------------------------------------
  // 13. Sync errors on SIGNED_IN are caught and reported to Sentry
  // ---------------------------------------------------------------
  it('reports sync errors to Sentry on SIGNED_IN', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const syncError = new Error('sync failed');
    (clearAllLocalData as jest.Mock).mockRejectedValueOnce(syncError);

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    jest.clearAllMocks();

    const newSession = makeSession('user-new', 'new@example.com');
    await act(async () => {
      await authStateCallback!('SIGNED_IN', newSession);
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(syncError);
    (console.error as jest.Mock).mockRestore();
  });

  // ---------------------------------------------------------------
  // 14. getSession error is caught and reported to Sentry
  // ---------------------------------------------------------------
  it('reports getSession errors to Sentry', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const sessionError = new Error('getSession failed');
    (supabase.auth.getSession as jest.Mock).mockRejectedValueOnce(sessionError);

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(Sentry.captureException).toHaveBeenCalledWith(sessionError);
    });
    (console.error as jest.Mock).mockRestore();
  });

  // ---------------------------------------------------------------
  // 15. loading becomes false even when getSession rejects
  // ---------------------------------------------------------------
  it('sets loading to false even when getSession fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    (supabase.auth.getSession as jest.Mock).mockRejectedValueOnce(
      new Error('network error'),
    );

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });
    (console.error as jest.Mock).mockRestore();
  });

  // ---------------------------------------------------------------
  // 16. Unsubscribes from auth state change on unmount
  // ---------------------------------------------------------------
  it('unsubscribes from auth state changes on unmount', async () => {
    const { unmount, getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------
  // 17. previousUserIdRef tracks user correctly across sign-in/out
  // ---------------------------------------------------------------
  it('tracks user ID across sign-in and sign-out correctly', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    // Sign in as user A
    const sessionA = makeSession('user-A', 'a@example.com');
    await act(async () => {
      await authStateCallback!('SIGNED_IN', sessionA);
    });

    expect(clearAllLocalData).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();

    // Sign out
    await act(async () => {
      await authStateCallback!('SIGNED_OUT', null);
    });

    jest.clearAllMocks();

    // Sign in as user B (different user)
    const sessionB = makeSession('user-B', 'b@example.com');
    await act(async () => {
      await authStateCallback!('SIGNED_IN', sessionB);
    });

    // Should call clearAllLocalData again because user changed (null -> user-B)
    expect(setCurrentUserId).toHaveBeenCalledWith('user-B');
    expect(clearAllLocalData).toHaveBeenCalledTimes(1);
    expect(pullExercisesAndTemplates).toHaveBeenCalledTimes(1);
    expect(pullWorkoutHistory).toHaveBeenCalledTimes(1);
    expect(migrateExerciseNotesToUserTable).toHaveBeenCalledWith('user-B');
    expect(pullUpcomingWorkout).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------
  // 18. SIGNED_IN does not set Sentry user when session has no user
  // ---------------------------------------------------------------
  it('does not set Sentry user on SIGNED_IN when session has no user object', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    jest.clearAllMocks();

    // Fire SIGNED_IN with a session that has no user (edge case)
    await act(async () => {
      await authStateCallback!('SIGNED_IN', { user: null });
    });

    expect(Sentry.setUser).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // 19. syncing is true during sign-in data sync, false after
  // ---------------------------------------------------------------
  it('syncing is true during sign-in data sync and false after', async () => {
    // Make pullExercisesAndTemplates take a moment so we can observe syncing=true
    let resolvePull: () => void;
    (pullExercisesAndTemplates as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolvePull = resolve; }),
    );

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    // Initially syncing is false
    expect(getByTestId('syncing').props.children).toBe('false');

    // Start sign-in (don't await — we want to check mid-sync)
    const newSession = makeSession('user-sync', 'sync@example.com');
    act(() => {
      authStateCallback!('SIGNED_IN', newSession);
    });

    // syncing should be true while pull is pending
    await waitFor(() => {
      expect(getByTestId('syncing').props.children).toBe('true');
    });

    // Resolve the pull
    await act(async () => {
      resolvePull!();
    });

    // syncing should be false after sync completes
    await waitFor(() => {
      expect(getByTestId('syncing').props.children).toBe('false');
    });
  });

  // ---------------------------------------------------------------
  // 20. syncing becomes false even when sync fails
  // ---------------------------------------------------------------
  it('syncing becomes false even when sync fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    (clearAllLocalData as jest.Mock).mockRejectedValueOnce(new Error('sync failed'));

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(getByTestId('loading').props.children).toBe('false');
    });

    const newSession = makeSession('user-sync-fail', 'syncfail@example.com');
    await act(async () => {
      await authStateCallback!('SIGNED_IN', newSession);
    });

    expect(getByTestId('syncing').props.children).toBe('false');
    (console.error as jest.Mock).mockRestore();
  });

  // ---------------------------------------------------------------
  // Network resilience
  // ---------------------------------------------------------------
  describe('network resilience', () => {
    it('loading becomes false even when getSession throws TypeError', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      (supabase.auth.getSession as jest.Mock).mockRejectedValueOnce(
        new TypeError('Network request failed'),
      );

      const { getByTestId } = render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('false');
      });
      (console.error as jest.Mock).mockRestore();
    });

    it('sync failure on SIGNED_IN does not crash and session is still set', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      (clearAllLocalData as jest.Mock).mockRejectedValueOnce(
        new Error('clearAllLocalData failed'),
      );

      const { getByTestId } = render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('false');
      });

      const newSession = makeSession('user-sync-fail', 'sync@example.com');
      await act(async () => {
        await authStateCallback!('SIGNED_IN', newSession);
      });

      // Session should still be set despite sync failure
      expect(getByTestId('has-session').props.children).toBe('yes');
      expect(getByTestId('user-email').props.children).toBe('sync@example.com');
      (console.error as jest.Mock).mockRestore();
    });

    it('session still set when pullUpcomingWorkout fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      (pullUpcomingWorkout as jest.Mock).mockRejectedValueOnce(
        new Error('pullUpcomingWorkout failed'),
      );

      const { getByTestId } = render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('false');
      });

      const newSession = makeSession('user-pull-fail', 'pull@example.com');
      await act(async () => {
        await authStateCallback!('SIGNED_IN', newSession);
      });

      expect(getByTestId('has-session').props.children).toBe('yes');
      expect(getByTestId('user-email').props.children).toBe('pull@example.com');
      expect(getByTestId('user-id').props.children).toBe('user-pull-fail');
      (console.error as jest.Mock).mockRestore();
    });

    it('sync errors are reported to Sentry', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const syncError = new Error('clearAllLocalData network failure');
      (clearAllLocalData as jest.Mock).mockRejectedValueOnce(syncError);

      const { getByTestId } = render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('false');
      });

      jest.clearAllMocks();

      const newSession = makeSession('user-sentry', 'sentry@example.com');
      await act(async () => {
        await authStateCallback!('SIGNED_IN', newSession);
      });

      expect(Sentry.captureException).toHaveBeenCalledWith(syncError);
      (console.error as jest.Mock).mockRestore();
    });

    it('getSession error is reported to Sentry', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const networkError = new TypeError('Network request failed');
      (supabase.auth.getSession as jest.Mock).mockRejectedValueOnce(networkError);

      render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(Sentry.captureException).toHaveBeenCalledWith(networkError);
      });
      (console.error as jest.Mock).mockRestore();
    });

    it('rapid auth events do not corrupt state — final state shows last user', async () => {
      const { getByTestId } = render(
        <AuthProvider>
          <AuthConsumer />
        </AuthProvider>,
      );

      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('false');
      });

      const sessionA = makeSession('user-rapid-A', 'rapidA@example.com');
      const sessionB = makeSession('user-rapid-B', 'rapidB@example.com');

      // Fire two SIGNED_IN events in rapid succession
      await act(async () => {
        await authStateCallback!('SIGNED_IN', sessionA);
        await authStateCallback!('SIGNED_IN', sessionB);
      });

      expect(getByTestId('has-session').props.children).toBe('yes');
      expect(getByTestId('user-id').props.children).toBe('user-rapid-B');
      expect(getByTestId('user-email').props.children).toBe('rapidB@example.com');
    });
  });
});
