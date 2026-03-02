import { useState, useRef, useEffect, useCallback } from 'react';
import { AppState, Vibration } from 'react-native';
import {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  scheduleRestNotification,
  cancelTimerEndNotification,
} from '../services/liveActivity';
import { getWidgetRestState } from '../services/workoutBridge';

interface UseRestTimerOptions {
  onRestEnd: () => void;
  onRestUpdate: (isResting: boolean, endTime: number) => void;
}

interface UseRestTimerReturn {
  restSeconds: number;
  restTotal: number;
  restExerciseName: string;
  isResting: boolean;
  currentEndTime: number;
  startRestTimer: (seconds: number, exerciseName: string) => void;
  adjustRestTimer: (delta: number, opts?: { fromWidget?: boolean }) => void;
  dismissRest: () => void;
}

export function useRestTimer({ onRestEnd, onRestUpdate }: UseRestTimerOptions): UseRestTimerReturn {
  const [restSeconds, setRestSeconds] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [restExerciseName, setRestExerciseName] = useState('');
  const [isResting, setIsResting] = useState(false);
  const [currentEndTime, setCurrentEndTime] = useState(0);

  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentEndTimeRef = useRef(0);

  // Keep callback refs stable so the interval closure always calls the latest version
  const onRestEndRef = useRef(onRestEnd);
  onRestEndRef.current = onRestEnd;
  const onRestUpdateRef = useRef(onRestUpdate);
  onRestUpdateRef.current = onRestUpdate;

  // ─── Shared cleanup helper ───
  const endRest = useCallback((vibrate: boolean) => {
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
    currentEndTimeRef.current = 0;
    setIsResting(false);
    setCurrentEndTime(0);
    setRestSeconds(0);
    setRestTotal(0);
    setRestExerciseName('');
    cancelTimerEndNotification();
    stopRestTimerActivity();
    onRestEndRef.current();
    if (vibrate) {
      try { Vibration.vibrate([0, 200, 100, 200]); } catch {}
    }
  }, []);

  // ─── Start rest timer ───
  const startRestTimer = useCallback((seconds: number, exerciseName: string) => {
    if (restRef.current) clearInterval(restRef.current);
    const total = seconds;
    setRestTotal(total);
    setRestSeconds(total);
    setRestExerciseName(exerciseName);

    const endTime = Date.now() + total * 1000;
    currentEndTimeRef.current = endTime;
    setIsResting(true);
    setCurrentEndTime(endTime);

    onRestUpdateRef.current(true, endTime);

    // Schedule notification for when timer ends (Fix 1)
    // Routed through serialized queue to prevent race with adjustRestTimerActivity
    scheduleRestNotification(total);

    // Interval computes remaining from absolute endTime (Fix 7+8: aligns with lock screen)
    restRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.round((currentEndTimeRef.current - Date.now()) / 1000));
      setRestSeconds(remaining);

      if (remaining <= 0) {
        endRest(true);
      }
    }, 1000);
  }, [endRest]);

  // ─── Adjust timer (+/-15s) ───
  const adjustRestTimer = useCallback((delta: number, opts?: { fromWidget?: boolean }) => {
    const newEndTime = currentEndTimeRef.current + delta * 1000;
    const remaining = Math.max(0, Math.round((newEndTime - Date.now()) / 1000));

    if (remaining <= 0) {
      // Timer hit zero via adjustment — treat like natural expiry (Fix 4)
      endRest(true);
    } else {
      currentEndTimeRef.current = newEndTime;
      setCurrentEndTime(newEndTime);
      setRestSeconds(remaining);
      setRestTotal((prev) => Math.max(prev + delta, 1));

      // Always update Live Activity from RN — Swift's refreshLiveActivity is a no-op
      // due to cross-target type mismatch. The skipNextLiveActivityUpdate flag in
      // useWidgetBridge prevents the redundant second update from syncWidgetState.
      adjustRestTimerActivity(delta);
      onRestUpdateRef.current(true, newEndTime);
    }
  }, [endRest]);

  // ─── Dismiss/skip rest ───
  const dismissRest = useCallback(() => {
    // Fix 5: call onRestEnd (via endRest) so widget state is synced
    endRest(false);
  }, [endRest]);

  // ─── Resync rest timer on foreground return ───
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && restRef.current !== null) {
        // Fix 2: Read widget-side state (may have been updated by Swift intents while backgrounded)
        const widgetState = getWidgetRestState();

        // If widget says rest was skipped, honor that without vibrating
        if (widgetState && !widgetState.isResting) {
          endRest(false);
          return;
        }

        // Use the widget's end time if available (it reflects +/-15s adjustments)
        const effectiveEndTime = widgetState
          ? Math.max(currentEndTimeRef.current, widgetState.restEndTime)
          : currentEndTimeRef.current;
        currentEndTimeRef.current = effectiveEndTime;
        setCurrentEndTime(effectiveEndTime);

        const remaining = Math.max(0, Math.round((effectiveEndTime - Date.now()) / 1000));

        if (remaining <= 0) {
          // Fix 3: cancelTimerEndNotification is called inside endRest, before vibrating
          endRest(true);
        } else {
          setRestSeconds(remaining);
        }
      }
    });
    return () => subscription.remove();
  }, [endRest]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (restRef.current) clearInterval(restRef.current);
    };
  }, []);

  return {
    restSeconds,
    restTotal,
    restExerciseName,
    isResting,
    currentEndTime,
    startRestTimer,
    adjustRestTimer,
    dismissRest,
  };
}
