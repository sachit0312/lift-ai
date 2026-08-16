# Interactive Rest Timer Live Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable `-15s` and `+15s` controls to the iOS 17+ Lock Screen Live Activity and expanded Dynamic Island while keeping the React Native timer and local notification synchronized.

**Architecture:** JavaScript and the native App Intent share one versioned App Group `RestTimerSnapshot` containing an absolute deadline and progress denominator. Zero-parameter `LiveActivityIntent` buttons serialize native adjustments, update the matching ActivityKit activity and stable notification immediately, and the existing rest hook adopts the snapshot once on foreground return. No action queue or polling loop is introduced.

**Tech Stack:** React Native 0.81, Expo 54, TypeScript, Jest, SwiftUI, ActivityKit, AppIntents, UserNotifications, Expo config plugins.

## Global Constraints

- Scope is rest controls only: no weight, reps, RPE, set completion, skip-rest, or non-rest controls.
- Controls appear only on iOS 17+ Lock Screen and expanded Dynamic Island presentations.
- Compact, minimal, and iOS 16 presentations remain read-only.
- All timing uses an absolute epoch-millisecond deadline; never reconstruct the deadline from rounded remaining seconds.
- `+15s` grows the progress denominator; `-15s` never shrinks it.
- Use the stable notification identifier `liftai-rest-complete` and preserve current title, body, sound, and time-sensitive interruption level.
- Do not reintroduce `liftai_action_queue`, `workoutBridge`, a polling interval, or array-index workout commands.
- Swift plugin changes require `npx expo prebuild --clean` and a physical-iPhone native build from `/Users/sachitgoyal/code/lift-ai`.

---

### Task 1: Versioned App Group rest snapshot

**Files:**
- Create: `src/services/restTimerSnapshot.ts`
- Create: `src/services/__tests__/restTimerSnapshot.test.ts`
- Modify: `src/__mocks__/shared-user-defaults.ts`

**Interfaces:**
- Consumes: `getItem`, `setItem`, and `removeItem` from `modules/shared-user-defaults`; `uuid()` from `src/utils/uuid.ts`.
- Produces: `RestTimerSnapshot`, `createRestTimerSessionId`, `createRestTimerSnapshot`, `readRestTimerSnapshot`, `writeRestTimerSnapshot`, and `clearRestTimerSnapshot`.

- [ ] **Step 1: Write failing snapshot contract tests**

Create tests that use the real snapshot module with the existing in-memory SharedUserDefaults mock:

```ts
it('round-trips a valid active rest snapshot', () => {
  const snapshot = createRestTimerSnapshot({
    sessionId: 'session-1',
    activityId: 'activity-1',
    exerciseName: 'Bench Press',
    setNumber: 2,
    totalSets: 4,
    endTimeMs: 1_800_000,
    maxRestSeconds: 120,
  });
  writeRestTimerSnapshot(snapshot);
  expect(readRestTimerSnapshot()).toEqual(snapshot);
});

it('rejects malformed and unsupported snapshots', () => {
  setItem('liftai_rest_timer_snapshot', JSON.stringify({ version: 99 }));
  expect(readRestTimerSnapshot()).toBeNull();
});

it('clears the snapshot', () => {
  writeRestTimerSnapshot(validSnapshot);
  clearRestTimerSnapshot();
  expect(readRestTimerSnapshot()).toBeNull();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest src/services/__tests__/restTimerSnapshot.test.ts --runInBand`

