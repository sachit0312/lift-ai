# Error Handling & Observability Hardening — Implementation Plan

**Date**: 2026-04-04  
**Spec**: `docs/superpowers/specs/2026-04-04-error-handling-hardening-design.md`

## Steps

### Step 1: Fix `src/services/sync.ts`
- Replace `Sentry.addBreadcrumb(...)` in `fireAndForgetSync` with `Sentry.captureException(e)`.

### Step 2: Fix `src/services/liveActivity.ts`
- `applyPendingWidgetActions`: replace bare `catch {}` with `catch (e) { Sentry.captureException(e); return 0; }`.

### Step 3: Fix `src/hooks/useSetCompletion.ts`
- Add Sentry import.
- Add `.catch(e => Sentry.captureException(e))` to the `updateWorkoutSet(...)` fire-and-forget call on line ~187.

### Step 4: Fix `src/hooks/useExerciseBlocks.ts`
- Add Sentry import.
- `handleCycleTag`: add `.catch(e => Sentry.captureException(e))` to `updateWorkoutSet(set.id, dbUpdate)`.
- `flushPendingSetWrites`: add `.catch(e => Sentry.captureException(e))` to each `updateWorkoutSet(setId, entry.data)` call.
- The debounced `updateWorkoutSet` calls in `handleSetChange` setTimeout: add `.catch(e => Sentry.captureException(e))`.

### Step 5: Fix `src/hooks/useNotesDebounce.ts`
- `debouncedSaveNotes`: add `.catch(e => Sentry.captureException(e))` to `updateExerciseMachineNotes(...)`.

### Step 6: Fix `src/hooks/useWidgetBridge.ts`
- Add Sentry import.
- In `syncWidgetState`: add `.catch(e => Sentry.captureException(e))` to both `updateWorkoutActivityForRest(...)` and `updateWorkoutActivityForSet(...)`.

### Step 7: Fix `src/hooks/useWorkoutLifecycle.ts`
- `handleOpenAddExercise` (~596): wrap body in try/catch with `Sentry.captureException`.
- `handleCreateAndAddExercise` (~657): wrap body in try/catch with `Sentry.captureException`.
- `handleSessionNotesChange` (~684): add `.catch(e => Sentry.captureException(e))` to `updateWorkoutSessionNotes(...)`.
- Template set counts catch (~540): add `Sentry.captureException(e)`.
- Target values catch (~562): add `Sentry.captureException(e)`.
- Coach notes catch (~578): add `Sentry.captureException(e)`.
- `clearLocalUpcomingWorkout().catch(() => {})` (~790): replace with `.catch(e => Sentry.captureException(e))`.

### Step 8: Write tests
- `src/services/__tests__/sync.test.ts` — `fireAndForgetSync` error reporting.
- `src/services/__tests__/liveActivity.test.ts` — `applyPendingWidgetActions` parse error reporting.
- `src/hooks/__tests__/useNotesDebounce.test.ts` — debounced save error reporting.

### Step 9: Run tests and type-check
- `npx jest --verbose` — all must pass.
- `npx tsc --noEmit` — must be clean.

### Step 10: Commit
- Conventional commit: `fix: add Sentry error reporting to fire-and-forget DB writes and bare catch blocks`
