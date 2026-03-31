# Notification & Live Activity System Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 confirmed bugs in the Live Activity / notification / widget system — stacked activities, wrong exercise name, Swift intent desync, React updater side-effect, silent error swallowing.

**Architecture:** Targeted fixes in existing files. No new abstractions. TDD — update existing bug-documenting tests to assert correct behavior, then implement fixes to make them pass.

**Tech Stack:** React Native, expo-live-activity, expo-notifications, shared-user-defaults (Expo module), Jest + RNTL

**Spec:** `docs/superpowers/specs/2026-03-30-notification-system-fix-design.md`

**Test command:** `npx jest --testPathIgnorePatterns='/node_modules/' --no-coverage`
(Must override worktree ignore pattern — running from inside a git worktree.)

---

### Task 1: Make `startWorkoutActivity` Idempotent

**Files:**
- Modify: `src/services/liveActivity.ts:71-112`
- Modify: `src/services/__tests__/liveActivity.test.ts:36-57`
- Modify: `src/services/__tests__/liveActivity.duplication.test.ts:51-91`

- [ ] **Step 1: Update the existing duplication test to assert correct (non-stacking) behavior**

In `src/services/__tests__/liveActivity.duplication.test.ts`, change the `focus-triggered activity stacking` test to assert idempotent behavior:

```typescript
// Replace the test at line 52-60
    it('calling startWorkoutActivity multiple times reuses existing activity', async () => {
      // Simulates: user starts workout, tabs away, tabs back (focus fires loadState again)
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await startWorkoutActivity('Bench Press', 'Set 2/4');
      await startWorkoutActivity('Bench Press', 'Set 3/4');

      // First call creates, subsequent calls update — no stacking
      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(1);
      expect(LiveActivity.updateActivity).toHaveBeenCalledTimes(2);
    });
```

Also update the existing test in `liveActivity.test.ts` at line 51-57:

```typescript
// Replace "stops previous activity before starting new one"
    it('reuses existing activity on second call instead of creating new', async () => {
      await startWorkoutActivity('First', 'Set 1/3');
      await startWorkoutActivity('Second', 'Set 1/4');

      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(1);
      expect(LiveActivity.updateActivity).toHaveBeenCalledTimes(1);
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Add test for recovery when update fails with "not found"**

In `src/services/__tests__/liveActivity.duplication.test.ts`, update the `stopActivity failure` test:

```typescript
// Replace the test at line 62-78
    it('creates new activity when existing one is dead (not found)', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');

      // Simulate: activity was dismissed by iOS — updateActivity throws "not found"
      (LiveActivity.updateActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Activity not found');
      });

      // Second call — update fails, should fall through to create new
      await startWorkoutActivity('Bench Press', 'Set 2/4');

      // Should have created 2 activities total (first + recovery)
      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(2);
    });
```

- [ ] **Step 3: Run tests to verify they FAIL (implementation not changed yet)**

Run: `npx jest --testPathPattern="liveActivity" --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: FAIL — tests expect 1 `startActivity` call but current code creates 2+.

- [ ] **Step 4: Implement idempotent `startWorkoutActivity`**

In `src/services/liveActivity.ts`, replace the function at lines 71-112:

```typescript
export async function startWorkoutActivity(exerciseName: string, subtitle: string): Promise<void> {
  if (Platform.OS !== 'ios') return;

  // If we already have an activity, try to update it (idempotent — no stacking)
  if (currentActivityId) {
    try {
      LiveActivity.updateActivity(currentActivityId, { title: exerciseName, subtitle });
      currentExerciseName = exerciseName;
      // Update dedup state so subsequent safeUpdateActivity calls see the latest
      lastContentStateJSON = JSON.stringify({ title: exerciseName, subtitle });
      lastUpdateTimestamp = Date.now();
      return;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      if (/not found/i.test(message)) {
        currentActivityId = null; // Dead — fall through to create
      } else {
        return; // Transient error — don't stack a new activity
      }
    }
  }

  // No existing activity — create fresh
  try {
    currentEndTime = 0;
    currentExerciseName = exerciseName;
    await cancelTimerEndNotification();

    const activityId = LiveActivity.startActivity(
      {
        title: exerciseName,
        subtitle,
      },
      {
        deepLinkUrl: '/workout',
        backgroundColor: colors.surface,
        titleColor: colors.text,
        subtitleColor: colors.textSecondary,
        progressViewTint: colors.primary,
      },
    );

    currentActivityId = activityId ?? null;
    // Reset dedup/throttle state for fresh activity
    lastContentStateJSON = '';
    lastUpdateTimestamp = 0;
    if (pendingUpdate) {
      clearTimeout(pendingUpdate.timeoutId);
      pendingUpdate = null;
    }
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to start workout Live Activity', e);
    Sentry.captureException(e);
  }
}
```

