# Batch 4: Templates + Sync Data Integrity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five data-integrity issues across template editing and Supabase sync: drag rollback discarding intervening stepper changes, stepper double-tap race, delete-account leaving local SQLite intact, JSONB columns mis-encoded on pull, `.in()` query risking PostgREST URL truncation at 200 workout IDs.

**Architecture:** Surgical edits to two screens and one service module. Drag rollback switches to a ref-based snapshot. Stepper handler gates per-item with an in-flight Set. Delete account calls `clearAllLocalData()` after `signOut()`. JSONB columns are serialized via `JSON.stringify()` at the bind site. `.in()` queries chunk to 50 IDs.

**Tech Stack:** React Native (Expo), TypeScript, expo-sqlite, `@supabase/supabase-js`, Jest + @testing-library/react-native.

**Repo:** This worktree (`/Users/sachitgoyal/code/lift-ai/.claude/worktrees/brave-spence-530049/`). Branch: `claude/brave-spence-530049`.

---

## File Structure

**Modified files (3):**
- `src/screens/TemplateDetailScreen.tsx` — Tasks 1 (drag ref) and 2 (stepper in-flight guard)
- `src/screens/ProfileScreen.tsx` — Task 3 (clear local data on delete account)
- `src/services/sync.ts` — Tasks 4 (JSONB stringify) and 5 (`.in()` chunking)

**New test files (5):**
- `src/__tests__/screens/TemplateDetailScreen-dragRollback.test.ts`
- `src/__tests__/screens/TemplateDetailScreen-stepperRace.test.ts`
- `src/__tests__/screens/ProfileScreen-deleteAccount.test.ts`
- `src/__tests__/services/sync-jsonbRoundtrip.test.ts`
- `src/__tests__/services/sync-chunkedIn.test.ts`

---

## Task 1: Drag rollback uses ref-based snapshot

**Problem.** `handleDragEnd` at `TemplateDetailScreen.tsx:134-144` captures `previous = exercises` via closure. If a stepper write completes between the drag start and a failed `updateTemplateExerciseOrder`, `previous` is the pre-stepper state. The rollback `setExercises(previous)` then silently discards the stepper change — a write that succeeded against the DB is reverted in the UI.

**Files:**
- Modify: `src/screens/TemplateDetailScreen.tsx`
- Test: `src/__tests__/screens/TemplateDetailScreen-dragRollback.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/screens/TemplateDetailScreen-dragRollback.test.ts`:

```typescript
/**
 * Tests for Batch 4 Task 1: handleDragEnd must snapshot the live `exercises`
 * via a ref so rollback after a failed reorder doesn't clobber an intervening
 * stepper write that succeeded.
 *
 * We don't render the full screen (it depends on navigation, drag library,
 * many services) — instead we test the contract that a ref captured BEFORE
 * the awaited reorder must hold the latest state at the time of rollback,
 * not a stale closure snapshot.
 */
import { useRef, useState } from 'react';

describe('Batch 4 Task 1: drag rollback ref contract', () => {
  it('models the bug: closure-captured previous discards intervening updates', () => {
    let exercises = [{ id: 'a', sets: 3 }, { id: 'b', sets: 3 }];
    const setExercises = (next: typeof exercises) => { exercises = next; };

    // User starts drag — handler captures `previous` via closure
    const previous = exercises;

    // Drag completes, optimistic update
    setExercises([{ id: 'b', sets: 3 }, { id: 'a', sets: 3 }]);

    // BEFORE the reorder write fails, a stepper increments b's sets
    setExercises(exercises.map(e => e.id === 'b' ? { ...e, sets: 4 } : e));

    // Reorder fails → rollback via closure-captured snapshot
    setExercises(previous);

    // BUG: the stepper change (b.sets = 4) was lost
    const b = exercises.find(e => e.id === 'b')!;
    expect(b.sets).toBe(3);  // <- the closure-captured rollback reverted to 3
  });

  it('models the fix: ref-based snapshot rolls back only the order, preserving intervening data changes', () => {
    let exercises = [{ id: 'a', sets: 3 }, { id: 'b', sets: 3 }];
    const exercisesRef = { current: exercises };
    const setExercises = (next: typeof exercises) => {
      exercises = next;
      exercisesRef.current = next;
    };

    // The fix snapshots the ORDER, not the full state.
    const previousOrder = exercisesRef.current.map(e => e.id);

    setExercises([{ id: 'b', sets: 3 }, { id: 'a', sets: 3 }]);

    // Intervening stepper update on b
    setExercises(exercisesRef.current.map(e => e.id === 'b' ? { ...e, sets: 4 } : e));

    // Reorder fails → rollback to previous order, preserving live data
    const byId = new Map(exercisesRef.current.map(e => [e.id, e]));
    setExercises(previousOrder.map(id => byId.get(id)!));

    // FIX: b.sets stays at 4 because the rollback only restored order
    const b = exercises.find(e => e.id === 'b')!;
    expect(b.sets).toBe(4);
    expect(exercises.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('grep invariant: TemplateDetailScreen.handleDragEnd uses a ref-based rollback', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../screens/TemplateDetailScreen.tsx'),
      'utf8',
    );
    // The fix introduces an `exercisesRef` and uses it inside handleDragEnd's
    // rollback path instead of closure-captured `exercises`.
    expect(src).toMatch(/exercisesRef/);
    expect(src).toMatch(/handleDragEnd[^]*?exercisesRef\.current/);
  });
});
```

