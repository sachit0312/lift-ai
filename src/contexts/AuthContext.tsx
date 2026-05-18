import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { resetDatabase, setCurrentUserId } from '../services/database';
import { pullUpcomingWorkout, pullExercisesAndTemplates, pullWorkoutHistory } from '../services/sync';

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

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        previousUserIdRef.current = session?.user?.id ?? null;
        setSession(session);
        // Keep the database module's currentUserId in sync with the rehydrated session.
        // Without this, cold-start writes to user_exercise_notes land under 'local'
        // and are never pushed to Supabase.
        setCurrentUserId(session?.user?.id ?? 'local');
        if (session?.user) {
          Sentry.setUser({ email: session.user.email, id: session.user.id });
        }
      })
      .catch((error) => {
        Sentry.captureException(error);
        if (__DEV__) console.error('Failed to get session:', error);
      })
      .finally(() => {
        setAuthPhase('ready');
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        const prevUserId = previousUserIdRef.current;
        const newUserId = newSession?.user?.id ?? null;
        setSession(newSession);

        // Always mirror the session into the database module, regardless of event type.
        // INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED / SIGNED_IN all count.
        setCurrentUserId(newUserId ?? 'local');

        if (event === 'SIGNED_IN') {
          if (newSession?.user) {
            Sentry.setUser({ email: newSession.user.email, id: newSession.user.id });
          }
          if (newUserId !== prevUserId) {
            setAuthPhase('syncing');
            try {
              await Promise.race([
                (async () => {
                  await resetDatabase();
                  // Run pulls sequentially so each can safely wrap its row writes in a single
                  // SQLite transaction. The added network latency (~few hundred ms) is more
                  // than offset by collapsing thousands of per-row fsyncs into one.
                  await pullExercisesAndTemplates();
                  await pullWorkoutHistory();
                  await pullUpcomingWorkout();
                })(),
                new Promise<void>((_, reject) =>
                  setTimeout(() => reject(new Error('sign-in sync timeout')), SYNC_TIMEOUT_MS),
                ),
              ]);
            } catch (error) {
              Sentry.captureException(error);
              if (__DEV__) console.error('Failed to sync data on sign in:', error);
            } finally {
              setAuthPhase('ready');
            }
          }
        } else if (event === 'SIGNED_OUT') {
          Sentry.setUser(null);
        }

        previousUserIdRef.current = newUserId;
      },
    );

    return () => subscription.unsubscribe();
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
