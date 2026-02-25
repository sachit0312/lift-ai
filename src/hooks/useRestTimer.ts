import { useState, useRef, useEffect, useCallback } from 'react';
import { AppState, Vibration } from 'react-native';
import {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  getRestTimerRemainingSeconds,
} from '../services/liveActivity';

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
  adjustRestTimer: (delta: number) => void;
  dismissRest: () => void;
}

export function useRestTimer({ onRestEnd, onRestUpdate }: UseRestTimerOptions): UseRestTimerReturn {
  const [restSeconds, setRestSeconds] = useState(0);
  const [restTotal, setRestTotal] = useState(0);
  const [restExerciseName, setRestExerciseName] = useState('');

  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentEndTimeRef = useRef(0);

  // Keep callback refs stable so the interval closure always calls the latest version
  const onRestEndRef = useRef(onRestEnd);
  onRestEndRef.current = onRestEnd;
  const onRestUpdateRef = useRef(onRestUpdate);
  onRestUpdateRef.current = onRestUpdate;

  const startRestTimer = useCallback((seconds: number, exerciseName: string) => {
    if (restRef.current) clearInterval(restRef.current);
    const total = seconds;
    setRestTotal(total);
    setRestSeconds(total);
    setRestExerciseName(exerciseName);

    const endTime = Date.now() + total * 1000;
    currentEndTimeRef.current = endTime;

    onRestUpdateRef.current(true, endTime);

    restRef.current = setInterval(() => {
      setRestSeconds((prev) => {
        if (prev <= 1) {
          if (restRef.current) clearInterval(restRef.current);
          restRef.current = null;
          currentEndTimeRef.current = 0;
          stopRestTimerActivity();
          onRestEndRef.current();
          try { Vibration.vibrate([0, 200, 100, 200]); } catch {}
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const adjustRestTimer = useCallback((delta: number) => {
    setRestSeconds((prev) => {
      const next = Math.max(0, prev + delta);
      if (next === 0 && restRef.current) {
        clearInterval(restRef.current);
        restRef.current = null;
      }
      return next;
    });
    setRestTotal((prev) => Math.max(prev + delta, 1));

    currentEndTimeRef.current += delta * 1000;

    adjustRestTimerActivity(delta);

    onRestUpdateRef.current(true, currentEndTimeRef.current);
  }, []);

  const dismissRest = useCallback(() => {
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
    setRestSeconds(0);
    currentEndTimeRef.current = 0;

    stopRestTimerActivity();
  }, []);

  // Resync rest timer on foreground return
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && restRef.current !== null) {
        const remaining = getRestTimerRemainingSeconds();
        if (remaining === null || remaining <= 0) {
          if (restRef.current) clearInterval(restRef.current);
          restRef.current = null;
          currentEndTimeRef.current = 0;
          setRestSeconds(0);
          stopRestTimerActivity();
          onRestEndRef.current();
          try { Vibration.vibrate([0, 200, 100, 200]); } catch {}
        } else {
          setRestSeconds(remaining);
        }
      }
    });
    return () => subscription.remove();
  }, []);

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
    isResting: restRef.current !== null,
    currentEndTime: currentEndTimeRef.current,
    startRestTimer,
    adjustRestTimer,
    dismissRest,
  };
}
