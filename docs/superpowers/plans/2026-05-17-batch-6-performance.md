# Batch 6: Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six surgical performance fixes targeting startup time, render churn, and SQLite write throughput: lazy-load tab screens, lazy-load `ExerciseHistoryContent`, drop the unused per-second `restSeconds` state, merge three 1RM JOIN scans into one, batch-update set order with a single CASE WHEN statement (both `stampExerciseOrder` and `updateTemplateExerciseOrder`), and stop blowing up dev Sentry tracing.

**Architecture:** Each fix is bounded to one or two files. No new abstractions. The 1RM merge introduces a small `getE1RMSummary` function that returns `{ best, current, confidence }` in one pass; existing callers can adopt incrementally.

**Tech Stack:** React Native (Expo), TypeScript, expo-sqlite, `@sentry/react-native`, React.lazy + Suspense.

**Repo:** This worktree (`/Users/sachitgoyal/code/lift-ai/.claude/worktrees/brave-spence-530049/`). Branch: `claude/brave-spence-530049`.

---

## File Structure

**Modified files (6):**
- `src/hooks/useRestTimer.ts` — Task 1 (drop unused state)
- `src/navigation/TabNavigator.tsx` — Task 2 (lazy tab screens)
- `src/components/ExerciseDetailModal.tsx` — Task 3 (lazy chart bundle)
- `src/services/database.ts` — Tasks 4, 5, 6 (1RM merge + batch UPDATEs)
- `src/components/ExerciseHistoryContent.tsx` — Task 4 caller migration
- `App.tsx` — Task 7 (Sentry dev sampling)

**New test files (3):**
- `src/__tests__/services/database-getE1RMSummary.test.ts`
- `src/__tests__/services/database-stampExerciseOrder-batched.test.ts`
- `src/__tests__/services/database-updateTemplateExerciseOrder-batched.test.ts`

---

## Task 1: Drop unused per-second `restSeconds` state in `useRestTimer`

**Problem.** `useRestTimer` keeps a `restSeconds` state that's updated every second from the interval (`setRestSeconds(remaining)` at line 88). WorkoutScreen destructures `restTotal`, `restExerciseName`, `isResting`, `currentEndTime`, `startRestTimer`, `adjustRestTimer`, `dismissRest` — but NOT `restSeconds`. The state update causes WorkoutScreen to re-render every second during rest, while the visible countdown is driven by RestTimerBar's own internal state (it computes `remaining` from `endTime` independently). Double tick + wasted parent re-render.

**Files:**
- Modify: `src/hooks/useRestTimer.ts`

(No new test file — verified by grep that the field is gone from the public return and the interval no longer calls `setRestSeconds`.)

- [ ] **Step 1: Remove the unused state and its setter calls**

Open `src/hooks/useRestTimer.ts`. Locate line 17 in the `UseRestTimerReturn` interface:

```typescript
  restSeconds: number;
```

Delete that line.

Locate line 28:

```typescript
  const [restSeconds, setRestSeconds] = useState(0);
```

Delete that line.

In `endRest` (around line 54), find:

```typescript
    setRestSeconds(0);
```

Delete that line.

In `startRestTimer` (around line 71), find:

```typescript
    setRestSeconds(total);
```

Delete that line.

Inside `startRestTimer`'s `setInterval` body (around line 88), find:

```typescript
    restRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.round((currentEndTimeRef.current - Date.now()) / 1000));
      setRestSeconds(remaining);

      if (remaining <= 0) {
```

Remove the `setRestSeconds(remaining);` line. The `remaining` local is still needed for the `if (remaining <= 0)` check.

In `adjustRestTimer` (around line 101-117), find any `setRestSeconds(...)` call and remove it.

In the `return` block at line ~171, find and delete:

```typescript
    restSeconds,
```

- [ ] **Step 2: Build + tests**

