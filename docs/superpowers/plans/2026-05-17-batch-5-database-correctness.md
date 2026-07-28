# Batch 5: Database Correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five surgical correctness fixes in `src/services/database.ts`: eliminate an N+1 in upcoming-workout loads, restore `exercise_order` + `programmed_order` + target columns to exercise history, harden an unguarded migration UPDATE, count first-ever PRs in the weekly summary, and make `createTemplate` user-scoped like `createExercise`.

**Architecture:** All edits scoped to one file. Each fix is independently testable. No schema migrations or new tables required.

**Tech Stack:** TypeScript, expo-sqlite async API, Jest.

**Repo:** This worktree (`/Users/sachitgoyal/code/lift-ai/.claude/worktrees/brave-spence-530049/`). Branch: `claude/brave-spence-530049`.

---

## File Structure

**Modified files (1):**
- `src/services/database.ts` — all 5 fixes

**New test files (3):**
- `src/__tests__/services/database-buildUpcomingExercises.test.ts`
- `src/__tests__/services/database-getExerciseHistoryColumns.test.ts`
- `src/__tests__/services/database-getPRsThisWeek.test.ts`

(`initSchema` is exercised via existing tests; the migration-guard fix is verified by grep + manual idempotency review. `createTemplate` user_id fix is verified by inspecting the existing test mocks; new dedicated test optional.)

---

## Task 1: Batch the N+1 in `buildUpcomingExercises`

**Problem.** `buildUpcomingExercises` (`database.ts:1120-1157`) does:
1. One SELECT JOIN to fetch all upcoming_workout_exercises for a workout.
2. **One additional `SELECT * FROM upcoming_workout_sets WHERE upcoming_exercise_id = ?` per exercise** — sequential awaits inside a `for` loop.

For 8 exercises this is 8 sequential SQLite round-trips that should be 1.

**Files:**
- Modify: `src/services/database.ts:1120-1157`
- Test: `src/__tests__/services/database-buildUpcomingExercises.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/services/database-buildUpcomingExercises.test.ts`:

```typescript
/**
 * Tests for Batch 5 Task 1: buildUpcomingExercises must batch the
 * upcoming_workout_sets fetch into a single IN query, not N per-exercise queries.
 */

const getAllAsync = jest.fn();

jest.mock('../../services/database', () => {
  const actual = jest.requireActual('../../services/database');
  return actual;
});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync,
    getFirstAsync: jest.fn().mockResolvedValue(null),
    closeAsync: jest.fn().mockResolvedValue(undefined),
    withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => { await cb(); }),
  }),
  deleteDatabaseAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

const { getUpcomingWorkoutForToday } = require('../../services/database');

describe('Batch 5 Task 1: buildUpcomingExercises batched fetch', () => {
  beforeEach(() => {
    getAllAsync.mockReset();
  });

  it('issues exactly ONE upcoming_workout_sets query for N upcoming exercises', async () => {
    // 1st call: upcoming_workouts for today
    // 2nd call: upcoming_workout_exercises JOIN exercises (N rows)
    // 3rd call: SHOULD BE a single IN query, NOT N separate queries
    const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    getAllAsync
      .mockResolvedValueOnce([{ id: 'uw1', date: today, name: 'Today', notes: null, template_id: null, created_at: 't' }]) // upcoming_workouts
      .mockResolvedValueOnce([
        { id: 'ue1', upcoming_workout_id: 'uw1', exercise_id: 'ex1', sort_order: 0, rest_seconds: 90, notes: null, e_id: 'ex1', e_user_id: null, e_name: 'A', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
        { id: 'ue2', upcoming_workout_id: 'uw1', exercise_id: 'ex2', sort_order: 1, rest_seconds: 90, notes: null, e_id: 'ex2', e_user_id: null, e_name: 'B', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
        { id: 'ue3', upcoming_workout_id: 'uw1', exercise_id: 'ex3', sort_order: 2, rest_seconds: 90, notes: null, e_id: 'ex3', e_user_id: null, e_name: 'C', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
      ])
      // ONE batched sets query (the fix). Pre-fix this would be 3 separate calls.
      .mockResolvedValueOnce([
        { id: 's1', upcoming_exercise_id: 'ue1', set_number: 1, target_weight: 100, target_reps: 5, target_rpe: 8, tag: 'working' },
        { id: 's2', upcoming_exercise_id: 'ue2', set_number: 1, target_weight: 200, target_reps: 5, target_rpe: 8, tag: 'working' },
        { id: 's3', upcoming_exercise_id: 'ue3', set_number: 1, target_weight: 300, target_reps: 5, target_rpe: 8, tag: 'working' },
      ]);

    const result = await getUpcomingWorkoutForToday();

    expect(result).not.toBeNull();
    expect(result!.exercises).toHaveLength(3);
    // The third call (sets) should be a SINGLE IN query.
    const setsCallCount = getAllAsync.mock.calls.filter(call => /upcoming_workout_sets/i.test(call[0] as string)).length;
    expect(setsCallCount).toBe(1);
  });

  it('groups returned sets back to their parent exercise correctly', async () => {
    const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    getAllAsync
      .mockResolvedValueOnce([{ id: 'uw1', date: today, name: 'Today', notes: null, template_id: null, created_at: 't' }])
      .mockResolvedValueOnce([
        { id: 'ue1', upcoming_workout_id: 'uw1', exercise_id: 'ex1', sort_order: 0, rest_seconds: 90, notes: null, e_id: 'ex1', e_user_id: null, e_name: 'A', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
        { id: 'ue2', upcoming_workout_id: 'uw1', exercise_id: 'ex2', sort_order: 1, rest_seconds: 90, notes: null, e_id: 'ex2', e_user_id: null, e_name: 'B', e_type: 'weighted', e_muscle_groups: '[]', e_training_goal: 'hypertrophy', e_description: '', e_created_at: 't' },
      ])
      .mockResolvedValueOnce([
        // Deliberately out of order — grouping must still partition correctly.
        { id: 's2a', upcoming_exercise_id: 'ue2', set_number: 1, target_weight: 200, target_reps: 5, target_rpe: 8, tag: 'working' },
        { id: 's1a', upcoming_exercise_id: 'ue1', set_number: 1, target_weight: 100, target_reps: 5, target_rpe: 8, tag: 'working' },
        { id: 's1b', upcoming_exercise_id: 'ue1', set_number: 2, target_weight: 100, target_reps: 5, target_rpe: 8, tag: 'working' },
      ]);

    const result = await getUpcomingWorkoutForToday();
    expect(result!.exercises[0].sets).toHaveLength(2); // ue1
    expect(result!.exercises[1].sets).toHaveLength(1); // ue2
    expect(result!.exercises[0].sets.map(s => s.set_number)).toEqual([1, 2]); // sorted within group
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/database-buildUpcomingExercises.test.ts
```
Expected: FAIL — current code makes N sets queries; the first test sees 3 calls instead of 1.

- [ ] **Step 3: Replace the per-exercise sets loop with one IN query**

In `src/services/database.ts`, replace `buildUpcomingExercises` (lines 1120-1157):