Expected: FAIL because `restTimerSnapshot.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal snapshot module**

Define this exact wire contract:

```ts
export interface RestTimerSnapshot {
  version: 1;
  sessionId: string;
  activityId: string;
  exerciseName: string;
  setNumber: number;
  totalSets: number;
  endTimeMs: number;
  maxRestSeconds: number;
  isActive: boolean;
  updatedAtMs: number;
  writer: 'javascript' | 'intent';
}
```

Use the key `liftai_rest_timer_snapshot`. Validate every field when reading; return `null` for malformed JSON, unsupported versions, non-finite numbers, empty IDs/names, or invalid set counts. `createRestTimerSessionId()` returns a fresh UUID. Snapshot creation accepts that session ID and supplies `isActive: true`, `writer: 'javascript'`, and `Date.now()`.

- [ ] **Step 4: Run the snapshot tests and verify GREEN**

Run: `npx jest src/services/__tests__/restTimerSnapshot.test.ts --runInBand`

Expected: PASS with all snapshot behaviors covered.

- [ ] **Step 5: Commit the snapshot contract**

```bash
git add src/services/restTimerSnapshot.ts src/services/__tests__/restTimerSnapshot.test.ts src/__mocks__/shared-user-defaults.ts
git commit -m "feat: add shared rest timer snapshot"
```

### Task 2: Mirror JavaScript rest lifecycle into the snapshot

**Files:**
- Modify: `src/services/liveActivity.ts`
- Modify: `src/services/__tests__/liveActivity.test.ts`
- Modify: `src/__tests__/hooks/liveActivity-restDeadline.test.ts`

**Interfaces:**
- Consumes: Task 1 snapshot APIs.
- Produces: a current snapshot after every rest start or in-app adjustment, and no snapshot after rest/workout stop.

- [ ] **Step 1: Write failing lifecycle tests**

Add behavioral tests around public Live Activity functions:

```ts
it('writes an absolute-deadline snapshot when rest starts', async () => {
  await updateWorkoutActivityForRest('Bench Press', 1_800_000, 2, 4, 120);
  expect(readRestTimerSnapshot()).toMatchObject({
    activityId: 'activity-1',
    exerciseName: 'Bench Press',
    setNumber: 2,
    totalSets: 4,
    endTimeMs: 1_800_000,
    maxRestSeconds: 120,
    isActive: true,
  });
});

it('grows only the denominator on positive adjustment', async () => {
  await adjustRestTimerActivity(15);
  expect(readRestTimerSnapshot()).toMatchObject({
    endTimeMs: 1_815_000,
    maxRestSeconds: 135,
  });
});