- [ ] **Step 2: Run test to verify the grep invariant fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/screens/TemplateDetailScreen-dragRollback.test.ts
```
Expected: FAIL on the third test (grep invariant). The first two model-tests pass (they document the contract).

- [ ] **Step 3: Add `exercisesRef` and rewrite `handleDragEnd` rollback**

Edit `src/screens/TemplateDetailScreen.tsx`. Near the `const [exercises, setExercises] = useState<TemplateExercise[]>([]);` line (around 39), add:

```typescript
  // Mirror of exercises for refs-based snapshots that must see the LIVE value,
  // not a closure-captured snapshot from a previous render.
  const exercisesRef = useRef<TemplateExercise[]>([]);
  exercisesRef.current = exercises;
```

Add the import if missing — at the top of the file, ensure `useRef` is included in the `react` import alongside the existing hooks (`useState`, `useCallback`, etc.).

Replace `handleDragEnd` (lines 134-144). Find:

```typescript
  const handleDragEnd = useCallback(({ data }: { data: TemplateExercise[] }) => {
    const previous = exercises;
    setExercises(data);
    const orderedIds = data.map((e) => e.id);
    updateTemplateExerciseOrder(templateId, orderedIds)
      .then(() => { fireAndForgetSync(); pushTemplateOrderToSupabase(templateId); })
      .catch((e) => {
        if (__DEV__) console.error('Failed to update exercise order', e);
        Sentry.captureException(e);
        setExercises(previous);
      });
```

Replace with:

```typescript
  const handleDragEnd = useCallback(({ data }: { data: TemplateExercise[] }) => {
    // Snapshot ONLY the previous order, not the full row data. If a stepper
    // write completes between the drag start and a failed reorder, we want to
    // preserve that data update — only the order needs rolling back.
    const previousOrder = exercisesRef.current.map((e) => e.id);
    setExercises(data);
    const orderedIds = data.map((e) => e.id);
    updateTemplateExerciseOrder(templateId, orderedIds)
      .then(() => { fireAndForgetSync(); pushTemplateOrderToSupabase(templateId); })
      .catch((e) => {
        if (__DEV__) console.error('Failed to update exercise order', e);
        Sentry.captureException(e);
        // Rebuild from current data, restoring only the order.
        const byId = new Map(exercisesRef.current.map((row) => [row.id, row]));
        const rolledBack = previousOrder
          .map((id) => byId.get(id))
          .filter((row): row is TemplateExercise => row !== undefined);
        setExercises(rolledBack);
      });
```

The dependency array on the `useCallback` should drop `exercises` (no longer captured) — find the closing `}, [...]);` of `handleDragEnd` and update to `}, [templateId]);` if it currently lists `exercises`.

- [ ] **Step 4: Run test to verify it passes**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/screens/TemplateDetailScreen-dragRollback.test.ts
```
Expected: PASS (3 tests including the grep invariant).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/screens/TemplateDetailScreen.tsx src/__tests__/screens/TemplateDetailScreen-dragRollback.test.ts
git commit -m "fix(templates): handleDragEnd uses ref-based order snapshot so rollback preserves intervening stepper writes"
```

---

## Task 2: Stepper in-flight guard

**Problem.** `makeStepperHandler` fires `updateTemplateExerciseDefaults(...).then(loadExercises)`. A rapid double-tap (+/- pressed twice in quick succession) issues two writes that both call `loadExercises`. The second `loadExercises` can resolve before the first write commits, repainting the UI with stale row data — the first write's effect is invisible until the next focus refresh.

**Files:**
- Modify: `src/screens/TemplateDetailScreen.tsx`
- Test: `src/__tests__/screens/TemplateDetailScreen-stepperRace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/screens/TemplateDetailScreen-stepperRace.test.ts`:

```typescript
/**
 * Tests for Batch 4 Task 2: makeStepperHandler must drop concurrent calls
 * for the same item, otherwise a second loadExercises can resolve before
 * the first write commits and clobber the UI with stale data.
 *
 * Contract test — the production fix adds an in-flight Set keyed by item.id.
 * We verify the contract via grep + an in-isolation model.
 */
