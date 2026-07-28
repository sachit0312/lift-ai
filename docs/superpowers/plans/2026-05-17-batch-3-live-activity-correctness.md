# Batch 3: Live Activity Correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four correctness bugs in the iOS Live Activity widget so the lock-screen rest timer's progress bar denominator is correct, action queue can't double-drain, and notification churn stops on rapid +/-15s taps.

**Architecture:** Add `restMaxSeconds` to the shared `WorkoutState` schema (RN ↔ Swift App Group UserDefaults) so the lock-screen progress bar denominator survives across resume and is available to widget intents. Add a native atomic `getItemAndRemove` operation to the SharedUserDefaults bridge. Debounce notification reschedules in the JS adjust path so rapid taps coalesce.

**Tech Stack:** React Native (Expo), TypeScript, Swift (AppIntents/ActivityKit/WidgetKit), `expo-notifications`, `expo-modules-core` native module bridge, App Group UserDefaults.

**Repo:** This worktree (`/Users/sachitgoyal/code/lift-ai/.claude/worktrees/brave-spence-530049/`). Branch: `claude/brave-spence-530049`.

**Build caveat (per CLAUDE.md):** Plugin Swift edits require `npx expo prebuild --clean` before a device build. Device builds must run from `/Users/sachitgoyal/code/lift-ai/`, NOT this worktree (worktrees lack `.env.*` and Expo has path issues). Device verification of Tasks 1–3 is therefore deferred to "merge to main → build from main → manual smoke."

---

## File Structure

**Modified files (6):**

- `src/services/workoutBridge.ts` — Task 1 (add `restMaxSeconds` to `WidgetState`)
- `src/services/liveActivity.ts` — Task 2 (persist + restore `currentMaxRestSeconds`), Task 5 (atomic action drain), Task 6 (notification debounce)
- `src/hooks/useWidgetBridge.ts` — Task 1 (thread `restMaxSeconds` through state construction)
- `plugins/withInteractiveLiveActivity/swift/WorkoutUserDefaultsHelper.swift` — Task 1 (add field), Task 4 (atomic `readAndClearActions` already exists; document)
- `plugins/withInteractiveLiveActivity/swift/WorkoutIntents.swift` — Task 3 (write `|D` suffix in `refreshLiveActivity`)
- `modules/shared-user-defaults/ios/SharedUserDefaultsModule.swift` + `modules/shared-user-defaults/index.ts` — Task 5 (add `getItemAndRemove`)

**New test files (3):**

- `src/__tests__/hooks/liveActivity-restoreMaxRest.test.ts`
- `src/__tests__/hooks/liveActivity-notificationDebounce.test.ts`
- `src/__tests__/services/liveActivity-applyPending.test.ts`

---

## Task 1: Add `restMaxSeconds` to shared `WorkoutState` schema

The lock-screen widget needs to know the original rest duration to render a proportional progress bar. The current schema only carries `restEndTime` (absolute timestamp); widget intents can't recover the max. Add `restMaxSeconds` to the JS `WidgetState`, write it through `syncStateToWidget`, and decode it on the Swift side.

**Files:**
- Modify: `src/services/workoutBridge.ts:7-21`
- Modify: `src/hooks/useWidgetBridge.ts` (callers of `syncStateToWidget` — find with grep)
- Modify: `plugins/withInteractiveLiveActivity/swift/WorkoutUserDefaultsHelper.swift:21-26` (`WorkoutState` struct)

- [ ] **Step 1: Add `restMaxSeconds` to the TypeScript `WidgetState`**

Edit `src/services/workoutBridge.ts`. Replace the `WidgetState` interface (lines 16-21) with:

```typescript
export interface WidgetState {
  current: WidgetSetState;
  isResting: boolean;
  restEndTime: number;
  /**
   * The original rest duration in seconds, used by the lock-screen widget as
   * the progress bar denominator. Persists across app resume so the bar
   * proportion stays correct. Set on rest start; grows on +15s adjustments;
   * never shrinks (see liveActivity.ts currentMaxRestSeconds).
   */
  restMaxSeconds: number;
  workoutActive: boolean;
}
```

- [ ] **Step 2: Add the Swift-side field**

Edit `plugins/withInteractiveLiveActivity/swift/WorkoutUserDefaultsHelper.swift`. Replace the `WorkoutState` struct (lines 21-26):

