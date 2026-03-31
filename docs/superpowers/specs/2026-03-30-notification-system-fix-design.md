# Notification & Live Activity System Fix

**Date**: 2026-03-30
**Status**: Design approved, ready for implementation planning

## Problem Statement

The Live Activity, notification, and vibration system has recurring bugs despite multiple patch attempts:

1. **Stacked Live Activities**: Multiple lock screen widgets appear. Root cause: `startWorkoutActivity()` is called from 4+ code paths (fresh start, resume-on-focus, first-exercise-add) and always creates a NEW activity.
2. **Wrong exercise name on widget during rest**: After auto-reorder, the widget shows the next incomplete exercise instead of the one the user is resting from. Root cause: `buildWidgetState()` searches for "next incomplete set" — a different question than "what are we resting from?"
3. **Swift intent / RN state desync**: Widget +/-15s buttons mutate UserDefaults and refresh the Live Activity from the extension process, but RN never polls the action queue — so in-app timer diverges from lock screen.
4. **Side effect in React updater**: `startWorkoutActivityProp` is called inside a `setExerciseBlocks` updater function, which is a React anti-pattern (can fire multiple times in concurrent mode).
5. **Notification chain silently swallows errors**: `.catch(() => {})` hides failures from Sentry.

## Design Approach

Targeted, test-driven fixes in existing code. No new classes or abstractions. Each fix addresses one root cause.

---

## Fix 1: Idempotent Activity Management

**File**: `src/services/liveActivity.ts`

**Change**: Modify `startWorkoutActivity()` to be idempotent — update-if-exists, create-if-dead-or-missing.

```
Before: Always stop old + create new (stacks if stop fails)
After:  If activityId exists → try updateActivity. On "not found" → null ID, fall through to create. Only create when activityId is null.
```

**Pseudocode**:
```typescript
export async function startWorkoutActivity(exerciseName, subtitle) {
  if (Platform.OS !== 'ios') return;

  // If we already have an activity, try to update it
  if (currentActivityId) {
    try {
      LiveActivity.updateActivity(currentActivityId, { title: exerciseName, subtitle });
      // Reset dedup state so subsequent updates aren't suppressed
      lastContentStateJSON = JSON.stringify({ title: exerciseName, subtitle });
      lastUpdateTimestamp = Date.now();
      currentExerciseName = exerciseName;
      return; // Reused existing activity — no stacking
    } catch (e) {
      if (/not found/i.test(e.message)) {
        currentActivityId = null; // Dead activity — fall through to create
      } else {
        return; // Transient error — don't stack
      }
    }
  }

  // No existing activity — create fresh
  try {
    await cancelTimerEndNotification();
    currentEndTime = 0;
    currentExerciseName = exerciseName;
    const activityId = LiveActivity.startActivity({ title: exerciseName, subtitle }, { ... });
    currentActivityId = activityId ?? null;
    // Reset dedup/throttle state
    lastContentStateJSON = '';
    lastUpdateTimestamp = 0;
    if (pendingUpdate) { clearTimeout(pendingUpdate.timeoutId); pendingUpdate = null; }
  } catch (e) {
    Sentry.captureException(e);
  }
}
```

**Callers unchanged**: `activateWorkout()`, `loadActiveWorkout()`, `handleAddExerciseToWorkout()` all keep calling `startWorkoutActivity()` — it's now safe to call repeatedly.

**Test**: Update existing test `stops previous activity before starting new one` to verify only 1 `startActivity` call when called twice with an active activity.

---

## Fix 2: Thread Resting Exercise Name Through Widget Bridge

**Files**: `src/hooks/useWidgetBridge.ts`, `src/hooks/useRestTimer.ts`, `src/screens/WorkoutScreen.tsx`

**Change**: `buildWidgetState()` and `syncWidgetState()` accept an optional `restingExerciseName` parameter. During rest, the widget uses this captured name instead of searching blocks.