```typescript
async function buildUpcomingExercises(
  database: SQLite.SQLiteDatabase,
  workoutId: string,
): Promise<(UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[]> {
  const exerciseRows = await database.getAllAsync<UpcomingExerciseJoinRow>(
    `SELECT ue.*, e.id as e_id, e.user_id as e_user_id, e.name as e_name, e.type as e_type,
            e.muscle_groups as e_muscle_groups, e.training_goal as e_training_goal,
            e.description as e_description, e.created_at as e_created_at
     FROM upcoming_workout_exercises ue
     JOIN exercises e ON ue.exercise_id = e.id
     WHERE ue.upcoming_workout_id = ?
     ORDER BY ue.sort_order`,
    workoutId,
  );

  if (exerciseRows.length === 0) return [];

  // Batched sets fetch: one IN query for all upcoming_exercise_ids, then group
  // by upcoming_exercise_id in memory. Replaces an N+1 of one query per
  // exercise — which was 8-15 sequential round-trips on workout-start.
  const ueIds = exerciseRows.map((r) => r.id);
  const placeholders = ueIds.map(() => '?').join(',');
  const rawSets = await database.getAllAsync<UpcomingWorkoutSetRow>(
    `SELECT * FROM upcoming_workout_sets
     WHERE upcoming_exercise_id IN (${placeholders})
     ORDER BY upcoming_exercise_id, set_number`,
    ...ueIds,
  );

  const setsByExerciseId = new Map<string, UpcomingWorkoutSet[]>();
  for (const row of rawSets) {
    const mapped = mapUpcomingWorkoutSetRow(row);
    const bucket = setsByExerciseId.get(row.upcoming_exercise_id);
    if (bucket) {
      bucket.push(mapped);
    } else {
      setsByExerciseId.set(row.upcoming_exercise_id, [mapped]);
    }
  }

  return exerciseRows.map((r) => ({
    id: r.id,
    upcoming_workout_id: r.upcoming_workout_id,
    exercise_id: r.exercise_id,
    order: r.sort_order,
    rest_seconds: r.rest_seconds,
    notes: r.notes,
    exercise: parseExerciseFromJoin(r),
    sets: setsByExerciseId.get(r.id) ?? [],
  }));
}
```

If `mapUpcomingWorkoutSetRow` doesn't include `upcoming_exercise_id` in the row interface, ensure the typed `UpcomingWorkoutSetRow` has it (it should — `SELECT *` returns it). Verify by checking the type definition.

- [ ] **Step 4: Run tests to verify both pass**

Run the same jest command as Step 2.
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full database suite for regressions**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/ src/services/__tests__/
```
Expected: all green.

- [ ] **Step 6: Typecheck + commit**

```
npx tsc --noEmit
```

```bash
git add src/services/database.ts src/__tests__/services/database-buildUpcomingExercises.test.ts
git commit -m "perf(db): batch buildUpcomingExercises sets fetch into one IN query (was N+1)"
```

---

## Task 2: `getExerciseHistory` JOIN must include `exercise_order`, `programmed_order`, and target columns

**Problem.** The SELECT at `database.ts:982-989` enumerates specific columns and omits:
- `ws.exercise_order`
- `ws.programmed_order`
- `ws.target_weight`, `ws.target_reps`, `ws.target_rpe`

The row mapper at lines 1019-1035 then hardcodes these to `0`/`null`. Downstream consumers (MCP coach, ghost-row detection, ExerciseHistoryContent target overlays) see falsified data.

**Files:**
- Modify: `src/services/database.ts:982-1035`
- Test: `src/__tests__/services/database-getExerciseHistoryColumns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/services/database-getExerciseHistoryColumns.test.ts`:

```typescript
/**
 * Tests for Batch 5 Task 2: getExerciseHistory must surface exercise_order,
 * programmed_order, and target_* columns from workout_sets instead of
 * hardcoding them to defaults.
 */

const getAllAsync = jest.fn();

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync,
    getFirstAsync: jest.fn().mockResolvedValue(null),
    closeAsync: jest.fn().mockResolvedValue(undefined),
    withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => { await cb(); }),
  }),
  deleteDatabaseAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

const { getExerciseHistory } = require('../../services/database');

