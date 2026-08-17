import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

let mockAuthStateCallback: ((event: string, session: any) => unknown) | null = null;
let mockInitialSession: any = null;
let mockGetSessionMode: 'immediate' | 'pending' = 'immediate';
let mockPendingGetSessionResolve: ((value: { data: { session: any } }) => void) | null = null;
let mockDurableOwner: string | null = null;
let mockInferredOwner: string | null = null;
let mockSecureStoreReadError: Error | null = null;
let mockSecureStoreWriteError: Error | null = null;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => {
    if (mockSecureStoreReadError) return Promise.reject(mockSecureStoreReadError);
    return Promise.resolve(mockDurableOwner);
  }),
  setItemAsync: jest.fn(() => {
    if (mockSecureStoreWriteError) return Promise.reject(mockSecureStoreWriteError);
    return Promise.resolve();
  }),
}));

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => {
        if (mockGetSessionMode === 'pending') {
          return new Promise(resolve => {
            mockPendingGetSessionResolve = resolve;
          });
        }
        return Promise.resolve({ data: { session: mockInitialSession } });
      }),
      onAuthStateChange: jest.fn((callback: typeof mockAuthStateCallback) => {
        mockAuthStateCallback = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
  },
}));

jest.mock('../../services/database', () => ({
  resetDatabase: jest.fn(),
  setCurrentUserId: jest.fn(),
  isDatabaseHealthy: jest.fn().mockResolvedValue(true),
  inferLocalDataOwner: jest.fn(() => Promise.resolve(mockInferredOwner)),
  markSyncReadyForUser: jest.fn(),
}));

jest.mock('../../services/sync', () => ({
  pullExercisesAndTemplates: jest.fn(),
  pullExercisesAndTemplatesStrict: jest.fn(),
  pullWorkoutHistory: jest.fn(),
  pullWorkoutHistoryStrict: jest.fn(),
  pullUpcomingWorkout: jest.fn(),
  pullUpcomingWorkoutStrict: jest.fn(),
}));

import * as Sentry from '@sentry/react-native';
import * as SecureStore from 'expo-secure-store';
import { resetDatabase } from '../../services/database';
import {
  pullExercisesAndTemplatesStrict,
  pullUpcomingWorkoutStrict,
  pullWorkoutHistoryStrict,
} from '../../services/sync';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';

const mockResetDatabase = resetDatabase as jest.Mock;
const mockPullExercisesAndTemplatesStrict = pullExercisesAndTemplatesStrict as jest.Mock;
const mockPullWorkoutHistoryStrict = pullWorkoutHistoryStrict as jest.Mock;
const mockPullUpcomingWorkoutStrict = pullUpcomingWorkoutStrict as jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function sessionFor(id: string) {
  return { user: { id, email: `${id}@example.com` } };
}

function AuthPhaseProbe() {
  const { authPhase } = useAuth();
  return <Text testID="authPhase">{authPhase}</Text>;
}

