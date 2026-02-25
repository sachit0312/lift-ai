import { useRef, useCallback } from 'react';
import { Vibration } from 'react-native';
import * as Sentry from '@sentry/react-native';
import {
  syncStateToWidget,
  startPolling,
  type WidgetState,
  type WidgetAction,
} from '../services/workoutBridge';
import {
  updateWorkoutActivityForSet,
  updateWorkoutActivityForRest,
} from '../services/liveActivity';
import { updateWorkoutSet } from '../services/database';
import type { Exercise, Workout, WorkoutSet, SetTag } from '../types/database';
import type { UpcomingWorkoutExercise, UpcomingWorkoutSet } from '../types/database';
import type { LocalSet, ExerciseBlock } from '../types/workout';

export type { LocalSet, ExerciseBlock } from '../types/workout';

export interface UseWidgetBridgeOptions {
  blocksRef: React.MutableRefObject<ExerciseBlock[]>;
  workoutRef: React.MutableRefObject<Workout | null>;
  upcomingTargets: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[] | null;
  isResting: boolean;
  restEndTime: number;
  onCompleteSet: (blockIdx: number, setIdx: number, weight: number, reps: number) => void;
  onDismissRest: () => void;
  onAdjustRest: (delta: number) => void;
  onStartRest: (seconds: number, exerciseName: string) => void;
  setExerciseBlocks: React.Dispatch<React.SetStateAction<ExerciseBlock[]>>;
}

export interface UseWidgetBridgeReturn {
  lastActiveBlockRef: React.MutableRefObject<number>;
  buildWidgetState: (blocks: ExerciseBlock[], isResting: boolean, restEnd: number, preferBlockIdx?: number) => WidgetState;
  syncWidgetState: (blocks?: ExerciseBlock[], isResting?: boolean, restEnd?: number) => void;
  handleWidgetActions: (actions: WidgetAction[]) => void;
  startWidgetPolling: () => void;
}

// ─── Hook ───