```swift
struct WorkoutState: Codable {
    var current: WorkoutSetState
    var isResting: Bool
    var restEndTime: Double
    var restMaxSeconds: Int
    var workoutActive: Bool
}
```

The JSON keys are derived from property names, so this matches `restMaxSeconds` on the JS side. Codable's default decoding tolerates a missing key only if we mark it optional or provide a custom decoder — see Step 3.

- [ ] **Step 3: Make decoding backward-compatible**

Older builds wrote `WorkoutState` without `restMaxSeconds`. To avoid breaking on first launch after upgrade (when the persisted state lacks the new field), add an explicit `init(from:)` that defaults the field to 0:

In `WorkoutUserDefaultsHelper.swift`, immediately after the `WorkoutState` struct declaration, add:

```swift
extension WorkoutState {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        current = try container.decode(WorkoutSetState.self, forKey: .current)
        isResting = try container.decode(Bool.self, forKey: .isResting)
        restEndTime = try container.decode(Double.self, forKey: .restEndTime)
        restMaxSeconds = try container.decodeIfPresent(Int.self, forKey: .restMaxSeconds) ?? 0
        workoutActive = try container.decode(Bool.self, forKey: .workoutActive)
    }
}
```

Note: Swift auto-synthesizes `CodingKeys` for structs; this custom initializer overrides only the decoding side, leaving encoding auto-synthesized.

- [ ] **Step 4: Thread `restMaxSeconds` through `useWidgetBridge`**

Find every call site that constructs a `WidgetState`:

```bash
grep -rn 'syncStateToWidget\|WidgetState' src/
```

In `src/hooks/useWidgetBridge.ts` (the only construction site in the repo apart from tests), add `restMaxSeconds` to the returned object. The value should come from the JS module-level `currentMaxRestSeconds` in `liveActivity.ts`. Since that variable is not exported, we'll surface it through a small getter:

In `src/services/liveActivity.ts`, near the existing `getRestTimerRemainingSeconds` export (around line 51), add:

```typescript
export function getCurrentMaxRestSeconds(): number {
  return currentMaxRestSeconds;
}
```

In `src/hooks/useWidgetBridge.ts`, import it and include it when building the widget state. Find the construction (around the `syncStateToWidget` call site) and add `restMaxSeconds: getCurrentMaxRestSeconds()` alongside `restEndTime`. The implementer should grep for `syncStateToWidget(` and `restEndTime:` to find the exact insertion point; if there is more than one state construction, update all of them.

- [ ] **Step 5: Build + typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `grep -rn 'restMaxSeconds' src/services/ src/hooks/ plugins/withInteractiveLiveActivity/swift/`
Expected: matches in `workoutBridge.ts`, `liveActivity.ts`, `useWidgetBridge.ts`, and `WorkoutUserDefaultsHelper.swift`. No other source touched.

- [ ] **Step 6: Commit**

```bash
git add src/services/workoutBridge.ts src/services/liveActivity.ts src/hooks/useWidgetBridge.ts plugins/withInteractiveLiveActivity/swift/WorkoutUserDefaultsHelper.swift
git commit -m "feat(live-activity): add restMaxSeconds to shared WorkoutState schema"
```

---

## Task 2: Persist + restore `currentMaxRestSeconds` across JS module reload

`liveActivity.ts` keeps `currentMaxRestSeconds` as a module-level variable that's lost on JS context reset (cold start, OTA reload). After Task 1, the value is already mirrored in the persisted `WorkoutState`. This task adds a JS-side reader so the module can restore its in-memory copy on first use after reload.

**Files:**
- Modify: `src/services/liveActivity.ts`
- Test: `src/__tests__/hooks/liveActivity-restoreMaxRest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/hooks/liveActivity-restoreMaxRest.test.ts`:

```typescript
/**
 * Tests for Batch 3 Task 2: liveActivity module restores currentMaxRestSeconds
 * from the persisted WorkoutState so first-rest-after-resume has the correct
 * progress bar denominator.
 */
import { Platform } from 'react-native';

jest.mock('../../../modules/shared-user-defaults', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('expo-live-activity', () => ({
  startActivity: jest.fn(() => 'activity-id'),
  updateActivity: jest.fn(),
  stopActivity: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

(Platform as any).OS = 'ios';

const sud = require('../../../modules/shared-user-defaults');

describe('Batch 3 Task 2: restore currentMaxRestSeconds on rest update', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('seeds currentMaxRestSeconds from persisted WorkoutState if module was just loaded', async () => {
    // Simulate persisted state from a previous session with restMaxSeconds=180
    (sud.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'liftai_workout_state') {
        return JSON.stringify({
          current: { exerciseName: 'Bench', exerciseBlockIndex: 0, setNumber: 2, totalSets: 3, restSeconds: 90, restEnabled: true },
          isResting: true,
          restEndTime: Date.now() + 60000,
          restMaxSeconds: 180,
          workoutActive: true,
        });
      }
      return null;
    });

    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 2/3');
    // Pre-restore the module sees 0; updateWorkoutActivityForRest should
    // restore from persisted state instead of overwriting with the passed
    // remaining-seconds total.
    await updateWorkoutActivityForRest('Bench', 60 /* remaining */, 2, 3);

    expect(getCurrentMaxRestSeconds()).toBe(180);
  });

  it('falls back to totalSeconds if no persisted state has restMaxSeconds', async () => {
    (sud.getItem as jest.Mock).mockReturnValue(null);
    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', 90, 1, 3);

    expect(getCurrentMaxRestSeconds()).toBe(90);
  });

  it('does not overwrite an already-set value (subsequent re-syncs do not shrink)', async () => {
    (sud.getItem as jest.Mock).mockReturnValue(null);
    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', 90, 1, 3);
    // Re-sync passes a smaller "remaining" — must not shrink the denominator
    await updateWorkoutActivityForRest('Bench', 30, 1, 3);

    expect(getCurrentMaxRestSeconds()).toBe(90);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Use the worktree workaround per CLAUDE.md gotcha:

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/hooks/liveActivity-restoreMaxRest.test.ts
```

Expected: FAIL — first test expects 180, gets 60 (the remaining-seconds value).

- [ ] **Step 3: Apply the restore logic**

In `src/services/liveActivity.ts`, change the `currentMaxRestSeconds === 0` guard inside `updateWorkoutActivityForRest`. Replace the existing block (around line 169):

```typescript
    // Only set on initial rest start — re-syncs from useWidgetBridge pass remaining
    // seconds (not total), which would shrink the progress bar denominator.
    if (currentMaxRestSeconds === 0) currentMaxRestSeconds = totalSeconds;
```

with:

```typescript
    // If currentMaxRestSeconds is 0 (cold-start or post-OTA reload), try to
    // restore it from the persisted WorkoutState — that's where Task 1 stamps
    // the original max via syncStateToWidget. Only fall back to totalSeconds
    // (which on re-sync is *remaining* seconds, not total) when no persisted
    // max is available.
    if (currentMaxRestSeconds === 0) {
      const persisted = readPersistedMaxRestSeconds();
      currentMaxRestSeconds = persisted > 0 ? persisted : totalSeconds;
    }
```

Then add a private helper near the bottom of the file (just above the `scheduleTimerEndNotification` export):

```typescript
function readPersistedMaxRestSeconds(): number {
  try {
    const raw = getItem('liftai_workout_state');
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { restMaxSeconds?: number };
    return typeof parsed.restMaxSeconds === 'number' ? parsed.restMaxSeconds : 0;
  } catch {
    return 0;
  }
}
```

(This re-uses the already-imported `getItem` from `../../modules/shared-user-defaults`.)

