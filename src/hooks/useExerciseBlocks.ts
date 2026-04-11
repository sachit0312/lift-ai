import { useState, useCallback, useRef } from 'react';
import { Alert, LayoutAnimation, Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import type { ExerciseBlock, LocalSet } from '../types/workout';
import type { SetTag } from '../types/database';
import type { Workout } from '../types/database';
import {
  addWorkoutSet,
  updateWorkoutSet,
  deleteWorkoutSet,
} from '../services/database';
import { getExerciseHistoryData } from '../utils/exerciseHistory';

// ─── Types ───

export interface UseExerciseBlocksOptions {
  workoutRef: React.MutableRefObject<Workout | null>;
  blocksRef: React.MutableRefObject<ExerciseBlock[]>;
  lastActiveBlockRef: React.MutableRefObject<number>;
  debouncedSaveNotes: (exerciseId: string, notes: string) => void;
}

export interface UseExerciseBlocksReturn {
  exerciseBlocks: ExerciseBlock[];
  setExerciseBlocks: React.Dispatch<React.SetStateAction<ExerciseBlock[]>>;
  originalBestE1RMRef: React.MutableRefObject<Map<string, number | undefined>>;
  currentBestE1RMRef: React.MutableRefObject<Map<string, number | undefined>>;
  prSetIdsRef: React.MutableRefObject<Set<string>>;
  flushPendingSetWrites: () => void;
  clearPendingSetWrites: () => void;
  handleSetChange: (blockIdx: number, setIdx: number, field: 'weight' | 'reps' | 'rpe', value: string) => void;
  handleCycleTag: (blockIdx: number, setIdx: number) => void;
  handleAddSet: (blockIdx: number) => Promise<void>;
  handleDeleteSet: (blockIdx: number, setIdx: number) => Promise<void>;
  handleToggleMachineNotes: (blockIdx: number) => void;
  handleToggleRestTimer: (blockIdx: number) => void;
  handleAdjustExerciseRest: (blockIdx: number, delta: number) => void;
  handleMachineNotesChange: (blockIdx: number, text: string) => void;
  handleRemoveExercise: (blockIdx: number) => void;
}

// ─── Hook ───

export function useExerciseBlocks(options: UseExerciseBlocksOptions): UseExerciseBlocksReturn {
  const { workoutRef, blocksRef, lastActiveBlockRef, debouncedSaveNotes } = options;

  const [exerciseBlocks, setExerciseBlocks] = useState<ExerciseBlock[]>([]);
  const originalBestE1RMRef = useRef<Map<string, number | undefined>>(new Map());
  // Tracks the current (possibly PR-updated) bestE1RM per exercise — always in sync, unlike blocksRef
  const currentBestE1RMRef = useRef<Map<string, number | undefined>>(new Map());
  const prSetIdsRef = useRef<Set<string>>(new Set());

  // Debounced DB writes for set input changes (weight/reps/RPE)
  const pendingSetWritesRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; data: Record<string, unknown> }>>(new Map());

  // Keep ref in sync
  blocksRef.current = exerciseBlocks;

  // ─── Immutable update helpers ───

  const updateBlock = useCallback((blockIdx: number, updater: (block: ExerciseBlock) => ExerciseBlock) => {
    setExerciseBlocks((prev) => {
      const next = [...prev];
      next[blockIdx] = updater(next[blockIdx]);
      return next;
    });
  }, []);

  const updateBlockSets = useCallback((blockIdx: number, setsUpdater: (sets: LocalSet[]) => LocalSet[]) => {
    setExerciseBlocks((prev) => {
      const next = [...prev];
      next[blockIdx] = { ...next[blockIdx], sets: setsUpdater([...next[blockIdx].sets]) };
      return next;
    });
  }, []);

  // ─── Debounced DB write helpers ───

  const flushPendingSetWrites = useCallback(() => {
    for (const [setId, entry] of pendingSetWritesRef.current) {
      clearTimeout(entry.timer);
      updateWorkoutSet(setId, entry.data).catch(e => Sentry.captureException(e));
    }
    pendingSetWritesRef.current.clear();
  }, []);

  const clearPendingSetWrites = useCallback(() => {
    for (const entry of pendingSetWritesRef.current.values()) {
      clearTimeout(entry.timer);
    }
    pendingSetWritesRef.current.clear();
  }, []);

  // ─── Handlers ───

  const handleSetChange = useCallback((
    blockIdx: number,
    setIdx: number,
    field: 'weight' | 'reps' | 'rpe',
    value: string,
  ) => {
    lastActiveBlockRef.current = blockIdx;
    const block = blocksRef.current[blockIdx];
    const set = block?.sets[setIdx];
    if (!set) return;

    // Guard: RPE is not editable for warmup or failure sets
    if (field === 'rpe' && (set.tag === 'warmup' || set.tag === 'failure')) return;

    // Immediate state update for responsive UI
    updateBlockSets(blockIdx, (sets) => {
      sets[setIdx] = { ...sets[setIdx], [field]: value };
      return sets;
    });

    // Debounced DB write (300ms) — coalesces rapid keystrokes
    const numVal = value === '' ? null : Number(value);
    const pending = pendingSetWritesRef.current.get(set.id);
    if (pending) {
      clearTimeout(pending.timer);
      pending.data[field] = numVal;
      pending.timer = setTimeout(() => {
        updateWorkoutSet(set.id, pending.data).catch(e => Sentry.captureException(e));
        pendingSetWritesRef.current.delete(set.id);
      }, 300);
    } else {
      const data: Record<string, unknown> = { [field]: numVal };
      const timer = setTimeout(() => {
        updateWorkoutSet(set.id, data).catch(e => Sentry.captureException(e));
        pendingSetWritesRef.current.delete(set.id);
      }, 300);
      pendingSetWritesRef.current.set(set.id, { timer, data });
    }
  }, [lastActiveBlockRef, updateBlockSets]);

  const handleCycleTag = useCallback((blockIdx: number, setIdx: number) => {
    const block = blocksRef.current[blockIdx];
    const set = block?.sets[setIdx];
    if (!set) return;

    const tags: SetTag[] = ['working', 'warmup', 'failure', 'drop'];
    const idx = tags.indexOf(set.tag);
    const newTag = tags[(idx + 1) % tags.length];

    // Compute RPE side-effect based on new tag
    const rpeUpdate: Record<string, string | undefined> = {};
    const dbUpdate: Record<string, unknown> = { tag: newTag };
    if (newTag === 'warmup') {
      rpeUpdate.rpe = '';
      dbUpdate.rpe = null;
    } else if (newTag === 'failure') {
      rpeUpdate.rpe = '';
      dbUpdate.rpe = null;
    }

    updateBlockSets(blockIdx, (sets) => {
      sets[setIdx] = { ...sets[setIdx], tag: newTag, ...rpeUpdate };
      return sets;
    });

    updateWorkoutSet(set.id, dbUpdate).catch(e => Sentry.captureException(e));
  }, [updateBlockSets]);

  const handleAddSet = useCallback(async (blockIdx: number) => {
    const workout = workoutRef.current;
    if (!workout) return;

    const block = blocksRef.current[blockIdx];
    if (!block) return;

    const exerciseId = block.exercise.id;
    const newSetNumber = block.sets.length + 1;
    const blockExerciseOrder = block.sets[0]?.exercise_order ?? 0;

    const { previousSets } = await getExerciseHistoryData(exerciseId);
    const ws = await addWorkoutSet({
      workout_id: workout.id,
      exercise_id: exerciseId,
      set_number: newSetNumber,
      reps: null,
      weight: null,
      tag: 'working',
      rpe: null,
      is_completed: false,
      notes: null,
      exercise_order: blockExerciseOrder,
    });

    updateBlockSets(blockIdx, (sets) => {
      sets.push({
        id: ws.id,
        exercise_id: exerciseId,
        set_number: newSetNumber,
        weight: '',
        reps: '',
        rpe: '',
        tag: 'working',
        is_completed: false,
        exercise_order: blockExerciseOrder,
        previous: previousSets[newSetNumber - 1] ?? null,
      });
      return sets;
    });
  }, [workoutRef, updateBlockSets]);

  const handleDeleteSet = useCallback(async (blockIdx: number, setIdx: number) => {
    const block = blocksRef.current[blockIdx];
    const set = block?.sets[setIdx];
    if (!set) return;

    // Don't allow deleting the last set
    if (block.sets.length <= 1) return;

    // Cancel any pending debounced write for this set
    const pendingWrite = pendingSetWritesRef.current.get(set.id);
    if (pendingWrite) {
      clearTimeout(pendingWrite.timer);
      pendingSetWritesRef.current.delete(set.id);
    }

    // Clear PR badge if deleting a PR set and revert bestE1RM
    if (prSetIdsRef.current.has(set.id)) {
      const updated = new Set(prSetIdsRef.current);
      updated.delete(set.id);
      prSetIdsRef.current = updated;
      // Synchronously revert bestE1RM from cached original
      const originalBest = originalBestE1RMRef.current.get(block.exercise.id);
      currentBestE1RMRef.current.set(block.exercise.id, originalBest);
      setExerciseBlocks(prev => {
        const next = [...prev];
        const idx = next.findIndex(b => b.exercise.id === block.exercise.id);
        if (idx >= 0) next[idx] = { ...next[idx], bestE1RM: originalBest };
        return next;
      });
    }

    Vibration.vibrate(10);
    await deleteWorkoutSet(set.id);
    LayoutAnimation.configureNext({
      duration: 250,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });

    // Compute remaining sets before state update for DB persistence
    const remainingSets = block.sets.filter((_, i) => i !== setIdx);

    updateBlockSets(blockIdx, (sets) => {
      sets.splice(setIdx, 1);
      // Renumber
      sets.forEach((s, i) => { s.set_number = i + 1; });
      return sets;
    });

    // Persist renumbered set_numbers to SQLite
    for (let i = 0; i < remainingSets.length; i++) {
      await updateWorkoutSet(remainingSets[i].id, { set_number: i + 1 });
    }
  }, [updateBlockSets]);

  const handleToggleMachineNotes = useCallback((blockIdx: number) => {
    updateBlock(blockIdx, (block) => ({ ...block, machineNotesExpanded: !block.machineNotesExpanded }));
  }, [updateBlock]);

  const handleToggleRestTimer = useCallback((blockIdx: number) => {
    updateBlock(blockIdx, (block) => ({ ...block, restEnabled: !block.restEnabled }));
  }, [updateBlock]);

  const handleAdjustExerciseRest = useCallback((blockIdx: number, delta: number) => {
    updateBlock(blockIdx, (block) => {
      const newSeconds = Math.max(15, block.restSeconds + delta);
      // If adjusting, also ensure timer is enabled
      return { ...block, restSeconds: newSeconds, restEnabled: true };
    });
  }, [updateBlock]);

  const handleMachineNotesChange = useCallback((blockIdx: number, text: string) => {
    const block = blocksRef.current[blockIdx];
    if (!block) return;

    updateBlock(blockIdx, (b) => ({ ...b, machineNotes: text }));

    // Debounced persist to exercise machine notes
    debouncedSaveNotes(block.exercise.id, text);
  }, [updateBlock, debouncedSaveNotes]);

  const handleRemoveExercise = useCallback(async (blockIdx: number) => {
    const block = blocksRef.current[blockIdx];
    if (!block) return;

    Alert.alert(
      `Remove ${block.exercise.name}?`,
      'This will delete all sets for this exercise.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            // Re-read from ref at onPress time for latest set IDs
            const currentBlock = blocksRef.current[blockIdx];
            const setsToDelete = currentBlock ? currentBlock.sets : block.sets;
            // Clean up PR state for any PR sets in this block
            const prIdsToRemove = setsToDelete.filter(s => prSetIdsRef.current.has(s.id));
            if (prIdsToRemove.length > 0) {
              const updated = new Set(prSetIdsRef.current);
              prIdsToRemove.forEach(s => updated.delete(s.id));
              prSetIdsRef.current = updated;
            }
            // Clean up e1RM caches for the removed exercise
            originalBestE1RMRef.current.delete(block.exercise.id);
            currentBestE1RMRef.current.delete(block.exercise.id);
            for (const set of setsToDelete) {
              await deleteWorkoutSet(set.id);
            }
            LayoutAnimation.configureNext({
              duration: 300,
              update: { type: LayoutAnimation.Types.easeInEaseOut },
              delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
            });
            setExerciseBlocks((prev) => prev.filter((_, idx) => idx !== blockIdx));
          },
        },
      ],
    );
  }, []);

  return {
    exerciseBlocks,
    setExerciseBlocks,
    originalBestE1RMRef,
    currentBestE1RMRef,
    prSetIdsRef,
    flushPendingSetWrites,
    clearPendingSetWrites,
    handleSetChange,
    handleCycleTag,
    handleAddSet,
    handleDeleteSet,
    handleToggleMachineNotes,
    handleToggleRestTimer,
    handleAdjustExerciseRest,
    handleMachineNotesChange,
    handleRemoveExercise,
  };
}
