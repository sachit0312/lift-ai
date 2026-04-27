import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { resetDatabase, setCurrentUserId } from '../services/database';
import { pullUpcomingWorkout, pullExercisesAndTemplates, pullWorkoutHistory } from '../services/sync';

const SYNC_TIMEOUT_MS = 30000;

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  syncing: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
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
        setLoading(false);
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
            setSyncing(true);
            try {
              await Promise.race([
                (async () => {
                  await resetDatabase();
                  await Promise.all([
                    pullExercisesAndTemplates(),
                    pullWorkoutHistory(),
                  ]);
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
              setSyncing(false);
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
    () => ({ session, user: session?.user ?? null, loading, syncing }),
    [session, loading, syncing]
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