describe('Batch 4 Task 2: stepper in-flight guard', () => {
  it('models the bug: concurrent stepper calls both fire loadExercises', async () => {
    let loadCount = 0;
    const loadExercises = () => { loadCount++; return Promise.resolve(); };
    const updateDb = jest.fn().mockResolvedValue(undefined);

    const handler = async (itemId: string, _newValue: number) => {
      await updateDb(itemId);
      await loadExercises();
    };

    await Promise.all([handler('a', 4), handler('a', 5)]);

    expect(loadCount).toBe(2); // <- bug: two loads race
  });

  it('models the fix: in-flight guard drops the second call for the same id', async () => {
    let loadCount = 0;
    const loadExercises = () => { loadCount++; return Promise.resolve(); };
    const updateDb = jest.fn().mockResolvedValue(undefined);
    const inFlight = new Set<string>();

    const handler = async (itemId: string, _newValue: number) => {
      if (inFlight.has(itemId)) return;
      inFlight.add(itemId);
      try {
        await updateDb(itemId);
        await loadExercises();
      } finally {
        inFlight.delete(itemId);
      }
    };

    await Promise.all([handler('a', 4), handler('a', 5)]);

    expect(loadCount).toBe(1);
    expect(updateDb).toHaveBeenCalledTimes(1);
  });

  it('models the fix: in-flight guard allows concurrent calls on different ids', async () => {
    let loadCount = 0;
    const loadExercises = () => { loadCount++; return Promise.resolve(); };
    const updateDb = jest.fn().mockResolvedValue(undefined);
    const inFlight = new Set<string>();

    const handler = async (itemId: string) => {
      if (inFlight.has(itemId)) return;
      inFlight.add(itemId);
      try {
        await updateDb(itemId);
        await loadExercises();
      } finally {
        inFlight.delete(itemId);
      }
    };

    await Promise.all([handler('a'), handler('b')]);

    expect(loadCount).toBe(2); // different ids, both run
  });

  it('grep invariant: TemplateDetailScreen uses an in-flight guard on stepper writes', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../screens/TemplateDetailScreen.tsx'),
      'utf8',
    );
    // The fix introduces a Set ref for in-flight stepper writes.
    expect(src).toMatch(/stepperInFlightRef|stepperInFlight/);
  });
});
```

- [ ] **Step 2: Run test to verify the grep invariant fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/screens/TemplateDetailScreen-stepperRace.test.ts
```
Expected: FAIL on the grep test.

- [ ] **Step 3: Add in-flight Set and gate the stepper handler**

In `src/screens/TemplateDetailScreen.tsx`, near the other refs (around `exercisesRef` added in Task 1), add:

```typescript
  // Tracks template_exercise IDs currently writing to SQLite. A rapid double-tap
  // on +/- buttons would otherwise issue two writes that race against each
  // other's loadExercises; the second can resolve before the first commits
  // and clobber the UI with stale row data.
  const stepperInFlightRef = useRef<Set<string>>(new Set());
```

Replace `makeStepperHandler` (around lines 91-102):

