# Workout Lifecycle Safety — Design Spec

**Date:** 2026-04-04
**Status:** Approved
**Priority:** HIGH / MEDIUM bugs

---

## Problem Statement

An audit of the workout lifecycle hooks identified four state-management bugs that can cause data loss or incorrect behavior during the critical workout finish and set completion flows.

---

## Bug Details

### BUG-1 (HIGH): Session notes lost on fast finish

**File:** `src/hooks/useWorkoutLifecycle.ts` — `handleSessionNotesChange` / `confirmFinish`

**Root cause:**  
`handleSessionNotesChange` writes to `workoutNotes` state AND schedules a 500ms debounce that calls `updateWorkoutSessionNotes(workout.id, text)`. `confirmFinish` reads `workoutNotes` (React state) and passes it to `finishWorkout(workout.id, workoutNotes || undefined)`.

The 500ms debounce is cancelled in `confirmFinish` (correct), and `finishWorkout` is called with the `workoutNotes` React state value — but **React state is updated asynchronously**. If the user calls `handleSessionNotesChange` while the finish modal is being shown, the state update from `setWorkoutNotes(text)` may not yet be reflected in the `workoutNotes` variable captured by `confirmFinish`'s closure.

More critically: the `workoutNotes` variable in the `confirmFinish` function body is read from the hook scope at **render time** (the render when `confirmFinish` was last recreated via `useCallback`). Because `confirmFinish` is an async function defined without `useCallback`, it captures the latest `workoutNotes` from the enclosing scope. However, if `confirmFinish` is called from inside a Modal's "Confirm" button, the enclosing scope's `workoutNotes` will be whatever value was current at the time the modal was last rendered — not necessarily the most recent value.

**Fix:** Introduce a `workoutNotesRef` that mirrors `workoutNotes` state (same pattern as `blocksRef` / `workoutRef`). In `confirmFinish`, read `workoutNotesRef.current` instead of `workoutNotes`. This guarantees the most up-to-date value regardless of React's async state batching.

---

### BUG-2 (HIGH): `confirmFinish` uses stale `exerciseBlocks` closure

**File:** `src/hooks/useWorkoutLifecycle.ts` — `confirmFinish`

**Root cause:**  
`confirmFinish` iterates over `exerciseBlocks` (React state from hook scope) to compute `setOrderEntries`, `totalSets`, `exerciseCount`, and the template update plan. Because `confirmFinish` is not memoized and `exerciseBlocks` is a state value, the snapshot captured depends on when the function was last created.

The Finish modal can be open while the user is still completing sets (unlikely but possible). Any set completion that fires `setExerciseBlocks` after the modal opens will not be reflected in the `exerciseBlocks` the modal captured.

**Fix:** Replace all references to `exerciseBlocks` inside `confirmFinish` with `blocksRef.current`. `blocksRef` is always kept in sync with the latest state (updated synchronously in `useExerciseBlocks` on every render), so `blocksRef.current` at the time `confirmFinish` is called will reflect the truly current blocks.

---

### BUG-3 (MEDIUM): Double-tap guard missing on `handleToggleComplete`

**File:** `src/hooks/useSetCompletion.ts` — `handleToggleComplete`

**Root cause:**  
Two rapid taps on the completion checkbox both enter `handleToggleComplete` before the first `setExerciseBlocks` has re-rendered the component. Both read `blocksRef.current[blockIdx].sets[setIdx].is_completed === false`, both set `newCompleted = true`, both call `startRestTimer`, stacking two rest timer notifications.

**Fix:** Add a `completionInProgressRef` — a `Set<string>` keyed by `"${blockIdx}-${setIdx}"`. At the top of `handleToggleComplete`, if the key is already in the set, bail out. Add the key before the async work, remove it after `setExerciseBlocks` resolves (or in the synchronous path after the state dispatch, since React state updates are synchronous in event handlers but batched).

A simpler pattern: use a `ref<Set<string>>` (`pendingCompletionRef`) that tracks set IDs currently being toggled. Check `set.id` at entry; add it; remove it after the state update dispatch.

---

### BUG-4 (MEDIUM): Focus effect reloads all state during active workout

**File:** `src/hooks/useWorkoutLifecycle.ts` — `useFocusEffect` / `loadState`

**Root cause:**  
`useFocusEffect` calls `loadState()` on every tab focus. `loadState` calls `loadActiveWorkout(active)` which ends with `setExerciseBlocks(blocks)` — replacing the entire in-memory blocks with fresh DB data. If the user switches tabs while typing a weight value (300ms debounce hasn't flushed to DB yet), then returns, that weight value is overwritten.

**Fix:** In `loadState`, after getting the active workout, check if `workoutRef.current?.id === active.id`. If they match, an active workout is already loaded in memory — skip `loadActiveWorkout()` entirely and instead only run the background sync pulls. The in-memory state is the source of truth during an active workout; DB is only the persistent backing store.

---

## Non-Goals

- No changes to the actual finish/cancel data flow beyond the specific fixes above
- No UI changes
- No database schema changes

---

## Testing Strategy

- Unit tests for the pure logic of each bug: session notes ref pattern, double-tap guard, focus skip
- Tests live in `src/__tests__/hooks/` to mirror the hooks structure
- Run `npx jest --verbose` — all must pass
- Run `npx tsc --noEmit` — must be clean