```
npx tsc --noEmit
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: tsc 0, all tests pass. If any test asserts on the `restSeconds` return field, update those tests (only useSetCompletion/useRestTimer tests are likely consumers).

- [ ] **Step 3: Grep verify**

```bash
grep -rn 'restSeconds' src/hooks/useRestTimer.ts src/screens/WorkoutScreen.tsx
```
Expected: zero matches in `useRestTimer.ts`; zero matches for `restSeconds` (the destructured name) in `WorkoutScreen.tsx`. The `block.restSeconds` references in other hooks are unrelated (that's a field on `ExerciseBlock`).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRestTimer.ts
git commit -m "perf(rest-timer): drop unused per-second restSeconds state to stop WorkoutScreen re-renders during rest"
```

---

## Task 2: Lazy-load tab screens

**Problem.** `TabNavigator.tsx` statically imports all 7 screen components (`WorkoutScreen`, `TemplatesScreen`, `TemplateDetailScreen`, `ExercisePickerScreen`, `HistoryScreen`, `ProfileScreen`, `ExercisesScreen`) at the top of the module. Every transitive import (chart-kit, drag library, etc.) is parsed at app boot. Lazy-loading the non-default tabs cuts TTI by 150-300ms on mid-range devices.

**Files:**
- Modify: `src/navigation/TabNavigator.tsx`

- [ ] **Step 1: Convert non-default tab screen imports to React.lazy**

Replace the top of `src/navigation/TabNavigator.tsx`:

```typescript
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize } from '../theme';
import WorkoutScreen from '../screens/WorkoutScreen';
import TemplatesScreen from '../screens/TemplatesScreen';
import TemplateDetailScreen from '../screens/TemplateDetailScreen';
import ExercisePickerScreen from '../screens/ExercisePickerScreen';
import HistoryScreen from '../screens/HistoryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ExercisesScreen from '../screens/ExercisesScreen';
```

with:

```typescript
import React, { Suspense } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize } from '../theme';
// Workout is the default tab — keep eager so cold-start renders the first frame immediately.
import WorkoutScreen from '../screens/WorkoutScreen';
import TemplatesScreen from '../screens/TemplatesScreen';
import TemplateDetailScreen from '../screens/TemplateDetailScreen';
import ExercisePickerScreen from '../screens/ExercisePickerScreen';

// Lazy: these tabs pull heavy transitive deps (chart-kit, etc.) that don't need
// to parse at boot. React.lazy with a Suspense fallback shifts the cost to first
// activation of each tab.
const HistoryScreen = React.lazy(() => import('../screens/HistoryScreen'));
const ProfileScreen = React.lazy(() => import('../screens/ProfileScreen'));
const ExercisesScreen = React.lazy(() => import('../screens/ExercisesScreen'));

function TabScreenFallback() {
  return (
    <View style={fallbackStyles.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});

// Wrap a lazy screen with Suspense so each tab can be loaded independently.
// React Navigation's tab routes mount the component eagerly when the tab is
// selected; Suspense yields a fallback frame while the chunk parses.
function lazyTabScreen<P extends object>(Component: React.LazyExoticComponent<React.ComponentType<P>>): React.ComponentType<P> {
  return function LazyTabScreen(props: P) {
    return (
      <Suspense fallback={<TabScreenFallback />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

const HistoryTab = lazyTabScreen(HistoryScreen);
const ProfileTab = lazyTabScreen(ProfileScreen);
const ExercisesTab = lazyTabScreen(ExercisesScreen);
```

Then update the `<Tab.Screen>` references at the bottom. Find:

```typescript
      <Tab.Screen name="Workout" component={WorkoutScreen} />
      <Tab.Screen name="Templates" component={TemplatesStack} />
      <Tab.Screen name="Exercises" component={ExercisesScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
```

Replace with:

```typescript
      <Tab.Screen name="Workout" component={WorkoutScreen} />
      <Tab.Screen name="Templates" component={TemplatesStack} />
      <Tab.Screen name="Exercises" component={ExercisesTab} />
      <Tab.Screen name="History" component={HistoryTab} />
      <Tab.Screen name="Profile" component={ProfileTab} />
```