describe('Batch 5 Task 2: getExerciseHistory surfaces all columns', () => {
  beforeEach(() => { getAllAsync.mockReset(); });

  it('returns exercise_order, programmed_order, and target_* from the underlying row', async () => {
    // 1st call: workout IDs
    getAllAsync.mockResolvedValueOnce([{ id: 'w1' }]);
    // 2nd call: joined rows with the new s_* columns
    getAllAsync.mockResolvedValueOnce([
      {
        w_id: 'w1', w_user_id: 'u1', w_template_id: null,
        w_upcoming_workout_id: null,
        w_started_at: 't1', w_finished_at: 't2',
        w_coach_notes: null, w_exercise_coach_notes: null, w_session_notes: null,
        s_id: 's1', s_workout_id: 'w1', s_exercise_id: 'ex1',
        s_set_number: 1, s_reps: 5, s_weight: 100,
        s_tag: 'working', s_rpe: 8, s_is_completed: 1, s_notes: null,
        s_target_weight: 95, s_target_reps: 5, s_target_rpe: 8,
        s_exercise_order: 2, s_programmed_order: 1,
      },
    ]);

    const result = await getExerciseHistory('ex1', 5);

    expect(result).toHaveLength(1);
    expect(result[0].sets).toHaveLength(1);
    const set = result[0].sets[0];
    expect(set.exercise_order).toBe(2);
    expect(set.programmed_order).toBe(1);
    expect(set.target_weight).toBe(95);
    expect(set.target_reps).toBe(5);
    expect(set.target_rpe).toBe(8);
  });

  it('grep invariant: getExerciseHistory SELECT includes the five columns', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/database.ts'),
      'utf8',
    );
    // Locate the getExerciseHistory body and check the JOIN SELECT
    const fnMatch = src.match(/export function getExerciseHistory[\s\S]*?(?=export function|\Z)/);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toMatch(/ws\.exercise_order\s+as\s+s_exercise_order/);
    expect(fnBody).toMatch(/ws\.programmed_order\s+as\s+s_programmed_order/);
    expect(fnBody).toMatch(/ws\.target_weight\s+as\s+s_target_weight/);
    expect(fnBody).toMatch(/ws\.target_reps\s+as\s+s_target_reps/);
    expect(fnBody).toMatch(/ws\.target_rpe\s+as\s+s_target_rpe/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/database-getExerciseHistoryColumns.test.ts
```
Expected: FAIL on both tests.

- [ ] **Step 3: Add the columns to the SELECT and the row mapper**

In `src/services/database.ts`, locate the SELECT inside `getExerciseHistory` (lines 982-994). Replace it:

```typescript
    const rows = await database.getAllAsync<ExerciseHistoryJoinRow>(
      `SELECT
         w.id as w_id, w.user_id as w_user_id, w.template_id as w_template_id,
         w.upcoming_workout_id as w_upcoming_workout_id,
         w.started_at as w_started_at, w.finished_at as w_finished_at,
         w.coach_notes as w_coach_notes, w.exercise_coach_notes as w_exercise_coach_notes, w.session_notes as w_session_notes,
         ws.id as s_id, ws.workout_id as s_workout_id, ws.exercise_id as s_exercise_id,
         ws.set_number as s_set_number, ws.reps as s_reps, ws.weight as s_weight,
         ws.tag as s_tag, ws.rpe as s_rpe, ws.is_completed as s_is_completed, ws.notes as s_notes,
         ws.target_weight as s_target_weight, ws.target_reps as s_target_reps, ws.target_rpe as s_target_rpe,
         ws.exercise_order as s_exercise_order, ws.programmed_order as s_programmed_order
       FROM workouts w
       INNER JOIN workout_sets ws ON ws.workout_id = w.id
       WHERE w.id IN (${placeholders}) AND ws.exercise_id = ?
       ORDER BY w.started_at DESC, ws.set_number`,
      ...ids, exerciseId,
    );
```

Replace the row-mapper call (lines 1019-1035):

```typescript
      workoutMap.get(r.w_id)!.sets.push(mapWorkoutSetRow({
        id: r.s_id,
        workout_id: r.s_workout_id,
        exercise_id: r.s_exercise_id,
        set_number: r.s_set_number,
        reps: r.s_reps,
        weight: r.s_weight,
        tag: r.s_tag,
        rpe: r.s_rpe,
        is_completed: r.s_is_completed,
        notes: r.s_notes,
        target_weight: r.s_target_weight ?? null,
        target_reps: r.s_target_reps ?? null,
        target_rpe: r.s_target_rpe ?? null,
        exercise_order: r.s_exercise_order ?? 0,
        programmed_order: r.s_programmed_order ?? null,
      }));
```

The `ExerciseHistoryJoinRow` type must include the five new fields. Locate the type (grep for `ExerciseHistoryJoinRow` interface) and add:

```typescript
  s_target_weight: number | null;
  s_target_reps: number | null;
  s_target_rpe: number | null;
  s_exercise_order: number;
  s_programmed_order: number | null;
```

- [ ] **Step 4: Run tests to verify both pass**

Run the same jest command.
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```
npx tsc --noEmit
```

```bash
git add src/services/database.ts src/__tests__/services/database-getExerciseHistoryColumns.test.ts
git commit -m "fix(db): getExerciseHistory surfaces exercise_order, programmed_order, and target_* columns"
```

---

## Task 3: Harden `initSchema` migration UPDATE

**Problem.** Line 450:

```typescript
await database.runAsync("UPDATE workout_sets SET rpe = NULL WHERE tag = 'failure' AND rpe IS NOT NULL");
```

- No `.catch(() => {})` — every other migration above and below has one. A transient failure here crashes `initSchema`, which means the app boot fails.
- Runs unconditionally on every cold start with a full-table scan over `workout_sets` (no index on `tag` or `rpe`).

**Files:**
- Modify: `src/services/database.ts:449-451`

(No new test — the grep-style verification in Step 4 is sufficient. The behavior change is "no longer crashes on transient error" which is hard to unit-test without contriving the failure.)

- [ ] **Step 1: Add an existence pre-check and a swallow-and-log catch**

In `src/services/database.ts`, replace lines 449-450:

```typescript
  // Migration: null out RPE on failure sets (failure = implicit RPE 10, no need to store it)
  await database.runAsync("UPDATE workout_sets SET rpe = NULL WHERE tag = 'failure' AND rpe IS NOT NULL");
```

with:

```typescript
  // Migration: null out RPE on failure sets (failure = implicit RPE 10, no need to store it).
  // Cheap pre-check avoids a full-table UPDATE on every cold start once the migration
  // has effectively converged. .catch swallows transient errors so initSchema never
  // crashes the app on boot — matches the pattern used by every other ALTER above.
  try {
    const stale = await database.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM workout_sets WHERE tag = 'failure' AND rpe IS NOT NULL LIMIT 1"
    );
    if ((stale?.count ?? 0) > 0) {
      await database.runAsync("UPDATE workout_sets SET rpe = NULL WHERE tag = 'failure' AND rpe IS NOT NULL");
    }
  } catch {}
```

- [ ] **Step 2: Build + typecheck**

```
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Run full test suite for regressions (initSchema runs on every test DB init)**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all green.

- [ ] **Step 4: Grep verify**

Run:
```bash
grep -n -A 5 "null out RPE on failure" src/services/database.ts
```
Expected: shows the new pre-check + try/catch + UPDATE structure.

- [ ] **Step 5: Commit**

```bash
git add src/services/database.ts
git commit -m "fix(db): guard rpe-null migration with existence pre-check and swallowed catch"
```

---

## Task 4: `getPRsThisWeek` counts first-ever PRs

**Problem.** Line 1109 gates PR counting on `priorBest > 0`:

```typescript
if (weekBest > priorBest && priorBest > 0) {
  prCount++;
}
```

This silently drops first-time PRs (any exercise the user has never done before this week). The WorkoutScreen PR badge counts these as PRs; the weekly summary should match.

**Files:**
- Modify: `src/services/database.ts:1098-1112`
- Test: `src/__tests__/services/database-getPRsThisWeek.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/services/database-getPRsThisWeek.test.ts`:

```typescript
/**
 * Tests for Batch 5 Task 4: getPRsThisWeek must count first-ever PRs
 * (exercises with no prior history), aligning with WorkoutScreen's PR badge.
 */

const getAllAsync = jest.fn();

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue({
    execAsync: jest.fn().mockResolvedValue(undefined),
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync,
    getFirstAsync: jest.fn().mockResolvedValue(null),
    closeAsync: jest.fn().mockResolvedValue(undefined),
    withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => { await cb(); }),
  }),
  deleteDatabaseAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

jest.mock('../../utils/oneRepMax', () => ({
  calculateEstimated1RM: (weight: number, reps: number) => weight * (1 + reps / 30),
}));

const { getPRsThisWeek } = require('../../services/database');

describe('Batch 5 Task 4: first-ever PRs count', () => {
  beforeEach(() => { getAllAsync.mockReset(); });

  it('counts a brand-new exercise as a PR (no prior history)', async () => {
    // This-week sets — one exercise the user has never done before
    getAllAsync
      .mockResolvedValueOnce([
        { exercise_id: 'newEx', weight: 100, reps: 5, rpe: 8 },
      ])
      // Prior sets query returns empty (no prior history for newEx)
      .mockResolvedValueOnce([]);

    const count = await getPRsThisWeek();
    expect(count).toBe(1); // first-ever PR
  });

  it('counts a PR-beating week (weekBest > priorBest)', async () => {
    getAllAsync
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 200, reps: 5, rpe: 8 },
      ])
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 180, reps: 5, rpe: 8 },
      ]);

    expect(await getPRsThisWeek()).toBe(1);
  });

  it('does NOT count when weekBest is lower than priorBest', async () => {
    getAllAsync
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 150, reps: 5, rpe: 8 },
      ])
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 200, reps: 5, rpe: 8 },
      ]);

    expect(await getPRsThisWeek()).toBe(0);
  });

  it('handles mixed: one first-ever + one PR-beat + one regression = 2 PRs', async () => {
    getAllAsync
      .mockResolvedValueOnce([
        { exercise_id: 'newEx', weight: 100, reps: 5, rpe: 8 },
        { exercise_id: 'bench', weight: 200, reps: 5, rpe: 8 },
        { exercise_id: 'squat', weight: 150, reps: 5, rpe: 8 },
      ])
      .mockResolvedValueOnce([
        { exercise_id: 'bench', weight: 180, reps: 5, rpe: 8 },
        { exercise_id: 'squat', weight: 200, reps: 5, rpe: 8 },
      ]);

    expect(await getPRsThisWeek()).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify the first-ever test fails**

Run:
```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/database-getPRsThisWeek.test.ts
```
Expected: FAIL on tests 1 and 4 (first-ever PR cases).

- [ ] **Step 3: Drop the `priorBest > 0` guard**

In `src/services/database.ts`, replace lines 1107-1111:

```typescript
      const priorBest = priorBestByExercise.get(exId) ?? 0;

      if (weekBest > priorBest && priorBest > 0) {
        prCount++;
      }
```

with:

```typescript
      const priorBest = priorBestByExercise.get(exId) ?? 0;

      // weekBest is always > 0 here because the SELECT filters on weight + reps
      // being non-null and is_completed = 1. priorBest = 0 means the user has
      // no prior history for this exercise — that first-ever lift IS a PR (matches
      // WorkoutScreen's PR badge logic).
      if (weekBest > priorBest) {
        prCount++;
      }
```

- [ ] **Step 4: Run tests to verify all 4 pass**

Run the same jest command.
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```
npx tsc --noEmit
```

```bash
git add src/services/database.ts src/__tests__/services/database-getPRsThisWeek.test.ts
git commit -m "fix(db): getPRsThisWeek counts first-ever PRs (align with WorkoutScreen badge)"
```

---

## Task 5: `createTemplate` uses `resolveUserId()` instead of hardcoded `'local'`

**Problem.** `createTemplate` (`database.ts:598-605`):

```typescript
export function createTemplate(name: string): Promise<Template> {
  return withDb('createTemplate', async (database) => {
    const id = uuid();
    const now = new Date().toISOString();
    await database.runAsync('INSERT INTO templates (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', id, name, now, now);
    return { id, user_id: 'local', name, created_at: now, updated_at: now };
  });
}
```

- INSERT does not supply `user_id`; relies on schema default `'local'`.
- In-memory return also hardcodes `'local'`.

`createExercise` (`database.ts:494-505`) shows the right pattern: `await resolveUserId()` before the `withDb`, then INSERT with the resolved user_id and return it.

**Files:**
- Modify: `src/services/database.ts:598-605`

(No new test file — the existing sync rescue tests cover the user_id propagation. We verify via grep that `resolveUserId` is invoked and the INSERT/return both use it.)

- [ ] **Step 1: Apply the fix**

Replace `createTemplate` in `src/services/database.ts`:

```typescript
export async function createTemplate(name: string): Promise<Template> {
  const userId = await resolveUserId();
  return withDb('createTemplate', async (database) => {
    const id = uuid();
    const now = new Date().toISOString();
    await database.runAsync(
      'INSERT INTO templates (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      id, userId, name, now, now,
    );
    return { id, user_id: userId, name, created_at: now, updated_at: now };
  });
}
```

Note: the function signature changes from `function` to `async function` so the `await resolveUserId()` can run before the `withDb` call. Verify no caller relies on the synchronous-Promise-creation timing (they all `await` the result; this is purely an internal refactor).

- [ ] **Step 2: Build + run all tests**

```
npx tsc --noEmit
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: tsc 0; all tests pass.

- [ ] **Step 3: Grep verify**

```bash
grep -n -A 8 'export async function createTemplate' src/services/database.ts
```
Expected: the function uses `await resolveUserId()` and the INSERT includes `user_id` in both the columns list and the bind params.

- [ ] **Step 4: Commit**

```bash
git add src/services/database.ts
git commit -m "fix(db): createTemplate resolves real user_id instead of hardcoding 'local'"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full Jest suite**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all green; test count grows by ~3 new files (~9 tests).

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Grep checks**

```bash
echo "=== buildUpcomingExercises batched ==="
grep -n 'WHERE upcoming_exercise_id IN' src/services/database.ts

echo "=== getExerciseHistory columns ==="
grep -n 'ws.exercise_order as s_exercise_order\|ws.target_weight as s_target_weight' src/services/database.ts

echo "=== initSchema migration guard ==="
grep -n -B 1 "UPDATE workout_sets SET rpe = NULL WHERE tag = 'failure'" src/services/database.ts

echo "=== first-ever PRs ==="
grep -n -B 3 'if (weekBest > priorBest)' src/services/database.ts

echo "=== createTemplate user_id ==="
grep -n -A 8 'export async function createTemplate' src/services/database.ts
```
Expected:
- IN-batched fetch is present
- All 5 missing columns appear in getExerciseHistory SELECT
- The migration guard has a pre-check + try/catch
- `weekBest > priorBest` (no `&& priorBest > 0`)
- createTemplate uses `await resolveUserId()` + INSERT with `user_id`

- [ ] **Step 4: Code review (mandatory gate per CLAUDE.md)**

```
/code-review deep --spec docs/superpowers/plans/2026-05-17-batch-5-database-correctness.md
```
Address actionable findings, then re-run grep + tests.

---

## Risks and rollback

- **Task 1 grouping correctness.** The IN query's `ORDER BY upcoming_exercise_id, set_number` keeps sets sorted within each group. Test 2 verifies grouping handles out-of-order rows. Low risk.
- **Task 2 type changes.** `ExerciseHistoryJoinRow` gains 5 fields. If any consumer typed against the old shape, TS will catch it. Likely zero impact since the type is internal.
- **Task 3 pre-check.** The `getFirstAsync<{ count: number }>` returns a single row from `COUNT(*) ... LIMIT 1` — the `LIMIT 1` is technically redundant for COUNT but harmless. If the SELECT itself errors, the catch swallows it and the UPDATE is skipped, which is the safe outcome.
- **Task 4 semantic change.** Existing users might suddenly see "more PRs this week" than before because first-evers now count. This is closer to the intended behavior (matches WorkoutScreen) — flag in user-facing changelog if there is one.
- **Task 5 user_id resolution.** `resolveUserId()` falls back to `'local'` when no Supabase session — preserves the pre-fix behavior for un-authed local-only usage. Authed users now correctly get their real ID.

---

## Self-review notes

- Spec coverage: 5 findings → 5 tasks. ✓
- Placeholder scan: none. ✓
- Type consistency: `UpcomingWorkoutSetRow.upcoming_exercise_id` referenced in Task 1 — verify exists; `ExerciseHistoryJoinRow` gains 5 fields in Task 2 — consistent with Step 3 edit. ✓
- TDD ordering: Tasks 1, 2, 4 write failing tests first; Tasks 3 + 5 are too small to TDD meaningfully and use grep verification. ✓
- All edits in one file (`database.ts`); 3 new test files. ✓