- [ ] **Step 5: Run tests to verify they PASS**

Run: `npx jest --testPathPattern="liveActivity" --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: PASS — all liveActivity tests green.

- [ ] **Step 6: Commit**

```bash
git add src/services/liveActivity.ts src/services/__tests__/liveActivity.test.ts src/services/__tests__/liveActivity.duplication.test.ts
git commit -m "fix: make startWorkoutActivity idempotent — update existing, create only when dead"
```

---

### Task 2: Thread Resting Exercise Name Through Widget Bridge

**Files:**
- Modify: `src/hooks/useWidgetBridge.ts`
- Modify: `src/hooks/__tests__/useWidgetBridge.test.ts`

- [ ] **Step 1: Update BUG tests to assert correct behavior with `restingExerciseName`**

In `src/hooks/__tests__/useWidgetBridge.test.ts`, in the `exercise name after auto-reorder` describe block, update the two BUG tests.

First test — change assertions to expect correct behavior:

```typescript
    it('shows correct exercise when resting from fully-completed exercise after reorder', () => {
      // ... same setup as existing test ...
      const completedBench = createBlock({
        exercise: createMockExercise({ id: 'bench', name: 'Bench Press' }),
        sets: [
          { id: 'b1', exercise_id: 'bench', set_number: 1, weight: '185', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
          { id: 'b2', exercise_id: 'bench', set_number: 2, weight: '185', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
        ],
      });
      const incompleteSq = createBlock({
        exercise: createMockExercise({ id: 'sq', name: 'Squats' }),
        sets: [
          { id: 'sq1', exercise_id: 'sq', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });
      const incompleteRow = createBlock({
        exercise: createMockExercise({ id: 'row', name: 'Rows' }),
        sets: [
          { id: 'r1', exercise_id: 'row', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });

      const blocks = [completedBench, incompleteSq, incompleteRow];
      const options = makeOptions({ blocksRef: { current: blocks } });
      const { result } = renderHook(() => useWidgetBridge(options));

      const restEnd = Date.now() + 120000;
      // Pass restingExerciseName — the exercise we're actually resting from
      const state = result.current.buildWidgetState(blocks, true, restEnd, 0, 'Bench Press');

      // Now correctly shows "Bench Press" during rest
      expect(state.current.exerciseName).toBe('Bench Press');
    });
```

Second test — update `syncWidgetState` BUG test:

```typescript
    it('syncWidgetState sends correct exercise to Live Activity during rest after reorder', () => {
      const completedBench = createBlock({
        exercise: createMockExercise({ id: 'bench', name: 'Bench Press' }),
        sets: [
          { id: 'b1', exercise_id: 'bench', set_number: 1, weight: '185', reps: '5', rpe: '', tag: 'working', is_completed: true, previous: null },
        ],
      });
      const incompleteSq = createBlock({
        exercise: createMockExercise({ id: 'sq', name: 'Squats' }),
        sets: [
          { id: 'sq1', exercise_id: 'sq', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null },
        ],
      });

      const blocks = [completedBench, incompleteSq];
      const options = makeOptions({ blocksRef: { current: blocks } });
      const { result } = renderHook(() => useWidgetBridge(options));

      result.current.lastActiveBlockRef.current = 0;

      const restEnd = Date.now() + 120000;
      act(() => {
        // Pass restingExerciseName through syncWidgetState
        result.current.syncWidgetState(undefined, true, restEnd, 'Bench Press');
      });

      // Now correctly sends "Bench Press" to Live Activity
      expect(updateWorkoutActivityForRest).toHaveBeenCalledWith(
        'Bench Press',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });
```

- [ ] **Step 2: Run tests to verify they FAIL**

Run: `npx jest --testPathPattern="useWidgetBridge" --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: FAIL — `buildWidgetState` doesn't accept 5th arg yet, `syncWidgetState` doesn't accept 4th arg yet.

- [ ] **Step 3: Add `restingExerciseName` parameter to `buildWidgetState`**

In `src/hooks/useWidgetBridge.ts`, update the `buildWidgetState` callback signature (line 43-44) and the exercise name resolution (line 92-93):

Change the signature at line 22 in the interface:
```typescript
  buildWidgetState: (blocks: ExerciseBlock[], isResting: boolean, restEnd: number, preferBlockIdx?: number, restingExerciseName?: string) => WidgetState;
```

Change the callback at line 43-44:
```typescript
  const buildWidgetState = useCallback(
    (blocks: ExerciseBlock[], isRestingArg: boolean, restEnd: number, preferBlockIdx?: number, restingExerciseName?: string): WidgetState => {
```

Change the exercise name resolution at lines 92-93:
```typescript
      const current = {
        exerciseName: (isRestingArg && restingExerciseName) ? restingExerciseName : block.exercise.name,
```

- [ ] **Step 4: Add `restingExerciseName` parameter to `syncWidgetState`**

Change the interface at line 23:
```typescript
  syncWidgetState: (blocks?: ExerciseBlock[], isResting?: boolean, restEnd?: number, restingExerciseName?: string) => void;
```

Change the callback at line 111-112:
```typescript
  const syncWidgetState = useCallback(
    (blocks?: ExerciseBlock[], isRestingOverride?: boolean, restEnd?: number, restingExerciseName?: string) => {
```

Change the `buildWidgetState` call at line 116:
```typescript
      const state = buildWidgetState(b, resting, end, lastActiveBlockRef.current, restingExerciseName);
```

- [ ] **Step 5: Run tests to verify they PASS**

Run: `npx jest --testPathPattern="useWidgetBridge" --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useWidgetBridge.ts src/hooks/__tests__/useWidgetBridge.test.ts
git commit -m "fix: thread restingExerciseName through widget bridge to show correct exercise during rest"
```

---

### Task 3: Thread Exercise Name Through Rest Timer Callbacks

**Files:**
- Modify: `src/hooks/useRestTimer.ts:10-13,78`
- Modify: `src/screens/WorkoutScreen.tsx:61-67`
- Modify: `src/hooks/__tests__/useRestTimer.test.ts`

- [ ] **Step 1: Update `onRestUpdate` test to include exercise name**

In `src/hooks/__tests__/useRestTimer.test.ts`, update the test `startRestTimer sets correct state and calls onRestUpdate` (around line 65-83):

```typescript
  it('startRestTimer calls onRestUpdate with exercise name', () => {
    const { result, onRestUpdate } = setup();

    act(() => {
      result.current.startRestTimer(120, 'Bench Press');
    });

    expect(onRestUpdate).toHaveBeenCalledTimes(1);
    // Third argument is the exercise name
    expect(onRestUpdate).toHaveBeenCalledWith(true, expect.any(Number), 'Bench Press');
  });
```

- [ ] **Step 2: Run test to verify it FAILS**

Run: `npx jest --testPathPattern="useRestTimer" --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: FAIL — `onRestUpdate` is called with 2 args, test expects 3.

- [ ] **Step 3: Update `useRestTimer` to pass exercise name to `onRestUpdate`**

In `src/hooks/useRestTimer.ts`:

Update the `UseRestTimerOptions` interface at line 12:
```typescript
  onRestUpdate: (isResting: boolean, endTime: number, exerciseName?: string) => void;
```

Update `startRestTimer` at line 78 to pass exercise name:
```typescript
    onRestUpdateRef.current(true, endTime, exerciseName);
```

Update `adjustRestTimer` at line 114 to pass current exercise name:
```typescript
      onRestUpdateRef.current(true, newEndTime, undefined);
```

- [ ] **Step 4: Update `WorkoutScreen.tsx` callbacks to thread exercise name**

In `src/screens/WorkoutScreen.tsx`:

Update `onRestUpdate` callback at line 65-67:
```typescript
  const onRestUpdate = useCallback((resting: boolean, endTime: number, exerciseName?: string) => {
    syncWidgetStateRef.current(undefined, resting, endTime, exerciseName);
  }, []);
```

- [ ] **Step 5: Run all tests to verify PASS**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: PASS (all 538+ tests)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useRestTimer.ts src/screens/WorkoutScreen.tsx src/hooks/__tests__/useRestTimer.test.ts
git commit -m "fix: pass resting exercise name through callback chain to widget bridge"
```

---

### Task 4: Poll Swift Action Queue on Foreground Return

**Files:**
- Modify: `src/services/liveActivity.ts` (add `applyPendingWidgetActions`)
- Modify: `src/hooks/useRestTimer.ts:130-146`
- Modify: `src/services/__tests__/liveActivity.duplication.test.ts`
- Modify: `src/hooks/__tests__/useRestTimer.test.ts`

- [ ] **Step 1: Write tests for `applyPendingWidgetActions`**

In `src/services/__tests__/liveActivity.duplication.test.ts`, add a new describe block at the end (before the closing `});`):

```typescript
  describe('applyPendingWidgetActions', () => {
    // Import at top of file: import { getItem, removeItem } from 'modules/shared-user-defaults';
    // Already mocked via jest.config.js moduleNameMapper

    it('returns 0 when no actions queued', () => {
      const { applyPendingWidgetActions } = require('../liveActivity');
      expect(applyPendingWidgetActions()).toBe(0);
    });

    it('sums adjustRest deltas', () => {
      const { applyPendingWidgetActions } = require('../liveActivity');
      const { setItem } = require('modules/shared-user-defaults');
      setItem('liftai_action_queue', JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: Date.now() },
        { type: 'adjustRest', delta: 15, ts: Date.now() },
        { type: 'adjustRest', delta: -15, ts: Date.now() },
      ]));

      expect(applyPendingWidgetActions()).toBe(15);
    });

    it('returns -Infinity for skipRest', () => {
      const { applyPendingWidgetActions } = require('../liveActivity');
      const { setItem } = require('modules/shared-user-defaults');
      setItem('liftai_action_queue', JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: Date.now() },
        { type: 'skipRest', delta: null, ts: Date.now() },
      ]));

      expect(applyPendingWidgetActions()).toBe(-Infinity);
    });

    it('clears the queue after reading', () => {
      const { applyPendingWidgetActions } = require('../liveActivity');
      const { setItem, getItem, removeItem } = require('modules/shared-user-defaults');
      setItem('liftai_action_queue', JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: Date.now() },
      ]));

      applyPendingWidgetActions();
      expect(removeItem).toHaveBeenCalledWith('liftai_action_queue');
    });

    it('returns 0 on Android', () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', writable: true });
      const { applyPendingWidgetActions } = require('../liveActivity');
      expect(applyPendingWidgetActions()).toBe(0);
    });
  });
```

- [ ] **Step 2: Run tests to verify they FAIL**

Run: `npx jest --testPathPattern="liveActivity.duplication" --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: FAIL — `applyPendingWidgetActions` not exported yet.

- [ ] **Step 3: Implement `applyPendingWidgetActions` in `liveActivity.ts`**

Add import at top of `src/services/liveActivity.ts` (after line 7):
```typescript
import { getItem, removeItem } from 'modules/shared-user-defaults';
```

Add the function before the `// ─── Notification serialization ───` comment (before line 271):
```typescript
/**
 * Read and clear pending widget intent actions from UserDefaults.
 * Called on foreground return to sync RN state with Swift widget adjustments.
 * Returns total delta in seconds (0 = no actions, -Infinity = skip rest).
 */
export function applyPendingWidgetActions(): number {
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
        totalDelta += action.delta;
      }
    }
    return totalDelta;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Run liveActivity tests to verify PASS**

Run: `npx jest --testPathPattern="liveActivity" --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: PASS

- [ ] **Step 5: Write test for foreground resync applying widget actions**

In `src/hooks/__tests__/useRestTimer.test.ts`, add to the `foreground return vibration edge cases` describe block:

```typescript
    it('applies widget action queue delta before computing remaining time', () => {
      const { setItem } = require('modules/shared-user-defaults');
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(30, 'Bench');
      });

      // Go to background
      act(() => {
        appStateCallback?.('background');
      });

      // Widget user tapped +15s while app was backgrounded
      setItem('liftai_action_queue', JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: Date.now() },
      ]));

      // 25 seconds pass — without the +15s, timer would have 5s left
      // With the +15s, timer should have 20s left
      jest.setSystemTime(new Date(Date.now() + 25000));

      act(() => {
        appStateCallback?.('active');
      });

      expect(result.current.isResting).toBe(true);
      expect(result.current.restSeconds).toBe(20);
    });

    it('applies widget skipRest action by ending rest', () => {
      const { setItem } = require('modules/shared-user-defaults');
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(120, 'Bench');
      });

      act(() => {
        appStateCallback?.('background');
      });

      // Widget user tapped "skip rest"
      setItem('liftai_action_queue', JSON.stringify([
        { type: 'skipRest', delta: null, ts: Date.now() },
      ]));

      act(() => {
        appStateCallback?.('active');
      });

      expect(result.current.isResting).toBe(false);
      expect(onRestEnd).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 6: Run test to verify it FAILS**

Run: `npx jest --testPathPattern="useRestTimer" --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: FAIL — `useRestTimer` doesn't call `applyPendingWidgetActions` yet.

- [ ] **Step 7: Integrate action queue polling into `useRestTimer` foreground resync**

In `src/hooks/useRestTimer.ts`:

Add import at top (after line 7):
```typescript
import {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  scheduleRestNotification,
  isRestNotificationScheduled,
  applyPendingWidgetActions,
} from '../services/liveActivity';
```

Replace the `else if (nextState === 'active')` block at lines 130-146:
```typescript
      } else if (nextState === 'active') {
        // ─── Resync rest timer on foreground return ───
        if (restRef.current !== null) {
          // Apply any pending widget intent actions (e.g., +/-15s taps from lock screen)
          const delta = applyPendingWidgetActions();
          if (delta === -Infinity) {
            // Widget user tapped "skip rest"
            endRest(false);
            return;
          }
          if (delta !== 0) {
            currentEndTimeRef.current += delta * 1000;
          }

          const remaining = Math.max(0, Math.round((currentEndTimeRef.current - Date.now()) / 1000));
          if (remaining <= 0) {
            endRest(false); // no vibrate — notification already fired
          } else {
            setRestSeconds(remaining);
            setTimeout(() => { wasBackgroundedRef.current = false; }, 500);
          }
        } else {
          wasBackgroundedRef.current = false;
        }
      }
```

- [ ] **Step 8: Run all tests to verify PASS**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add src/services/liveActivity.ts src/hooks/useRestTimer.ts src/services/__tests__/liveActivity.duplication.test.ts src/hooks/__tests__/useRestTimer.test.ts
git commit -m "fix: poll Swift widget action queue on foreground return to sync timer state"
```

---

### Task 5: Move Side Effect Out of React Updater

**Files:**
- Modify: `src/hooks/useWorkoutLifecycle.ts:630-637`

- [ ] **Step 1: Move `startWorkoutActivityProp` out of `setExerciseBlocks` updater**

In `src/hooks/useWorkoutLifecycle.ts`, replace lines 630-637:

```typescript
    const wasEmpty = blocksRef.current.length === 0;
    setExerciseBlocks((prev) => [...prev, newBlock]);
    if (wasEmpty) {
      startWorkoutActivityProp(newBlock.exercise.name, `Set 1/${newBlock.sets.length}`);
    }
    syncWidgetState([...blocksRef.current, newBlock]);
```

- [ ] **Step 2: Run all tests to verify PASS**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWorkoutLifecycle.ts
git commit -m "fix: move startWorkoutActivity call out of React state updater function"
```

---

### Task 6: Route Notification Chain Errors to Sentry

**Files:**
- Modify: `src/services/liveActivity.ts:277`

- [ ] **Step 1: Replace silent error swallowing with Sentry capture**

In `src/services/liveActivity.ts`, change line 277:

From:
```typescript
  notificationChain = notificationChain.then(fn).catch(() => {});
```

To:
```typescript
  notificationChain = notificationChain.then(fn).catch(e => Sentry.captureException(e));
```

- [ ] **Step 2: Run all tests to verify PASS**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/liveActivity.ts
git commit -m "fix: route notification chain errors to Sentry instead of swallowing silently"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --no-coverage`

Expected: All tests PASS. No regressions in existing 538 tests.

- [ ] **Step 2: Run TypeScript type-check**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Verify git log shows clean commit history**

Run: `git log --oneline -10`

Expected: 6 clean fix commits on top of the spec commit.