- [ ] **Step 2: Build + tests**

```
npx tsc --noEmit
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: tsc 0, all tests pass. If any test snapshots or asserts on the rendered tree of TabNavigator, it should still pass because Suspense wraps the same component type.

- [ ] **Step 3: Grep verify**

```bash
grep -n 'React.lazy\|lazyTabScreen' src/navigation/TabNavigator.tsx
```
Expected: 3 `React.lazy` matches (History, Profile, Exercises) + 3 `lazyTabScreen` usages.

- [ ] **Step 4: Commit**

```bash
git add src/navigation/TabNavigator.tsx
git commit -m "perf(nav): lazy-load History/Profile/Exercises tabs to cut TTI"
```

---

## Task 3: Lazy-load `ExerciseHistoryContent` inside `ExerciseDetailModal`

**Problem.** `ExerciseDetailModal` statically imports `ExerciseHistoryContent`, which imports `react-native-chart-kit` (which depends on `react-native-svg`). The modal is reachable from WorkoutScreen, ExercisesScreen, and HistoryScreen — any of those static-imports the chart bundle into the relevant chunk. Defer chart loading until the user actually taps the History tab inside the modal.

**Files:**
- Modify: `src/components/ExerciseDetailModal.tsx`

- [ ] **Step 1: Convert the import to React.lazy + gate on tab activation**

Open `src/components/ExerciseDetailModal.tsx`. Add `React.lazy` + `Suspense` to the existing react import at line 1:

```typescript
import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
```

Replace the existing static import at line 20:

```typescript
import ExerciseHistoryContent from './ExerciseHistoryContent';
```

with:

```typescript
// Lazy: ExerciseHistoryContent pulls react-native-chart-kit (+ react-native-svg).
// Loading at mount would parse those into every modal-opening tab. Defer until
// the user activates the History tab inside the modal.
const ExerciseHistoryContent = React.lazy(() => import('./ExerciseHistoryContent'));
```

Then locate the History-tab render around line 225:

```typescript
            <ExerciseHistoryContent exercise={exercise} />
```

Add a Suspense boundary at the call site. Wrap in `<Suspense fallback={...}>`:

```typescript
            <Suspense fallback={null}>
              <ExerciseHistoryContent exercise={exercise} />
            </Suspense>
```

Use `null` as the fallback to avoid layout shift on first tab switch — the History tab content area appears empty briefly while the chunk parses, then renders.

**Important detail:** because the History tab content is rendered conditionally on `activeTab === 'history'`, the lazy chunk only fetches once the user navigates there. Verify the existing render guard. If both tab contents are mounted simultaneously (e.g., for animation), the lazy import still works — Suspense renders the fallback for the unmounted-but-pending side.

- [ ] **Step 2: Build + tests**

```
npx tsc --noEmit
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: tsc 0. Tests for `ExerciseDetailModal` (if any) need to handle the lazy boundary — they should already work since Jest resolves dynamic imports synchronously in jest-expo. If `ExerciseHistoryContent.test.tsx` breaks because the modal-level import shape changed, update that test.

- [ ] **Step 3: Grep verify**

```bash
grep -n 'React.lazy\|Suspense' src/components/ExerciseDetailModal.tsx
```
Expected: `React.lazy(() => import('./ExerciseHistoryContent'))` + `Suspense` wrapper.

- [ ] **Step 4: Commit**

```bash
git add src/components/ExerciseDetailModal.tsx
git commit -m "perf(modal): lazy-load ExerciseHistoryContent so chart-kit isn't parsed at modal mount"
```

---

## Task 4: Merge three 1RM JOIN scans into one `getE1RMSummary`

**Problem.** `getBestE1RM`, `getCurrentE1RM`, and `getE1RMWithConfidence` each issue an identical JOIN over `workout_sets × workouts` filtered the same way. ExerciseDetailModal opens fire 2-3 of these back-to-back via `ExerciseHistoryContent`. Three scans of the same data when one suffices.