- [ ] **Step 4: Run tests to verify all three pass**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/hooks/liveActivity-restoreMaxRest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/services/liveActivity.ts src/__tests__/hooks/liveActivity-restoreMaxRest.test.ts
git commit -m "fix(live-activity): restore currentMaxRestSeconds from persisted state on cold-start"
```

---

## Task 3: Write `|D` suffix in Swift `refreshLiveActivity`

Now that `restMaxSeconds` is in `WorkoutState`, the Swift intents can include it in the lock-screen subtitle so the widget's `ParsedSetState` extracts the correct progress bar denominator.

**Files:**
- Modify: `plugins/withInteractiveLiveActivity/swift/WorkoutIntents.swift:127-145`

- [ ] **Step 1: Update the resting-branch subtitle**

Replace lines 127-135 (the `if state.isResting` branch of `contentState` construction):

```swift
    if state.isResting {
        contentState = LiveActivityAttributes.ContentState(
            title: state.current.exerciseName,
            subtitle: "Set \(state.current.setNumber)/\(state.current.totalSets)",
            timerEndDateInMilliseconds: state.restEndTime,
            progress: nil,
            imageName: nil,
            dynamicIslandImageName: nil
        )
```

with:

```swift
    if state.isResting {
        // Encode the original rest duration in the subtitle as "Set X/Y|D" so
        // ParsedSetState.from() in the widget view can compute a proportional
        // progress bar denominator. Without |D, the bar uses Date.now...endDate
        // as its interval and resets to full-width after every +/-15s tap.
        let maxRest = state.restMaxSeconds > 0 ? state.restMaxSeconds : 0
        let subtitle = maxRest > 0
            ? "Set \(state.current.setNumber)/\(state.current.totalSets)|\(maxRest)"
            : "Set \(state.current.setNumber)/\(state.current.totalSets)"
        contentState = LiveActivityAttributes.ContentState(
            title: state.current.exerciseName,
            subtitle: subtitle,
            timerEndDateInMilliseconds: state.restEndTime,
            progress: nil,
            imageName: nil,
            dynamicIslandImageName: nil
        )
```

- [ ] **Step 2: Grep verification**

Run: `grep -n 'state.restMaxSeconds' plugins/withInteractiveLiveActivity/swift/WorkoutIntents.swift`
Expected: at least one match in `refreshLiveActivity`.

- [ ] **Step 3: Commit**

```bash
git add plugins/withInteractiveLiveActivity/swift/WorkoutIntents.swift
git commit -m "fix(live-activity): include |D suffix in widget intent refresh subtitle"
```

(Device verification requires `npx expo prebuild --clean` + a fresh build from `/Users/sachitgoyal/code/lift-ai/` after merge to main. Out of scope for this batch.)

---

## Task 4: Document existing Swift `readAndClearActions` atomicity

`WorkoutUserDefaultsHelper.readAndClearActions()` (lines 93-100) already reads-then-removes inside a single Swift function call. UserDefaults `synchronize()` is process-local; the operation is atomic *within* a single intent invocation. The bug from the original review (`applyPendingWidgetActions` non-atomic) lives on the **JS side**, not Swift — see Task 5.

**Files:**
- Modify: `plugins/withInteractiveLiveActivity/swift/WorkoutUserDefaultsHelper.swift:93-100` (comment only)

- [ ] **Step 1: Add a clarifying comment**

Before line 93's `func readAndClearActions() -> [WorkoutAction] {`, insert:

```swift
    /**
     * Atomically read and remove the action queue. Safe to call from concurrent
     * AppIntent invocations because each invocation runs on its own task and
     * synchronize() flushes the UserDefaults backing store before the next
     * call observes it. The corresponding JS-side drain (applyPendingWidgetActions)
     * is NOT atomic — see Task 5 for the matching native getItemAndRemove fix.
     */
```

- [ ] **Step 2: Commit**

```bash
git add plugins/withInteractiveLiveActivity/swift/WorkoutUserDefaultsHelper.swift
git commit -m "docs(live-activity): clarify Swift action-queue atomicity vs JS drain"
```

---

## Task 5: Add native atomic `getItemAndRemove` to SharedUserDefaults

JS-side `applyPendingWidgetActions` does `getItem` then `removeItem` as two separate native calls. If `AppState` fires `active` twice in quick succession, the second call can read the same queue before the first call's `removeItem` propagates → 2× timer adjustment. Replace with a single atomic native operation.

**Files:**
- Modify: `modules/shared-user-defaults/ios/SharedUserDefaultsModule.swift`
- Modify: `modules/shared-user-defaults/index.ts`
- Modify: `src/services/liveActivity.ts:290-308` (use new op)
- Test: `src/__tests__/services/liveActivity-applyPending.test.ts`

- [ ] **Step 1: Add the native function**

Edit `modules/shared-user-defaults/ios/SharedUserDefaultsModule.swift`. Inside `definition()`, after the existing `Function("removeItem")` block, add:

```swift
    Function("getItemAndRemove") { (key: String) -> String? in
      let defaults = UserDefaults(suiteName: self.appGroupID)
      defaults?.synchronize()
      let value = defaults?.string(forKey: key)
      if value != nil {
        defaults?.removeObject(forKey: key)
        defaults?.synchronize()
      }
      return value
    }
```

- [ ] **Step 2: Add the JS binding**

Edit `modules/shared-user-defaults/index.ts`. After the existing `removeItem` export:

```typescript
export function getItemAndRemove(key: string): string | null {
  return SharedUserDefaultsNative?.getItemAndRemove(key) ?? null;
}
```

- [ ] **Step 3: Write the failing test**

Create `src/__tests__/services/liveActivity-applyPending.test.ts`:

```typescript
/**
 * Tests for Batch 3 Task 5: applyPendingWidgetActions uses atomic
 * getItemAndRemove so two concurrent foreground events can't drain
 * the same queue twice.
 */
import { Platform } from 'react-native';

jest.mock('../../../modules/shared-user-defaults', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getItemAndRemove: jest.fn(),
}));

jest.mock('expo-live-activity', () => ({
  startActivity: jest.fn(),
  updateActivity: jest.fn(),
  stopActivity: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

(Platform as any).OS = 'ios';

const sud = require('../../../modules/shared-user-defaults');

describe('Batch 3 Task 5: applyPendingWidgetActions atomicity', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('reads via getItemAndRemove (not separate getItem + removeItem)', () => {
    (sud.getItemAndRemove as jest.Mock).mockReturnValue(
      JSON.stringify([{ type: 'adjustRest', delta: 15, ts: 1 }]),
    );
    const { applyPendingWidgetActions } = require('../../services/liveActivity');
    const delta = applyPendingWidgetActions();
    expect(delta).toBe(15);
    expect(sud.getItemAndRemove).toHaveBeenCalledWith('liftai_action_queue');
    expect(sud.getItem).not.toHaveBeenCalled();
    expect(sud.removeItem).not.toHaveBeenCalled();
  });

  it('handles an empty queue (no actions present)', () => {
    (sud.getItemAndRemove as jest.Mock).mockReturnValue(null);
    const { applyPendingWidgetActions } = require('../../services/liveActivity');
    expect(applyPendingWidgetActions()).toBe(0);
  });

  it('returns -Infinity when a skipRest action is present', () => {
    (sud.getItemAndRemove as jest.Mock).mockReturnValue(
      JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: 1 },
        { type: 'skipRest', ts: 2 },
      ]),
    );
    const { applyPendingWidgetActions } = require('../../services/liveActivity');
    expect(applyPendingWidgetActions()).toBe(-Infinity);
  });

  it('sums multiple adjustRest deltas', () => {
    (sud.getItemAndRemove as jest.Mock).mockReturnValue(
      JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: 1 },
        { type: 'adjustRest', delta: -15, ts: 2 },
        { type: 'adjustRest', delta: 15, ts: 3 },
      ]),
    );
    const { applyPendingWidgetActions } = require('../../services/liveActivity');
    expect(applyPendingWidgetActions()).toBe(15);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/liveActivity-applyPending.test.ts`
Expected: FAIL — current code calls `getItem`, not `getItemAndRemove`.

- [ ] **Step 5: Swap to the atomic op in liveActivity.ts**

In `src/services/liveActivity.ts`, update the import at the top:

```typescript
import { getItem, getItemAndRemove } from '../../modules/shared-user-defaults';
```

(`removeItem` is no longer needed in this file. If grep shows other usages, keep the import; otherwise remove `removeItem` from the import list.)

Run `grep -n 'removeItem' src/services/liveActivity.ts` to confirm — if no other matches, drop it from the import. If any remain, keep it.

Replace `applyPendingWidgetActions` (lines 290-308) with:

```typescript
export function applyPendingWidgetActions(): number {
  if (Platform.OS !== 'ios') return 0;
  try {
    const raw = getItemAndRemove('liftai_action_queue');
    if (!raw) return 0;
    const actions: { type: string; delta?: number; ts: number }[] = JSON.parse(raw);
    let totalDelta = 0;
    for (const action of actions) {
      if (action.type === 'skipRest') return -Infinity;
      if (action.type === 'adjustRest' && action.delta != null) {
        totalDelta += action.delta;
      }
    }
    return totalDelta;
  } catch (e) {
    Sentry.captureException(e);
    return 0;
  }
}
```

- [ ] **Step 6: Run tests to verify all four pass**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/liveActivity-applyPending.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add modules/shared-user-defaults/ios/SharedUserDefaultsModule.swift modules/shared-user-defaults/index.ts src/services/liveActivity.ts src/__tests__/services/liveActivity-applyPending.test.ts
git commit -m "fix(live-activity): atomic getItemAndRemove prevents double-drain of widget action queue"
```

---

## Task 6: Debounce notification cancel+reschedule in `adjustRestTimerActivity`

Five rapid `+15s` taps currently fire 10 expo-notifications calls (5 cancels, 5 schedules). Only the final position matters. Collapse rapid adjustments via a 300ms debounce: each adjust clears any pending reschedule timer and sets a new one. The actual cancel+schedule only runs when 300ms passes with no further adjusts.

**Files:**
- Modify: `src/services/liveActivity.ts:235-261` (adjustRestTimerActivity)
- Test: `src/__tests__/hooks/liveActivity-notificationDebounce.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/hooks/liveActivity-notificationDebounce.test.ts`:

```typescript
/**
 * Tests for Batch 3 Task 6: adjustRestTimerActivity coalesces rapid taps
 * into a single notification reschedule.
 */
import { Platform } from 'react-native';

jest.mock('../../../modules/shared-user-defaults', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getItemAndRemove: jest.fn(),
}));

jest.mock('expo-live-activity', () => ({
  startActivity: jest.fn(() => 'activity-id'),
  updateActivity: jest.fn(),
  stopActivity: jest.fn(),
}));

const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockSchedule = jest.fn().mockResolvedValue('notif-id');

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: mockSchedule,
  cancelScheduledNotificationAsync: mockCancel,
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

(Platform as any).OS = 'ios';

describe('Batch 3 Task 6: adjust debounces notification reschedules', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces 5 rapid +15s taps into a single cancel+schedule', async () => {
    const { startWorkoutActivity, updateWorkoutActivityForRest, adjustRestTimerActivity } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', 60, 1, 3);

    // Drain the initial scheduleRestNotification call (if any) by running pending microtasks
    await Promise.resolve();
    mockSchedule.mockClear();
    mockCancel.mockClear();

    // Five rapid +15s adjustments
    for (let i = 0; i < 5; i++) {
      await adjustRestTimerActivity(15);
    }

    // Before the debounce window elapses, no notification ops should have fired
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();

    // After the 300ms debounce window, exactly one cancel + one schedule
    await jest.advanceTimersByTimeAsync(350);
    await Promise.resolve();

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a notification if the final remaining time is <= 0', async () => {
    const { startWorkoutActivity, updateWorkoutActivityForRest, adjustRestTimerActivity } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', 30, 1, 3);
    await Promise.resolve();
    mockSchedule.mockClear();
    mockCancel.mockClear();

    // -45s puts the timer past zero
    await adjustRestTimerActivity(-45);

    await jest.advanceTimersByTimeAsync(350);
    await Promise.resolve();

    // Cancel always runs; schedule must NOT run when remaining <= 0
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/hooks/liveActivity-notificationDebounce.test.ts`
Expected: FAIL — first test sees 5 cancels and 5 schedules instead of 1 each.

- [ ] **Step 3: Apply the debounce**

In `src/services/liveActivity.ts`, near the other module-level state at the top (around line 23), add:

```typescript
let pendingNotificationReschedule: { endTime: number; timeoutId: ReturnType<typeof setTimeout> } | null = null;
const NOTIFICATION_DEBOUNCE_MS = 300;
```

Replace `adjustRestTimerActivity` (lines 235-261) with:

```typescript
export async function adjustRestTimerActivity(deltaSeconds: number): Promise<void> {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    const newEndTime = currentEndTime + deltaSeconds * 1000;
    currentEndTime = newEndTime;
    if (deltaSeconds > 0) currentMaxRestSeconds += deltaSeconds;

    safeUpdateActivity({
      title: currentExerciseName,
      subtitle: `Set ${currentSetNumber}/${currentTotalSets}|${currentMaxRestSeconds}`,
      progressBar: { date: newEndTime },
    });

    // Debounce the notification reschedule. Rapid +/-15s taps would otherwise
    // fire one cancel + one schedule per tap; we only need the FINAL position
    // reflected in the system notification.
    if (pendingNotificationReschedule) {
      clearTimeout(pendingNotificationReschedule.timeoutId);
    }
    const timeoutId = setTimeout(() => {
      pendingNotificationReschedule = null;
      const remainingSeconds = Math.max(0, Math.round((currentEndTime - Date.now()) / 1000));
      serializedNotificationOp(async () => {
        await cancelTimerEndNotification();
        if (remainingSeconds > 0) {
          await scheduleTimerEndNotification(remainingSeconds);
        }
      });
    }, NOTIFICATION_DEBOUNCE_MS);
    pendingNotificationReschedule = { endTime: newEndTime, timeoutId };
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to adjust rest timer', e);
    Sentry.captureException(e);
  }
}
```

- [ ] **Step 4: Clear pending reschedule on stop / start**

The debounced reschedule must not fire after the rest is dismissed. Two cleanup hooks needed:

In `stopRestTimerActivity` (around line 263), right after the existing `serializedNotificationOp(() => cancelTimerEndNotification());` call, add:

```typescript
  if (pendingNotificationReschedule) {
    clearTimeout(pendingNotificationReschedule.timeoutId);
    pendingNotificationReschedule = null;
  }
```

In `stopWorkoutActivity` (around line 188), inside the existing cleanup block (right before `serializedNotificationOp(() => cancelTimerEndNotification());`), add the same three lines.

In `startWorkoutActivity` (around line 116, near the existing `pendingUpdate` reset block), add:

```typescript
    if (pendingNotificationReschedule) {
      clearTimeout(pendingNotificationReschedule.timeoutId);
      pendingNotificationReschedule = null;
    }
```

- [ ] **Step 5: Run tests to verify both pass**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/hooks/liveActivity-notificationDebounce.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/services/liveActivity.ts src/__tests__/hooks/liveActivity-notificationDebounce.test.ts
git commit -m "fix(live-activity): debounce notification cancel+reschedule on rapid adjust taps"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full Jest suite (worktree workaround)**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -10
```
Expected: all suites pass; test count grows by 3 new files (~9 new tests).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Grep checks**

```bash
echo "=== restMaxSeconds (RN side) ==="
grep -rn 'restMaxSeconds' src/services src/hooks

echo "=== restMaxSeconds (Swift side) ==="
grep -n 'restMaxSeconds' plugins/withInteractiveLiveActivity/swift/

echo "=== getItemAndRemove usage ==="
grep -rn 'getItemAndRemove' src/ modules/

echo "=== notification debounce ==="
grep -n 'pendingNotificationReschedule\|NOTIFICATION_DEBOUNCE_MS' src/services/liveActivity.ts
```
Expected: all four checks return matches at the expected sites; no orphan references.

- [ ] **Step 4: Code review (mandatory gate per CLAUDE.md)**

```
/code-review deep --spec docs/superpowers/plans/2026-05-17-batch-3-live-activity-correctness.md
```
Address actionable findings, then re-run grep and tests.

---

## Risks and rollback

- **WorkoutState schema change.** Existing builds on user devices have a `WorkoutState` JSON without `restMaxSeconds`. Task 1 Step 3 adds a backward-compatible Swift decoder that defaults the new field to 0. On the JS side, the existing read paths (`JSON.parse(raw)`) tolerate extra/missing properties natively. Rollback: revert the schema change; older builds keep working.
- **Notification debounce delays the first alert by 300ms.** A user who taps +15s and immediately backgrounds the app might see the notification fire 300ms later than today. Acceptable.
- **Atomic `getItemAndRemove` is a new native function.** Requires `npx expo prebuild --clean` to surface in the iOS module. Tasks 5 + 6 device verification is deferred to the main-branch build pipeline.
- **JS module re-instantiation.** If Metro hot-reloads `liveActivity.ts`, the module-level state (`currentMaxRestSeconds`, `pendingNotificationReschedule`, etc.) resets. Task 2's `readPersistedMaxRestSeconds` recovers gracefully; the pending debounce timer is lost on reload but the next adjust restarts it.

---

## Self-review notes

- Spec coverage: 4 review findings (Swift `|D`, `currentMaxRestSeconds` resume, atomic action drain, notification debounce) → covered by Tasks 1+3 (schema + Swift subtitle), Task 2 (restore), Task 5 (atomic op), Task 6 (debounce). ✓
- Placeholder scan: none. ✓
- Type consistency: `restMaxSeconds` is `number` in TS / `Int` in Swift, used consistently in all touched files. Function name `getItemAndRemove` matches between native module and TS binding. ✓
- TDD ordering: each task except 3 (Swift-only) and 4 (comment) writes the failing test first, then the implementation. Tasks 3 and 4 are verified by Task 7's grep + the post-merge device smoke. ✓
- Files touched: 6 source + 3 test = 9 files. Same magnitude as Batch 2. ✓
- Device verification deferred per CLAUDE.md worktree gotcha; documented in the header. ✓