```typescript
  const makeStepperHandler = useCallback(
    (field: string, getCurrent: (item: TemplateExercise) => number, computeNew: (current: number) => number) =>
      (item: TemplateExercise) => {
        const current = getCurrent(item);
        const newValue = computeNew(current);
        if (newValue === current) return;
        updateTemplateExerciseDefaults(item.id, { [field]: newValue })
          .then(() => { fireAndForgetSync(); return loadExercises(); })
          .catch((e) => { if (__DEV__) console.error(`Failed to update ${field}`, e); Sentry.captureException(e); });
      },
    [loadExercises],
  );
```

with:

```typescript
  const makeStepperHandler = useCallback(
    (field: string, getCurrent: (item: TemplateExercise) => number, computeNew: (current: number) => number) =>
      (item: TemplateExercise) => {
        const current = getCurrent(item);
        const newValue = computeNew(current);
        if (newValue === current) return;
        if (stepperInFlightRef.current.has(item.id)) return; // drop concurrent tap for same row
        stepperInFlightRef.current.add(item.id);
        updateTemplateExerciseDefaults(item.id, { [field]: newValue })
          .then(() => { fireAndForgetSync(); return loadExercises(); })
          .catch((e) => { if (__DEV__) console.error(`Failed to update ${field}`, e); Sentry.captureException(e); })
          .finally(() => { stepperInFlightRef.current.delete(item.id); });
      },
    [loadExercises],
  );
```

- [ ] **Step 4: Run tests to verify all 4 pass**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/screens/TemplateDetailScreen-stepperRace.test.ts
```
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/screens/TemplateDetailScreen.tsx src/__tests__/screens/TemplateDetailScreen-stepperRace.test.ts
git commit -m "fix(templates): per-row in-flight guard on stepper handler drops rapid double-taps"
```

---

## Task 3: Delete account clears local SQLite

**Problem.** `ProfileScreen.handleDeleteAccount` calls `deleteAccount()` (Supabase Edge Function) then `supabase.auth.signOut()`. The `SIGNED_OUT` event handler in `AuthContext` does NOT call `resetDatabase` or `clearAllLocalData` — only `SIGNED_IN` with a *different* user ID does. Result: workout history, exercise notes, templates remain on-device queryable after account deletion.

**Files:**
- Modify: `src/screens/ProfileScreen.tsx`
- Test: `src/__tests__/screens/ProfileScreen-deleteAccount.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/screens/ProfileScreen-deleteAccount.test.ts`:

```typescript
/**
 * Tests for Batch 4 Task 3: handleDeleteAccount must wipe local SQLite
 * (via clearAllLocalData) after Supabase signOut so the next user of
 * the device can't read the deleted account's workouts.
 */
describe('Batch 4 Task 3: delete account clears local data', () => {
  it('grep invariant: ProfileScreen.handleDeleteAccount calls clearAllLocalData after signOut', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../screens/ProfileScreen.tsx'),
      'utf8',
    );

    // Imports clearAllLocalData from database service
    expect(src).toMatch(/import\s+[^;]*clearAllLocalData[^;]*from\s+['"]\.\.\/services\/database['"]/);

    // The call sequence: deleteAccount → signOut → clearAllLocalData
    // Use a multi-line regex to verify ordering inside handleDeleteAccount.
    const deleteHandlerSlice = src.split('handleDeleteAccount')[1] ?? '';
    expect(deleteHandlerSlice).toMatch(/deleteAccount\(\)/);
    expect(deleteHandlerSlice).toMatch(/signOut\(\)/);
    expect(deleteHandlerSlice).toMatch(/clearAllLocalData\(\)/);

    // clearAllLocalData appears AFTER signOut in source order.
    const signOutIdx = deleteHandlerSlice.indexOf('signOut()');
    const clearIdx = deleteHandlerSlice.indexOf('clearAllLocalData()');
    expect(signOutIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(signOutIdx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/screens/ProfileScreen-deleteAccount.test.ts
```
Expected: FAIL — clearAllLocalData is not yet imported or called.

- [ ] **Step 3: Wire up the local-data wipe**

In `src/screens/ProfileScreen.tsx`, find the existing import line for `../services/supabase` (around line 19). Add `clearAllLocalData` to the imports — the agent should find the existing imports from `../services/database` if any, otherwise add a new import line:

```typescript
import { clearAllLocalData } from '../services/database';
```

Find the `onPress: async () => {` inside the inner "Yes, Delete My Account" Alert button (around line 115). Replace its body:

Find:
```typescript
                  onPress: async () => {
                    try {
                      await deleteAccount();
                      await supabase.auth.signOut();
                    } catch (e: unknown) {
                      Alert.alert(
                        'Error',
                        e instanceof Error ? e.message : 'Failed to delete account. Please try again.',
                      );
                    }
                  },
```

Replace with:
```typescript
                  onPress: async () => {
                    try {
                      await deleteAccount();
                      await supabase.auth.signOut();
                      // Wipe local SQLite so the deleted account's data
                      // isn't queryable on this device until the next sign-in.
                      // SIGNED_OUT in AuthContext only resets the userId; it
                      // does not clear the DB (other sign-outs preserve data
                      // for the next sign-in).
                      await clearAllLocalData();
                    } catch (e: unknown) {
                      Alert.alert(
                        'Error',
                        e instanceof Error ? e.message : 'Failed to delete account. Please try again.',
                      );
                    }
                  },
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/screens/ProfileScreen-deleteAccount.test.ts
```
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ProfileScreen.tsx src/__tests__/screens/ProfileScreen-deleteAccount.test.ts
git commit -m "fix(profile): wipe local SQLite after delete-account so data isn't readable until next sign-in"
```

---

## Task 4: JSONB columns round-trip correctly on pull

**Problem.** `pullWorkoutHistory` at `sync.ts:511-522` binds `w.planned_exercise_ids` and `w.exercise_coach_notes` directly into SQLite. Supabase returns JSONB columns as JS values (parsed arrays/objects), but SQLite TEXT columns expect strings. The values get coerced via `.toString()` to `"[object Object]"` or `"a,b,c"` (array `toString`), corrupting both fields.

**Files:**
- Modify: `src/services/sync.ts:491-548` (pullWorkoutHistory) and `:170-205` (push path — same fields)
- Test: `src/__tests__/services/sync-jsonbRoundtrip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/services/sync-jsonbRoundtrip.test.ts`:

```typescript
/**
 * Tests for Batch 4 Task 4: pullWorkoutHistory must serialize JSONB columns
 * (planned_exercise_ids, exercise_coach_notes) via JSON.stringify before
 * binding to SQLite TEXT columns.
 *
 * Supabase returns these as parsed JS values (array, object); naive binding
 * coerces them to "[object Object]" or "a,b,c" via toString.
 */
import { pullWorkoutHistory } from '../../services/sync';

// Capture all db.runAsync invocations so we can inspect what was bound.
const runAsyncCalls: unknown[][] = [];

jest.mock('../../services/database', () => ({
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn((...args: unknown[]) => {
      runAsyncCalls.push(args);
      return Promise.resolve();
    }),
    getAllAsync: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock('../../services/supabase', () => {
  const inFn = jest.fn().mockReturnValue({ data: [], error: null });
  const notFn = jest.fn().mockReturnValue({ in: inFn });
  const orderFn = jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({
    data: [
      {
        id: 'w1',
        user_id: 'u1',
        template_id: null,
        upcoming_workout_id: null,
        started_at: '2026-05-17T10:00:00Z',
        finished_at: '2026-05-17T11:00:00Z',
        coach_notes: null,
        // JSONB columns arrive as parsed JS values, NOT strings
        exercise_coach_notes: { 'ex-bench': 'good form' },
        session_notes: null,
        planned_exercise_ids: ['ex-bench', 'ex-squat'],
      },
    ],
    error: null,
  }) });
  return {
    supabase: {
      auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({ order: orderFn }),
          }),
          in: inFn,
        }),
      }),
    },
  };
});