**Files:**
- Modify: `src/services/database.ts:1269-1361` (the three functions)
- Modify: `src/components/ExerciseHistoryContent.tsx` (or wherever multiple 1RM fns are called consecutively)
- Test: `src/__tests__/services/database-getE1RMSummary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/services/database-getE1RMSummary.test.ts`:

```typescript
/**
 * Tests for Batch 6 Task 4: getE1RMSummary returns best, current, and confidence
 * in one query — replaces three separate JOIN scans at the call site.
 */

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

jest.mock('../../utils/oneRepMax', () => ({
  calculateEstimated1RM: (w: number, r: number) => w * (1 + r / 30),
  calculateE1RM: (w: number, r: number) => ({ value: w * (1 + r / 30), confidence: 'HIGH', margin: 0 }),
  FRESHNESS_HALF_LIFE_DAYS: 42,
}));

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;
const { getE1RMSummary } = require('../../services/database');

describe('Batch 6 Task 4: getE1RMSummary single-scan', () => {
  beforeEach(() => {
    __mockDb.getAllAsync.mockReset();
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.runAsync.mockResolvedValue({ changes: 0 } as any);
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('returns null when there are no completed sets for the exercise', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    const result = await getE1RMSummary('ex-bench');
    expect(result).toBeNull();
  });

  it('returns best (raw), current (decay-weighted), and confidence in ONE getAllAsync call', async () => {
    const today = new Date().toISOString();
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex-bench', weight: 200, reps: 5, rpe: 8, finished_at: today },
      { exercise_id: 'ex-bench', weight: 180, reps: 8, rpe: 9, finished_at: today },
    ]);

    const result = await getE1RMSummary('ex-bench');
    expect(result).not.toBeNull();
    expect(result!.best).toBeGreaterThan(0);
    expect(result!.current).toBeGreaterThan(0);
    expect(result!.confidence).not.toBeNull();
    expect(__mockDb.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('current value is less than best when the highest set is old', async () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year ago
    __mockDb.getAllAsync.mockResolvedValueOnce([
      // Old heaviest lift — high raw value, low decay-weighted
      { exercise_id: 'ex-bench', weight: 300, reps: 5, rpe: 8, finished_at: old },
      // Recent lighter lift
      { exercise_id: 'ex-bench', weight: 150, reps: 5, rpe: 8, finished_at: recent },
    ]);

    const result = await getE1RMSummary('ex-bench');
    expect(result).not.toBeNull();
    expect(result!.best).toBeGreaterThan(result!.current!); // old PR > current capacity
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/database-getE1RMSummary.test.ts
```
Expected: FAIL — `getE1RMSummary is not a function`.

- [ ] **Step 3: Add `getE1RMSummary` to `database.ts`**

In `src/services/database.ts`, add a new export just before `getBestE1RM` (around line 1268):

