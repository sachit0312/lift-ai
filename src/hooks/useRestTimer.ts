import { useState, useRef, useEffect, useCallback } from 'react';
import { AppState, Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  scheduleRestNotification,
  resetRestProgressBaseline,
} from '../services/liveActivity';
import { readRestTimerSnapshot } from '../services/restTimerSnapshot';

interface UseRestTimerOptions {
  onRestEnd: () => void;
  onRestUpdate: (
    isResting: boolean, endTime: number, restingExerciseId?: string, totalSeconds?: number,
  ) => void;
}

interface UseRestTimerReturn {
  restTotal: number;
  restExerciseName: string;
  /** Exercise being rested FROM, or '' when idle. Consumed by useWidgetBridge so that every
   *  widget sync — not only the one that arms the rest — labels the correct exercise. */
  restExerciseId: string;
  isResting: boolean;
  currentEndTime: number;
  /**
   * Arms the rest countdown and returns its absolute epoch-millis deadline.
   *
   * Deliberately does NOT sync the widget itself: the caller holds the post-completion block
   * list, which this hook cannot see (`blocksRef` still lags by a render inside the completion
   * handler). Syncing from here as well pushed the just-completed set to the lock screen for
   * up to one throttle window before the caller's correct sync replaced it, and cost a second
   * native UserDefaults write on every checkbox tap.
   *
   * **Callers must pass the returned deadline to `syncWidgetState` themselves.**
   */
  startRestTimer: (seconds: number, exerciseName: string, exerciseId: string) => number;
  adjustRestTimer: (delta: number) => void;
  dismissRest: () => void;
}