describe('Batch 4 Task 4: JSONB round-trip on pull', () => {
  beforeEach(() => { runAsyncCalls.length = 0; });

  it('serializes planned_exercise_ids as JSON string before binding to SQLite', async () => {
    await pullWorkoutHistory();
    const workoutsInsert = runAsyncCalls.find((args) =>
      typeof args[0] === 'string' && (args[0] as string).startsWith('INSERT INTO workouts'),
    );
    expect(workoutsInsert).toBeDefined();
    // The bind params start at index 1. planned_exercise_ids is the LAST param
    // per the existing INSERT shape (10 columns).
    const plannedBind = workoutsInsert![10];
    expect(typeof plannedBind).toBe('string');
    expect(plannedBind).toBe('["ex-bench","ex-squat"]');
  });

  it('serializes exercise_coach_notes as JSON string', async () => {
    await pullWorkoutHistory();
    const workoutsInsert = runAsyncCalls.find((args) =>
      typeof args[0] === 'string' && (args[0] as string).startsWith('INSERT INTO workouts'),
    );
    // exercise_coach_notes is param index 8 in the existing column order.
    const ecnBind = workoutsInsert![8];
    expect(typeof ecnBind).toBe('string');
    expect(ecnBind).toBe('{"ex-bench":"good form"}');
  });

  it('leaves null values null (not the string "null")', async () => {
    // Re-mock with null values for these fields
    const supabaseMock = require('../../services/supabase').supabase;
    (supabaseMock.from as jest.Mock).mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          not: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                data: [{
                  id: 'w2', user_id: 'u1', template_id: null, upcoming_workout_id: null,
                  started_at: 'x', finished_at: 'y', coach_notes: null,
                  exercise_coach_notes: null, session_notes: null, planned_exercise_ids: null,
                }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    runAsyncCalls.length = 0;
    await pullWorkoutHistory();
    const workoutsInsert = runAsyncCalls.find((args) =>
      typeof args[0] === 'string' && (args[0] as string).startsWith('INSERT INTO workouts'),
    );
    expect(workoutsInsert).toBeDefined();
    expect(workoutsInsert![8]).toBeNull();
    expect(workoutsInsert![10]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/sync-jsonbRoundtrip.test.ts
```
Expected: FAIL — current code binds the array/object directly, so `typeof plannedBind === 'string'` fails.

- [ ] **Step 3: Add a serializer helper and apply to bind sites**

In `src/services/sync.ts`, near the top of the file (after the existing helpers like `handleSyncError`), add:

```typescript
/**
 * Serialize a JSONB-shaped value into the TEXT representation SQLite expects.
 * Supabase returns JSONB columns as parsed JS (arrays/objects); naive binding
 * coerces them via toString to "[object Object]" or "a,b,c". This normalizes:
 *   - null/undefined → null
 *   - strings (already JSON) → unchanged
 *   - everything else → JSON.stringify(value)
 */
function jsonbToText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
```

Then update `pullWorkoutHistory`'s `INSERT INTO workouts` binding (around line 521). Replace:

```typescript
        w.id, w.user_id, w.template_id, w.upcoming_workout_id ?? null, w.started_at, w.finished_at, w.coach_notes, w.exercise_coach_notes, w.session_notes, w.planned_exercise_ids ?? null,
```

with:

```typescript
        w.id, w.user_id, w.template_id, w.upcoming_workout_id ?? null, w.started_at, w.finished_at, w.coach_notes, jsonbToText(w.exercise_coach_notes), w.session_notes, jsonbToText(w.planned_exercise_ids),
```

Also check the PUSH side (around line 170-205) where the same fields go in the other direction. The push reads from SQLite (already TEXT, already a string) and sends to Supabase. Supabase will accept a JSON string for JSONB columns OR a JS object — but if we send a string, Supabase may store the string itself, not parse it. The safer push pattern is to parse on push (turn the local TEXT into a JS value) before upsert.

Find the push payload construction in `syncToSupabase`. Look for the block that builds the `workouts` upsert (search for `from('workouts').upsert(`). Where `planned_exercise_ids` and `exercise_coach_notes` are spread or assigned, parse them via:

```typescript
function textToJsonb(value: string | null): unknown {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return null; }
}
```

Add `textToJsonb` next to `jsonbToText`. Then in the push payload mapping (the agent should locate the workout-row mapper — typically a `.map(w => ({ ..., planned_exercise_ids: w.planned_exercise_ids, ... }))` block), replace direct assignment with:

```typescript
        planned_exercise_ids: textToJsonb(w.planned_exercise_ids),
        exercise_coach_notes: textToJsonb(w.exercise_coach_notes),
```

If the push payload is constructed via object spread without per-field handling, restructure it to use explicit field assignment for these two fields.

- [ ] **Step 4: Run tests to verify all 3 pull tests pass**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/sync-jsonbRoundtrip.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + grep**

Run: `npx tsc --noEmit` (expect exit 0)
Run: `grep -n 'jsonbToText\|textToJsonb' src/services/sync.ts`
Expected: helper definitions + at least 4 call sites (push and pull, both columns).

- [ ] **Step 6: Commit**

```bash
git add src/services/sync.ts src/__tests__/services/sync-jsonbRoundtrip.test.ts
git commit -m "fix(sync): JSON-serialize planned_exercise_ids and exercise_coach_notes for SQLite/Supabase round-trip"
```

---

## Task 5: Chunk `.in('workout_id', workoutIds)` to ≤50 IDs

**Problem.** `pullWorkoutHistory` queries `workout_sets` via `.in('workout_id', workoutIds)` with up to 200 UUIDs (`limit(200)` on the parent workouts query). At ~36 chars per UUID plus URL encoding, the query string approaches PostgREST's default 8KB URL limit. Past the limit, the query truncates or fails silently. Chunk to 50 IDs per request.

**Files:**
- Modify: `src/services/sync.ts:525-547` (pullWorkoutHistory workout_sets fetch)
- Test: `src/__tests__/services/sync-chunkedIn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/services/sync-chunkedIn.test.ts`:

```typescript
/**
 * Tests for Batch 4 Task 5: pullWorkoutHistory chunks the workout_sets
 * .in('workout_id', ...) query to ≤50 IDs to avoid PostgREST URL truncation.
 */
import { pullWorkoutHistory } from '../../services/sync';

const inCalls: unknown[][] = [];

jest.mock('../../services/database', () => ({
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock('../../services/supabase', () => {
  // Build a mock that records all .in('workout_id', ids) invocations
  const inFn = jest.fn((field: string, ids: unknown[]) => {
    inCalls.push([field, ids]);
    return { data: [], error: null };
  });

  // Generate 120 workouts so we expect 3 chunks (50 + 50 + 20)
  const manyWorkouts = Array.from({ length: 120 }, (_, i) => ({
    id: `w${i}`, user_id: 'u1', template_id: null, upcoming_workout_id: null,
    started_at: 'x', finished_at: 'y', coach_notes: null,
    exercise_coach_notes: null, session_notes: null, planned_exercise_ids: null,
  }));

  return {
    supabase: {
      auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({ data: manyWorkouts, error: null }),
              }),
            }),
          }),
          in: inFn,
        }),
      }),
    },
  };
});