**`buildWidgetState` change**:
```typescript
function buildWidgetState(
  blocks, isResting, restEnd, preferBlockIdx?,
  restingExerciseName?: string  // NEW parameter
): WidgetState {
  // ... existing search for first incomplete set ...

  // During rest, override exercise name with the one we're actually resting from
  const exerciseName = (isResting && restingExerciseName)
    ? restingExerciseName
    : block.exercise.name;

  return {
    current: {
      exerciseName,  // Correct during rest AND set-entry
      exerciseBlockIndex: currentBlockIdx,
      setNumber: set.set_number,
      totalSets: block.sets.length,
      ...
    },
    ...
  };
}
```

**`syncWidgetState` change**: Accept `restingExerciseName` and pass through.

**Data flow**:
```
useSetCompletion captures exerciseName (line 56)
  → startRestTimer(blockRestSeconds, exerciseName)
    → useRestTimer stores restExerciseName in state
    → onRestUpdate callback fires
      → WorkoutScreen: syncWidgetStateRef.current(undefined, true, endTime, restExerciseName)
        → buildWidgetState(..., restingExerciseName)  // Uses captured name
          → updateWorkoutActivityForRest(restingExerciseName, ...)  // Correct on lock screen
```

The `restExerciseName` is already captured correctly in `useRestTimer` (line 71). We just need to thread it through to the widget bridge.

**WorkoutScreen callback changes**:
```typescript
// onRestUpdate gets the exercise name from useRestTimer
const onRestUpdate = useCallback((resting: boolean, endTime: number, exerciseName?: string) => {
  syncWidgetStateRef.current(undefined, resting, endTime, exerciseName);
}, []);

// onRestEnd clears it
const onRestEnd = useCallback(() => {
  syncWidgetStateRef.current(undefined, false, 0);
}, []);
```

**useRestTimer change**: Pass `restExerciseName` to `onRestUpdate`:
```typescript
onRestUpdateRef.current(true, endTime, exerciseName);
```

**Test**: Update the BUG tests in `useWidgetBridge.test.ts` to pass `restingExerciseName` and verify correct exercise name during rest after reorder.

---

## Fix 3: Poll Swift Action Queue on Foreground Return

**Files**: `src/hooks/useRestTimer.ts`, `src/services/liveActivity.ts`

**Change**: Before rest timer foreground resync, read and apply pending actions from UserDefaults written by Swift widget intents.

**New function in `liveActivity.ts`**:

Swift action types (from `WorkoutIntents.swift`):
- `"adjustRest"` with `delta: number` (±15.0 seconds)
- `"skipRest"` with `delta: null`

UserDefaults key: `liftai_action_queue` (from `WorkoutUserDefaultsHelper.swift` line 6).
Actions are JSON-encoded `WorkoutAction[]`: `{ type: string, delta: number | null, ts: number }`.

```typescript
import { getItem, removeItem } from 'modules/shared-user-defaults';

export function applyPendingWidgetActions(): number {
  // Returns total delta seconds applied (0 if none, -Infinity if skip)
  if (Platform.OS !== 'ios') return 0;
  try {
    const raw = getItem('liftai_action_queue');
    if (!raw) return 0;
    removeItem('liftai_action_queue');
    const actions: { type: string; delta?: number; ts: number }[] = JSON.parse(raw);
    let totalDelta = 0;
    for (const action of actions) {
      if (action.type === 'skipRest') return -Infinity;
      if (action.type === 'adjustRest' && action.delta != null) {
        totalDelta += action.delta; // delta is already in seconds (±15)
      }
    }
    return totalDelta;
  } catch { return 0; }
}
```

**Integration in `useRestTimer.ts` AppState listener** (before the existing resync logic):
```typescript
} else if (nextState === 'active') {
  if (restRef.current !== null) {
    // NEW: Apply widget actions first
    const delta = applyPendingWidgetActions();
    if (delta === -Infinity) {
      endRest(false); // Widget user tapped "skip"
      return;
    }
    if (delta !== 0) {
      currentEndTimeRef.current += delta * 1000;
    }

    // Existing resync logic (now uses updated currentEndTimeRef)
    const remaining = Math.max(0, Math.round((currentEndTimeRef.current - Date.now()) / 1000));
    ...
  }
}

**Test**: Mock `SharedUserDefaults.getItem` to return queued actions, verify `currentEndTimeRef` is adjusted before resync.

---

## Fix 4: Move Side Effect Out of React Updater

**File**: `src/hooks/useWorkoutLifecycle.ts`

**Change**: Move `startWorkoutActivityProp` call out of the `setExerciseBlocks` updater in `handleAddExerciseToWorkout`.

```
Before (line 630-637):
  setExerciseBlocks((prev) => {
    if (prev.length === 0) {
      startWorkoutActivityProp(newBlock.exercise.name, ...);  // Side effect in updater!
    }
    return [...prev, newBlock];
  });

