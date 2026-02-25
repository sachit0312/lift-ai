import { useRef, useEffect } from 'react';
import * as Sentry from '@sentry/react-native';
import { updateExerciseNotes, updateWorkoutSet } from '../services/database';
import { syncToSupabase } from '../services/sync';

interface UseNotesDebounceReturn {
  debouncedSaveNotes: (exerciseId: string, notes: string, setId: string | null) => void;
  flushPendingNotes: () => Promise<void>;
  clearPendingNotes: () => void;
}

export function useNotesDebounce(): UseNotesDebounceReturn {
  const pendingNotesRef = useRef<Map<string, { notes: string; setId: string | null }>>(new Map());
  const notesTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      for (const timerId of notesTimerRef.current.values()) {
        clearTimeout(timerId);
      }
    };
  }, []);

  async function flushPendingNotes() {
    for (const timerId of notesTimerRef.current.values()) {
      clearTimeout(timerId);
    }
    notesTimerRef.current.clear();

    const promises: Promise<unknown>[] = [];
    for (const [exerciseId, { notes, setId }] of pendingNotesRef.current.entries()) {
      promises.push(
        updateExerciseNotes(exerciseId, notes || null).catch(e => Sentry.captureException(e))
      );
      if (setId) {
        promises.push(
          updateWorkoutSet(setId, { notes }).catch(e => Sentry.captureException(e))
        );
      }
    }
    await Promise.allSettled(promises);
    pendingNotesRef.current.clear();
  }

  function clearPendingNotes() {
    for (const timerId of notesTimerRef.current.values()) {
      clearTimeout(timerId);
    }
    notesTimerRef.current.clear();
    pendingNotesRef.current.clear();
  }

  function debouncedSaveNotes(exerciseId: string, notes: string, setId: string | null) {
    pendingNotesRef.current.set(exerciseId, { notes, setId });

    const existing = notesTimerRef.current.get(exerciseId);
    if (existing) clearTimeout(existing);

    const timerId = setTimeout(() => {
      const pending = pendingNotesRef.current.get(exerciseId);
      if (pending) {
        updateExerciseNotes(exerciseId, pending.notes || null);
        if (pending.setId) {
          updateWorkoutSet(pending.setId, { notes: pending.notes });
        }
        pendingNotesRef.current.delete(exerciseId);
        syncToSupabase().catch(e => Sentry.addBreadcrumb({ category: 'sync', message: 'syncToSupabase fire-and-forget failed', level: 'warning', data: { error: String(e) } }));
      }
      notesTimerRef.current.delete(exerciseId);
    }, 500);

    notesTimerRef.current.set(exerciseId, timerId);
  }

  return { debouncedSaveNotes, flushPendingNotes, clearPendingNotes };
}
