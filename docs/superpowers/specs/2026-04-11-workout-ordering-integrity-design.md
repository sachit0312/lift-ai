# Workout Ordering Integrity — Design

**Date:** 2026-04-11
**Scope:** Fix exercise-ordering bugs in the workout pipeline (phone app + MCP server). Single migration, single implementation pass.

## Problem

Three distinct bugs degrade the integrity of exercise ordering in the workout pipeline:

### Issue 1 — Rowid race scrambles order on reload

`handleStartFromUpcoming` and `handleStartFromTemplate` in `src/hooks/useWorkoutLifecycle.ts` materialize exercise blocks by running `Promise.all(exercises.map(async (ex) => buildExerciseBlock(...)))`. Each `buildExerciseBlock` calls `addWorkoutSetsBatch`, which inserts a batch of `workout_sets` rows. Because the map callbacks fire concurrently, the batches race through the serialized `withDb` queue in arbitrary order.

`Promise.all` preserves *result array* order, so in-memory blocks are correct the moment the workout starts. But `workout_sets.exercise_order` is only stamped at **finish** time (via `stampExerciseOrder`). Until then, every set has `exercise_order = 0`.

`getWorkoutSets` orders by `exercise_order, rowid, set_number`. With `exercise_order = 0` for every row, `rowid` (insert order) is the effective tiebreaker — and the race scrambled it.

**Symptom:** exercises appear correctly right after Start, then jump to a different order the moment `loadActiveWorkout` runs (tab re-focus, remount, app relaunch, background→foreground resume).

### Issue 2 — Programmed order is destroyed at finish

`stampExerciseOrder()` in `confirmFinish` overwrites `workout_sets.exercise_order` with the *actually performed* order. This is correct for history display, but it destroys the only record of the original plan.

The upstream plan is also transient:
- `upcoming_workouts` rows are DELETEd by the next `create_upcoming_workout` call (see `lift-ai-mcp/src/tools/write/upcoming.ts:54-58`).
- `workouts.upcoming_workout_id` is a dangling FK after replacement.

After finish, no data source on phone or cloud can answer "what did the AI originally plan?"

### Issue 3 — Skipped exercises vanish

If an exercise was in the plan but never engaged with — either removed mid-workout via `handleRemoveExercise` (which hard-deletes `workout_sets` rows), or simply left untouched and filtered out — there is no trace of it after finish. The coach cannot detect chronic skipping ("user skipped calves 3 sessions in a row") because skipped exercises look identical to exercises that were never in the plan.

### Out of scope

**Issue 4 (AI reordering vs template)** is not a bug. The AI is allowed to reorder exercises relative to the template when it has a programming reason (front-loading compounds, prioritizing lagging muscles). Once Issue 1 is fixed, whatever order the AI intends is what the user sees. No change needed.

## Goals

1. After finish, a workout record durably captures both **performed order** and **programmed order** per exercise.
2. Exercises present in the plan but not performed are visible to the coach as explicit "skipped" signals.
3. The rowid race is eliminated — the order you see at Start is the order you see on every subsequent reload.
4. The fix is a single migration, applied to dev and prod Supabase, with mechanical sync and MCP changes.

## Non-goals

- No full plan snapshot. The existing columns already capture targets, notes, rest, tags, and set counts. Only *order* + *existence* need new storage.
- No changes to AI reordering freedom.
- No backfill of historical workouts. Pre-migration rows will have `programmed_order = NULL`; coach tools treat NULL as "unknown plan."

## Design

### Schema changes (migration `013_workout_ordering_integrity.sql`)

Two additive, nullable columns. Applied to both Supabase projects (`gcpnqpqqwcwvyzoivolp` dev, `lgnkxjiqzsqiwrqrsxww` prod) and mirrored in the SQLite migration block inside `src/services/database.ts`.

```sql
ALTER TABLE workout_sets ADD COLUMN programmed_order INTEGER;
CREATE INDEX IF NOT EXISTS workout_sets_workout_programmed_idx
  ON workout_sets(workout_id, programmed_order);

ALTER TABLE workouts ADD COLUMN planned_exercise_ids TEXT;
-- JSON array of exercise_ids in plan order, e.g. '["uuid-a","uuid-b","uuid-c"]'
-- NULL for workouts that started empty or pre-migration.
```