After:
  const wasEmpty = blocksRef.current.length === 0;
  setExerciseBlocks((prev) => [...prev, newBlock]);
  if (wasEmpty) {
    startWorkoutActivityProp(newBlock.exercise.name, `Set 1/${newBlock.sets.length}`);
  }
  syncWidgetState([...blocksRef.current, newBlock]);
```

Uses `blocksRef.current` (always in sync) to check emptiness before the updater.

**Test**: Existing tests cover this path; verify no double activity creation.

---

## Fix 5: Route Notification Chain Errors to Sentry

**File**: `src/services/liveActivity.ts`

**Change**:
```
Before: notificationChain = notificationChain.then(fn).catch(() => {});
After:  notificationChain = notificationChain.then(fn).catch(e => Sentry.captureException(e));
```

One-line change. No test needed.

---

## Test Plan

### New Tests
- `startWorkoutActivity` idempotency: called 3x → only 1 `startActivity`, 2 `updateActivity`
- `startWorkoutActivity` recovery: update fails with "not found" → creates new activity
- `buildWidgetState` with `restingExerciseName`: returns correct name during rest after reorder
- `syncWidgetState` threads `restingExerciseName` to `updateWorkoutActivityForRest`
- `applyPendingWidgetActions`: applies delta, handles skip, handles empty queue
- Foreground resync applies widget actions before computing remaining time
- `handleAddExerciseToWorkout` no side effect in updater: `startActivity` called once

### Updated Tests
- Flip existing BUG tests from documenting wrong behavior to asserting correct behavior
- Update `useRestTimer` `onRestUpdate` tests to include `exerciseName` parameter

### Existing Tests (Must Still Pass)
- All 538 existing tests in the suite
- Specifically: liveActivity dedup, throttle, dismissed recovery, platform guards

---

## Files Changed

| File | Change Type | Description |
|------|------------|-------------|
| `src/services/liveActivity.ts` | Modified | Idempotent `startWorkoutActivity`, `applyPendingWidgetActions`, Sentry in notification chain |
| `src/hooks/useWidgetBridge.ts` | Modified | `restingExerciseName` parameter in `buildWidgetState`/`syncWidgetState` |
| `src/hooks/useRestTimer.ts` | Modified | Pass `restExerciseName` to `onRestUpdate`, poll action queue on foreground |
| `src/screens/WorkoutScreen.tsx` | Modified | Thread `exerciseName` through `onRestUpdate`/`onRestEnd` callbacks |
| `src/hooks/useWorkoutLifecycle.ts` | Modified | Move side effect out of `setExerciseBlocks` updater |
| `src/services/__tests__/liveActivity.test.ts` | Modified | Idempotency tests |
| `src/services/__tests__/liveActivity.duplication.test.ts` | Modified | Flip BUG tests to assert correct behavior |
| `src/hooks/__tests__/useWidgetBridge.test.ts` | Modified | Flip BUG tests, add `restingExerciseName` tests |
| `src/hooks/__tests__/useRestTimer.test.ts` | Modified | Action queue polling tests, `onRestUpdate` with name |

---

## Out of Scope

- **Swift-side cleanup of stale activities**: Would require native module changes to enumerate `Activity.activities`. Tracked as follow-up.
- **XCTest for widget intents**: Can't test Swift extension from Jest. Would need separate XCTest target.
- **`currentMaxRestSeconds` interleave on rapid completions**: Edge case, not user-reported. Tracked as follow-up.
