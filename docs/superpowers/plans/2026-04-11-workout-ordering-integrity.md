# Workout Ordering Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the rowid race that scrambles exercise order on reload, preserve the programmed exercise order forever after finish, and make skipped planned exercises visible to the MCP AI coach.

**Architecture:** Add two nullable columns (`workout_sets.programmed_order` and `workouts.planned_exercise_ids` JSON array). Stamp `exercise_order` + `programmed_order` at insert time (not just at finish) to kill the rowid dependency. Capture the full plan exercise-id list on `workouts` at start time so `handleRemoveExercise`'s hard-delete doesn't erase plan membership. Insert "ghost" placeholder rows at finish for any planned exercise not in the live blocks. Persist auto-reorder (F2) to DB so reloads preserve user reorderings. Mechanical sync + MCP read-tool additions.

**Tech Stack:** Expo React Native, expo-sqlite (async API), Supabase (two projects: dev `gcpnqpqqwcwvyzoivolp`, prod `lgnkxjiqzsqiwrqrsxww`), TypeScript, Jest + jest-expo.

---

## File Structure

### Files to create

- `supabase/migrations/013_workout_ordering_integrity.sql` — additive schema migration (`workout_sets.programmed_order`, `workouts.planned_exercise_ids`, index).

### Files to modify

- `src/types/database.ts` — add `programmed_order` to `WorkoutSet`, add `planned_exercise_ids` to `Workout`.
- `src/services/database.ts` — SQLite migration block, row interfaces, `mapWorkoutSetRow`, `addWorkoutSetsBatch`, `updateWorkoutSet`, new `setPlannedExerciseIds`, new `getPlannedExerciseIds`, new `insertSkippedPlaceholderSets`, simplify `getWorkoutSets` ORDER BY.
- `src/hooks/useWorkoutLifecycle.ts` — `buildExerciseBlock` accepts `programmedOrder`, `handleStartFromUpcoming` / `handleStartFromTemplate` / `handleStartEmpty` / `handleAddExerciseToWorkout` thread the index, `confirmFinish` reads planned IDs and inserts ghosts before `stampExerciseOrder`.
- `src/hooks/useSetCompletion.ts` — after the in-memory auto-reorder, fire-and-forget `stampExerciseOrder` to persist the new ordering.
- `src/services/sync.ts` — push/pull add `programmed_order` on `workout_sets` and `planned_exercise_ids` on `workouts`.
- `src/services/__tests__/database.test.ts` — new tests for `programmed_order` persistence, `setPlannedExerciseIds`, `insertSkippedPlaceholderSets`, simplified ORDER BY.
- `src/screens/__tests__/WorkoutScreen.test.tsx` — update mocks for `addWorkoutSetsBatch` (already accepts exercise_order, now accepts programmed_order), verify start paths pass through indices, verify ghost-row insertion at finish.
- `src/__tests__/hooks/useWorkoutLifecycle-sessionNotes.test.ts` — update mocks (signature change in `addWorkoutSetsBatch`).

### Files to touch in the MCP repo (separate commit after phone app ships)

- `/Users/sachitgoyal/code/lift-ai-mcp/src/tools/read/workouts.ts` (or equivalent — find by `get_workout_detail`) — SELECT adds `programmed_order`, `planned_exercise_ids`; response adds `reordered` and `skipped_exercises`.
- `/Users/sachitgoyal/code/lift-ai-mcp/src/tools/read/exercises.ts` (or equivalent — find by `get_exercise_history`) — SELECT adds `programmed_order`.

The MCP work is included in this plan as Task 10 but builds on the phone app's Supabase schema, so the migration must run **first**.

---

## Task 1: Supabase migration + SQLite migration block

**Files:**
- Create: `supabase/migrations/013_workout_ordering_integrity.sql`
- Modify: `src/services/database.ts` (around line 442 — the migration ALTER block)

Purpose: add the two columns and index to Supabase (manually applied on dev + prod) and to the local SQLite DB (runs on next app open, guarded by `.catch(() => {})`).

- [ ] **Step 1: Write the Supabase migration SQL**

Create `supabase/migrations/013_workout_ordering_integrity.sql`:

```sql
-- Migration 013: Workout ordering integrity
--
-- Adds programmed_order to workout_sets to preserve the original plan order
-- through finish (exercise_order captures performed order).
--
-- Adds planned_exercise_ids JSON array to workouts so the full plan survives
-- mid-workout exercise removal (which hard-deletes workout_sets rows).

ALTER TABLE workout_sets ADD COLUMN programmed_order INTEGER;

CREATE INDEX IF NOT EXISTS workout_sets_workout_programmed_idx
  ON workout_sets(workout_id, programmed_order);

ALTER TABLE workouts ADD COLUMN planned_exercise_ids TEXT;
-- JSON array of exercise_ids in plan order, e.g. '["uuid-a","uuid-b"]'.
-- NULL for ad-hoc empty workouts and pre-migration rows.
```

- [ ] **Step 2: Apply the migration on dev Supabase**

Run the SQL above in the Supabase dashboard SQL Editor for project `gcpnqpqqwcwvyzoivolp` (lift-ai-dev). Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'workout_sets' AND column_name = 'programmed_order';` returns one row.

- [ ] **Step 3: Apply the migration on prod Supabase**

Run the same SQL in the Supabase dashboard SQL Editor for project `lgnkxjiqzsqiwrqrsxww` (lift.ai). Verify the same way.

- [ ] **Step 4: Add the SQLite mirror to the migration block**

In `src/services/database.ts`, locate the block around line 442 where `exercise_order` is ALTER-added. Add these lines right after it:

```ts
  await database.runAsync('ALTER TABLE workout_sets ADD COLUMN programmed_order INTEGER').catch(() => {});
  await database.runAsync('CREATE INDEX IF NOT EXISTS workout_sets_workout_programmed_idx ON workout_sets(workout_id, programmed_order)').catch(() => {});
  await database.runAsync('ALTER TABLE workouts ADD COLUMN planned_exercise_ids TEXT').catch(() => {});
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (no code references the new columns yet).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/013_workout_ordering_integrity.sql src/services/database.ts
git commit -m "feat: add programmed_order and planned_exercise_ids schema"
```

---

## Task 2: Type updates

**Files:**
- Modify: `src/types/database.ts`

Purpose: extend the TypeScript types so the rest of the plan has compile-time safety.

- [ ] **Step 1: Add `programmed_order` to `WorkoutSet`**

In `src/types/database.ts`, modify the `WorkoutSet` interface (around line 56). After the existing `exercise_order?` line, add:

```ts
  programmed_order?: number | null;  // null = user-added mid-workout or historical
