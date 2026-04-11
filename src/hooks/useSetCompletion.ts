import { useState, useCallback, useRef } from 'react';
import { LayoutAnimation, Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type { ExerciseBlock } from '../types/workout';
import type { UpcomingWorkoutExercise, UpcomingWorkoutSet, Exercise } from '../types/database';
import { updateWorkoutSet, stampExerciseOrder } from '../services/database';
import { calculateE1RM, getPRGatingMargin } from '../utils/oneRepMax';
import type { Workout } from '../types/database';
// ─── Types ───

export interface UseSetCompletionOptions {
  blocksRef: React.MutableRefObject<ExerciseBlock[]>;
  setExerciseBlocks: React.Dispatch<React.SetStateAction<ExerciseBlock[]>>;
  upcomingTargetsRef: React.MutableRefObject<(UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null>;
  prSetIdsRef: React.MutableRefObject<Set<string>>;
  originalBestE1RMRef: React.MutableRefObject<Map<string, number | undefined>>;
  currentBestE1RMRef: React.MutableRefObject<Map<string, number | undefined>>;
  lastActiveBlockRef: React.MutableRefObject<number>;
  workoutRef: React.MutableRefObject<Workout | null>;
  startRestTimer: (seconds: number, exerciseName: string) => void;
  syncWidgetState: (blocks?: ExerciseBlock[], isResting?: boolean, restEnd?: number) => void;
  onConfetti: () => void;
}

export interface UseSetCompletionReturn {
  validationErrors: Record<string, boolean>;
  reorderToast: string | null;
  reorderToastTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  handleToggleComplete: (blockIdx: number, setIdx: number) => void;
}

// ─── Hook ───

export function useSetCompletion(options: UseSetCompletionOptions): UseSetCompletionReturn {
  const {
    blocksRef,
    setExerciseBlocks,
    upcomingTargetsRef,
    prSetIdsRef,
    originalBestE1RMRef,
    currentBestE1RMRef,
    lastActiveBlockRef,
    workoutRef,
    startRestTimer,
    syncWidgetState,
    onConfetti,
  } = options;

  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});
  const [reorderToast, setReorderToast] = useState<string | null>(null);
  const reorderToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // FIX-3: Guard against double-tap.
  // Maps set ID → the is_completed value we're in the middle of toggling TO.
  // Two rapid taps both read is_completed=false from blocksRef (which lags by one
  // render). Without a guard, both would dispatch setExerciseBlocks and call
  // startRestTimer. We bail if a second tap would toggle toward the same target
  // value as an already-pending toggle.
  const pendingCompletionRef = useRef<Map<string, boolean>>(new Map());

  const handleToggleComplete = useCallback((blockIdx: number, setIdx: number) => {
    const block = blocksRef.current[blockIdx];
    let set = block?.sets[setIdx];
    if (!set || !block) return;

    const wouldToggleTo = !set.is_completed;

    // Double-tap guard: prevent two rapid taps from both dispatching state updates.
    //
    // We store the toggled-to value in a Map keyed by set ID. On the next call
    // for the same set, we check whether blocksRef already reflects the expected
    // completed state (meaning the first dispatch has re-rendered). If it does,
    // the guard is stale and we clear it. If it doesn't match yet AND we already
    // have a pending toggle to the same value, bail out.
    const pendingValue = pendingCompletionRef.current.get(set.id);
    if (pendingValue !== undefined) {
      // If blocksRef has caught up (set is now in the toggled state), clear guard
      if (set.is_completed === pendingValue) {
        pendingCompletionRef.current.delete(set.id);
      } else if (pendingValue === wouldToggleTo) {
        // Still pending same toggle — bail (double-tap)
        return;
      }
    }
    pendingCompletionRef.current.set(set.id, wouldToggleTo);

    // Capture timer data NOW, before state update (avoid stale closure)
    const { restEnabled, restSeconds: blockRestSeconds, exercise } = block;
    const exerciseName = exercise.name;

    // Auto-fill empty weight/reps from target or previous values on completion
    if (!set.is_completed) {
      let weightFilled = set.weight;
      let repsFilled = set.reps;
      let rpeFilled = set.rpe;

      const target = upcomingTargetsRef.current
        ?.find(e => e.exercise_id === block.exercise.id)
        ?.sets?.find(s => s.set_number === set.set_number);

      if (!weightFilled.trim()) {
        if (target?.target_weight != null) weightFilled = String(target.target_weight);
        else if (set.previous?.weight != null) weightFilled = String(set.previous.weight);
      }
      if (!repsFilled.trim()) {
        if (target?.target_reps != null) repsFilled = String(target.target_reps);
        else if (set.previous?.reps != null) repsFilled = String(set.previous.reps);
      }
      if (!rpeFilled.trim() && set.tag !== 'warmup' && set.tag !== 'failure') {
        if (target?.target_rpe != null) rpeFilled = String(target.target_rpe);
      }

      if (weightFilled !== set.weight || repsFilled !== set.reps || rpeFilled !== set.rpe) {
        set = { ...set, weight: weightFilled, reps: repsFilled, rpe: rpeFilled };
      }
    }

    // Validate when marking complete (not when unchecking)
    if (!set.is_completed && (!set.weight.trim() || !set.reps.trim())) {
      const errorKey = `${blockIdx}-${setIdx}`;
      setValidationErrors(prev => ({ ...prev, [errorKey]: true }));
      // Clear error after 2 seconds
      setTimeout(() => {
        setValidationErrors(prev => {
          const { [errorKey]: _, ...rest } = prev;
          return rest;
        });
      }, 2000);
      // Release the double-tap guard so the user can re-try after fixing inputs
      pendingCompletionRef.current.delete(set.id);
      return;

    }

    const newCompleted = !set.is_completed;

    // Pre-compute reorder decision using blocksRef (safe: hasn't re-rendered yet)
    let shouldReorder = false;
    let reorderInsertIdx = 0;
    if (newCompleted) {
      const prevCompletedCount = block.sets.filter(s => s.is_completed).length;
      if (prevCompletedCount === 0) {
        const blocks = blocksRef.current;
        let preCheckCompleted = 0;
        for (const b of blocks) {
          if (b.sets.every(s => s.is_completed)) preCheckCompleted++;
          else break;
        }
        const preCheckIdx = blocks.findIndex(b => b.exercise.id === block.exercise.id);
        if (preCheckIdx > preCheckCompleted) {
          shouldReorder = true;
          reorderInsertIdx = preCheckCompleted;
        }
      }
    }

    // Pre-compute PR result (pure CPU, ~0.1ms)
    // Read bestE1RM from ref (always in sync) rather than blocksRef (may lag behind render)
    let isPR = false;
    let newBestE1RM: number | undefined;
    if (newCompleted) {
      const w = Number(set.weight), r = Number(set.reps);
      const rpe = set.tag === 'failure' ? 10 : (set.rpe ? Number(set.rpe) : null);
      if (w > 0 && r > 0) {
        const result = calculateE1RM(w, r, rpe);
        const bestE1RM = currentBestE1RMRef.current.get(block.exercise.id);
        const gatingMargin = getPRGatingMargin(result.confidence);
        const threshold = bestE1RM != null ? bestE1RM * (1 + gatingMargin) : 0;
        if (bestE1RM != null && result.value > threshold) {
          isPR = true;
          newBestE1RM = result.value;
        }
      }
    }

    // Single coalesced state update: completion + auto-fill + reorder + PR bestE1RM
    if (shouldReorder) {
      LayoutAnimation.configureNext({
        duration: 250,
        update: { type: LayoutAnimation.Types.easeInEaseOut },
      });
    }

    setExerciseBlocks((prev) => {
      const next = [...prev];
      // 1. Apply completion + auto-fill
      const updatedBlock = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      updatedBlock.sets[setIdx] = {
        ...updatedBlock.sets[setIdx],
        weight: set.weight,
        reps: set.reps,
        rpe: set.rpe,
        is_completed: newCompleted,
      };
      next[blockIdx] = updatedBlock;

      // 2. Apply reorder (if needed)
      if (shouldReorder) {
        const currentIdx = next.findIndex(b => b.exercise.id === block.exercise.id);
        if (currentIdx > reorderInsertIdx) {
          const [moved] = next.splice(currentIdx, 1);
          next.splice(reorderInsertIdx, 0, moved);
        }
      }

      // 3. Apply PR bestE1RM update (if needed)
      if (isPR && newBestE1RM != null) {
        const prIdx = next.findIndex(b => b.exercise.id === block.exercise.id);
        if (prIdx >= 0) next[prIdx] = { ...next[prIdx], bestE1RM: newBestE1RM };
      }

      // 4. Un-complete: revert bestE1RM if this was a PR set
      if (!newCompleted && prSetIdsRef.current.has(set.id)) {
        const originalBest = originalBestE1RMRef.current.get(block.exercise.id);
        const idx = next.findIndex(b => b.exercise.id === block.exercise.id);
        if (idx >= 0) next[idx] = { ...next[idx], bestE1RM: originalBest };
      }

      return next;
    });

    // Note: pendingCompletionRef entry is intentionally NOT deleted here.
    // It will be cleared on the next handleToggleComplete call for this set,
    // once blocksRef.current reflects the updated is_completed state (post re-render).

    // Persist auto-reorder to DB so reload preserves the new sequence.
    // Without this, exercise_order rows would still reflect the original
    // insert-time plan order, and loadActiveWorkout would revert visually
    // after a tab switch or app relaunch.
    // NOTE: blocksRef.current still holds the PRE-UPDATE list here (ref-sync
    // useEffect hasn't fired yet), so we apply the same splice to a local copy
    // to derive the correct post-reorder layout.
    if (shouldReorder && workoutRef.current) {
      const workoutId = workoutRef.current.id;
      const preBlocks = blocksRef.current;
      const reordered = [...preBlocks];
      const currentIdx = reordered.findIndex(b => b.exercise.id === block.exercise.id);
      if (currentIdx > reorderInsertIdx) {
        const [moved] = reordered.splice(currentIdx, 1);
        reordered.splice(reorderInsertIdx, 0, moved);
      }
      const entries: Array<{ id: string; order: number }> = [];
      reordered.forEach((b, idx) => {
        for (const s of b.sets) {
          entries.push({ id: s.id, order: idx + 1 });
        }
      });
      stampExerciseOrder(workoutId, entries).catch(e => Sentry.captureException(e));
    }

    // DB write (fire-and-forget)
    updateWorkoutSet(set.id, {
      is_completed: newCompleted,
      weight: set.weight === '' ? null : Number(set.weight),
      reps: set.reps === '' ? null : Number(set.reps),
      rpe: set.rpe === '' ? null : Number(set.rpe),
    }).catch(e => Sentry.captureException(e));

    // Side effects after single state update
    if (newCompleted) {
      lastActiveBlockRef.current = shouldReorder ? reorderInsertIdx : blockIdx;

      // Reorder toast
      if (shouldReorder) {
        if (reorderToastTimer.current) clearTimeout(reorderToastTimer.current);
        setReorderToast(block.exercise.name);
        reorderToastTimer.current = setTimeout(() => setReorderToast(null), 2000);
      }

      // PR ref tracking + haptics
      if (isPR && newBestE1RM != null) {
        prSetIdsRef.current = new Set(prSetIdsRef.current).add(set.id);
        currentBestE1RMRef.current.set(block.exercise.id, newBestE1RM);
        try { Vibration.vibrate([0, 80, 40, 80]); } catch {}
        try { onConfetti(); } catch {}
      } else {
        try { Vibration.vibrate(50); } catch {}
      }

      // Rest timer or widget sync
      if (restEnabled) {
        startRestTimer(blockRestSeconds, exerciseName);
      } else {
        syncWidgetState();
      }
    } else {
      // Un-completing: clear PR badge if present and revert bestE1RM ref
      if (prSetIdsRef.current.has(set.id)) {
        const updated = new Set(prSetIdsRef.current);
        updated.delete(set.id);
        prSetIdsRef.current = updated;
        const originalBest = originalBestE1RMRef.current.get(block.exercise.id);
        currentBestE1RMRef.current.set(block.exercise.id, originalBest);
      }
      syncWidgetState();
    }
  }, [blocksRef, setExerciseBlocks, upcomingTargetsRef, prSetIdsRef, originalBestE1RMRef, currentBestE1RMRef, lastActiveBlockRef, workoutRef, startRestTimer, syncWidgetState, onConfetti]);

  return {
    validationErrors,
    reorderToast,
    reorderToastTimer,
    handleToggleComplete,
  };
}
