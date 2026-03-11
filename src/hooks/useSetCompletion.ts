import { useState, useCallback, useRef } from 'react';
import { LayoutAnimation, Vibration } from 'react-native';
import type { ExerciseBlock } from '../types/workout';
import type { UpcomingWorkoutExercise, UpcomingWorkoutSet, Exercise } from '../types/database';
import { updateWorkoutSet } from '../services/database';
import { calculateE1RM, getPRGatingMargin } from '../utils/oneRepMax';
import type ConfettiCannon from 'react-native-confetti-cannon';

// ─── Types ───

export interface UseSetCompletionOptions {
  blocksRef: React.MutableRefObject<ExerciseBlock[]>;
  setExerciseBlocks: React.Dispatch<React.SetStateAction<ExerciseBlock[]>>;
  upcomingTargetsRef: React.MutableRefObject<(UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null>;
  prSetIdsRef: React.MutableRefObject<Set<string>>;
  originalBestE1RMRef: React.MutableRefObject<Map<string, number | undefined>>;
  lastActiveBlockRef: React.MutableRefObject<number>;
  startRestTimer: (seconds: number, exerciseName: string) => void;
  syncWidgetState: (blocks?: ExerciseBlock[], isResting?: boolean, restEnd?: number) => void;
  confettiRef: React.MutableRefObject<ConfettiCannon | null>;
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
    lastActiveBlockRef,
    startRestTimer,
    syncWidgetState,
    confettiRef,
  } = options;

  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});
  const [reorderToast, setReorderToast] = useState<string | null>(null);
  const reorderToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleToggleComplete = useCallback((blockIdx: number, setIdx: number) => {
    const block = blocksRef.current[blockIdx];
    let set = block?.sets[setIdx];
    if (!set || !block) return;

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
      return;
    }

    const newCompleted = !set.is_completed;

    // Batch auto-fill + completion toggle into a single state update
    setExerciseBlocks((prev) => {
      const next = [...prev];
      const updatedBlock = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
      updatedBlock.sets[setIdx] = {
        ...updatedBlock.sets[setIdx],
        weight: set.weight,
        reps: set.reps,
        rpe: set.rpe,
        is_completed: newCompleted,
      };
      next[blockIdx] = updatedBlock;
      return next;
    });

    updateWorkoutSet(set.id, {
      is_completed: newCompleted,
      weight: set.weight === '' ? null : Number(set.weight),
      reps: set.reps === '' ? null : Number(set.reps),
      rpe: set.rpe === '' ? null : Number(set.rpe),
    });

    if (newCompleted) {
      // Default: track this block as active
      lastActiveBlockRef.current = blockIdx;

      // Auto-reorder: move exercise to top of incomplete on first set completion
      const prevCompletedCount = block.sets.filter(s => s.is_completed).length;
      if (prevCompletedCount === 0) {
        // Pre-check using blocksRef (safe: hasn't re-rendered yet)
        const blocks = blocksRef.current;
        let preCheckCompleted = 0;
        for (const b of blocks) {
          if (b.sets.every(s => s.is_completed)) preCheckCompleted++;
          else break;
        }
        const preCheckIdx = blocks.findIndex(b => b.exercise.id === block.exercise.id);
        if (preCheckIdx > preCheckCompleted) {
          let didReorder = false;
          setExerciseBlocks((prev) => {
            let completedBlockCount = 0;
            for (const b of prev) {
              if (b.sets.every(s => s.is_completed)) completedBlockCount++;
              else break;
            }
            const currentIdx = prev.findIndex(b => b.exercise.id === block.exercise.id);
            if (currentIdx > completedBlockCount) {
              didReorder = true;
              LayoutAnimation.configureNext({
                duration: 250,
                update: { type: LayoutAnimation.Types.easeInEaseOut },
              });
              const next = [...prev];
              const [moved] = next.splice(currentIdx, 1);
              next.splice(completedBlockCount, 0, moved);
              return next;
            }
            return prev;
          });
          if (didReorder) {
            lastActiveBlockRef.current = preCheckCompleted;
            // Show reorder feedback toast (no extra vibrate — set completion haptic fires below)
            if (reorderToastTimer.current) clearTimeout(reorderToastTimer.current);
            setReorderToast(block.exercise.name);
            reorderToastTimer.current = setTimeout(() => setReorderToast(null), 2000);
          }
        }
      }

      // PR check — compare estimated 1RM against cached best (confidence-gated)
      const w = Number(set.weight), r = Number(set.reps);
      const rpe = set.tag === 'failure' ? 10 : (set.rpe ? Number(set.rpe) : null);
      if (w > 0 && r > 0) {
        const result = calculateE1RM(w, r, rpe);
        const bestE1RM = block.bestE1RM;
        const gatingMargin = getPRGatingMargin(result.confidence);
        const threshold = bestE1RM != null ? bestE1RM * (1 + gatingMargin) : 0;
        if (bestE1RM != null && result.value > threshold) {
          const updated = new Set(prSetIdsRef.current).add(set.id);
          prSetIdsRef.current = updated;
          setExerciseBlocks(prev => {
            const next = [...prev];
            const prIdx = next.findIndex(b => b.exercise.id === block.exercise.id);
            if (prIdx >= 0) next[prIdx] = { ...next[prIdx], bestE1RM: result.value };
            return next;
          });
          try { Vibration.vibrate([0, 80, 40, 80]); } catch {}
          try { confettiRef.current?.start(); } catch {}
        } else {
          try { Vibration.vibrate(50); } catch {}
        }
      } else {
        try { Vibration.vibrate(50); } catch {}
      }
      // Use captured values, not stale state
      if (restEnabled) {
        startRestTimer(blockRestSeconds, exerciseName);
      } else {
        // Sync widget to show next set
        syncWidgetState();
      }
    } else {
      // Un-completing a set: clear PR badge if present and revert bestE1RM
      if (prSetIdsRef.current.has(set.id)) {
        const updated = new Set(prSetIdsRef.current);
        updated.delete(set.id);
        prSetIdsRef.current = updated;
        // Synchronously revert bestE1RM from cached original (avoids race condition)
        const originalBest = originalBestE1RMRef.current.get(block.exercise.id);
        setExerciseBlocks(prev => {
          const next = [...prev];
          const idx = next.findIndex(b => b.exercise.id === block.exercise.id);
          if (idx >= 0) next[idx] = { ...next[idx], bestE1RM: originalBest };
          return next;
        });
      }
      syncWidgetState();
    }
  }, [blocksRef, setExerciseBlocks, upcomingTargetsRef, prSetIdsRef, originalBestE1RMRef, lastActiveBlockRef, startRestTimer, syncWidgetState, confettiRef]);

  return {
    validationErrors,
    reorderToast,
    reorderToastTimer,
    handleToggleComplete,
  };
}
