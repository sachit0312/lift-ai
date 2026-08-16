import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { Session, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { resetDatabase, setCurrentUserId, isDatabaseHealthy } from '../services/database';
import { pullUpcomingWorkout, pullExercisesAndTemplates, pullWorkoutHistory } from '../services/sync';
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

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        previousUserIdRef.current = session?.user?.id ?? null;
        // A restored session means the data on disk already belongs to this user, so a later
        // sign-out/sign-in cycle in this app session is a resume, not an account switch.
        localDataOwnerRef.current = session?.user?.id ?? null;
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
        // Only transition out of 'initializing'. If onAuthStateChange already
        // moved us to 'syncing' (SIGNED_IN with new user), don't stomp it back
        // to 'ready' while the sync is still in flight.
        setAuthPhase(prev => prev === 'initializing' ? 'ready' : prev);
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
            // Is this the same account resuming, or a genuine account switch?
            //
            // previousUserIdRef is nulled on SIGNED_OUT, so it reports "different user" even
            // when you sign back in as yourself — and the resetDatabase() below deletes the
            // SQLite file outright. Only FINISHED workouts are ever pushed, so a session
            // logged with no signal and then interrupted by a token expiry was destroyed on
            // the next login. localDataOwnerRef survives sign-out and distinguishes the two.
            const isAccountSwitch = newUserId !== null && localDataOwnerRef.current !== null
              && newUserId !== localDataOwnerRef.current;

            setAuthPhase('syncing');
            try {
              await withTimeout(
                (async () => {
                  if (isAccountSwitch) {
                    // Different account: the local data belongs to someone else and cannot be
                    // pushed under this session's id, so wiping is the only safe option.
                    await resetDatabase();
                  } else if (localDataOwnerRef.current === newUserId) {
                    // Same account resuming. Keep local data — resetting here destroyed any
                    // finished workout that had not been pushed yet (logged with no signal,
                    // then interrupted by a token expiry).
                    //
                    // But CLAUDE.md documents sign-out/sign-in as THE fix for a corrupted
                    // SQLite file, and that is almost always a same-account action — so
                    // skipping the reset unconditionally would remove the only recovery
                    // route. Probe the file first and still reset when it is actually broken.
                    if (!(await isDatabaseHealthy())) {
                      await resetDatabase();
                    }
                  } else {
                    // First sign-in of this app session with no known local owner (cold start
                    // after install, or a restored-then-expired session). Nothing local is
                    // known to be safe, so reset as before.
                    await resetDatabase();
                  }
                  // Run pulls sequentially so each can safely wrap its row writes in a single
                  // SQLite transaction. The added network latency (~few hundred ms) is more
                  // than offset by collapsing thousands of per-row fsyncs into one.
                  await pullExercisesAndTemplates();
                  await pullWorkoutHistory();
                  await pullUpcomingWorkout();
                  localDataOwnerRef.current = newUserId;
                })(),
                SYNC_TIMEOUT_MS,
                'sign-in sync timeout',
              );
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