export function useRestTimer({ onRestEnd, onRestUpdate }: UseRestTimerOptions): UseRestTimerReturn {
  const [restTotal, setRestTotal] = useState(0);
  const [restExerciseName, setRestExerciseName] = useState('');
  const [restExerciseId, setRestExerciseId] = useState('');
  const [isResting, setIsResting] = useState(false);
  const [currentEndTime, setCurrentEndTime] = useState(0);

  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentEndTimeRef = useRef(0);
  const endingRef = useRef(false);
  const wasBackgroundedRef = useRef(false);
  const wasBackgroundedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which exercise the user is resting FROM, and the current rest duration. Mirrored as refs
  // because adjustRestTimer runs before the corresponding state updates flush, and the widget
  // needs both to render the right exercise against the right progress-bar denominator.
  const restExerciseIdRef = useRef('');
  const restTotalRef = useRef(0);
  const restSessionIdRef = useRef('');

  // Keep callback refs stable so the interval closure always calls the latest version
  const onRestEndRef = useRef(onRestEnd);
  onRestEndRef.current = onRestEnd;
  const onRestUpdateRef = useRef(onRestUpdate);
  onRestUpdateRef.current = onRestUpdate;

  // ─── Shared cleanup helper ───
  const endRest = useCallback((vibrate: boolean) => {
    if (endingRef.current) return; // only first caller proceeds
    endingRef.current = true;
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
    if (wasBackgroundedResetRef.current) {
      clearTimeout(wasBackgroundedResetRef.current);
      wasBackgroundedResetRef.current = null;
    }
    currentEndTimeRef.current = 0;
    restExerciseIdRef.current = '';
    restTotalRef.current = 0;
    restSessionIdRef.current = '';
    setIsResting(false);
    setCurrentEndTime(0);
    setRestTotal(0);
    setRestExerciseName('');
    setRestExerciseId('');
    stopRestTimerActivity(); // handles notification cancel internally
    onRestEndRef.current();
    if (vibrate) {
      try { Vibration.vibrate([0, 200, 100, 200]); } catch {}
    }
  }, []);

  // ─── Start rest timer ───
  const startRestTimer = useCallback((seconds: number, exerciseName: string, exerciseId: string): number => {
    endingRef.current = false; // reset for new timer
    wasBackgroundedRef.current = false; // fresh timer is always foreground
    if (restRef.current) clearInterval(restRef.current);
    if (wasBackgroundedResetRef.current) {
      clearTimeout(wasBackgroundedResetRef.current);
      wasBackgroundedResetRef.current = null;
    }
    // This is a NEW rest, so drop the previous rest's progress-bar denominator. Without this
    // a +15s-extended rest leaves its inflated max in place and the next (shorter) rest renders
    // as partly elapsed on the lock screen.
    restSessionIdRef.current = resetRestProgressBaseline();
    const total = seconds;
    restTotalRef.current = total;
    restExerciseIdRef.current = exerciseId;
    setRestTotal(total);
    setRestExerciseName(exerciseName);
    setRestExerciseId(exerciseId);

    const endTime = Date.now() + total * 1000;
    currentEndTimeRef.current = endTime;
    setIsResting(true);
    setCurrentEndTime(endTime);

    // No onRestUpdate here — the caller owns the widget sync (see the JSDoc on this function
    // in UseRestTimerReturn). Firing it from both places produced two native writes per tap,
    // the first of them built from a stale block list.

    // Schedule notification for when timer ends (Fix 1)
    // Routed through serialized queue to prevent race with adjustRestTimerActivity
    scheduleRestNotification(total);

    // Interval computes remaining from absolute endTime (Fix 7+8: aligns with lock screen)
    restRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.round((currentEndTimeRef.current - Date.now()) / 1000));

      if (remaining <= 0) {
        // Don't vibrate if this tick fired because iOS unfroze the interval on
        // foreground return — the notification already alerted the user.
        // Only vibrate when the timer naturally expires while the app is in
        // the foreground (wasBackgroundedRef is false).
        endRest(!wasBackgroundedRef.current);
      }
    }, 1000);

    return endTime;
  }, [endRest]);

  // ─── Adjust timer (+/-15s) ───
  const adjustRestTimer = useCallback((delta: number) => {
    const newEndTime = currentEndTimeRef.current + delta * 1000;
    const remaining = Math.max(0, Math.round((newEndTime - Date.now()) / 1000));

    if (remaining <= 0) {
      // Timer hit zero via adjustment — treat like natural expiry (Fix 4)
      endRest(true);
    } else {
      currentEndTimeRef.current = newEndTime;
      setCurrentEndTime(newEndTime);
      // The progress-bar denominator only grows, so the bar never jumps backwards on -15s.
      if (delta > 0) {
        restTotalRef.current += delta;
        setRestTotal((prev) => prev + delta);
      }

      adjustRestTimerActivity(delta);
      // Pass the resting exercise through. Omitting it made buildWidgetState fall back to
      // "first incomplete set", so tapping +/-15s while resting from the last exercise in the
      // list retitled the lock screen to a different exercise for the remainder of the rest.
      onRestUpdateRef.current(true, newEndTime, restExerciseIdRef.current, restTotalRef.current);
    }
  }, [endRest]);

  // ─── Dismiss/skip rest ───
  const dismissRest = useCallback(() => {
    endRest(false);
  }, [endRest]);

  // ─── Track background state ───
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') {
        // Only set on confirmed background — not 'inactive' (brief interruptions
        // like phone calls shouldn't suppress vibration)
        wasBackgroundedRef.current = true;
        // Drop any pending "back in foreground" reset. Locking the phone again within 500ms
        // of a resume would otherwise let that timeout fire from the background and clear the
        // flag, so the next resume vibrates on top of the notification that already alerted.
        if (wasBackgroundedResetRef.current) {
          clearTimeout(wasBackgroundedResetRef.current);
          wasBackgroundedResetRef.current = null;
        }
      } else if (nextState === 'active') {
        // ─── Resync rest timer on foreground return ───
        if (restRef.current !== null) {
          try {
            const snapshot = readRestTimerSnapshot();
            if (snapshot?.sessionId === restSessionIdRef.current) {
              if (!snapshot.isActive || snapshot.endTimeMs <= Date.now()) {
                endRest(false);
                return;
              }
              currentEndTimeRef.current = snapshot.endTimeMs;
              restTotalRef.current = snapshot.maxRestSeconds;
              setCurrentEndTime(snapshot.endTimeMs);
              setRestTotal(snapshot.maxRestSeconds);
            }
          } catch (e: unknown) {
            Sentry.captureException(e);
          }
          // App Intents write one authoritative snapshot; there is deliberately no action
          // queue to replay. Recompute against the adopted absolute deadline.
          const remaining = Math.max(0, Math.round((currentEndTimeRef.current - Date.now()) / 1000));
          if (remaining <= 0) {
            endRest(false); // no vibrate — notification already fired
          } else {
            // Tracked so it can be cancelled: an untracked timeout could fire after the app
            // was backgrounded again, clearing the flag and letting the next resume vibrate
            // on top of the notification that had already alerted the user.
            if (wasBackgroundedResetRef.current) clearTimeout(wasBackgroundedResetRef.current);
            wasBackgroundedResetRef.current = setTimeout(() => {
              wasBackgroundedResetRef.current = null;
              wasBackgroundedRef.current = false;
            }, 500);
          }
        } else {
          wasBackgroundedRef.current = false;
        }
      }
    });
    return () => subscription.remove();
  }, [endRest]);

  // Clean up on unmount.
  //
  // Clearing the interval alone left the scheduled "Rest Complete" notification armed and the
  // Live Activity stuck in countdown mode: signing out mid-rest unmounted this screen and the
  // time-sensitive banner still fired, with sound, while the user sat on the login screen.
  // stopRestTimerActivity cancels the notification and returns the widget to its non-rest state.
  useEffect(() => {
    return () => {
      if (wasBackgroundedResetRef.current) {
        clearTimeout(wasBackgroundedResetRef.current);
        wasBackgroundedResetRef.current = null;
      }
      if (restRef.current) {
        clearInterval(restRef.current);
        restRef.current = null;
        // Synchronous; it routes its own failures to Sentry internally.
        try { stopRestTimerActivity(); } catch (e) { Sentry.captureException(e); }
      }
    };
  }, []);

  return {
    restTotal,
    restExerciseName,
    restExerciseId,
    isResting,
    currentEndTime,
    startRestTimer,
    adjustRestTimer,
    dismissRest,
  };
}