it('clears shared rest state when rest stops', () => {
  stopRestTimerActivity();
  expect(readRestTimerSnapshot()).toBeNull();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx jest src/services/__tests__/liveActivity.test.ts src/__tests__/hooks/liveActivity-restDeadline.test.ts --runInBand`

Expected: FAIL because the Live Activity service does not create or maintain the snapshot.

- [ ] **Step 3: Implement lifecycle snapshot writes**

In `liveActivity.ts`:

- Start a fresh snapshot session in `resetRestProgressBaseline()`, return its session ID, and clear the previous snapshot.
- Write the complete snapshot after `updateWorkoutActivityForRest` establishes the current deadline, labels, and denominator.
- Rewrite the same session after `refreshWorkoutActivityDuringRest` and `adjustRestTimerActivity`.
- Preserve `maxRestSeconds` on negative adjustments and grow it on positive adjustments.
- Clear the snapshot and session ID in both `stopRestTimerActivity` and `stopWorkoutActivity`.
- Catch snapshot bridge failures and report them to Sentry without preventing ActivityKit or notification updates.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx jest src/services/__tests__/liveActivity.test.ts src/__tests__/hooks/liveActivity-restDeadline.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit lifecycle mirroring**

```bash
git add src/services/liveActivity.ts src/services/__tests__/liveActivity.test.ts src/__tests__/hooks/liveActivity-restDeadline.test.ts
git commit -m "feat: mirror active rest state for intents"
```

### Task 3: Reconcile intent-written deadlines on foreground return

**Files:**
- Modify: `src/hooks/useRestTimer.ts`
- Modify: `src/hooks/__tests__/useRestTimer.test.ts`

**Interfaces:**
- Consumes: `readRestTimerSnapshot()` from Task 1 and the current active rest refs.
- Produces: foreground adoption of an intent-written absolute deadline and denominator without replaying an adjustment.

- [ ] **Step 1: Write failing reconciliation tests**

Mock only the snapshot boundary and keep the real hook behavior:

```ts
it('adopts an intent-written deadline and denominator on foreground return', () => {
  startRest(120);
  mockReadRestTimerSnapshot.mockReturnValue({
    ...activeSnapshot,
    endTimeMs: originalDeadline + 15_000,
    maxRestSeconds: 135,
    writer: 'intent',
  });
  act(() => appStateCallback?.('active'));
  expect(result.current.currentEndTime).toBe(originalDeadline + 15_000);
  expect(result.current.restTotal).toBe(135);
  expect(adjustRestTimerActivity).not.toHaveBeenCalled();
});

it('ends a rest when the matching shared snapshot is inactive', () => {
  startRest(10);
  mockReadRestTimerSnapshot.mockReturnValue({ ...activeSnapshot, isActive: false });
  act(() => appStateCallback?.('active'));
  expect(result.current.isResting).toBe(false);
  expect(Vibration.vibrate).not.toHaveBeenCalled();
});
```

Also cover malformed/missing snapshots and snapshots from a different session.

- [ ] **Step 2: Run the hook suite and verify RED**

Run: `npx jest src/hooks/__tests__/useRestTimer.test.ts --runInBand`

Expected: FAIL because foreground return ignores the shared snapshot.

- [ ] **Step 3: Implement one-shot reconciliation**

Capture the session ID returned by `resetRestProgressBaseline()` in a hook ref when a rest starts. On `AppState === 'active'`, read the snapshot before calculating remaining time. Adopt only a matching session. Copy `endTimeMs` and `maxRestSeconds` into refs and state. If inactive or expired, call `endRest(false)` and return. Do not call `adjustRestTimerActivity`, schedule notifications, or push widget state during reconciliation.

- [ ] **Step 4: Run the hook suite and verify GREEN**

Run: `npx jest src/hooks/__tests__/useRestTimer.test.ts --runInBand`

Expected: PASS with the existing background-vibration tests unchanged.

- [ ] **Step 5: Commit foreground reconciliation**

```bash
git add src/hooks/useRestTimer.ts src/hooks/__tests__/useRestTimer.test.ts
git commit -m "feat: reconcile native rest adjustments"
```

### Task 4: Add native App Intents and interactive SwiftUI controls

**Files:**
- Create: `plugins/withInteractiveLiveActivity/swift/LiveActivityAttributes.swift`
- Create: `plugins/withInteractiveLiveActivity/swift/RestTimerIntents.swift`
- Create: `plugins/withInteractiveLiveActivity/swift/RestTimerSnapshotStore.swift`
- Modify: `plugins/withInteractiveLiveActivity/swift/InteractiveLiveActivityWidget.swift`
- Modify: `plugins/withInteractiveLiveActivity/swift/InteractiveLiveActivityView.swift`
- Modify: `plugins/withInteractiveLiveActivity/index.js`
- Generated by clean prebuild: `ios/LiveActivity/LiveActivityAttributes.swift`
- Generated by clean prebuild: `ios/LiveActivity/RestTimerIntents.swift`
- Generated by clean prebuild: `ios/LiveActivity/RestTimerSnapshotStore.swift`

**Interfaces:**
- Consumes: the exact Task 1 JSON wire contract and existing `Set X/Y|D` subtitle format.
- Produces: zero-parameter `DecreaseRestIntent` and `IncreaseRestIntent`, immediate ActivityKit refresh, immediate stable-notification replacement, and 44-point SwiftUI buttons.

- [ ] **Step 1: Add the shared ActivityKit schema and snapshot decoder**

Move `LiveActivityAttributes` unchanged out of `InteractiveLiveActivityWidget.swift` into `LiveActivityAttributes.swift`. Implement a Swift `Codable` snapshot matching every Task 1 field and a store using `UserDefaults(suiteName: "group.com.sachitgoyal.liftai")` with safe decode/no-op behavior.

- [ ] **Step 2: Implement zero-parameter intents**

Create iOS 17-gated `DecreaseRestIntent` and `IncreaseRestIntent` conforming to `LiveActivityIntent`. Route both through one actor:

```swift
@available(iOS 17.0, *)
actor RestTimerIntentCoordinator {
  static let shared = RestTimerIntentCoordinator()

  func adjust(by deltaSeconds: Int) async {
    guard var snapshot = RestTimerSnapshotStore.shared.read(), snapshot.isActive else { return }
    let nowMs = Date().timeIntervalSince1970 * 1000
    guard snapshot.endTimeMs > nowMs else { return }

    let nextEndTimeMs = snapshot.endTimeMs + Double(deltaSeconds * 1000)
    snapshot.updatedAtMs = nowMs
    snapshot.writer = "intent"

    if nextEndTimeMs <= nowMs {
      snapshot.endTimeMs = 0
      snapshot.isActive = false
      RestTimerSnapshotStore.shared.write(snapshot)
      await updateLiveActivity(snapshot)
      await replaceRestNotification(snapshot)
      return
    }

    snapshot.endTimeMs = nextEndTimeMs
    if deltaSeconds > 0 { snapshot.maxRestSeconds += deltaSeconds }
    RestTimerSnapshotStore.shared.write(snapshot)
    await updateLiveActivity(snapshot)
    await replaceRestNotification(snapshot)
  }
}
```

The actor validates an active unexpired snapshot, adjusts the absolute deadline, grows the denominator only for positive deltas, writes `writer = "intent"`, updates only the Activity whose ID matches `snapshot.activityId`, moves `staleDate`, and replaces `liftai-rest-complete`. A negative adjustment crossing zero writes `isActive = false`, renders the non-rest `Set X/Y` state, and cancels the notification.

- [ ] **Step 3: Add the buttons to the two interactive presentations**

Add a reusable iOS 17-gated `RestTimerControls` view with 44-point `-15s` and `+15s` buttons, plain button style, visible pressed affordance, and explicit accessibility labels. Render it:

- below the Lock Screen progress bar in `UnifiedWorkoutView`;
- below the expanded Dynamic Island progress bar;
- nowhere in compact, minimal, non-rest, stale, or iOS 16 states.

- [ ] **Step 4: Register shared Swift sources idempotently**

Extend the finalized Expo plugin to copy all three new Swift files. Add one file reference per source and one sources-build-phase entry to each required native target, skipping entries already present. Keep both App Group entitlements. Repeated clean prebuilds must produce no duplicate source entries.

- [ ] **Step 5: Run a clean prebuild as the native integration test**

Run: `npx expo prebuild --clean`

Expected: exit 0; generated `ios/LiveActivity` files match plugin sources; each new Swift file appears once in the relevant PBX source phases; App Group entitlements remain present.

- [ ] **Step 6: Commit native controls and generated project changes**

```bash
git add plugins/withInteractiveLiveActivity ios app.config.ts
git commit -m "feat: add interactive rest timer controls"
```

### Task 5: Full validation, device verification, and review

**Files:**
- Review scope: all changes since design commit `f6349f6`.
- Spec: `docs/superpowers/specs/2026-08-16-interactive-rest-timer-live-activity-design.md`.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: evidence-backed test/build status and an independent deep code review.

- [ ] **Step 1: Run focused tests**

```bash
npx jest src/services/__tests__/restTimerSnapshot.test.ts src/services/__tests__/liveActivity.test.ts src/__tests__/hooks/liveActivity-restDeadline.test.ts src/hooks/__tests__/useRestTimer.test.ts --runInBand
```

Expected: all focused suites pass with zero failures.

- [ ] **Step 2: Run repository verification**

```bash
npx tsc --noEmit
npm test -- --runInBand
```

Expected: both commands exit 0.

- [ ] **Step 3: Run physical-device preflight and native build**

Follow `.agents/skills/run-on-device/SKILL.md`: verify main checkout, `.env.development`, paired device, and Metro port; because Swift plugin files changed, use a clean prebuild. Build with the paired hardware UDID and `SENTRY_DISABLE_AUTO_UPLOAD=true`, then install/launch with `devicectl` if Expo hangs after `Build Succeeded`.

Expected: a real Xcode build succeeds, the app installs, and it launches on the paired iPhone.

- [ ] **Step 4: Verify the physical interaction matrix**

On the device, validate single and rapid `+15s`, single and zero-crossing `-15s`, notification movement/cancellation, foreground convergence, expanded Island controls, read-only compact Island, and untouched locked expiry. Record anything that cannot be exercised without user interaction as outstanding rather than claiming it passed.

- [ ] **Step 5: Run a deep read-only code review**

Use the `code-review` skill in deep mode against the implementation scope with Correctness, Plan alignment, Security and concurrency, and Test quality coverage as allowed by the review panel cap. Fix every Critical or Important finding test-first, rerun relevant verification, and repeat review until no blocking findings remain.

- [ ] **Step 6: Commit review fixes and final verification state**

```bash
git add src/services/restTimerSnapshot.ts src/services/liveActivity.ts src/hooks/useRestTimer.ts src/services/__tests__/restTimerSnapshot.test.ts src/services/__tests__/liveActivity.test.ts src/__tests__/hooks/liveActivity-restDeadline.test.ts src/hooks/__tests__/useRestTimer.test.ts plugins/withInteractiveLiveActivity ios/LiveActivity ios/liftai.xcodeproj/project.pbxproj
git commit -m "fix: harden interactive rest controls"
```

Skip the final commit when review produces no changes. Do not push or deploy unless the user asks.
