/**
 * Verifies that SIGNED_IN re-emitted with the SAME user.id does not trigger
 * resetDatabase or the pull sequence. The existing tests cover TOKEN_REFRESHED;
 * this covers the SIGNED_IN-same-user path explicitly.
 *
 * Sourced from the original Batch 1-bash review (test gap #5).
 */
import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';

// Mock the supabase + database + sync modules used by AuthContext
let authStateCallback: ((event: string, session: unknown) => void) | null = null;

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'user-A' } } } }),
      onAuthStateChange: jest.fn((cb: typeof authStateCallback) => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
  },
}));

jest.mock('../../services/database', () => ({
  resetDatabase: jest.fn().mockResolvedValue(undefined),
  setCurrentUserId: jest.fn(),
}));

jest.mock('../../services/sync', () => {
  const pullExercisesAndTemplates = jest.fn().mockResolvedValue(undefined);
  const pullWorkoutHistory = jest.fn().mockResolvedValue(undefined);
  const pullUpcomingWorkout = jest.fn().mockResolvedValue(undefined);
  return {
    pullExercisesAndTemplates,
    pullExercisesAndTemplatesStrict: pullExercisesAndTemplates,
    pullWorkoutHistory,
    pullWorkoutHistoryStrict: pullWorkoutHistory,
    pullUpcomingWorkout,
    pullUpcomingWorkoutStrict: pullUpcomingWorkout,
  };
});

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn(), setUser: jest.fn() }));

import { resetDatabase, setCurrentUserId } from '../../services/database';
import { pullExercisesAndTemplates, pullWorkoutHistory, pullUpcomingWorkout } from '../../services/sync';

const mockResetDatabase = resetDatabase as jest.Mock;
const mockSetCurrentUserId = setCurrentUserId as jest.Mock;
const mockPullExercisesAndTemplates = pullExercisesAndTemplates as jest.Mock;
const mockPullWorkoutHistory = pullWorkoutHistory as jest.Mock;
const mockPullUpcomingWorkout = pullUpcomingWorkout as jest.Mock;

function AuthConsumer() {
  const { authPhase } = useAuth();
  return <Text testID="authPhase">{authPhase}</Text>;
}

describe('AuthContext: SIGNED_IN with same user ID', () => {
  beforeEach(() => {
    mockResetDatabase.mockClear();
    mockPullExercisesAndTemplates.mockClear();
    mockPullWorkoutHistory.mockClear();
    mockPullUpcomingWorkout.mockClear();
    mockSetCurrentUserId.mockClear();
    authStateCallback = null;
  });

  it('does NOT call resetDatabase when SIGNED_IN fires for the existing user', async () => {
    const { getByTestId } = render(<AuthProvider><AuthConsumer /></AuthProvider>);

    // Wait for initial getSession + INITIAL_SESSION to settle
    await act(async () => { await Promise.resolve(); });

    expect(authStateCallback).not.toBeNull();

    // After initial settle, before any SIGNED_IN, authPhase should be 'ready'
    expect(getByTestId('authPhase').props.children).toBe('ready');

    // Initial SIGNED_IN with user-A (sets previousUserIdRef to user-A)
    await act(async () => {
      authStateCallback!('SIGNED_IN', { user: { id: 'user-A' } });
    });
    // Wait for any pending sync to settle
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const firstResetCount = mockResetDatabase.mock.calls.length;
    const firstPullExercisesCount = mockPullExercisesAndTemplates.mock.calls.length;
    const firstPullWorkoutCount = mockPullWorkoutHistory.mock.calls.length;
    const firstPullUpcomingCount = mockPullUpcomingWorkout.mock.calls.length;

    // Re-emit SIGNED_IN with SAME user-A — guard must skip resetDatabase + pulls
    await act(async () => {
      authStateCallback!('SIGNED_IN', { user: { id: 'user-A' } });
    });
    await act(async () => { await Promise.resolve(); });

    // authPhase stays 'ready' — no transient 'syncing' flash
    expect(getByTestId('authPhase').props.children).toBe('ready');

    expect(mockResetDatabase.mock.calls.length).toBe(firstResetCount);
    expect(mockPullExercisesAndTemplates.mock.calls.length).toBe(firstPullExercisesCount);
    expect(mockPullWorkoutHistory.mock.calls.length).toBe(firstPullWorkoutCount);
    expect(mockPullUpcomingWorkout.mock.calls.length).toBe(firstPullUpcomingCount);
    // setCurrentUserId is still called unconditionally on every auth event (per CLAUDE.md)
    expect(mockSetCurrentUserId).toHaveBeenCalledWith('user-A');
  });

  it('DOES call resetDatabase when SIGNED_IN fires for a DIFFERENT user', async () => {
    render(<AuthProvider><AuthConsumer /></AuthProvider>);
    await act(async () => { await Promise.resolve(); });

    // user-A signs in first
    await act(async () => {
      authStateCallback!('SIGNED_IN', { user: { id: 'user-A' } });
    });
    const resetsAfterA = mockResetDatabase.mock.calls.length;

    // user-B signs in (different user) — should trigger reset
    await act(async () => {
      authStateCallback!('SIGNED_IN', { user: { id: 'user-B' } });
    });

    expect(mockResetDatabase.mock.calls.length).toBe(resetsAfterA + 1);
  });
});