**Rationale for two columns, not one:**
- `workout_sets.programmed_order` is the fast path for the common case (per-set diffs, exists rows to join against).
- `workouts.planned_exercise_ids` is the durable record of the *full* plan, surviving mid-workout exercise removal (which hard-deletes `workout_sets` rows). Without this, `handleRemoveExercise` would erase the evidence that the exercise was ever planned, and Issue 3 would be unsolved.

### Code changes — phone app

**`src/services/database.ts`**

1. Extend `WorkoutSet` type and the row mapper with `programmed_order: number | null`.
2. Extend `addWorkoutSetsBatch` to accept and persist `programmed_order` and `exercise_order` per row.
3. Add `setPlannedExerciseIds(workoutId, ids: string[] | null)` helper that writes the JSON array to `workouts.planned_exercise_ids`.
4. Add `insertSkippedPlaceholderSets(workoutId, skipped: Array<{ exercise_id: string; programmed_order: number }>)` helper that writes one ghost row per skipped exercise: `set_number = 1`, `reps = 0`, `weight = 0`, `rpe = null`, `tag = 'working'`, `is_completed = 0`, `exercise_order = null`, `programmed_order = <position>`.
5. `stampExerciseOrder` continues to write only `exercise_order`. It must not touch `programmed_order`.

**`src/hooks/useWorkoutLifecycle.ts`**

1. `buildExerciseBlock(workoutId, exercise, setCount, restSec?, tagOverrides?, programmedOrder?: number | null)` — new optional final parameter. The function stamps both `exercise_order` (equal to `programmedOrder + 1` at start, treated as provisional) and `programmed_order` (equal to `programmedOrder + 1` if not null) on every set in the batch insert. This eliminates Issue 1 by removing the rowid dependency.
2. `handleStartFromUpcoming` — iterate `upcomingWorkout.exercises` with index, pass `i` as `programmedOrder`. After blocks are built, call `setPlannedExerciseIds(workout.id, upcomingWorkout.exercises.map(e => e.exercise_id))`.
3. `handleStartFromTemplate` — iterate `templateExercises` with index, pass `i` as `programmedOrder`. Call `setPlannedExerciseIds(workout.id, templateExercises.map(te => te.exercise_id))`.
4. `handleStartEmpty` — no plan. Call `setPlannedExerciseIds(workout.id, null)` (or leave default NULL).
5. `handleAddExerciseToWorkout` — user-added mid-workout. Pass `programmedOrder = null`. Do not mutate `planned_exercise_ids`.
6. `confirmFinish` — before `stampExerciseOrder`:
   - Read `workout.planned_exercise_ids`.
   - Compute the set of exercise_ids present in current blocks (`exerciseBlocks` already in memory).
   - For any planned exercise_id absent from the blocks, call `insertSkippedPlaceholderSets` with its position in the plan array.
   - Then call `stampExerciseOrder` on the performed blocks (unchanged).

**`src/hooks/useExerciseBlocks.ts`**

1. No change to `handleRemoveExercise` — it continues to hard-delete `workout_sets` rows. The ghost-row fill at finish time, driven by `workouts.planned_exercise_ids`, catches removed-planned exercises automatically.
2. **Persist auto-reorder (F2) to DB.** Today, `handleToggleComplete` in `useSetCompletion` performs the auto-reorder in memory only. Post-fix, after any auto-reorder, fire-and-forget call `stampExerciseOrder(workoutId, [{id: setId, order: newPosition}, ...])` on the affected sets so the reorder survives reload. This is the same helper used at finish — it just gets called mid-workout now as well. Without this step, a reload after auto-reorder would revert to the plan order stamped at insert time.

**`src/hooks/useSetCompletion.ts`**

After the auto-reorder branch in `handleToggleComplete`, call `stampExerciseOrder` with the new ordering of the affected blocks. Wrap in `try/catch` with Sentry per project convention. The in-memory `setExerciseBlocks` call remains synchronous and is not blocked on the DB write.

### Code changes — sync

**`src/services/sync.ts`**