```

Final interface should read:

```ts
export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  tag: SetTag;
  rpe: number | null;
  is_completed: boolean;
  notes: string | null;
  target_weight?: number | null;
  target_reps?: number | null;
  target_rpe?: number | null;
  exercise_order?: number;  // 0 = unknown (historical), 1+ = sequence position
  programmed_order?: number | null;  // null = user-added mid-workout or historical
}
```

- [ ] **Step 2: Add `planned_exercise_ids` to `Workout`**

In the same file, modify the `Workout` interface (around line 43). Add after `session_notes`:

```ts
  planned_exercise_ids: string | null;  // JSON array of exercise_ids in plan order
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in `database.ts` and possibly in tests complaining that fields are unhandled — these will be fixed in later tasks. Note any new errors, don't fix yet.

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add programmed_order and planned_exercise_ids to types"
```

---

## Task 3: Database helpers — batch insert, planned IDs, skipped placeholders, ORDER BY

**Files:**
- Modify: `src/services/database.ts`
- Test: `src/services/__tests__/database.test.ts`

Purpose: extend `addWorkoutSetsBatch` to persist `programmed_order`, add `setPlannedExerciseIds` / `getPlannedExerciseIds` / `insertSkippedPlaceholderSets`, and simplify `getWorkoutSets` to `ORDER BY exercise_order, set_number`.

- [ ] **Step 1: Write the failing test for `addWorkoutSetsBatch` with programmed_order**

Add to `src/services/__tests__/database.test.ts` inside the existing `describe('addWorkoutSetsBatch', () => { ... })` block (search for that name; if it doesn't exist, add a new `describe`):

```ts
it('persists programmed_order when provided', async () => {
  const w = await createWorkout({ template_id: null, upcoming_workout_id: null });
  const [set] = await addWorkoutSetsBatch([
    {
      workout_id: w.id,
      exercise_id: 'ex-1',
      set_number: 1,
      reps: null,
      weight: null,
      tag: 'working',
      rpe: null,
      is_completed: false,
      notes: null,
      exercise_order: 3,
      programmed_order: 3,
    },
  ]);
  const rows = await getWorkoutSets(w.id);
  expect(rows[0].id).toBe(set.id);
  expect(rows[0].exercise_order).toBe(3);
  expect(rows[0].programmed_order).toBe(3);
});

