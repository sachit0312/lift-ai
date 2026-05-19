import { useRef, useEffect } from 'react';
import * as Sentry from '@sentry/react-native';
import { updateExerciseMachineNotes } from '../services/database';
import { fireAndForgetSync } from '../services/sync';

interface UseNotesDebounceReturn {
  debouncedSaveNotes: (exerciseId: string, notes: string) => void;
  flushPendingNotes: () => Promise<void>;
  clearPendingNotes: () => void;
}

export function useNotesDebounce(): UseNotesDebounceReturn {
  const pendingNotesRef = useRef<Map<string, { notes: string }>>(new Map());
  const notesTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // On unmount: flush pending writes BEFORE cancelling timers, so notes
  // typed within the debounce window aren't lost. Writes are fire-and-forget
  // because the cleanup function cannot be async — SQLite operations resolve
  // on their own and Sentry catches any errors.
  useEffect(() => {
    return () => {
      for (const [exerciseId, { notes }] of pendingNotesRef.current.entries()) {
        updateExerciseMachineNotes(exerciseId, notes || null).catch(e =>
          Sentry.captureException(e),
        );
      }
      // Match the debounce timer path: trigger Supabase sync after note writes.
      if (pendingNotesRef.current.size > 0) {
        fireAndForgetSync();
      }
      pendingNotesRef.current.clear();
      for (const timerId of notesTimerRef.current.values()) {
        clearTimeout(timerId);
      }
      notesTimerRef.current.clear();
    };
  }, []);

  async function flushPendingNotes() {
    for (const timerId of notesTimerRef.current.values()) {
      clearTimeout(timerId);
    }
    notesTimerRef.current.clear();

    const promises: Promise<unknown>[] = [];
    for (const [exerciseId, { notes }] of pendingNotesRef.current.entries()) {
      promises.push(
        updateExerciseMachineNotes(exerciseId, notes || null).catch(e => Sentry.captureException(e))
      );
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

  function debouncedSaveNotes(exerciseId: string, notes: string) {
    pendingNotesRef.current.set(exerciseId, { notes });

    const existing = notesTimerRef.current.get(exerciseId);
    if (existing) clearTimeout(existing);

    const timerId = setTimeout(() => {
      const pending = pendingNotesRef.current.get(exerciseId);
      if (pending) {
        updateExerciseMachineNotes(exerciseId, pending.notes || null).catch(e => Sentry.captureException(e));
        pendingNotesRef.current.delete(exerciseId);
        fireAndForgetSync();
      }
      notesTimerRef.current.delete(exerciseId);
    }, 500);

    notesTimerRef.current.set(exerciseId, timerId);
  }

  return { debouncedSaveNotes, flushPendingNotes, clearPendingNotes };
}