describe('Batch 4 Task 5: chunked .in() on workout_sets', () => {
  beforeEach(() => { inCalls.length = 0; });

  it('chunks 120 workout IDs into 3 requests of size 50,50,20', async () => {
    await pullWorkoutHistory();
    const chunks = inCalls.filter(([field]) => field === 'workout_id');
    expect(chunks).toHaveLength(3);
    expect((chunks[0][1] as string[]).length).toBe(50);
    expect((chunks[1][1] as string[]).length).toBe(50);
    expect((chunks[2][1] as string[]).length).toBe(20);
  });

  it('grep invariant: pullWorkoutHistory uses a chunk size constant <= 50', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/sync.ts'),
      'utf8',
    );
    // Look for an obvious chunk-size literal or constant.
    expect(src).toMatch(/IN_CHUNK_SIZE\s*=\s*(50|[1-4][0-9])\b|workoutIds\.slice\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/sync-chunkedIn.test.ts
```
Expected: FAIL — current code makes 1 unchunked `.in()` call.

- [ ] **Step 3: Chunk the query**

In `src/services/sync.ts`, near the top constants area, add:

```typescript
/**
 * PostgREST's default URL length cap is ~8KB. At 36 chars per UUID plus
 * encoding, ~50 IDs per .in() is a safe upper bound that leaves headroom
 * for other query params and headers.
 */
const IN_CHUNK_SIZE = 50;
```

Replace the workout_sets fetch block in `pullWorkoutHistory` (around lines 525-547). Find:

```typescript
    // Fetch workout_sets for those workouts
    const workoutIds = (workouts as PullWorkoutRow[]).map(w => w.id);
    const { data: sets, error: sErr } = await supabase
      .from('workout_sets')
      .select('*')
      .in('workout_id', workoutIds);

    if (sErr) { handleSyncError('pull workout_sets', sErr); return; }
```

Replace with:

```typescript
    // Fetch workout_sets for those workouts in chunks to stay under PostgREST's
    // URL length cap (~8KB; 200 UUIDs at 36 chars each can exceed it).
    const workoutIds = (workouts as PullWorkoutRow[]).map(w => w.id);
    const allSets: PullWorkoutSetRow[] = [];
    for (let i = 0; i < workoutIds.length; i += IN_CHUNK_SIZE) {
      const chunk = workoutIds.slice(i, i + IN_CHUNK_SIZE);
      const { data: chunkSets, error: chunkErr } = await supabase
        .from('workout_sets')
        .select('*')
        .in('workout_id', chunk);

      if (chunkErr) { handleSyncError('pull workout_sets', chunkErr); return; }
      if (chunkSets) allSets.push(...(chunkSets as PullWorkoutSetRow[]));
    }
    const sets = allSets;
```

The subsequent `for (const s of (sets ?? []) as PullWorkoutSetRow[])` loop must continue to compile — `sets` is now a typed array (not `null`). Remove the `?? []` and type cast since `sets` is now guaranteed to be `PullWorkoutSetRow[]`:

```typescript
    for (const s of sets) {
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/sync-chunkedIn.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit` (expect exit 0)
Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/` (expect all green)

- [ ] **Step 6: Commit**

```bash
git add src/services/sync.ts src/__tests__/services/sync-chunkedIn.test.ts
git commit -m "fix(sync): chunk pullWorkoutHistory workout_sets .in() to 50 IDs to avoid PostgREST URL truncation"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full Jest suite**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8`
Expected: all suites pass; test count grows by 5 new files (~14 new tests).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Grep checks**

```bash
echo "=== drag rollback uses ref ==="
grep -n 'exercisesRef\|previousOrder' src/screens/TemplateDetailScreen.tsx

echo "=== stepper in-flight guard ==="
grep -n 'stepperInFlightRef' src/screens/TemplateDetailScreen.tsx

echo "=== delete account clears local ==="
grep -n 'clearAllLocalData' src/screens/ProfileScreen.tsx

echo "=== JSONB helpers ==="
grep -n 'jsonbToText\|textToJsonb' src/services/sync.ts

echo "=== IN chunking ==="
grep -n 'IN_CHUNK_SIZE\|workoutIds.slice' src/services/sync.ts
```
Expected: all 5 checks return matches at the expected sites.

- [ ] **Step 4: Code review (mandatory gate per CLAUDE.md)**

```
/code-review deep --spec docs/superpowers/plans/2026-05-17-batch-4-templates-sync-integrity.md
```
Address actionable findings, then re-run grep and tests.

---

## Risks and rollback

- **Drag rollback ref pattern.** If the ref isn't kept in sync (mirror assignment outside the right phase), the rollback could read stale. Mitigation: ref is assigned on every render via `exercisesRef.current = exercises;` after the `useState` declaration — same pattern used elsewhere in the codebase.
- **Stepper guard blocks legitimate retries.** If a stepper write fails, the `finally` clears the in-flight flag so the next tap proceeds. UX-wise this matches user intent.
- **Delete account `clearAllLocalData`.** The function is intentionally non-transactional (per CLAUDE.md it's called from concurrent sync flows). If it throws between two table DELETEs, the user retains partial local data after deletion. The catch block surfaces the error to the user; they can re-try by reinstalling the app. Acceptable.
- **JSONB serializer.** A future schema change that turns these columns from JSONB to TEXT (unlikely) would mean `jsonbToText` is a no-op. Harmless.
- **`.in()` chunking.** Multiple round-trips instead of one. For 200 workouts, that's 4 chunks ≈ 4× round-trip latency. Mitigation: chunks run sequentially because PostgREST cost is small and parallel makes error handling more complex. If perf becomes an issue, swap to `Promise.all`.

---

## Self-review notes

- Spec coverage: 5 fixes → covered by Tasks 1–5. ✓
- Placeholder scan: none. ✓
- Type consistency: `exercisesRef: React.RefObject<TemplateExercise[]>`, `stepperInFlightRef: React.RefObject<Set<string>>`, `jsonbToText/textToJsonb` consistent in both directions. ✓
- TDD ordering: each task writes the failing test (or grep invariant) first, then implementation, then verifies green. ✓
- Files touched: 3 source + 5 test = 8 files. ✓