async function flushReconciliation() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AuthContext reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStateCallback = null;
    mockInitialSession = null;
    mockGetSessionMode = 'immediate';
    mockPendingGetSessionResolve = null;
    mockDurableOwner = null;
    mockInferredOwner = null;
    mockSecureStoreReadError = null;
    mockSecureStoreWriteError = null;
    mockResetDatabase.mockResolvedValue(undefined);
    mockPullExercisesAndTemplatesStrict.mockResolvedValue(undefined);
    mockPullWorkoutHistoryStrict.mockResolvedValue(undefined);
    mockPullUpcomingWorkoutStrict.mockResolvedValue(undefined);
  });

  it('returns from SIGNED_IN before reconciliation starts while getSession is auth-locked', async () => {
    mockGetSessionMode = 'pending';
    const reset = deferred<void>();
    mockResetDatabase.mockReturnValueOnce(reset.promise);

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );

    let callbackResult: unknown;
    act(() => {
      callbackResult = mockAuthStateCallback!('SIGNED_IN', sessionFor('user-A'));
    });

    // Supabase keeps auth APIs locked until this callback returns. Reconciliation must not
    // await work inside the callback, or a later getSession in the pull path deadlocks.
    expect(callbackResult).toBeUndefined();
    expect(getByTestId('authPhase').props.children).toBe('syncing');

    mockPendingGetSessionResolve!({ data: { session: null } });
    await flushReconciliation();
    expect(mockResetDatabase).toHaveBeenCalledTimes(1);

    await act(async () => {
      reset.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('exposes ready only after reset and every sequential pull succeeds', async () => {
    const reset = deferred<void>();
    const exercises = deferred<void>();
    const history = deferred<void>();
    const upcoming = deferred<void>();
    mockResetDatabase.mockReturnValueOnce(reset.promise);
    mockPullExercisesAndTemplatesStrict.mockReturnValueOnce(exercises.promise);
    mockPullWorkoutHistoryStrict.mockReturnValueOnce(history.promise);
    mockPullUpcomingWorkoutStrict.mockReturnValueOnce(upcoming.promise);

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );
    await waitFor(() => expect(getByTestId('authPhase').props.children).toBe('ready'));

    act(() => {
      mockAuthStateCallback!('SIGNED_IN', sessionFor('user-A'));
    });
    await flushReconciliation();
    expect(getByTestId('authPhase').props.children).toBe('syncing');
    expect(mockResetDatabase).toHaveBeenCalledTimes(1);
    expect(mockPullExercisesAndTemplatesStrict).not.toHaveBeenCalled();

    await act(async () => {
      reset.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockPullExercisesAndTemplatesStrict).toHaveBeenCalledWith('user-A');
    expect(mockPullWorkoutHistoryStrict).not.toHaveBeenCalled();
    expect(getByTestId('authPhase').props.children).toBe('syncing');

    await act(async () => {
      exercises.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockPullWorkoutHistoryStrict).toHaveBeenCalledWith('user-A');
    expect(mockPullUpcomingWorkoutStrict).not.toHaveBeenCalled();
    expect(getByTestId('authPhase').props.children).toBe('syncing');

    await act(async () => {
      history.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockPullUpcomingWorkoutStrict).toHaveBeenCalledWith('user-A');
    expect(getByTestId('authPhase').props.children).toBe('syncing');

    await act(async () => {
      upcoming.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getByTestId('authPhase').props.children).toBe('ready');
  });

  it('abandons a stale A reconciliation before running B reconciliation', async () => {
    render(<AuthProvider><AuthPhaseProbe /></AuthProvider>);

    act(() => {
      mockAuthStateCallback!('SIGNED_IN', sessionFor('user-A'));
      mockAuthStateCallback!('SIGNED_IN', sessionFor('user-B'));
    });
    await flushReconciliation();

    // A stale job must not reset or pull into B's local database.
    expect(mockResetDatabase).toHaveBeenCalledTimes(1);
    expect(mockPullExercisesAndTemplatesStrict).toHaveBeenCalledTimes(1);
    expect(mockPullWorkoutHistoryStrict).toHaveBeenCalledTimes(1);
    expect(mockPullUpcomingWorkoutStrict).toHaveBeenCalledTimes(1);
  });

  it('stays fail-closed when reset fails before any pull', async () => {
    const resetError = new Error('could not isolate local database');
    mockResetDatabase.mockRejectedValueOnce(resetError);

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );
    await waitFor(() => expect(getByTestId('authPhase').props.children).toBe('ready'));

    act(() => {
      mockAuthStateCallback!('SIGNED_IN', sessionFor('user-A'));
    });
    await flushReconciliation();

    expect(Sentry.captureException).toHaveBeenCalledWith(resetError);
    expect(mockPullExercisesAndTemplatesStrict).not.toHaveBeenCalled();
    expect(mockPullWorkoutHistoryStrict).not.toHaveBeenCalled();
    expect(mockPullUpcomingWorkoutStrict).not.toHaveBeenCalled();
    expect(getByTestId('authPhase').props.children).toBe('syncing');
  });

  it('waits for a timed-out A pull to quiesce before B can reset or become ready', async () => {
    jest.useFakeTimers();
    const staleExercises = deferred<void>();
    const rowsWritten: string[] = [];
    let exercisePulls = 0;
    const reset = jest.fn(async () => {
      rowsWritten.length = 0;
    });
    const pullExercises = jest.fn(() => {
      exercisePulls += 1;
      if (exercisePulls === 1) {
        return staleExercises.promise.then(() => {
          rowsWritten.push('A');
        });
      }
      rowsWritten.push('B');
      return Promise.resolve();
    });
    mockResetDatabase.mockImplementation(reset);
    mockPullExercisesAndTemplatesStrict.mockImplementation(pullExercises);

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      mockAuthStateCallback!('SIGNED_IN', sessionFor('user-A'));
    });
    await flushReconciliation();
    expect(pullExercises).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30000);
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      mockAuthStateCallback!('SIGNED_IN', sessionFor('user-B'));
    });
    await flushReconciliation();

    // B must remain behind A's still-running pull. Resetting B before A settles lets A write
    // after B's cleanup and leaves old-account rows in B's database.
    expect(reset).toHaveBeenCalledTimes(1);
    expect(getByTestId('authPhase').props.children).toBe('syncing');

    await act(async () => {
      staleExercises.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(reset).toHaveBeenCalledTimes(2));
    expect(rowsWritten).toEqual(['B']);
    expect(getByTestId('authPhase').props.children).toBe('ready');
    jest.useRealTimers();
  });

  it('resets and strictly pulls when a restored B session disagrees with the durable A owner', async () => {
    // This is the crash window: B's Supabase session persisted, but the A -> B SQLite reset
    // never ran before the process died. The durable marker remains A and must block B from
    // rendering that SQLite file until reset + all pulls finish.
    mockInitialSession = sessionFor('user-A');
    mockDurableOwner = 'user-A';
    const firstLaunch = render(<AuthProvider><AuthPhaseProbe /></AuthProvider>);
    await waitFor(() => expect(firstLaunch.getByTestId('authPhase').props.children).toBe('ready'));
    firstLaunch.unmount();

    mockInitialSession = sessionFor('user-B');
    const upcoming = deferred<void>();
    mockPullUpcomingWorkoutStrict.mockReturnValueOnce(upcoming.promise);

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );

    await waitFor(() => expect(mockResetDatabase).toHaveBeenCalledTimes(1));
    expect(getByTestId('authPhase').props.children).toBe('syncing');
    expect(mockPullExercisesAndTemplatesStrict).toHaveBeenCalledWith('user-B');
    expect(mockPullWorkoutHistoryStrict).toHaveBeenCalledWith('user-B');
    expect(mockPullUpcomingWorkoutStrict).toHaveBeenCalledWith('user-B');

    await act(async () => {
      upcoming.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(getByTestId('authPhase').props.children).toBe('ready'));
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'liftai-local-data-owner',
      'user-B',
    );
  });

  it('preserves an upgraded restored user\'s active local data when every owner-bearing row proves that user', async () => {
    // Pre-marker installs can contain an active workout that is not remotely recoverable. A
    // healthy database whose only owner is the restored user is safe to adopt without reset.
    mockInitialSession = sessionFor('user-A');
    mockInferredOwner = 'user-A';

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );

    await waitFor(() => expect(getByTestId('authPhase').props.children).toBe('ready'));
    expect(mockResetDatabase).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'liftai-local-data-owner',
      'user-A',
    );
  });

  it.each([
    ['ambiguous owner rows', null],
    ['a different proven owner', 'user-B'],
  ])('resets before exposing an upgraded restored user with %s', async (_case, inferredOwner) => {
    mockInitialSession = sessionFor('user-A');
    mockInferredOwner = inferredOwner;

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );

    await waitFor(() => expect(mockResetDatabase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByTestId('authPhase').props.children).toBe('ready'));
  });

  it('treats a durable-owner read failure as unknown and reconciles before ready', async () => {
    const ownerReadError = new Error('secure storage unavailable');
    mockInitialSession = sessionFor('user-A');
    mockSecureStoreReadError = ownerReadError;

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );

    await waitFor(() => expect(mockResetDatabase).toHaveBeenCalledTimes(1));
    expect(Sentry.captureException).toHaveBeenCalledWith(ownerReadError);
    await waitFor(() => expect(getByTestId('authPhase').props.children).toBe('ready'));
  });

  it('reports durable-owner write failure without exposing data before reconciliation', async () => {
    const ownerWriteError = new Error('secure storage write failed');
    mockInitialSession = sessionFor('user-A');
    mockSecureStoreWriteError = ownerWriteError;

    const { getByTestId } = render(
      <AuthProvider><AuthPhaseProbe /></AuthProvider>,
    );

    await waitFor(() => expect(mockResetDatabase).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByTestId('authPhase').props.children).toBe('ready'));
    expect(Sentry.captureException).toHaveBeenCalledWith(ownerWriteError);
  });
});
