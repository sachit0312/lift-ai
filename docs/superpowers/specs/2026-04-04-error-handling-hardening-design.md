# Error Handling & Observability Hardening — Design Spec

**Date**: 2026-04-04  
**Status**: Approved

## Problem

An audit of the lift-ai codebase identified 15 locations where errors are silently swallowed or reported with insufficient fidelity. The categories are:

1. **Fire-and-forget DB writes with no `.catch()`** — If the write fails, the failure is invisible. The workout data may be inconsistent with what the user sees.
2. **Bare `catch {}` blocks** — Errors caught and discarded entirely, providing zero signal in Sentry.
3. **Missing try/catch on async workflows** — Functions that call DB APIs without any error handling; an uncaught rejection crashes the hook.
4. **Session notes debounce with no error handler** — The timeout callback calls an async DB function synchronously with no `.catch()`.
5. **`fireAndForgetSync` using breadcrumb instead of `captureException`** — Breadcrumbs are low-fidelity; sync failures should surface as exceptions.
6. **`syncWidgetState` calling async functions without awaiting or catching** — Errors from Live Activity updates are lost.

## Goals

- All DB write failures (fire-and-forget or otherwise) are reported to Sentry.
- All async functions called from hooks/services have either a try/catch or a `.catch()` that calls `Sentry.captureException`.
- `fireAndForgetSync` emits a Sentry exception on failure rather than a breadcrumb.
- `applyPendingWidgetActions` parse errors are reported to Sentry.
- `cancelTimerEndNotification` bare catch is annotated (already correct behavior — the error is expected when the notification has already fired, but should be reported for unexpected errors).
- `syncWidgetState` in `useWidgetBridge` attaches `.catch(e => Sentry.captureException(e))` to the async Live Activity calls.

## Non-Goals

- Do NOT add user-facing error UI — this is purely observability.
- Do NOT change fire-and-forget patterns to awaited patterns — just add error handlers.
- Do NOT refactor or restructure — surgical, line-level changes only.
- Do NOT add Sentry reporting to `cancelTimerEndNotification`'s inner catch (the failure there is expected: notification may have already fired; no change needed per the audit).

## Fix Pattern Summary

| Finding | Fix |
|---------|-----|
| `updateWorkoutSet()` in `useSetCompletion` (line ~187) | Add `.catch(e => Sentry.captureException(e))` |
| `updateWorkoutSet()` in `useExerciseBlocks.handleCycleTag` (line ~160) | Add `.catch(e => Sentry.captureException(e))` |
| `updateWorkoutSet()` calls inside `flushPendingSetWrites` debounce timers (line ~78-84) | Add `.catch(e => Sentry.captureException(e))` to each call |
| `handleOpenAddExercise` missing try/catch (lifecycle ~596) | Wrap in try/catch with `Sentry.captureException` |
| `handleCreateAndAddExercise` missing try/catch (lifecycle ~657) | Wrap in try/catch with `Sentry.captureException` |
| Session notes debounce callback no await/catch (lifecycle ~684) | Add `.catch(e => Sentry.captureException(e))` |
| `fireAndForgetSync` uses breadcrumb (sync ~10-17) | Replace with `Sentry.captureException(e)` |
| `applyPendingWidgetActions` swallows parse errors (liveActivity ~305) | Replace bare `catch {}` with `catch (e) { Sentry.captureException(e); }` |
| `stopWorkoutActivity` inner bare catch (liveActivity ~197) | Already correct (activity may be dismissed), no change needed |
| Template set counts failure not reported (lifecycle ~540-543) | Add `Sentry.captureException(e)` to existing catch |
| Target values persistence failure not reported (lifecycle ~562-564) | Add `Sentry.captureException(e)` to existing catch |
| Coach notes persistence failure not reported (lifecycle ~578-581) | Add `Sentry.captureException(e)` to existing catch |
| `clearLocalUpcomingWorkout` error swallowed (lifecycle ~790) | Replace `.catch(() => {})` with `.catch(e => Sentry.captureException(e))` |
| `syncWidgetState` async calls without catch (widgetBridge ~122-135) | Add `.catch(e => Sentry.captureException(e))` to both `updateWorkoutActivityForRest` and `updateWorkoutActivityForSet` calls |
| `debouncedSaveNotes` debounce timer unguarded (notesDebounce ~55) | Add `.catch(e => Sentry.captureException(e))` |

## Sentry Import Requirements

- `useSetCompletion.ts` — no existing Sentry import; add `import * as Sentry from '@sentry/react-native';`
- `useExerciseBlocks.ts` — no existing Sentry import; add `import * as Sentry from '@sentry/react-native';`
- `useWidgetBridge.ts` — no existing Sentry import; add `import * as Sentry from '@sentry/react-native';`
- All other files already import Sentry.

## Testing Strategy

Write unit tests for the highest-value fixes. Specifically:

1. **`fireAndForgetSync`** — verify `Sentry.captureException` is called (not `addBreadcrumb`) when `syncToSupabase` rejects.
2. **`applyPendingWidgetActions`** — verify `Sentry.captureException` is called when `JSON.parse` throws.
3. **`useNotesDebounce.debouncedSaveNotes`** — verify `Sentry.captureException` is called when `updateExerciseMachineNotes` rejects.

These three cover the most distinct code paths (service, module-level, hook debounce). The remaining fixes are straightforward `.catch()` additions that would be trivially easy to verify by inspection.
