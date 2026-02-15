import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { clearAllLocalData } from '../services/database';
import { pullUpcomingWorkout, pullExercisesAndTemplates, pullWorkoutHistory } from '../services/sync';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const previousUserIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        previousUserIdRef.current = session?.user?.id ?? null;
        setSession(session);
        if (session?.user) {
          Sentry.setUser({ email: session.user.email, id: session.user.id });
        }
      })
      .catch((error) => {
        Sentry.captureException(error);
        console.error('Failed to get session:', error);
      })
      .finally(() => {
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        const prevUserId = previousUserIdRef.current;
        const newUserId = newSession?.user?.id ?? null;
        setSession(newSession);

        if (event === 'SIGNED_IN') {
          if (newSession?.user) {
            Sentry.setUser({ email: newSession.user.email, id: newSession.user.id });
          }
          if (newUserId !== prevUserId) {
            try {
              await clearAllLocalData();
              await Promise.all([
                pullExercisesAndTemplates(),
                pullWorkoutHistory(),
              ]);
              await pullUpcomingWorkout();
            } catch (error) {
              Sentry.captureException(error);
              console.error('Failed to sync data on sign in:', error);
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

  const user = session?.user ?? null;

  const value = useMemo(
    () => ({ session, user, loading }),
    [session, user, loading]
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