1. `syncToSupabase` push of `workout_sets` — add `programmed_order` to the column list. Mechanical, same shape as the existing `exercise_order` handling from migration 007.
2. `syncToSupabase` push of `workouts` — add `planned_exercise_ids` to the column list.
3. `pullWorkoutHistory` — add both columns to the `SELECT`, pass them through to the SQLite upsert.

### Code changes — MCP server (`lift-ai-mcp`)

1. **`src/tools/read/workouts.ts`** (`get_workout_detail`, `get_workout_history`): include `programmed_order` in the `workout_sets` SELECT. Include `planned_exercise_ids` in the `workouts` SELECT. In the response:
   - Group sets by exercise, order by `programmed_order` ascending (plan order) with a secondary `exercise_order` field (performed order) on each group.
   - Add top-level derived fields: `reordered: boolean` (true if any exercise has `programmed_order !== exercise_order`) and `skipped_exercises: string[]` (exercise names with `exercise_order IS NULL`).
2. **`src/tools/read/exercises.ts`** (`get_exercise_history`): include `programmed_order` on per-set rows so the coach can detect chronic reorder/skip patterns across sessions.
3. **No changes** to `create_upcoming_workout`, `reorder_template_exercises`, or any write tool. The AI's ability to reorder is unchanged.

## Data Flow

**At workout start (from upcoming or template):**

```
caller (handleStartFromUpcoming/handleStartFromTemplate)
  ↓ index i per exercise in plan
  ↓
buildExerciseBlock(..., programmedOrder = i)
  ↓
addWorkoutSetsBatch({ ..., exercise_order: i+1, programmed_order: i+1 })
  ↓
workout_sets rows (both columns stamped, rowid irrelevant)

caller
  ↓ plan exercise_ids in order
  ↓
setPlannedExerciseIds(workoutId, [id0, id1, id2, ...])
  ↓
workouts.planned_exercise_ids = JSON
```

**At workout finish:**

```
confirmFinish
  ↓
read workouts.planned_exercise_ids
  ↓
compare against exerciseBlocks (exercise_ids in memory)
  ↓
for each missing planned exercise_id:
  insertSkippedPlaceholderSets({ exercise_id, programmed_order: positionInPlan + 1 })
  ↓
  workout_sets ghost row: programmed_order set, exercise_order NULL, is_completed=0
  ↓
stampExerciseOrder(workoutId, performed blocks)
  ↓
workout_sets.exercise_order updated for performed exercises only
  ↓ (ghost rows keep exercise_order = NULL)
```

**At reload (loadActiveWorkout):**

```
getWorkoutSets
  ↓
ORDER BY exercise_order, set_number
  ↓ (rowid no longer matters — exercise_order stamped at insert)
stable order, no race
```

**At MCP read:**

```
get_workout_detail(workout_id)
  ↓
SELECT ws.*, w.planned_exercise_ids FROM workout_sets ws JOIN workouts w
  ↓
group by exercise_id, order by programmed_order
  ↓
response:
  exercises: [
    { exercise_id, programmed_order: 1, exercise_order: 2, sets: [...] },
    { exercise_id, programmed_order: 2, exercise_order: 1, sets: [...] },
    { exercise_id, programmed_order: 3, exercise_order: null, sets: [] },  // skipped
  ],
  reordered: true,
  skipped_exercises: ["Calf Raises"]
```

## Testing

Unit + integration:

