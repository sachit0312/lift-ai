import { useRef, useCallback } from 'react';
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
import type { Workout } from '../types/database';
import type { LocalSet, ExerciseBlock } from '../types/workout';

export type { LocalSet, ExerciseBlock } from '../types/workout';

export interface UseWidgetBridgeOptions {
  blocksRef: React.MutableRefObject<ExerciseBlock[]>;
  workoutRef: React.MutableRefObject<Workout | null>;
  isResting: boolean;
  restEndTime: number;
  onDismissRest: () => void;
  onAdjustRest: (delta: number, opts?: { fromWidget?: boolean }) => void;
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
    isResting,
    restEndTime,
    onDismissRest,
    onAdjustRest,
  } = options;

  const lastActiveBlockRef = useRef(0);

  // When a widget action triggers a rest adjustment, adjustRestTimerActivity fires
  // from useRestTimer with the correct delta math. This flag prevents syncWidgetState
  // from sending a second update via updateWorkoutActivityForRest (which recomputes
  // endTime from Date.now(), causing timestamp drift and flicker).
  const skipNextLiveActivityUpdate = useRef(false);

  const isRestingRef = useRef(isResting);
  isRestingRef.current = isResting;

  const restEndTimeRef = useRef(restEndTime);
  restEndTimeRef.current = restEndTime;

  const buildWidgetState = useCallback(
    (blocks: ExerciseBlock[], isRestingArg: boolean, restEnd: number, preferBlockIdx?: number): WidgetState => {
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
          current: { exerciseName: 'Workout', exerciseBlockIndex: 0, setNumber: 1, totalSets: 1, restSeconds: 0, restEnabled: false },
          isResting: isRestingArg,
          restEndTime: restEnd,
          workoutActive: true,
        };
      }

      const block = blocks[currentBlockIdx];
      const set = block.sets[currentSetIdx];

      const current = {
        exerciseName: block.exercise.name,
        exerciseBlockIndex: currentBlockIdx,
        setNumber: set.set_number,
        totalSets: block.sets.length,
        restSeconds: block.restSeconds,
        restEnabled: block.restEnabled,
      };

      return {
        current,
        isResting: isRestingArg,
        restEndTime: restEnd,
        workoutActive: true,
      };
    },
    [],
  );

  const syncWidgetState = useCallback(
    (blocks?: ExerciseBlock[], isRestingOverride?: boolean, restEnd?: number) => {
      const b = blocks ?? blocksRef.current;
      const resting = isRestingOverride ?? isRestingRef.current;
      const end = restEnd ?? (resting ? restEndTimeRef.current : 0);
      const state = buildWidgetState(b, resting, end, lastActiveBlockRef.current);

      // Write to UserDefaults (for intent logic + action queue)
      syncStateToWidget(state);

      // Skip Live Activity update if this sync was triggered by a widget action
      // (adjustRestTimerActivity already sent the correct update from useRestTimer).
      // Only skip for resting updates — if the adjustment ended the rest, we still
      // need to send the set-entry update so the lock screen switches views.
      if (skipNextLiveActivityUpdate.current) {
        skipNextLiveActivityUpdate.current = false;
        if (resting) return;
      }

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

  const handleWidgetActions = useCallback(
    (actions: WidgetAction[]) => {
      if (!workoutRef.current) return;
      for (const action of actions) {
        if (action.type === 'skipRest') {
          onDismissRest(); // endRest → onRestEnd → syncWidgetState already fires
        } else if (action.type === 'adjustRest' && action.delta != null) {
          // adjustRestTimerActivity fires from useRestTimer — prevent syncWidgetState
          // from sending a second update with a slightly different timestamp (flicker)
          skipNextLiveActivityUpdate.current = true;
          onAdjustRest(action.delta, { fromWidget: true });
        }
      }
    },
    [workoutRef, onDismissRest, onAdjustRest],
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