```typescript
// ─── Combined 1RM summary (single-scan) ───

export interface E1RMSummary {
  /** Best raw estimated 1RM across all completed sets (no decay). */
  best: number;
  /** Freshness-weighted estimated 1RM (6-week half-life decay). */
  current: number;
  /** Best e1RM with confidence tier + margin (Tuchscherer / ensemble engine). */
  confidence: E1RMResult;
}

/**
 * Combined 1RM query: returns best (raw), current (freshness-weighted), and
 * confidence-tier result in ONE JOIN scan. Replaces three separate calls
 * (getBestE1RM + getCurrentE1RM + getE1RMWithConfidence) that ExerciseHistoryContent
 * used to fire back-to-back on every modal open.
 */
export function getE1RMSummary(exerciseId: string): Promise<E1RMSummary | null> {
  return withDb('getE1RMSummary', async (database) => {
    const rows = await database.getAllAsync<PRSetWithDateRow>(
      `SELECT ws.exercise_id, ws.weight, ws.reps, ws.rpe, w.finished_at
       FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE w.finished_at IS NOT NULL
         AND ws.exercise_id = ?
         AND ws.is_completed = 1
         AND ws.weight IS NOT NULL AND ws.weight > 0
         AND ws.reps IS NOT NULL AND ws.reps > 0`,
      exerciseId,
    );
    if (rows.length === 0) return null;

    const now = Date.now();
    let best = 0;
    let current = 0;
    let confidence: E1RMResult | null = null;

    for (const r of rows) {
      const rawE1RM = calculateEstimated1RM(r.weight, r.reps, r.rpe);
      if (rawE1RM > best) best = rawE1RM;

      const daysAgo = (now - new Date(r.finished_at).getTime()) / (1000 * 60 * 60 * 24);
      const decayFactor = Math.exp(-0.693 * daysAgo / FRESHNESS_HALF_LIFE_DAYS);
      const weighted = rawE1RM * decayFactor;
      if (weighted > current) current = weighted;

      const result = calculateE1RM(r.weight, r.reps, r.rpe);
      if (!confidence || result.value > confidence.value) {
        confidence = result;
      }
    }

    if (best <= 0 || !confidence) return null;
    return { best, current, confidence };
  });
}
```

- [ ] **Step 4: Run tests to verify all 3 pass**

Run the same jest command.
Expected: PASS.

- [ ] **Step 5: Migrate `ExerciseHistoryContent` to use the combined query**

Open `src/components/ExerciseHistoryContent.tsx`. Find the existing calls to `getBestE1RM` / `getCurrentE1RM` / `getE1RMWithConfidence` (use grep to locate). Replace the sequence with a single `getE1RMSummary` call:

```typescript
const summary = await getE1RMSummary(exercise.id);
// summary is null when no completed sets exist.
const bestE1RM = summary?.best ?? null;
const currentE1RM = summary?.current ?? null;
const confidenceResult = summary?.confidence ?? null;
```

Update the import line to add `getE1RMSummary` (and remove the now-unused old functions IF nothing else in the file consumes them).

**Important constraint:** the three old functions (`getBestE1RM`, `getCurrentE1RM`, `getE1RMWithConfidence`) MUST stay exported in `database.ts` because they're used elsewhere:
- `getBestE1RM` is called from `useWorkoutLifecycle.ts` and `useSetCompletion.ts` for PR detection
- `getCurrentE1RM` may be used by tests or other screens

Do NOT delete the old functions. Only the call site in `ExerciseHistoryContent` consolidates.

- [ ] **Step 6: Run full test suite for regressions**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all green. If `ExerciseHistoryContent.test.tsx` mocks the old functions, update its mocks to also mock `getE1RMSummary`.

- [ ] **Step 7: Commit**

```bash
git add src/services/database.ts src/components/ExerciseHistoryContent.tsx src/__tests__/services/database-getE1RMSummary.test.ts
git commit -m "perf(db): add getE1RMSummary single-scan; ExerciseHistoryContent uses it instead of 3 separate calls"
```

---

## Task 5: Batch `stampExerciseOrder` UPDATEs via single CASE WHEN

**Problem.** `stampExerciseOrder` (`database.ts:886-897`) issues N sequential `UPDATE workout_sets SET exercise_order = ? WHERE id = ?` inside a transaction. For a workout with 40 sets, that's 40 bridge calls. A single `UPDATE ... SET exercise_order = CASE id WHEN ? THEN ? ... END WHERE id IN (...)` collapses to one.

**Files:**
- Modify: `src/services/database.ts:886-897`
- Test: `src/__tests__/services/database-stampExerciseOrder-batched.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/services/database-stampExerciseOrder-batched.test.ts`:

```typescript
jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;
const { stampExerciseOrder } = require('../../services/database');

describe('Batch 6 Task 5: stampExerciseOrder batched UPDATE', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockReset();
    __mockDb.runAsync.mockResolvedValue({ changes: 0 } as any);
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('issues exactly ONE UPDATE for N entries (CASE WHEN, not N separate UPDATEs)', async () => {
    const entries = [
      { id: 's1', order: 1 },
      { id: 's2', order: 2 },
      { id: 's3', order: 3 },
      { id: 's4', order: 4 },
    ];
    await stampExerciseOrder('w1', entries);

    const updateCalls = __mockDb.runAsync.mock.calls.filter((call: unknown[]) =>
      typeof call[0] === 'string' && /UPDATE workout_sets SET exercise_order/i.test(call[0] as string),
    );
    expect(updateCalls.length).toBe(1);
    // The single statement should use CASE WHEN
    expect(updateCalls[0][0]).toMatch(/CASE\s+id\s+WHEN/i);
  });

  it('returns early without issuing any UPDATE on empty entries', async () => {
    await stampExerciseOrder('w1', []);
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('binds each (id, order) pair correctly into the CASE WHEN', async () => {
    await stampExerciseOrder('w1', [{ id: 's1', order: 1 }, { id: 's2', order: 2 }]);
    const call = __mockDb.runAsync.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && /UPDATE workout_sets SET exercise_order/i.test(c[0] as string),
    );
    expect(call).toBeDefined();
    // SQL is param 0; the rest are binds. For 2 entries: 2 (CASE WHEN ?) + 2 (THEN ?) + 2 (IN (?, ?)).
    expect(call!.slice(1)).toEqual(['s1', 1, 's2', 2, 's1', 's2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/database-stampExerciseOrder-batched.test.ts
```
Expected: FAIL — current code makes N UPDATEs instead of 1.

- [ ] **Step 3: Replace with a single CASE WHEN UPDATE**

In `src/services/database.ts`, replace `stampExerciseOrder` (lines 886-897):

```typescript
/** Stamp exercise_order on all sets for a finished workout based on block positions.
 *  Issues a single CASE WHEN UPDATE instead of N separate statements — meaningful
 *  on workout finish where 30-50 sets are common. SQLite parameter limit is 999;
 *  guard for safety even though typical workouts are well below. */
export function stampExerciseOrder(workoutId: string, entries: Array<{ id: string; order: number }>): Promise<void> {
  return withDb('stampExerciseOrder', async (database) => {
    if (entries.length === 0) return;
    // Each entry contributes 3 binds: WHEN ?, THEN ?, IN (..., ?, ...).
    // SQLite's parameter limit is 999 — chunk defensively.
    const MAX_PER_CHUNK = 300;
    await database.withTransactionAsync(async () => {
      for (let i = 0; i < entries.length; i += MAX_PER_CHUNK) {
        const chunk = entries.slice(i, i + MAX_PER_CHUNK);
        const whens = chunk.map(() => 'WHEN ? THEN ?').join(' ');
        const placeholders = chunk.map(() => '?').join(',');
        const binds: unknown[] = [];
        for (const { id, order } of chunk) {
          binds.push(id, order);
        }
        for (const { id } of chunk) {
          binds.push(id);
        }
        await database.runAsync(
          `UPDATE workout_sets SET exercise_order = CASE id ${whens} END WHERE id IN (${placeholders})`,
          ...binds,
        );
      }
    });
  });
}
```

- [ ] **Step 4: Run tests to verify all 3 pass**

Run the same jest command.
Expected: PASS.

- [ ] **Step 5: Run full suite for regressions**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/services/database.ts src/__tests__/services/database-stampExerciseOrder-batched.test.ts
git commit -m "perf(db): batch stampExerciseOrder UPDATEs into a single CASE WHEN statement"
```

---

## Task 6: Batch `updateTemplateExerciseOrder` UPDATEs

**Problem.** Identical pattern to Task 5 — `updateTemplateExerciseOrder` (`database.ts:723-734`) loops N rows of UPDATEs. Fires on every drag-to-reorder in TemplateDetailScreen.

**Files:**
- Modify: `src/services/database.ts:723-734`
- Test: `src/__tests__/services/database-updateTemplateExerciseOrder-batched.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/services/database-updateTemplateExerciseOrder-batched.test.ts`:

```typescript
jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;
const { updateTemplateExerciseOrder } = require('../../services/database');

