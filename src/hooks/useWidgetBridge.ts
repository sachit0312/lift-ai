import { useRef, useCallback } from 'react';
import * as Sentry from '@sentry/react-native';
import {
  syncStateToWidget,
  type WidgetState,
} from '../services/workoutBridge';
import {
  updateWorkoutActivityForSet,
  updateWorkoutActivityForRest,
  getCurrentMaxRestSeconds,
} from '../services/liveActivity';
import type { LocalSet, ExerciseBlock } from '../types/workout';

export type { LocalSet, ExerciseBlock } from '../types/workout';

export interface UseWidgetBridgeOptions {
  blocksRef: React.MutableRefObject<ExerciseBlock[]>;
  isResting: boolean;
  restEndTime: number;
  /**
   * Exercise the user is currently resting FROM, or '' when not resting.
   *
   * Mirrored here so that EVERY sync — not just the one that arms the rest — can anchor on
   * it. Incidental syncs (completing a set on a rest-disabled exercise, un-completing a set,
   * adding an exercise mid-rest) don't pass it, and without a default they fall back to the
   * "first incomplete set" search and push the wrong exercise's name and counter to the lock
   * screen while the real countdown keeps running underneath.
   */
  restingExerciseId: string;
}

export interface UseWidgetBridgeReturn {
  lastActiveBlockRef: React.MutableRefObject<number>;
  buildWidgetState: (blocks: ExerciseBlock[], isResting: boolean, restEnd: number, preferBlockIdx?: number, restingExerciseId?: string) => WidgetState;
  /**
   * `restEnd` is an ABSOLUTE epoch-millis deadline. Passing it explicitly (together with
   * `isResting`) marks the call as an authoritative rest-state change; omitting it marks an
   * incidental sync, which refreshes the labels without touching the running countdown.
   */
  syncWidgetState: (blocks?: ExerciseBlock[], isResting?: boolean, restEnd?: number, restingExerciseId?: string, restTotalSeconds?: number) => void;
}

// ─── Hook ───

export function useWidgetBridge(options: UseWidgetBridgeOptions): UseWidgetBridgeReturn {
  const {
    blocksRef,
    isResting,
    restEndTime,
    restingExerciseId,
  } = options;

  const lastActiveBlockRef = useRef(0);

  const isRestingRef = useRef(isResting);
  isRestingRef.current = isResting;

  const restEndTimeRef = useRef(restEndTime);
  restEndTimeRef.current = restEndTime;

  const restingExerciseIdRef = useRef(restingExerciseId);
  restingExerciseIdRef.current = restingExerciseId;

  const buildWidgetState = useCallback(
    (blocks: ExerciseBlock[], isRestingArg: boolean, restEnd: number, preferBlockIdx?: number, restingExerciseId?: string): WidgetState => {
      // Find first incomplete set, starting from the last-active block (wrap around)
      let currentBlockIdx = -1;
      let currentSetIdx = -1;

      // While resting, the widget must describe the exercise the user is resting FROM — and
      // the name and the set counter must describe the SAME one. Anchoring on the block id
      // rather than overriding just the name is what prevents "Bench Press · Set 1/3" where
      // the counter actually belongs to the next exercise in the list.
      const restingBlockIdx = (isRestingArg && restingExerciseId)
        ? blocks.findIndex(b => b.exercise.id === restingExerciseId)
        : -1;

      const startIdx = restingBlockIdx >= 0
        ? restingBlockIdx
        : (preferBlockIdx != null && preferBlockIdx >= 0 && preferBlockIdx < blocks.length)
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

      // Pin to the resting block even when every one of its sets is already complete — the
      // wrap-around search above would otherwise roll on to the next exercise and report its
      // counter under the resting exercise's name.
      if (restingBlockIdx >= 0 && currentBlockIdx !== restingBlockIdx
          && blocks[restingBlockIdx].sets.length > 0) {
        currentBlockIdx = restingBlockIdx;
        currentSetIdx = blocks[restingBlockIdx].sets.length - 1;
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
          restMaxSeconds: getCurrentMaxRestSeconds(),
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
        restMaxSeconds: getCurrentMaxRestSeconds(),
        workoutActive: true,
      };
    },
    [],
  );

  const syncWidgetState = useCallback(
    (blocks?: ExerciseBlock[], isRestingOverride?: boolean, restEnd?: number, restingExerciseId?: string, restTotalSeconds?: number) => {
      const b = blocks ?? blocksRef.current;
      const resting = isRestingOverride ?? isRestingRef.current;
      const end = restEnd ?? (resting ? restEndTimeRef.current : 0);
      // Default to the live resting exercise so incidental call sites can't mislabel the lock
      // screen just by omitting it. Callers still pass it explicitly when they run before the
      // corresponding state has flushed (set completion arms the rest inside the same handler).
      const restingId = restingExerciseId ?? restingExerciseIdRef.current;
      const state = buildWidgetState(b, resting, end, lastActiveBlockRef.current, restingId);

      // Write to UserDefaults
      syncStateToWidget(state);

      // An authoritative rest change supplies the deadline explicitly. Callers that merely
      // re-sync surrounding state (add exercise, un-complete a set) leave it undefined and
      // fall through to the refresh path, which must not re-anchor the running countdown.
      const isAuthoritativeRest = resting && restEnd != null && restEnd > 0;

      // Update ContentState (triggers widget view re-render)
      if (isAuthoritativeRest) {
        updateWorkoutActivityForRest(
          state.current.exerciseName,
          end,
          state.current.setNumber,
          state.current.totalSets,
          restTotalSeconds,
        ).catch(e => Sentry.captureException(e));
      } else {
        // updateWorkoutActivityForSet self-routes to the label-only refresh when a rest is
        // still live, so an incidental sync can no longer tear the countdown down.
        updateWorkoutActivityForSet(
          state.current.exerciseName,
          state.current.setNumber,
          state.current.totalSets
        ).catch(e => Sentry.captureException(e));
      }
    },
    [blocksRef, buildWidgetState],
  );

  return {
    lastActiveBlockRef,
    buildWidgetState,
    syncWidgetState,
  };
}