1. `addWorkoutSetsBatch` with `programmed_order` persists correctly (unit, database.test.ts).
2. `setPlannedExerciseIds` and `insertSkippedPlaceholderSets` round-trip (unit).
3. `handleStartFromUpcoming` — each block's sets have `programmed_order` matching array index, and `workouts.planned_exercise_ids` contains the expected JSON.
4. `handleStartFromTemplate` — same.
5. `handleStartEmpty` — `planned_exercise_ids` is NULL.
6. `handleAddExerciseToWorkout` — new rows have `programmed_order = NULL`, `planned_exercise_ids` unchanged.
7. `confirmFinish` with a removed planned exercise — ghost row is inserted with correct `programmed_order`, `exercise_order` NULL, `is_completed = 0`.
8. `confirmFinish` with no plan (empty workout) — no ghost rows, `stampExerciseOrder` only.
9. **Regression test for Issue 1:** start workout from template with 5 exercises, simulate `loadActiveWorkout` immediately, verify order matches the template's `sort_order`. (This catches the rowid race even if someone later reintroduces a `Promise.all` race.)
10. `getWorkoutSets` query orders by `exercise_order, set_number` correctly for a workout with mixed completed/ghost rows. Ghost rows have `exercise_order = 0` (NOT NULL — sentinel-at-zero, see Open Question 1), so they sort before performed exercises. This is acceptable because ghost rows are only written at finish time, and finished workouts do not reload via `loadActiveWorkout`.
11. **Auto-reorder persistence:** start a template workout, complete the first set of exercise #3 (triggering auto-reorder to top), call `getWorkoutSets`, verify exercise #3's rows now have `exercise_order = 1` and the previously-first exercise has `exercise_order = 2`. Simulate `loadActiveWorkout`, verify the in-memory order matches the auto-reordered state.

Maestro smoke: start from a template, finish, verify summary screen renders correctly (no regression in F5 template-update flow, which reads from `exerciseBlocks` not from `workout_sets`).

## Migration Strategy

1. Write `supabase/migrations/013_workout_ordering_integrity.sql` with both `ALTER TABLE` statements.
2. Apply via Supabase SQL Editor on dev (`gcpnqpqqwcwvyzoivolp`) first, then prod (`lgnkxjiqzsqiwrqrsxww`).
3. Update the SQLite migration block in `src/services/database.ts` (where `007_exercise_order` currently lives) to run the equivalent `ALTER TABLE` statements guarded by `.catch(() => {})` for idempotency.
4. Ship phone app build and MCP server deploy in either order — all new fields are nullable, reads tolerate NULL.

## Open Questions

1. **Ghost-row sentinel:** The spec originally described ghost rows as having `exercise_order IS NULL`. However, `workout_sets.exercise_order` was declared `NOT NULL DEFAULT 0` in migration 007. The NOT NULL constraint is preserved — dropping it would be a breaking change. Instead, ghost rows use `exercise_order = 0`. The composite sentinel is: `programmed_order IS NOT NULL AND exercise_order = 0 AND is_completed = 0 AND reps = 0 AND weight = 0`. MCP and phone code must NOT check `exercise_order IS NULL`; they must use this composite condition (or the equivalent `sets.length === 0` after filtering out ghost rows). **Resolved: sentinel-at-zero, NOT NULL constraint retained.**
2. **Should `getWorkoutSets` be updated to sort differently?** Current: `ORDER BY exercise_order, rowid, set_number`. After the fix, `exercise_order` is always non-NULL for active workouts, so `rowid` becomes dead code. Safe to leave for defense-in-depth, or simplify to `ORDER BY exercise_order, set_number`. **Proposed: simplify, one line of code is cleaner than a dead tiebreaker.**
3. **Should `handleRemoveExercise` confirm destructively when removing a planned exercise?** Currently it asks for any exercise. The ghost-row flow means "Remove" now effectively means "Mark skipped" for planned exercises. No UX change needed — the confirmation dialog message still reads correctly.

## Rollout Risks

- **Sync push/pull compatibility:** both sides tolerate NULL, so order of deploy doesn't matter. A phone on the new build talking to old MCP tools still works — MCP just doesn't expose the new fields.
- **Test mocks:** `src/__tests__/hooks/useWorkoutLifecycle-sessionNotes.test.ts` and `src/screens/__tests__/WorkoutScreen.test.tsx` mock `stampExerciseOrder` and `addWorkoutSetsBatch`. Their signatures change — update the mocks.
- **Existing workouts:** `planned_exercise_ids = NULL`, `programmed_order = NULL`. MCP tools must treat NULL as "unknown plan" and skip reorder/skip derivations. Do not backfill.

## Summary

One migration adds two nullable columns. One code change (insert-time stamping of `exercise_order` + `programmed_order`) eliminates the rowid race and preserves plan order forever. One helper (ghost placeholder rows driven by `workouts.planned_exercise_ids` at finish time) makes skipped exercises visible to the coach. The MCP read tools expose the new signal with derived `reordered` and `skipped_exercises` fields. The AI's reordering freedom is untouched.
