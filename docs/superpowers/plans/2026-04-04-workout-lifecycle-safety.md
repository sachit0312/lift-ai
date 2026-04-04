# Workout Lifecycle Safety — Implementation Plan

**Date:** 2026-04-04
**Spec:** `docs/superpowers/specs/2026-04-04-workout-lifecycle-safety-design.md`

---

## Steps

### Step 1 — FIX-1: Session notes ref in `useWorkoutLifecycle`
- Add `workoutNotesRef = useRef('')`
- Keep it in sync: set `workoutNotesRef.current = workoutNotes` at the top of the hook body (same pattern as `blocksRef.current = exerciseBlocks` in `useExerciseBlocks`)
- In `confirmFinish`, replace `workoutNotes` with `workoutNotesRef.current` where it is passed to `finishWorkout`

### Step 2 — FIX-2: Replace stale `exerciseBlocks` with `blocksRef.current` in `confirmFinish`
- In `confirmFinish`, replace every reference to `exerciseBlocks` with `blocksRef.current`
- This covers: `setOrderEntries` loop, `totalSets`/`exerciseCount` computation, and the template update plan building call

### Step 3 — FIX-3: Double-tap guard in `useSetCompletion`
- Add `pendingCompletionRef = useRef<Set<string>>(new Set())` 
- At top of `handleToggleComplete`: if `pendingCompletionRef.current.has(set.id)`, return early
- Add `set.id` to the set before the state update dispatch
- Remove `set.id` after `setExerciseBlocks` call completes (use a cleanup pattern or remove in a useEffect; since `setExerciseBlocks` is synchronous dispatch in a React event handler, remove immediately after the call)

### Step 4 — FIX-4: Skip reload during active workout in `loadState`
- In `loadState`, after `active = await getActiveWorkout()`, check if `workoutRef.current?.id === active?.id`
- If they match (workout already loaded), skip the `loadActiveWorkout(active)` call
- Instead, still run the sync pulls in the background (so upcoming workout / templates / history stay fresh)
- Keep `setActiveWorkout(active)` and `workoutRef.current = active` to confirm state is current

### Step 5 — Write tests
- `src/__tests__/hooks/useWorkoutLifecycle-sessionNotes.test.ts` — verifies notes ref is flushed on finish
- `src/__tests__/hooks/useSetCompletion-doubleTap.test.ts` — verifies double-tap guard prevents double invocation

### Step 6 — Type-check and test
- `npx tsc --noEmit`
- `npx jest --verbose`

### Step 7 — Commit
- Conventional commit: `fix: resolve workout lifecycle safety bugs`