describe('Batch 6 Task 6: updateTemplateExerciseOrder batched UPDATE', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockReset();
    __mockDb.runAsync.mockResolvedValue({ changes: 0 } as any);
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('issues exactly ONE UPDATE for N ordered IDs', async () => {
    await updateTemplateExerciseOrder('t1', ['a', 'b', 'c']);

    const updateCalls = __mockDb.runAsync.mock.calls.filter((call: unknown[]) =>
      typeof call[0] === 'string' && /UPDATE template_exercises SET sort_order/i.test(call[0] as string),
    );
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][0]).toMatch(/CASE\s+id\s+WHEN/i);
  });

  it('returns early on empty list (no UPDATE issued)', async () => {
    await updateTemplateExerciseOrder('t1', []);
    expect(__mockDb.runAsync).not.toHaveBeenCalled();
  });

  it('scopes the WHERE clause to the template (no cross-template writes)', async () => {
    await updateTemplateExerciseOrder('t1', ['a', 'b']);
    const call = __mockDb.runAsync.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && /UPDATE template_exercises SET sort_order/i.test(c[0] as string),
    );
    expect(call).toBeDefined();
    expect(call![0]).toMatch(/AND template_id = \?/);
    // Last bind is the templateId
    const binds = call!.slice(1);
    expect(binds[binds.length - 1]).toBe('t1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/database-updateTemplateExerciseOrder-batched.test.ts
```
Expected: FAIL — current code makes N UPDATEs.

- [ ] **Step 3: Replace with batched CASE WHEN**

In `src/services/database.ts`, replace `updateTemplateExerciseOrder` (lines 723-734):

```typescript
/** Batch-update sort_order for template exercises. Takes junction-table row IDs (template_exercises.id), not exercise IDs.
 *  Single CASE WHEN UPDATE — was N sequential UPDATEs. Templates rarely have >20 exercises so chunking is not needed,
 *  but applied defensively for parity with stampExerciseOrder. */
export function updateTemplateExerciseOrder(templateId: string, orderedIds: string[]): Promise<void> {
  return withDb('updateTemplateExerciseOrder', async (database) => {
    if (orderedIds.length === 0) return;
    const MAX_PER_CHUNK = 300;
    await database.withTransactionAsync(async () => {
      for (let start = 0; start < orderedIds.length; start += MAX_PER_CHUNK) {
        const chunk = orderedIds.slice(start, start + MAX_PER_CHUNK);
        const whens = chunk.map(() => 'WHEN ? THEN ?').join(' ');
        const placeholders = chunk.map(() => '?').join(',');
        const binds: unknown[] = [];
        for (let i = 0; i < chunk.length; i++) {
          binds.push(chunk[i], start + i);
        }
        for (const id of chunk) {
          binds.push(id);
        }
        binds.push(templateId);
        await database.runAsync(
          `UPDATE template_exercises SET sort_order = CASE id ${whens} END WHERE id IN (${placeholders}) AND template_id = ?`,
          ...binds,
        );
      }
    });
  });
}
```

- [ ] **Step 4: Run tests to verify all 3 pass**

Run the same jest command.
Expected: PASS.

- [ ] **Step 5: Run full suite**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/services/database.ts src/__tests__/services/database-updateTemplateExerciseOrder-batched.test.ts
git commit -m "perf(db): batch updateTemplateExerciseOrder UPDATEs into a single CASE WHEN statement"
```

---

## Task 7: Stop blowing up dev Sentry tracing

**Problem.** `App.tsx:29` sets `tracesSampleRate: __DEV__ ? 1.0 : 0.2`. Full sampling in dev instruments every async op and distorts profiling — every iteration measured includes Sentry transaction overhead.

**Files:**
- Modify: `App.tsx:29`

- [ ] **Step 1: Apply the fix**

In `App.tsx`, change line 29 from:

```typescript
  tracesSampleRate: __DEV__ ? 1.0 : 0.2,
```

to:

```typescript
  // Dev: sample nothing so profiling isn't distorted. Re-enable selectively when
  // actively investigating a perf issue by temporarily setting this to 1.0.
  tracesSampleRate: __DEV__ ? 0 : 0.2,
```

- [ ] **Step 2: Build (no test needed — this is a runtime constant)**

```
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "perf(sentry): disable dev tracing to stop distorting profiling baselines"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full Jest suite**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all suites green; test count grows by 3 new files (~10 tests).

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Grep checks**

```bash
echo "=== Task 1: restSeconds gone from useRestTimer ==="
grep -n 'restSeconds' src/hooks/useRestTimer.ts || echo "clean"

echo "=== Task 2: lazy tab screens ==="
grep -n 'React.lazy\|lazyTabScreen' src/navigation/TabNavigator.tsx

echo "=== Task 3: lazy ExerciseHistoryContent ==="
grep -n 'React.lazy.*ExerciseHistoryContent\|Suspense' src/components/ExerciseDetailModal.tsx

echo "=== Task 4: getE1RMSummary ==="
grep -n 'export function getE1RMSummary\|getE1RMSummary(' src/services/database.ts src/components/ExerciseHistoryContent.tsx

echo "=== Task 5+6: batched UPDATEs ==="
grep -n 'CASE id WHEN' src/services/database.ts

echo "=== Task 7: dev tracesSampleRate ==="
grep -n 'tracesSampleRate' App.tsx
```

Expected:
- Task 1: no `restSeconds` in `useRestTimer.ts`
- Task 2: 3 `React.lazy` matches, `lazyTabScreen` references
- Task 3: `React.lazy(() => import('./ExerciseHistoryContent'))` and `Suspense`
- Task 4: `export function getE1RMSummary` + at least one consumer in `ExerciseHistoryContent.tsx`
- Task 5+6: 2 `CASE id WHEN` matches
- Task 7: `__DEV__ ? 0 : 0.2`

- [ ] **Step 4: Code review (mandatory gate per CLAUDE.md)**

```
/code-review deep --spec docs/superpowers/plans/2026-05-17-batch-6-performance.md
```
Address findings, re-test.

---

## Risks and rollback

- **Lazy tab screens (Task 2).** First tap on a lazy tab has a one-time chunk-parse delay (typically <100ms). User-visible only on slow devices. If the perceived hitch is unacceptable, revert one or all of History/Profile/Exercises to eager.
- **Lazy chart in modal (Task 3).** First time the user taps History tab in the modal, chart-kit parses (~50-100ms). The `Suspense fallback={null}` shows empty space briefly; if jarring, swap to an `ActivityIndicator`.
- **CASE WHEN batched UPDATE (Tasks 5+6).** SQLite's parameter limit is 999. Each entry contributes 3 binds (WHEN id, THEN order, IN id). 300-entry chunks stay well under (300×3 = 900). For typical workout sizes (40 sets) this is one chunk.
- **Combined 1RM (Task 4).** The new function adds an export; the old three remain because they're called from PR detection paths in workout hooks. No public API removal.
- **Dev Sentry sampling (Task 7).** Trades: zero dev traces shipped to Sentry. If you actively need to investigate perf in dev, flip the constant temporarily.

---

## Self-review notes

- Spec coverage: 6 findings → 7 tasks (split lazy-tab + lazy-chart for clean commits). ✓
- Placeholder scan: none. ✓
- Type consistency: `E1RMSummary` is a new exported interface; `E1RMResult` reused from existing import. `MAX_PER_CHUNK = 300` consistent across Tasks 5 and 6. ✓
- TDD ordering: Tasks 4, 5, 6 write failing tests first. Tasks 1, 2, 3, 7 are too structural to TDD meaningfully — verified by grep + full suite. ✓
- Files touched: 5 source + 3 test = 8 files. ✓
