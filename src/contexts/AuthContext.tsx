import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { resetDatabase, setCurrentUserId, isDatabaseHealthy } from '../services/database';
import {
  pullUpcomingWorkoutStrict,
  pullExercisesAndTemplatesStrict,
  pullWorkoutHistoryStrict,
} from '../services/sync';
import { withTimeout } from '../utils/withTimeout';

const SYNC_TIMEOUT_MS = 30000;

export type AuthPhase = 'initializing' | 'syncing' | 'ready';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  authPhase: AuthPhase;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('initializing');
  const previousUserIdRef = React.useRef<string | null>(null);
  // Owner of the data currently on disk. Unlike previousUserIdRef this is NOT cleared on
  // sign-out, so signing back in as the same account is recognised as a resume rather than
  // an account switch. See the SIGNED_IN branch below.
  const localDataOwnerRef = React.useRef<string | null>(null);
  const authGenerationRef = React.useRef(0);
  const reconciliationQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let isDisposed = false;
    const initialGeneration = authGenerationRef.current;

    const isCurrentReconciliation = (generation: number, userId: string) => (
      !isDisposed
      && authGenerationRef.current === generation
      && previousUserIdRef.current === userId
    );

    const reconcileSignedInUser = async (
      generation: number,
      userId: string,
      localOwnerAtEvent: string | null,
    ): Promise<boolean> => {
      if (!isCurrentReconciliation(generation, userId)) return false;

      // The subscription callback updates this synchronously. Reassert the captured identity
      // only after the queue has confirmed this job is current, so a stale job cannot write as
      // the newer account while it waits behind reset/pull work.
      setCurrentUserId(userId);

      const isAccountSwitch = localOwnerAtEvent !== null && localOwnerAtEvent !== userId;
      if (isAccountSwitch) {
        await resetDatabase();
      } else if (localOwnerAtEvent === userId) {
        // Same account resuming keeps healthy local data, but retains sign-out/sign-in as the
        // documented recovery path for an actually corrupt SQLite file.
        if (!(await isDatabaseHealthy())) {
          if (!isCurrentReconciliation(generation, userId)) return false;
          await resetDatabase();
        }
      } else {
        // With no trustworthy owner (cold start or interrupted prior reconciliation), isolate
        // first. A reset that cannot prove an empty database rejects and keeps the app closed.
        await resetDatabase();
      }

      if (!isCurrentReconciliation(generation, userId)) return false;
      await pullExercisesAndTemplatesStrict(userId);
      if (!isCurrentReconciliation(generation, userId)) return false;
      await pullWorkoutHistoryStrict(userId);
      if (!isCurrentReconciliation(generation, userId)) return false;
      await pullUpcomingWorkoutStrict(userId);
      return isCurrentReconciliation(generation, userId);
    };

    const scheduleReconciliation = (
      generation: number,
      userId: string,
      localOwnerAtEvent: string | null,
    ) => {
      // Supabase invokes onAuthStateChange while holding an internal auth lock. Deferring the
      // queue join by one microtask guarantees the callback returns before any pull can call
      // auth APIs (notably getSession), avoiding a lock inversion/deadlock.
      void Promise.resolve().then(() => {
        const run = reconciliationQueueRef.current
          .catch(() => undefined)
          .then(async () => {
            if (!isCurrentReconciliation(generation, userId)) return;
            const reconciliation = reconcileSignedInUser(generation, userId, localOwnerAtEvent);
            let reportedError: unknown;
            try {
              const completed = await withTimeout(
                reconciliation,
                SYNC_TIMEOUT_MS,
                'sign-in sync timeout',
              );
              if (completed && isCurrentReconciliation(generation, userId)) {
                localDataOwnerRef.current = userId;
                setAuthPhase('ready');
              }
            } catch (error) {
              reportedError = error;
              Sentry.captureException(error);
              if (__DEV__) console.error('Failed to sync data on sign in:', error);

              // withTimeout cannot cancel the underlying promise. Invalidate this generation
              // so a timed-out pull cannot later mark ready or continue into later pulls.
              if (isCurrentReconciliation(generation, userId)) {
                authGenerationRef.current += 1;
              }
            } finally {
              // A timeout only settles the race, not the SQLite/network work it raced. Keep
              // this queue slot until the original operation settles so the next account's
              // reset cannot run before stale writes have quiesced.
              try {
                await reconciliation;
              } catch (error) {
                if (error !== reportedError) Sentry.captureException(error);
              }
            }
          });
        reconciliationQueueRef.current = run;
      });
    };

    supabase.auth.getSession()
      .then(({ data: { session: restoredSession } }) => {
        // An auth event won the race. Its synchronous capture is newer than this stale read.
        if (isDisposed || authGenerationRef.current !== initialGeneration) return;

        previousUserIdRef.current = restoredSession?.user?.id ?? null;
        // A restored session means the data on disk already belongs to this user, so a later
        // sign-out/sign-in cycle in this app session is a resume, not an account switch.
        localDataOwnerRef.current = restoredSession?.user?.id ?? null;
        setSession(restoredSession);
        // Keep the database module's currentUserId in sync with the rehydrated session.
        // Without this, cold-start writes to user_exercise_notes land under 'local'
        // and are never pushed to Supabase.
        setCurrentUserId(restoredSession?.user?.id ?? 'local');
        if (restoredSession?.user) {
          Sentry.setUser({ email: restoredSession.user.email, id: restoredSession.user.id });
        }
      })
      .catch((error) => {
        Sentry.captureException(error);
        if (__DEV__) console.error('Failed to get session:', error);
      })
      .finally(() => {
        // Do not let a late initial getSession completion expose a user while a newer sign-in
        // reconciliation is still isolating and pulling that user's data.
        if (!isDisposed && authGenerationRef.current === initialGeneration) {
          setAuthPhase(prev => prev === 'initializing' ? 'ready' : prev);
        }
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        const previousUserId = previousUserIdRef.current;
        const newUserId = newSession?.user?.id ?? null;

        // This callback must remain synchronous. Supabase holds an auth lock until it returns;
        // capture all state needed by reconciliation, then hand the async work to the queue.
        setSession(newSession);
        setCurrentUserId(newUserId ?? 'local');
        previousUserIdRef.current = newUserId;

        if (event === 'SIGNED_OUT') {
          authGenerationRef.current += 1;
          Sentry.setUser(null);
          // No authenticated corpus is rendered after sign-out, so the login screen is safe to
          // show even if a stale reconciliation is still unwinding in the background.
          setAuthPhase('ready');
          return;
        }

        if (event !== 'SIGNED_IN' || !newUserId || newUserId === previousUserId) return;

        if (newSession?.user) {
          Sentry.setUser({ email: newSession.user.email, id: newSession.user.id });
        }

        const generation = authGenerationRef.current + 1;
        authGenerationRef.current = generation;
        const localOwnerAtEvent = localDataOwnerRef.current;
        setAuthPhase('syncing');
        scheduleReconciliation(generation, newUserId, localOwnerAtEvent);
      },
    );

    return () => {
      isDisposed = true;
      authGenerationRef.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, authPhase }),
    [session, authPhase]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