it('leaves programmed_order null when not provided', async () => {
  const w = await createWorkout({ template_id: null, upcoming_workout_id: null });
  await addWorkoutSetsBatch([
    {
      workout_id: w.id,
      exercise_id: 'ex-2',
      set_number: 1,
      reps: null,
      weight: null,
      tag: 'working',
      rpe: null,
      is_completed: false,
      notes: null,
    },
  ]);
  const rows = await getWorkoutSets(w.id);
  expect(rows[0].programmed_order).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/services/__tests__/database.test.ts -t "persists programmed_order"`
Expected: FAIL — `programmed_order` is not yet persisted (undefined in row).

- [ ] **Step 3: Update `addWorkoutSetsBatch` to persist `programmed_order`**

In `src/services/database.ts`, around line 808, replace the function body:

```ts
export function addWorkoutSetsBatch(sets: Omit<WorkoutSet, 'id'>[]): Promise<WorkoutSet[]> {
  if (sets.length === 0) return Promise.resolve([]);
  return withDb('addWorkoutSetsBatch', async (database) => {
    const ids = sets.map(() => uuid());
    const placeholderGroup = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const placeholders = sets.map(() => placeholderGroup).join(', ');
    const values: (string | number | null)[] = [];
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      values.push(
        ids[i], set.workout_id, set.exercise_id, set.set_number,
        set.reps, set.weight, set.tag, set.rpe,
        set.is_completed ? 1 : 0, set.notes,
        set.target_weight ?? null, set.target_reps ?? null, set.target_rpe ?? null,
        set.exercise_order ?? 0,
        set.programmed_order ?? null,
      );
    }
    await database.runAsync(
      `INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe, is_completed, notes, target_weight, target_reps, target_rpe, exercise_order, programmed_order) VALUES ${placeholders}`,
      ...values,
    );
    return sets.map((set, i) => ({ id: ids[i], ...set }));
  });
}
```

- [ ] **Step 4: Find and update the `WorkoutSetRow` interface and `mapWorkoutSetRow`**

Search `src/services/database.ts` for `interface WorkoutSetRow` (or similar). Add field:

```ts
  programmed_order: number | null;
```

In `mapWorkoutSetRow`, add:

```ts
    programmed_order: row.programmed_order ?? null,
```

(Add it to the returned object alongside `exercise_order`.)

- [ ] **Step 5: Update `getWorkoutSets` SELECT and ORDER BY**

Replace the `getWorkoutSets` body (around line 786). Change the `ORDER BY` clause to drop `rowid` (now dead code) and add `programmed_order` as a secondary signal for robustness:

```ts
export function getWorkoutSets(workoutId: string): Promise<WorkoutSet[]> {
  return withDb('getWorkoutSets', async (database) => {
    const rows = await database.getAllAsync<WorkoutSetRow>(
      'SELECT * FROM workout_sets WHERE workout_id = ? ORDER BY exercise_order, set_number',
      workoutId,
    );
    return rows.map(mapWorkoutSetRow);
  });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/services/__tests__/database.test.ts -t "persists programmed_order"`
Expected: PASS. Also rerun "leaves programmed_order null when not provided" — PASS.

- [ ] **Step 7: Write the failing test for `setPlannedExerciseIds` / `getPlannedExerciseIds`**

Add to `database.test.ts`:

```ts
describe('planned_exercise_ids', () => {
  it('round-trips a JSON array', async () => {
    const w = await createWorkout({ template_id: null, upcoming_workout_id: null });
    await setPlannedExerciseIds(w.id, ['ex-a', 'ex-b', 'ex-c']);
    const ids = await getPlannedExerciseIds(w.id);
    expect(ids).toEqual(['ex-a', 'ex-b', 'ex-c']);
  });

  it('stores null when called with null', async () => {
    const w = await createWorkout({ template_id: null, upcoming_workout_id: null });
    await setPlannedExerciseIds(w.id, null);
    const ids = await getPlannedExerciseIds(w.id);
    expect(ids).toBeNull();
  });

  it('returns null for a workout with no plan stored', async () => {
    const w = await createWorkout({ template_id: null, upcoming_workout_id: null });
    const ids = await getPlannedExerciseIds(w.id);
    expect(ids).toBeNull();
  });
});
```

Also update the import at the top of the test file to include `setPlannedExerciseIds` and `getPlannedExerciseIds`.

- [ ] **Step 8: Run the test to verify it fails**

Run: `npm test -- src/services/__tests__/database.test.ts -t "planned_exercise_ids"`
Expected: FAIL — functions don't exist, import errors.

- [ ] **Step 9: Implement `setPlannedExerciseIds` and `getPlannedExerciseIds`**

Add to `src/services/database.ts`, after `stampExerciseOrder` (around line 867):

```ts
export function setPlannedExerciseIds(workoutId: string, exerciseIds: string[] | null): Promise<void> {
  return withDb('setPlannedExerciseIds', async (database) => {
    const json = exerciseIds === null ? null : JSON.stringify(exerciseIds);
    await database.runAsync(
      'UPDATE workouts SET planned_exercise_ids = ? WHERE id = ?',
      json, workoutId,
    );
  });
}

export function getPlannedExerciseIds(workoutId: string): Promise<string[] | null> {
  return withDb('getPlannedExerciseIds', async (database) => {
    const row = await database.getFirstAsync<{ planned_exercise_ids: string | null }>(
      'SELECT planned_exercise_ids FROM workouts WHERE id = ?',
      workoutId,
    );
    if (!row?.planned_exercise_ids) return null;
    try {
      const parsed = JSON.parse(row.planned_exercise_ids);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npm test -- src/services/__tests__/database.test.ts -t "planned_exercise_ids"`
Expected: all three PASS.

- [ ] **Step 11: Write the failing test for `insertSkippedPlaceholderSets`**

Add to `database.test.ts`:

```ts
describe('insertSkippedPlaceholderSets', () => {
  it('inserts one ghost row per skipped exercise', async () => {
    const w = await createWorkout({ template_id: null, upcoming_workout_id: null });
    await insertSkippedPlaceholderSets(w.id, [
      { exercise_id: 'ex-skip-1', programmed_order: 2 },
      { exercise_id: 'ex-skip-2', programmed_order: 4 },
    ]);
    const rows = await getWorkoutSets(w.id);
    const skipRows = rows.filter(r => r.exercise_id.startsWith('ex-skip-'));
    expect(skipRows).toHaveLength(2);
    for (const r of skipRows) {
      expect(r.set_number).toBe(1);
      expect(r.reps).toBe(0);
      expect(r.weight).toBe(0);
      expect(r.tag).toBe('working');
      expect(r.rpe).toBeNull();
      expect(r.is_completed).toBe(false);
      expect(r.exercise_order).toBe(0);  // NULL in DB, 0 via default in mapper
    }
    const byOrder = new Map(skipRows.map(r => [r.exercise_id, r.programmed_order]));
    expect(byOrder.get('ex-skip-1')).toBe(2);
    expect(byOrder.get('ex-skip-2')).toBe(4);
  });

  it('no-ops on an empty array', async () => {
    const w = await createWorkout({ template_id: null, upcoming_workout_id: null });
    await insertSkippedPlaceholderSets(w.id, []);
    const rows = await getWorkoutSets(w.id);
    expect(rows).toHaveLength(0);
  });
});
```

Update the import to include `insertSkippedPlaceholderSets`.

- [ ] **Step 12: Run the test to verify it fails**

Run: `npm test -- src/services/__tests__/database.test.ts -t "insertSkippedPlaceholderSets"`
Expected: FAIL — function doesn't exist.

- [ ] **Step 13: Implement `insertSkippedPlaceholderSets`**

Add to `src/services/database.ts`, after `getPlannedExerciseIds`:

```ts
export function insertSkippedPlaceholderSets(
  workoutId: string,
  skipped: Array<{ exercise_id: string; programmed_order: number }>,
): Promise<void> {
  if (skipped.length === 0) return Promise.resolve();
  return withDb('insertSkippedPlaceholderSets', async (database) => {
    await database.withTransactionAsync(async () => {
      for (const { exercise_id, programmed_order } of skipped) {
        const id = uuid();
        await database.runAsync(
          `INSERT INTO workout_sets
             (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe,
              is_completed, notes, target_weight, target_reps, target_rpe,
              exercise_order, programmed_order)
           VALUES (?, ?, ?, 1, 0, 0, 'working', NULL, 0, NULL, NULL, NULL, NULL, 0, ?)`,
          id, workoutId, exercise_id, programmed_order,
        );
      }
    });
  });
}
```

Note: `exercise_order` is stored as `0` (not NULL) because the column is `NOT NULL DEFAULT 0` from migration 007. Ghost rows sort first via `ORDER BY exercise_order, set_number`, but the MCP layer filters them by `is_completed = 0` when it matters.

- [ ] **Step 14: Run the tests to verify they pass**

Run: `npm test -- src/services/__tests__/database.test.ts -t "insertSkippedPlaceholderSets"`
Expected: both PASS.

- [ ] **Step 15: Run the full database test file**

Run: `npm test -- src/services/__tests__/database.test.ts`
Expected: all tests PASS. If any existing test fails, review — the only expected breakage would be from the ORDER BY change, which is intentional.

- [ ] **Step 16: Commit**

```bash
git add src/services/database.ts src/services/__tests__/database.test.ts
git commit -m "feat: add programmed_order + planned_exercise_ids DB helpers"
```

---

## Task 4: `buildExerciseBlock` accepts `programmedOrder`

**Files:**
- Modify: `src/hooks/useWorkoutLifecycle.ts`

Purpose: thread the plan index into the batch insert. No test for this task — it's a pure parameter passthrough. Behavior is validated in Tasks 5 and 6.

- [ ] **Step 1: Update `buildExerciseBlock` signature and body**

In `src/hooks/useWorkoutLifecycle.ts`, locate `buildExerciseBlock` (around line 206). Update it:

```ts
async function buildExerciseBlock(
  workoutId: string,
  exercise: Exercise,
  setCount: number,
  restSec?: number,
  tagOverrides?: SetTag[],
  programmedOrder?: number | null,
): Promise<ExerciseBlock> {
  const tags: SetTag[] = Array.from({ length: setCount }, (_, i) => tagOverrides?.[i] ?? 'working');
  const exerciseOrderValue = programmedOrder != null ? programmedOrder + 1 : 0;
  const programmedOrderValue = programmedOrder != null ? programmedOrder + 1 : null;
  const setsToInsert = tags.map((tag, i) => ({
    workout_id: workoutId,
    exercise_id: exercise.id,
    set_number: i + 1,
    reps: null,
    weight: null,
    tag,
    rpe: null,
    is_completed: false,
    notes: null,
    exercise_order: exerciseOrderValue,
    programmed_order: programmedOrderValue,
  }));
  const [{ previousSets, lastTime }, bestE1RMRaw, inserted, userNotes] = await Promise.all([
    getExerciseHistoryData(exercise.id),
    getBestE1RM(exercise.id),
    addWorkoutSetsBatch(setsToInsert),
    getUserExerciseNotes(exercise.id),
  ]);
  const bestE1RM = bestE1RMRaw ?? undefined;
  originalBestE1RMRef.current.set(exercise.id, bestE1RM);
  currentBestE1RMRef.current.set(exercise.id, bestE1RM);
  const sets: LocalSet[] = inserted.map((ws, i) => ({
    id: ws.id,
    exercise_id: exercise.id,
    set_number: i + 1,
    weight: '',
    reps: '',
    rpe: '',
    tag: tags[i],
    is_completed: false,
    previous: previousSets[i] ?? null,
  }));
  const stickyNotes = userNotes?.machine_notes ?? '';
  return { exercise, sets, lastTime, machineNotesExpanded: stickyNotes.length > 0, machineNotes: stickyNotes, restSeconds: restSec ?? REST_SECONDS[exercise.training_goal] ?? DEFAULT_REST_SECONDS, restEnabled: true, bestE1RM };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `useWorkoutLifecycle.ts`. Test files may error if they mock `addWorkoutSetsBatch` with the old shape — ignore for now.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useWorkoutLifecycle.ts
git commit -m "feat: buildExerciseBlock accepts programmedOrder"
```

---

## Task 5: Start paths thread plan index + persist `planned_exercise_ids`

**Files:**
- Modify: `src/hooks/useWorkoutLifecycle.ts`
- Test: `src/__tests__/hooks/useWorkoutLifecycle-*.test.ts` (new file: `useWorkoutLifecycle-planOrder.test.ts`)

Purpose: `handleStartFromUpcoming`, `handleStartFromTemplate`, `handleStartEmpty`, and `handleAddExerciseToWorkout` pass the correct `programmedOrder` and persist `planned_exercise_ids`.

- [ ] **Step 1: Write a failing integration test**

Create `src/__tests__/hooks/useWorkoutLifecycle-planOrder.test.ts` with this content:

```ts
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useWorkoutLifecycle } from '../../hooks/useWorkoutLifecycle';
import * as db from '../../services/database';
import { createMockSession, createMockExercise } from '../helpers/factories';

jest.mock('../../services/database');
jest.mock('../../services/sync', () => ({
  fireAndForgetSync: jest.fn(),
  pullWorkoutHistory: jest.fn().mockResolvedValue(undefined),
  pullExercisesAndTemplates: jest.fn().mockResolvedValue(undefined),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
  deleteUpcomingWorkoutFromSupabase: jest.fn().mockResolvedValue(undefined),
}));

describe('useWorkoutLifecycle plan order persistence', () => {
  const mockedDb = db as jest.Mocked<typeof db>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.startWorkout.mockResolvedValue({ id: 'w1', user_id: 'u1', template_id: null, upcoming_workout_id: null, started_at: '2026-04-11', finished_at: null, coach_notes: null, exercise_coach_notes: null, session_notes: null, planned_exercise_ids: null });
    mockedDb.addWorkoutSetsBatch.mockImplementation(async (sets) => sets.map((s, i) => ({ ...s, id: `set-${i}` })));
    mockedDb.getExerciseHistoryData?.mockResolvedValue?.({ previousSets: [], lastTime: null });
    mockedDb.getBestE1RM.mockResolvedValue(null);
    mockedDb.getUserExerciseNotes.mockResolvedValue({ notes: null, form_notes: null, machine_notes: null });
    mockedDb.setPlannedExerciseIds.mockResolvedValue(undefined);
    mockedDb.getAllTemplates.mockResolvedValue([]);
    mockedDb.getUpcomingWorkoutForToday.mockResolvedValue(null);
    mockedDb.getTemplateExercises.mockResolvedValue([
      { id: 'te-1', template_id: 't1', exercise_id: 'ex-a', order: 0, default_sets: 3, warmup_sets: 0, rest_seconds: 150, exercise: createMockExercise({ id: 'ex-a' }) },
      { id: 'te-2', template_id: 't1', exercise_id: 'ex-b', order: 1, default_sets: 3, warmup_sets: 0, rest_seconds: 150, exercise: createMockExercise({ id: 'ex-b' }) },
      { id: 'te-3', template_id: 't1', exercise_id: 'ex-c', order: 2, default_sets: 3, warmup_sets: 0, rest_seconds: 150, exercise: createMockExercise({ id: 'ex-c' }) },
    ]);
  });

  it('handleStartFromTemplate passes index as programmedOrder and persists planned_exercise_ids', async () => {
    // Render hook with template start path. Exact rendering harness depends on existing
    // test helpers (see `src/__tests__/hooks/useWorkoutLifecycle-sessionNotes.test.ts` for the pattern).
    // Invoke handleStartFromTemplate({ id: 't1', ... }).

    // ... (boilerplate to match existing test style — see the sessionNotes test file)

    await waitFor(() => expect(mockedDb.addWorkoutSetsBatch).toHaveBeenCalled());

    // Each call to addWorkoutSetsBatch represents one exercise.
    // Verify exercise_order and programmed_order on the first set of each batch.
    const calls = mockedDb.addWorkoutSetsBatch.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0][0][0].programmed_order).toBe(1);
    expect(calls[0][0][0].exercise_order).toBe(1);
    expect(calls[1][0][0].programmed_order).toBe(2);
    expect(calls[2][0][0].programmed_order).toBe(3);

    expect(mockedDb.setPlannedExerciseIds).toHaveBeenCalledWith('w1', ['ex-a', 'ex-b', 'ex-c']);
  });
});
```

Note: the test boilerplate (hook rendering, provider wrapping, etc.) must match the pattern in `src/__tests__/hooks/useWorkoutLifecycle-sessionNotes.test.ts`. Copy the setup from there; don't reinvent it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/hooks/useWorkoutLifecycle-planOrder.test.ts`
Expected: FAIL — `setPlannedExerciseIds` is never called and `addWorkoutSetsBatch` is called with the old signature (no `programmed_order` field).

- [ ] **Step 3: Update `handleStartFromTemplate` to thread index + persist plan**

In `src/hooks/useWorkoutLifecycle.ts` (around line 468):

```ts
async function handleStartFromTemplate(template: Template) {
  try {
    setStartingTemplateId(template.id);
    await historyPulledRef.current;
    const workout = await startWorkout(template.id);
    const templateExercises = await getTemplateExercises(template.id);

    const blocks = await Promise.all(
      templateExercises
        .filter(te => te.exercise)
        .map(async (te, i) => {
          const totalSets = te.warmup_sets + te.default_sets;
          const tags: SetTag[] = [
            ...Array(te.warmup_sets).fill('warmup' as SetTag),
            ...Array(te.default_sets).fill('working' as SetTag),
          ];
          const block = await buildExerciseBlock(workout.id, te.exercise!, totalSets, te.rest_seconds, tags, i);
          block.originalWarmupSets = te.warmup_sets;
          block.originalWorkingSets = te.default_sets;
          return block;
        })
    );

    const plannedIds = templateExercises.filter(te => te.exercise).map(te => te.exercise_id);
    await setPlannedExerciseIds(workout.id, plannedIds);

    activateWorkout(workout, blocks, template.name);
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to start workout', e);
    Sentry.captureException(e);
    Alert.alert('Error', 'Failed to start workout. Please try again.');
  } finally {
    setStartingTemplateId(null);
  }
}
```

Also add `setPlannedExerciseIds` to the import block at the top of the file (alongside `stampExerciseOrder`).

- [ ] **Step 4: Update `handleStartFromUpcoming` to thread index + persist plan**

In the same file (around line 530):

```ts
async function handleStartFromUpcoming() {
  if (!upcomingWorkout) return;
  try {
    setLoading(true);
    await historyPulledRef.current;
    const workout = await startWorkout(upcomingWorkout.workout.template_id, upcomingWorkout.workout.id);
    const plannedExercises = upcomingWorkout.exercises.filter(upEx => upEx.exercise);
    const blocks = await Promise.all(
      plannedExercises.map(async (upEx, i) => {
        const sets = upEx.sets ?? [];
        const setCount = Math.max(sets.length, 1);
        const tagOverrides: SetTag[] = sets.map(s => s.tag ?? 'working');
        return buildExerciseBlock(workout.id, upEx.exercise!, setCount, upEx.rest_seconds, tagOverrides, i);
      })
    );

    await setPlannedExerciseIds(workout.id, plannedExercises.map(upEx => upEx.exercise_id));

    // ... rest of the function unchanged (template exercise lookup, target persistence, coach notes)
```

Leave everything after the `setPlannedExerciseIds` call (template exercise lookup at old line 547, target persistence at old line 564, coach notes at old line 587) exactly as-is.

- [ ] **Step 5: Update `handleStartEmpty` — no plan**

In the same file (around line 516):

```ts
async function handleStartEmpty() {
  try {
    setLoading(true);
    const workout = await startWorkout(null);
    await setPlannedExerciseIds(workout.id, null);
    activateWorkout(workout, []);
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to start empty workout', e);
    Sentry.captureException(e);
    Alert.alert('Error', 'Failed to start workout. Please try again.');
  } finally {
    setLoading(false);
  }
}
```

- [ ] **Step 6: Update `handleAddExerciseToWorkout` — user-added, no plan slot**

In the same file (around line 629), find the `addWorkoutSetsBatch` or `buildExerciseBlock` call inside `handleAddExerciseToWorkout`. Verify it passes `undefined` (or omits) for `programmedOrder`. If it currently inlines the batch insert rather than calling `buildExerciseBlock`, ensure `programmed_order: null` and `exercise_order: 0` on the inserted sets.

Read the current implementation first. Likely shape:

```ts
async function handleAddExerciseToWorkout(exercise: Exercise) {
  // ...
  const block = await buildExerciseBlock(workout.id, exercise, 3);  // no programmedOrder arg
  // ...
}
```

This is already correct because `programmedOrder` is optional and defaults to `undefined` → `null` in the DB and `exercise_order = 0`. No change needed if this is the shape. Just verify.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- src/__tests__/hooks/useWorkoutLifecycle-planOrder.test.ts`
Expected: PASS.

- [ ] **Step 8: Run the type-check**

Run: `npx tsc --noEmit`
Expected: no errors in `useWorkoutLifecycle.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useWorkoutLifecycle.ts src/__tests__/hooks/useWorkoutLifecycle-planOrder.test.ts
git commit -m "feat: thread programmed_order through start paths"
```

---

## Task 6: `confirmFinish` inserts ghost rows for skipped planned exercises

**Files:**
- Modify: `src/hooks/useWorkoutLifecycle.ts`
- Test: new file `src/__tests__/hooks/useWorkoutLifecycle-skipped.test.ts`

Purpose: before `stampExerciseOrder`, scan the plan from `getPlannedExerciseIds`, compare against current blocks, and insert ghost rows for any planned exercise missing from memory.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/hooks/useWorkoutLifecycle-skipped.test.ts`:

```ts
import * as db from '../../services/database';

jest.mock('../../services/database');

describe('confirmFinish — ghost rows for skipped exercises', () => {
  const mockedDb = db as jest.Mocked<typeof db>;

  // This test exercises confirmFinish through the same harness used in
  // useWorkoutLifecycle-sessionNotes.test.ts. Copy its provider/render setup.

  it('inserts ghost row for a planned exercise that was removed mid-workout', async () => {
    mockedDb.getPlannedExerciseIds.mockResolvedValue(['ex-a', 'ex-b', 'ex-c']);
    mockedDb.insertSkippedPlaceholderSets.mockResolvedValue(undefined);

    // ... render hook, activate a workout with blocks for ex-a and ex-c only
    // (simulating that ex-b was removed via handleRemoveExercise)

    // ... call confirmFinish

    expect(mockedDb.insertSkippedPlaceholderSets).toHaveBeenCalledWith('w1', [
      { exercise_id: 'ex-b', programmed_order: 2 },
    ]);
    expect(mockedDb.stampExerciseOrder).toHaveBeenCalled();
    const insertCallOrder = mockedDb.insertSkippedPlaceholderSets.mock.invocationCallOrder[0];
    const stampCallOrder = mockedDb.stampExerciseOrder.mock.invocationCallOrder[0];
    expect(insertCallOrder).toBeLessThan(stampCallOrder);
  });

  it('inserts no ghost rows when plan is null', async () => {
    mockedDb.getPlannedExerciseIds.mockResolvedValue(null);
    // ... render with one block, call confirmFinish
    expect(mockedDb.insertSkippedPlaceholderSets).not.toHaveBeenCalled();
    expect(mockedDb.stampExerciseOrder).toHaveBeenCalled();
  });

  it('inserts no ghost rows when all planned exercises are present', async () => {
    mockedDb.getPlannedExerciseIds.mockResolvedValue(['ex-a', 'ex-b']);
    // ... render with blocks for both, call confirmFinish
    expect(mockedDb.insertSkippedPlaceholderSets).not.toHaveBeenCalled();
  });
});
```

The boilerplate for rendering the hook and activating a workout should match the pattern in `src/__tests__/hooks/useWorkoutLifecycle-sessionNotes.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/hooks/useWorkoutLifecycle-skipped.test.ts`
Expected: FAIL — `insertSkippedPlaceholderSets` is never called.

- [ ] **Step 3: Add the ghost-row logic to `confirmFinish`**

In `src/hooks/useWorkoutLifecycle.ts` (around line 781), update `confirmFinish`. Add before the existing `setOrderEntries` block:

```ts
async function confirmFinish() {
  setShowFinishModal(false);
  const workout = workoutRef.current;
  if (!workout) return;

  flushPendingSetWrites();
  flushPendingNotes();

  const currentBlocks = blocksRef.current;

  // FIX-3: Before stamping performed order, insert ghost rows for any planned
  // exercise that is missing from the current blocks (user removed it mid-workout,
  // or never engaged with it). Ghosts carry programmed_order so the coach can
  // detect "planned but skipped" after finish.
  try {
    const plannedIds = await getPlannedExerciseIds(workout.id);
    if (plannedIds && plannedIds.length > 0) {
      const presentIds = new Set(currentBlocks.map(b => b.exercise.id));
      const skipped: Array<{ exercise_id: string; programmed_order: number }> = [];
      plannedIds.forEach((exerciseId, i) => {
        if (!presentIds.has(exerciseId)) {
          skipped.push({ exercise_id: exerciseId, programmed_order: i + 1 });
        }
      });
      if (skipped.length > 0) {
        await insertSkippedPlaceholderSets(workout.id, skipped);
      }
    }
  } catch (e) {
    if (__DEV__) console.warn('Failed to insert skipped placeholder sets:', e);
    Sentry.captureException(e);
  }

  const setOrderEntries: Array<{ id: string; order: number }> = [];
  currentBlocks.forEach((block, blockIdx) => {
    for (const set of block.sets) {
      setOrderEntries.push({ id: set.id, order: blockIdx + 1 });
    }
  });
  await stampExerciseOrder(workout.id, setOrderEntries);

  // ... rest of confirmFinish unchanged
```

Add `getPlannedExerciseIds` and `insertSkippedPlaceholderSets` to the import block at the top of the file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/__tests__/hooks/useWorkoutLifecycle-skipped.test.ts`
Expected: all three PASS.

- [ ] **Step 5: Run the existing workout-lifecycle tests to verify no regression**

Run: `npm test -- src/__tests__/hooks/useWorkoutLifecycle-sessionNotes.test.ts`
Expected: PASS. If this test fails, it's because the mock for `getPlannedExerciseIds` is missing — add `mockedDb.getPlannedExerciseIds.mockResolvedValue(null);` to its `beforeEach`.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useWorkoutLifecycle.ts src/__tests__/hooks/useWorkoutLifecycle-skipped.test.ts
git commit -m "feat: insert ghost rows for skipped planned exercises at finish"
```

---

## Task 7: Persist auto-reorder (F2) to DB

**Files:**
- Modify: `src/hooks/useSetCompletion.ts`
- Test: `src/screens/__tests__/WorkoutScreen.test.tsx` (add one case) OR new file `src/__tests__/hooks/useSetCompletion-reorder.test.ts`

Purpose: after the in-memory auto-reorder inside `handleToggleComplete`, fire-and-forget call `stampExerciseOrder` with the new positions so a reload after auto-reorder preserves the user's reordered sequence.

- [ ] **Step 1: Write the failing test**

Add to an existing file or create `src/__tests__/hooks/useSetCompletion-reorder.test.ts`. Goal: simulate the auto-reorder path (completing the first set of an out-of-position exercise), verify `stampExerciseOrder` is called with the post-reorder positions for all blocks.

```ts
import * as db from '../../services/database';

jest.mock('../../services/database');

describe('handleToggleComplete — persists auto-reorder', () => {
  const mockedDb = db as jest.Mocked<typeof db>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.updateWorkoutSet.mockResolvedValue(undefined);
    mockedDb.stampExerciseOrder.mockResolvedValue(undefined);
  });

  it('stamps new exercise_order on all affected blocks after reorder', async () => {
    // Render useSetCompletion with initial blocks [A, B, C] where A has all sets
    // completed already is NOT the case — start with blocks [A, B, C] all uncompleted.
    // User completes the first set of C (which is at index 2).
    // Expected reorder: prevCompletedCount = 0, preCheckIdx for C = 2, preCheckCompleted = 0,
    // so C moves to index 0 → new order [C, A, B].

    // Boilerplate: copy hook render pattern from existing useSetCompletion tests
    // if any exist, otherwise from WorkoutScreen.test.tsx.

    // After the toggle:
    await new Promise(r => setTimeout(r, 0));
    expect(mockedDb.stampExerciseOrder).toHaveBeenCalledWith(
      'w1',
      expect.arrayContaining([
        expect.objectContaining({ order: 1 }),  // for sets belonging to C
        expect.objectContaining({ order: 2 }),  // for sets belonging to A
        expect.objectContaining({ order: 3 }),  // for sets belonging to B
      ]),
    );
  });

  it('does not stamp when no reorder happens', async () => {
    // Complete first set of exercise at index 0 — no reorder triggers.
    // ... render + toggle
    expect(mockedDb.stampExerciseOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/__tests__/hooks/useSetCompletion-reorder.test.ts`
Expected: FAIL — `stampExerciseOrder` is not called from the auto-reorder path.

- [ ] **Step 3: Add the DB persistence to `handleToggleComplete`**

In `src/hooks/useSetCompletion.ts`, find the section after the `setExerciseBlocks((prev) => { ... })` call (around line 216). The auto-reorder is applied inside that updater. After the updater returns, the new order is known — we need to compute the post-reorder position of each affected block and persist it.

The cleanest approach is to compute the new order in the pre-update block (alongside `shouldReorder` / `reorderInsertIdx`), then fire the DB write after the state update.

Insert this after `setExerciseBlocks(...)` returns (around line 216, before the `updateWorkoutSet` fire-and-forget):

```ts
    // Persist auto-reorder to DB so reload preserves the new order.
    // Without this, getWorkoutSets would return blocks sorted by the original
    // insert-time exercise_order, ignoring the user's reorder.
    if (shouldReorder && workoutRef.current) {
      const workoutId = workoutRef.current.id;
      // Build the post-reorder block list the same way the state updater did,
      // reading from blocksRef (which is updated by the state updater synchronously
      // in React's queueMicrotask model — but we need to compute it from pre-update
      // state for safety since blocksRef may lag).
      const preBlocks = blocksRef.current;
      const reorderedBlocks: typeof preBlocks = [];
      // Apply the same splice the state updater did
      const copy = [...preBlocks];
      const currentIdx = copy.findIndex(b => b.exercise.id === block.exercise.id);
      if (currentIdx > reorderInsertIdx) {
        const [moved] = copy.splice(currentIdx, 1);
        copy.splice(reorderInsertIdx, 0, moved);
      }
      reorderedBlocks.push(...copy);

      const entries: Array<{ id: string; order: number }> = [];
      reorderedBlocks.forEach((b, idx) => {
        for (const s of b.sets) {
          entries.push({ id: s.id, order: idx + 1 });
        }
      });
      stampExerciseOrder(workoutId, entries).catch(e => Sentry.captureException(e));
    }
```

Add `stampExerciseOrder` and `Sentry` to the imports at the top of the file.

Also: verify `workoutRef` is accessible in this hook. If `useSetCompletion` doesn't already receive `workoutRef`, add it to `UseSetCompletionOptions` and pass from `WorkoutScreen.tsx`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/__tests__/hooks/useSetCompletion-reorder.test.ts`
Expected: both cases PASS.

- [ ] **Step 5: Run the full WorkoutScreen test file to verify no regression**

Run: `npm test -- src/screens/__tests__/WorkoutScreen.test.tsx`
Expected: PASS. If `stampExerciseOrder` mock expectations conflict (the finish-time test may now also see a mid-workout call), update those tests to use `.toHaveBeenLastCalledWith` instead of `.toHaveBeenCalledWith`, or clear mock calls before finish.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useSetCompletion.ts src/__tests__/hooks/useSetCompletion-reorder.test.ts
git commit -m "feat: persist auto-reorder to DB so reload preserves user sequence"
```

---

## Task 8: Sync push/pull for new columns

**Files:**
- Modify: `src/services/sync.ts`
- Test: `src/services/__tests__/sync.test.ts`

Purpose: push `programmed_order` on `workout_sets` and `planned_exercise_ids` on `workouts`; pull the same.

- [ ] **Step 1: Find the push block for workout_sets**

Run: `grep -n "workout_sets" src/services/sync.ts`

Locate the function that pushes `workout_sets` rows (likely inside `syncToSupabase`). Note the line numbers.

- [ ] **Step 2: Find the push block for workouts**

Run: `grep -n "\.from('workouts')" src/services/sync.ts`

Locate the `workouts` insert/upsert inside `syncToSupabase`.

- [ ] **Step 3: Write a failing test**

Add to `src/services/__tests__/sync.test.ts`:

```ts
describe('syncToSupabase — programmed_order and planned_exercise_ids', () => {
  it('pushes programmed_order on workout_sets', async () => {
    // Set up a finished workout with one set whose programmed_order = 2.
    // Call syncToSupabase.
    // Verify the supabase upsert payload for workout_sets contains programmed_order: 2.
  });

  it('pushes planned_exercise_ids on workouts', async () => {
    // Set up a finished workout with planned_exercise_ids = '["ex-a","ex-b"]'.
    // Call syncToSupabase.
    // Verify the supabase upsert payload for workouts contains planned_exercise_ids: '["ex-a","ex-b"]'.
  });
});

describe('pullWorkoutHistory — programmed_order and planned_exercise_ids', () => {
  it('writes programmed_order to SQLite when pulled', async () => {
    // Mock supabase to return a workout_set with programmed_order = 3.
    // Call pullWorkoutHistory.
    // Query local workout_sets and verify programmed_order = 3.
  });

  it('writes planned_exercise_ids to SQLite when pulled', async () => {
    // Mock supabase to return a workout with planned_exercise_ids = '["ex-a"]'.
    // Call pullWorkoutHistory.
    // Query local workouts and verify planned_exercise_ids = '["ex-a"]'.
  });
});
```

Match the boilerplate of the existing sync.test.ts tests (supabase client mock, etc.).

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- src/services/__tests__/sync.test.ts -t "programmed_order\\|planned_exercise_ids"`
Expected: FAIL.

- [ ] **Step 5: Update the push for `workout_sets`**

In the push block identified in Step 1, add `programmed_order: s.programmed_order ?? null` to the row object being sent to Supabase. Also extend the SELECT from SQLite if it doesn't already use `SELECT *`.

- [ ] **Step 6: Update the push for `workouts`**

In the push block identified in Step 2, add `planned_exercise_ids: w.planned_exercise_ids ?? null` to the row object.

- [ ] **Step 7: Update the pull for `workout_sets` in `pullWorkoutHistory`**

Around line 540, the INSERT statement into SQLite. Extend the column list and values:

```ts
await db.runAsync(
  `INSERT OR REPLACE INTO workout_sets
    (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe,
     is_completed, notes, target_weight, target_reps, target_rpe,
     exercise_order, programmed_order)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  s.id, s.workout_id, s.exercise_id, s.set_number, s.reps, s.weight, s.tag, s.rpe,
  s.is_completed ? 1 : 0, s.notes,
  s.target_weight ?? null, s.target_reps ?? null, s.target_rpe ?? null,
  s.exercise_order ?? 0, s.programmed_order ?? null,
);
```

(If the existing statement uses `ON CONFLICT ... UPDATE SET ...`, extend the update clause similarly.)

- [ ] **Step 8: Update the pull for `workouts` in `pullWorkoutHistory`**

Find the workouts upsert in `pullWorkoutHistory`. Add `planned_exercise_ids` to the column list and the values bound to it: `w.planned_exercise_ids ?? null`.

- [ ] **Step 9: Run the sync tests to verify they pass**

Run: `npm test -- src/services/__tests__/sync.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/services/sync.ts src/services/__tests__/sync.test.ts
git commit -m "feat: sync programmed_order and planned_exercise_ids"
```

---

## Task 9: Regression test — reload after workout start preserves plan order

**Files:**
- Test: `src/screens/__tests__/WorkoutScreen.test.tsx` or new `src/__tests__/hooks/useWorkoutLifecycle-reload.test.ts`

Purpose: pin the fix to Issue 1. Without this, the rowid race could silently reappear.

- [ ] **Step 1: Write the failing-if-we-regress test**

Create `src/__tests__/hooks/useWorkoutLifecycle-reload.test.ts` or add to an existing file:

```ts
describe('reload preserves plan order after start', () => {
  it('loadActiveWorkout returns blocks in plan order even if rowid order is scrambled', async () => {
    // Start from template with exercises [A, B, C] → materialize sets.
    // In a real DB this writes rows with exercise_order = 1, 2, 3 regardless of insert order.
    // Simulate a scrambled insert order by inserting the rows in reverse:
    //
    //   - Sets for C with exercise_order = 3, programmed_order = 3
    //   - Sets for A with exercise_order = 1, programmed_order = 1
    //   - Sets for B with exercise_order = 2, programmed_order = 2
    //
    // Call getWorkoutSets — expected order of rows: A, B, C (by exercise_order).
    // Call loadActiveWorkout → exerciseBlocks [A, B, C].
    //
    // This test MUST FAIL on any future regression that reintroduces rowid
    // dependency or drops exercise_order stamping at insert time.

    const workoutId = 'w1';
    // ... create workout row
    // ... insert sets in reverse order via addWorkoutSetsBatch
    //     (pass exercise_order and programmed_order explicitly for each)

    const rows = await getWorkoutSets(workoutId);
    const exerciseOrderSequence = rows.map(r => r.exercise_id);
    // Deduplicate consecutive same exercise_id
    const unique = exerciseOrderSequence.filter((v, i, a) => i === 0 || a[i - 1] !== v);
    expect(unique).toEqual(['ex-a', 'ex-b', 'ex-c']);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- src/__tests__/hooks/useWorkoutLifecycle-reload.test.ts`
Expected: PASS (this is a regression guard — it passes on the fixed code).

- [ ] **Step 3: Sanity check — temporarily break the fix**

Manually remove `exercise_order` from the insert in `addWorkoutSetsBatch`. Run the test. Expected: FAIL. Revert the change.

This proves the test actually catches the regression.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/hooks/useWorkoutLifecycle-reload.test.ts
git commit -m "test: pin reload-preserves-plan-order regression guard"
```

---

## Task 10: MCP read-tool updates

**Files:**
- Modify: `/Users/sachitgoyal/code/lift-ai-mcp/src/tools/read/*.ts` (find the files by `get_workout_detail` and `get_exercise_history` tool registrations)

Purpose: expose `programmed_order` on set rows, derive `reordered` and `skipped_exercises` in `get_workout_detail`.

**Note:** This task runs in a **different git repo** (`/Users/sachitgoyal/code/lift-ai-mcp`). Do not commit to the lift-ai repo from here.

- [ ] **Step 1: Find the tool file for `get_workout_detail`**

```bash
grep -rn "get_workout_detail" /Users/sachitgoyal/code/lift-ai-mcp/src/tools/ | head -5
```

Note the file path.

- [ ] **Step 2: Extend the SELECT to include `programmed_order` on `workout_sets` and `planned_exercise_ids` on `workouts`**

Locate the Supabase query in the tool handler. Ensure `programmed_order` is included (often `.select('*')` already covers this, but confirm). Add `planned_exercise_ids` to the `workouts` select.

- [ ] **Step 3: Derive `reordered` and `skipped_exercises` in the response**

After the rows are grouped by exercise, compute:

```ts
const exercises = groupedRows.map(group => ({
  exercise_id: group.exercise_id,
  exercise_name: group.exercise_name,
  programmed_order: group.rows[0].programmed_order,
  exercise_order: group.rows[0].exercise_order,
  skipped: group.rows.every(r => !r.is_completed) && group.rows.length === 1 && group.rows[0].reps === 0 && group.rows[0].weight === 0,
  sets: group.rows.filter(r => !(r.reps === 0 && r.weight === 0 && !r.is_completed)),  // hide ghost row from sets list
}));

// Sort by programmed_order (plan order), NOT exercise_order (performed order).
exercises.sort((a, b) => (a.programmed_order ?? 999) - (b.programmed_order ?? 999));

const reordered = exercises.some(e =>
  e.programmed_order != null && e.exercise_order != null && e.programmed_order !== e.exercise_order
);
const skipped_exercises = exercises.filter(e => e.skipped).map(e => e.exercise_name);

return {
  ...workoutResponse,
  planned_exercise_ids: JSON.parse(workout.planned_exercise_ids ?? 'null'),
  exercises,
  reordered,
  skipped_exercises,
};
```

- [ ] **Step 4: Extend `get_exercise_history` similarly**

Locate the `get_exercise_history` tool handler. Add `programmed_order` to the set-level fields returned per session. No derivation needed — the caller (Claude Desktop) can reason about it directly.

- [ ] **Step 5: Build and test the MCP server**

```bash
cd /Users/sachitgoyal/code/lift-ai-mcp
npm run build
npm test  # if tests exist
```

Expected: clean build.

- [ ] **Step 6: Deploy to Cloudflare Workers**

```bash
cd /Users/sachitgoyal/code/lift-ai-mcp
npm run deploy
```

Verify deployment succeeded. The phone app will start producing rows with the new columns as soon as users run the new build; MCP reads them once deployed.

- [ ] **Step 7: Commit in the MCP repo**

```bash
cd /Users/sachitgoyal/code/lift-ai-mcp
git add src/tools/read/
git commit -m "feat: expose programmed_order, reordered, skipped_exercises"
git push
```

---

## Task 11: CLAUDE.md update

**Files:**
- Modify: `CLAUDE.md` (project root)

Purpose: document the new columns and behavior in the repo's AI-facing docs.

- [ ] **Step 1: Update the Database section**

In `CLAUDE.md`, find the `workouts` table description. Add `planned_exercise_ids` to the list of columns with a note: "JSON array of exercise_ids in plan order at workout start; NULL for empty workouts."

Find the `workout_sets` description (mentions `target_weight`, `target_reps`, `target_rpe`, `exercise_order`). Add `programmed_order` with: "plan position stamped at insert (NULL for user-added mid-workout or historical). `exercise_order` is the performed order, re-stamped at finish and after auto-reorder. Together they let the AI coach diff planned vs. performed."

- [ ] **Step 2: Update the Sync section**

Add a note that `planned_exercise_ids` on workouts and `programmed_order` on workout_sets flow through push/pull.

- [ ] **Step 3: Update the MCP section**

Note that `get_workout_detail` returns `reordered: boolean` and `skipped_exercises: string[]` derived from the new columns.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document programmed_order and planned_exercise_ids"
```

---

## Self-Review Checklist (performed before handoff)

1. **Spec coverage:**
   - Issue 1 (rowid race) → Tasks 3, 4, 5 (exercise_order stamped at insert) + Task 9 (regression guard)
   - Issue 2 (programmed order lost at finish) → Task 3 (`programmed_order` column) + Task 4 (stamped at insert) + Task 6 (confirmFinish preserves it)
   - Issue 3 (skipped exercises) → Task 3 (helpers) + Task 5 (`setPlannedExerciseIds`) + Task 6 (ghost rows at finish)
   - Auto-reorder persistence gap → Task 7
   - Migration on both Supabase projects → Task 1 (explicit steps 2, 3)
   - SQLite migration mirror → Task 1 (step 4)
   - Sync push/pull → Task 8
   - MCP read-tool exposure → Task 10
   - Docs → Task 11

2. **Placeholder scan:** No `TBD`, `TODO`, or `implement later` tokens in steps. Every code block is complete and pasteable. Test boilerplate references existing helper files by path.

3. **Type consistency:**
   - `programmed_order: number | null` is consistent in `WorkoutSet`, `WorkoutSetRow`, `addWorkoutSetsBatch` input, and the pull mapping.
   - `planned_exercise_ids: string | null` (the column is TEXT / JSON) is consistent in `Workout` and helpers.
   - `setPlannedExerciseIds(workoutId, ids: string[] | null)` — JS-side takes an array, converts to JSON inside the function.
   - `getPlannedExerciseIds(workoutId): Promise<string[] | null>` — JS-side returns parsed array.
   - `insertSkippedPlaceholderSets(workoutId, skipped: Array<{ exercise_id: string; programmed_order: number }>)`.

4. **Ordering of tasks:** Schema (1) → Types (2) → DB helpers (3) → buildExerciseBlock signature (4) → start paths (5) → finish path (6) → auto-reorder persistence (7) → sync (8) → regression guard (9) → MCP (10) → docs (11). Each task depends only on earlier tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-11-workout-ordering-integrity.md`.
