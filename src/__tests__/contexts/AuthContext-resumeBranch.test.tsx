/**
 * Tests for the three-way SIGNED_IN branch in AuthContext.tsx that decides whether to
 * resetDatabase() on sign-in:
 *
 *   (a) same-account resume (localDataOwnerRef === newUserId) -> consult isDatabaseHealthy(),
 *       skip resetDatabase() when healthy
 *   (b) same-account resume but isDatabaseHealthy() reports corruption -> resetDatabase() IS
 *       called (this is the corruption-recovery path CLAUDE.md documents: sign out, sign back
 *       in as yourself)
 *   (c) genuine account switch (localDataOwnerRef is a DIFFERENT known user) -> resetDatabase()
 *       IS called regardless of health, so one user's local data can never leak into another's
 *       session
 *   (d) cold start with no known local owner -> resetDatabase() IS called
 *
 * The existing AuthContext-sameUserResume.test.tsx only covers the case where
 * newUserId === prevUserId (the outer guard skips the branch entirely before reaching the
 * three-way decision) — it never actually calls isDatabaseHealthy(). These tests specifically
 * drive newUserId !== prevUserId (via an intervening SIGNED_OUT, which clears prevUserId but
 * NOT localDataOwnerRef) so the three-way branch itself gets exercised.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';

let authStateCallback: ((event: string, session: unknown) => void) | null = null;
let mockGetSessionResult: { data: { session: { user: { id: string } } | null } } = {
  data: { session: null },
};
let mockDurableOwner: string | null = null;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(mockDurableOwner)),
  setItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve(mockGetSessionResult)),
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
  isDatabaseHealthy: jest.fn().mockResolvedValue(true),
  inferLocalDataOwner: jest.fn().mockResolvedValue(null),
  markSyncReadyForUser: jest.fn(),
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

import { resetDatabase, isDatabaseHealthy } from '../../services/database';

const mockResetDatabase = resetDatabase as jest.Mock;
const mockIsDatabaseHealthy = isDatabaseHealthy as jest.Mock;

function AuthConsumer() {
  const { authPhase } = useAuth();
  return <Text testID="authPhase">{authPhase}</Text>;
}

async function renderAuth() {
  const utils = render(<AuthProvider><AuthConsumer /></AuthProvider>);
  // Let the initial getSession().then(...) settle.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return utils;
}

async function fireAuthEvent(event: string, userId: string | null) {
  await act(async () => {
    authStateCallback!(event, userId ? { user: { id: userId } } : null);
    // Flush the microtask queue so the async branch inside the handler resolves.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AuthContext: three-way resume/switch/cold-start branch', () => {
  beforeEach(() => {
    mockResetDatabase.mockClear();
    mockIsDatabaseHealthy.mockClear();
    mockIsDatabaseHealthy.mockResolvedValue(true);
    authStateCallback = null;
    mockGetSessionResult = { data: { session: null } };
    mockDurableOwner = null;
  });

  it('(a) sign out then sign back in as the SAME user: healthy DB -> resetDatabase NOT called', async () => {
    // Restored session for user-A seeds both previousUserIdRef and localDataOwnerRef.
    mockGetSessionResult = { data: { session: { user: { id: 'user-A' } } } };
    mockDurableOwner = 'user-A';
    await renderAuth();

    // Sign out: previousUserIdRef clears to null, but localDataOwnerRef.current stays 'user-A'.
    await fireAuthEvent('SIGNED_OUT', null);

    // Sign back in as the SAME user (user-A). newUserId ('user-A') !== prevUserId (null),
    // so this reaches the three-way branch. localDataOwnerRef.current === newUserId -> resume.
    mockIsDatabaseHealthy.mockResolvedValue(true);
    await fireAuthEvent('SIGNED_IN', 'user-A');

    expect(mockIsDatabaseHealthy).toHaveBeenCalled();
    expect(mockResetDatabase).not.toHaveBeenCalled();
  });

  it('(b) same-account resume but isDatabaseHealthy() is false -> resetDatabase IS called', async () => {
    mockGetSessionResult = { data: { session: { user: { id: 'user-A' } } } };
    mockDurableOwner = 'user-A';
    await renderAuth();

    await fireAuthEvent('SIGNED_OUT', null);

    mockIsDatabaseHealthy.mockResolvedValue(false);
    await fireAuthEvent('SIGNED_IN', 'user-A');

    expect(mockIsDatabaseHealthy).toHaveBeenCalled();
    expect(mockResetDatabase).toHaveBeenCalledTimes(1);
  });

  it('(c) genuine account switch -> resetDatabase IS called regardless of DB health', async () => {
    mockGetSessionResult = { data: { session: { user: { id: 'user-A' } } } };
    mockDurableOwner = 'user-A';
    await renderAuth();

    await fireAuthEvent('SIGNED_OUT', null);

    // DB reports healthy — if the switch branch mistakenly deferred to the health check,
    // this would (wrongly) skip the reset. It must reset anyway: never leak user-A's local
    // data into user-B's session.
    mockIsDatabaseHealthy.mockResolvedValue(true);
    await fireAuthEvent('SIGNED_IN', 'user-B');

    expect(mockResetDatabase).toHaveBeenCalledTimes(1);
  });

  it('(d) cold start with no known local owner -> resetDatabase IS called', async () => {
    // No restored session: previousUserIdRef and localDataOwnerRef both start null.
    mockGetSessionResult = { data: { session: null } };
    await renderAuth();

    await fireAuthEvent('SIGNED_IN', 'user-C');

    expect(mockResetDatabase).toHaveBeenCalledTimes(1);
    // Cold start with unknown owner does not need to consult DB health — there is no
    // local data anyone could resume, so nothing to probe.
  });

  it('authPhase returns to "ready" after the resume branch completes', async () => {
    mockGetSessionResult = { data: { session: { user: { id: 'user-A' } } } };
    mockDurableOwner = 'user-A';
    const { getByTestId } = await renderAuth();

    await fireAuthEvent('SIGNED_OUT', null);
    mockIsDatabaseHealthy.mockResolvedValue(true);
    await fireAuthEvent('SIGNED_IN', 'user-A');

    expect(getByTestId('authPhase').props.children).toBe('ready');
  });
});