export function useWidgetBridge(options: UseWidgetBridgeOptions): UseWidgetBridgeReturn {
  const {
    blocksRef,
    workoutRef,
    upcomingTargets,
    isResting,
    restEndTime,
    onDismissRest,
    onAdjustRest,
    onStartRest,
    setExerciseBlocks,
  } = options;

  const lastActiveBlockRef = useRef(0);

  // Capture latest values in refs for stable callbacks
  const upcomingTargetsRef = useRef(upcomingTargets);
  upcomingTargetsRef.current = upcomingTargets;

  const isRestingRef = useRef(isResting);
  isRestingRef.current = isResting;

  const restEndTimeRef = useRef(restEndTime);
  restEndTimeRef.current = restEndTime;

  const buildWidgetState = useCallback(
    (blocks: ExerciseBlock[], isRestingArg: boolean, restEnd: number, preferBlockIdx?: number): WidgetState => {
      const targets = upcomingTargetsRef.current;

      // Find first incomplete set, starting from the last-active block (wrap around)
      let currentBlockIdx = -1;
      let currentSetIdx = -1;

      const startIdx = (preferBlockIdx != null && preferBlockIdx >= 0 && preferBlockIdx < blocks.length)
        ? preferBlockIdx : 0;

      for (let i = 0; i < blocks.length; i++) {
        const bi = (startIdx + i) % blocks.length;
        for (let si = 0; si < blocks[bi].sets.length; si++) {
          if (!blocks[bi].sets[si].is_completed) {
            currentBlockIdx = bi;
            currentSetIdx = si;
            break;
          }
        }
        if (currentBlockIdx >= 0) break;
      }

      // If all sets complete, use last block with sets
      if (currentBlockIdx < 0 && blocks.length > 0) {
        for (let i = blocks.length - 1; i >= 0; i--) {
          if (blocks[i].sets.length > 0) {
            currentBlockIdx = i;
            currentSetIdx = blocks[i].sets.length - 1;
            break;
          }
        }
        // Fallback if all blocks empty
        if (currentBlockIdx < 0) {
          currentBlockIdx = 0;
          currentSetIdx = 0;
        }
      }

      if (currentBlockIdx < 0) {
        return {
          current: { exerciseName: 'Workout', exerciseBlockIndex: 0, setNumber: 1, totalSets: 1, weight: 0, reps: 0, restSeconds: 0, restEnabled: false },
          next: null,
          nextExercise: null,
          isResting: isRestingArg,
          restEndTime: restEnd,
          workoutActive: true,
        };
      }

      const block = blocks[currentBlockIdx];
      const set = block.sets[currentSetIdx];
      const target = targets
        ?.find(e => e.exercise_id === block.exercise.id)
        ?.sets?.find(s => s.set_number === set.set_number);

      const weight = set.weight ? Number(set.weight) : (target?.target_weight ?? set.previous?.weight ?? 0);
      const reps = set.reps ? Number(set.reps) : (target?.target_reps ?? set.previous?.reps ?? 0);

      const current = {
        exerciseName: block.exercise.name,
        exerciseBlockIndex: currentBlockIdx,
        setNumber: set.set_number,
        totalSets: block.sets.length,
        weight,
        reps,
        restSeconds: block.restSeconds,
        restEnabled: block.restEnabled,
      };

      // Next set in same exercise
      let next = null;
      const nextSetIdx = currentSetIdx + 1;
      if (nextSetIdx < block.sets.length) {
        const ns = block.sets[nextSetIdx];
        const nt = targets
          ?.find(e => e.exercise_id === block.exercise.id)
          ?.sets?.find(s => s.set_number === ns.set_number);
        next = {
          exerciseName: block.exercise.name,
          setNumber: ns.set_number,
          weight: ns.weight ? Number(ns.weight) : (nt?.target_weight ?? ns.previous?.weight ?? weight),
          reps: ns.reps ? Number(ns.reps) : (nt?.target_reps ?? ns.previous?.reps ?? reps),
        };
      }

      // Next exercise
      let nextExercise = null;
      if (currentBlockIdx + 1 < blocks.length) {
        const nb = blocks[currentBlockIdx + 1];
        const ns = nb.sets[0];
        if (ns) {
          const nt = targets
            ?.find(e => e.exercise_id === nb.exercise.id)
            ?.sets?.find(s => s.set_number === ns.set_number);
          nextExercise = {
            exerciseName: nb.exercise.name,
            setNumber: ns.set_number,
            totalSets: nb.sets.length,
            weight: ns.weight ? Number(ns.weight) : (nt?.target_weight ?? ns.previous?.weight ?? 0),
            reps: ns.reps ? Number(ns.reps) : (nt?.target_reps ?? ns.previous?.reps ?? 0),
          };
        }
      }

      return {
        current,
        next,
        nextExercise,
        isResting: isRestingArg,
        restEndTime: restEnd,
        workoutActive: true,
      };
    },
    [], // upcomingTargets accessed via ref
  );

  const syncWidgetState = useCallback(
    (blocks?: ExerciseBlock[], isRestingOverride?: boolean, restEnd?: number) => {
      const b = blocks ?? blocksRef.current;
      const resting = isRestingOverride ?? isRestingRef.current;
      const end = restEnd ?? (resting ? restEndTimeRef.current : 0);
      const state = buildWidgetState(b, resting, end, lastActiveBlockRef.current);

      // Write to UserDefaults (for intent logic + action queue)
      syncStateToWidget(state);

      // Always push ContentState from main app process (widget extension updates are unreliable)
      // Update ContentState (triggers widget view re-render)
      if (resting && end > 0) {
        updateWorkoutActivityForRest(
          state.current.exerciseName,
          Math.round((end - Date.now()) / 1000),
          state.current.setNumber,
          state.current.totalSets
        );
      } else {
        updateWorkoutActivityForSet(
          state.current.exerciseName,
          state.current.setNumber,
          state.current.totalSets
        );
      }
    },
    [blocksRef, buildWidgetState],
  );

  const handleWidgetCompleteSet = useCallback(
    async (blockIdx: number, setIdx: number, weight: number, reps: number) => {
      const block = blocksRef.current[blockIdx];
      const set = block?.sets[setIdx];
      if (!set || !block) return;
      lastActiveBlockRef.current = blockIdx;

      // Build updated blocks BEFORE syncing widget to avoid stale state
      const updatedBlocks = [...blocksRef.current];
      updatedBlocks[blockIdx] = { ...updatedBlocks[blockIdx], sets: [...updatedBlocks[blockIdx].sets] };
      updatedBlocks[blockIdx].sets[setIdx] = {
        ...updatedBlocks[blockIdx].sets[setIdx],
        weight: String(weight),
        reps: String(reps),
        is_completed: true,
      };

      // Update React state
      setExerciseBlocks(updatedBlocks);

      // Persist to SQLite
      await updateWorkoutSet(set.id, {
        weight,
        reps,
        is_completed: true,
      });

      // Haptic feedback
      try { Vibration.vibrate(50); } catch {}

      // Start rest timer if enabled, otherwise sync widget with updated blocks
      if (block.restEnabled) {
        onStartRest(block.restSeconds, block.exercise.name);
      } else {
        syncWidgetState(updatedBlocks);
      }
    },
    [blocksRef, setExerciseBlocks, onStartRest, syncWidgetState],
  );

  const handleWidgetActions = useCallback(
    (actions: WidgetAction[]) => {
      if (!workoutRef.current) return;
      for (const action of actions) {
        if (action.type === 'completeSet' && action.blockIndex != null && action.setIndex != null
          && action.blockIndex < blocksRef.current.length
          && action.setIndex < (blocksRef.current[action.blockIndex]?.sets.length ?? 0)) {
          handleWidgetCompleteSet(action.blockIndex, action.setIndex, action.weight ?? 0, action.reps ?? 0);
        } else if (action.type === 'skipRest') {
          onDismissRest();
          syncWidgetState(undefined, false, 0);
        } else if (action.type === 'adjustRest' && action.delta != null) {
          onAdjustRest(action.delta);
        }
      }
    },
    [workoutRef, blocksRef, handleWidgetCompleteSet, onDismissRest, onAdjustRest, syncWidgetState],
  );

  const startWidgetPolling = useCallback(() => {
    startPolling(handleWidgetActions);
  }, [handleWidgetActions]);

  return {
    lastActiveBlockRef,
    buildWidgetState,
    syncWidgetState,
    handleWidgetActions,
    startWidgetPolling,
  };
}
