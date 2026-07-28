import { useState, useRef, useEffect, useCallback } from 'react';
import { AppState, Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  scheduleRestNotification,
  applyPendingWidgetActions,
  resetRestProgressBaseline,
} from '../services/liveActivity';

interface UseRestTimerOptions {
  onRestEnd: () => void;
  onRestUpdate: (isResting: boolean, endTime: number, exerciseName?: string) => void;
}

interface UseRestTimerReturn {
  restTotal: number;
  restExerciseName: string;
  isResting: boolean;
  currentEndTime: number;
  startRestTimer: (seconds: number, exerciseName: string) => void;
  adjustRestTimer: (delta: number) => void;
  dismissRest: () => void;
}

export function useRestTimer({ onRestEnd, onRestUpdate }: UseRestTimerOptions): UseRestTimerReturn {
  const [restTotal, setRestTotal] = useState(0);
  const [restExerciseName, setRestExerciseName] = useState('');
  const [isResting, setIsResting] = useState(false);
  const [currentEndTime, setCurrentEndTime] = useState(0);

  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentEndTimeRef = useRef(0);
  const endingRef = useRef(false);
  const wasBackgroundedRef = useRef(false);

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
    currentEndTimeRef.current = 0;
    setIsResting(false);
    setCurrentEndTime(0);
    setRestTotal(0);
    setRestExerciseName('');
    stopRestTimerActivity(); // handles notification cancel internally
    onRestEndRef.current();
    if (vibrate) {
      try { Vibration.vibrate([0, 200, 100, 200]); } catch {}
    }
  }, []);

  // ─── Start rest timer ───
  const startRestTimer = useCallback((seconds: number, exerciseName: string) => {
    endingRef.current = false; // reset for new timer
    wasBackgroundedRef.current = false; // fresh timer is always foreground
    if (restRef.current) clearInterval(restRef.current);
    // This is a NEW rest, so drop the previous rest's progress-bar denominator. Without this
    // a +15s-extended rest leaves its inflated max in place and the next (shorter) rest renders
    // as partly elapsed on the lock screen.
    resetRestProgressBaseline();
    const total = seconds;
    setRestTotal(total);
    setRestExerciseName(exerciseName);

    const endTime = Date.now() + total * 1000;
    currentEndTimeRef.current = endTime;
    setIsResting(true);
    setCurrentEndTime(endTime);

    onRestUpdateRef.current(true, endTime, exerciseName);

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
      if (delta > 0) setRestTotal((prev) => prev + delta);

      adjustRestTimerActivity(delta);
      onRestUpdateRef.current(true, newEndTime);
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
      } else if (nextState === 'active') {
        // ─── Resync rest timer on foreground return ───
        if (restRef.current !== null) {
          // Apply any pending widget intent actions (e.g., +/-15s taps from lock screen)
          const delta = applyPendingWidgetActions();
          if (delta === -Infinity) {
            // Widget user tapped "skip rest"
            endRest(false);
            return;
          }
          if (delta !== 0) {
            currentEndTimeRef.current += delta * 1000;
            setCurrentEndTime(currentEndTimeRef.current);
            // sync Live Activity + notification through the debounced path
            adjustRestTimerActivity(delta);
          }

          const remaining = Math.max(0, Math.round((currentEndTimeRef.current - Date.now()) / 1000));
          if (remaining <= 0) {
            endRest(false); // no vibrate — notification already fired
          } else {
            setTimeout(() => { wasBackgroundedRef.current = false; }, 500);
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
    isResting,
    currentEndTime,
    startRestTimer,
    adjustRestTimer,
    dismissRest,
  };
}
