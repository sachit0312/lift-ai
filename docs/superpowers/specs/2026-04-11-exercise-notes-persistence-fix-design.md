# Exercise Notes Persistence Fix — Design

**Date:** 2026-04-11
**Status:** Draft

## Problem

User wrote machine notes for several exercises. On next app open they were gone. Repeatable. Investigation confirmed the same bug also affects `form_notes` and the coach `notes` column (all three live in `user_exercise_notes`).

### Root cause

The database module in `src/services/database.ts` holds a module-level `currentUserId` (default `'local'`). It is only updated by `setCurrentUserId()` called from `AuthContext`:

```ts
// src/services/database.ts:237
let currentUserId = 'local';
```

`AuthContext.tsx` calls `setCurrentUserId` **only** inside the `event === 'SIGNED_IN'` branch of `onAuthStateChange`, gated by `newUserId !== prevUserId` (`AuthContext.tsx:48-54`). On cold start with an existing session:

1. `supabase.auth.getSession()` rehydrates the session and sets `previousUserIdRef.current = session.user.id` (line 28). It does **not** call `setCurrentUserId`.
2. `onAuthStateChange` then fires `INITIAL_SESSION` (not `SIGNED_IN`), so the setter is skipped.
3. Even if it were `SIGNED_IN`, `newUserId !== prevUserId` fails because we pre-seeded `prevUserId`.

Result: `currentUserId` stays `'local'` for the whole session.

### Why notes disappear

- `upsertExerciseNote` (`database.ts:488-498`) writes rows with `user_id = currentUserId = 'local'`.
- `getUserExerciseNotes` (`database.ts:457-467`) reads with the same `'local'`, so within the session the notes appear to work and the bug is invisible.
- `syncToSupabase` (`sync.ts:115-118`) pushes `WHERE user_id = ?` bound to `session.user.id` — the **real** auth id — so the `'local'` rows are never pushed to Supabase.
- On next real sign-in (sign out/in, re-auth, reinstall), `clearAllLocalData()` (`AuthContext.tsx:58`) wipes `user_exercise_notes` before the pull. The pull brings back nothing because the notes were never uploaded. **Gone.**

### Audited adjacent state

| State | Risk | Notes |
|---|---|---|
| `user_exercise_notes` (machine/form/coach) | **Critical** | The bug above |
| Custom exercises (`createExercise`) | Low | Push uses `WHERE user_id IS NOT NULL` and remaps to `session.user.id`, so `'local'` rows still get pushed correctly — works by accident. This spec makes it explicit. |
| `workouts.session_notes`, `coach_notes`, `exercise_coach_notes` | Medium | Only pushed when `finished_at IS NOT NULL`. Mid-workout notes are local-only by design — out of scope here. |
| `workout_sets.exercise_order`, `target_weight/reps/rpe` | Medium | Same finished-workout gate — out of scope. |
| `template_exercises.sort_order` | Low | Explicit reorder push, deliberately excluded from general sync. |
| Upcoming workouts | By design | MCP-owned, pull-only. |

## Goals

1. `currentUserId` is always in sync with Supabase's session, at every app lifecycle point.
2. A write to `user_exercise_notes` cannot silently land under `user_id = 'local'` when a real session exists.
3. Even if a row somehow does land under `'local'`, the next sync push rewrites and uploads it.
4. Regressions are caught by unit tests.
5. **Non-goal:** recovering notes already orphaned on the user's device. User explicitly accepted loss of current notes.
6. **Non-goal:** mid-workout sync of active `session_notes` / `exercise_coach_notes`. Deliberate design.
7. **Non-goal:** removing the module-level `currentUserId` entirely. Future refactor. This spec mitigates the smell with call-time resolution.

## Design

### 1. Fix auth → DB user-id propagation

**File:** `src/contexts/AuthContext.tsx`

- In the initial `getSession().then(...)` block (`AuthContext.tsx:25-40`), call `setCurrentUserId(session.user.id)` when a session is restored. If no session, call `setCurrentUserId('local')` explicitly.
- In `onAuthStateChange`, call `setCurrentUserId` unconditionally whenever the event carries a session (covers `INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`, `USER_UPDATED`). On `SIGNED_OUT`, set it to `'local'` (already done).
- Keep the existing `newUserId !== prevUserId` guard only around the expensive `clearAllLocalData()` + pull block — that's what the guard is actually meant to protect against (token refresh causing a full wipe).

Net effect: `currentUserId` is a reliable mirror of `session?.user?.id ?? 'local'` throughout the app lifecycle.

### 2. Resolve user id at call time, not from a module global

**File:** `src/services/database.ts`

- Add an internal async helper:

  ```ts
  async function resolveUserId(): Promise<string> {
    if (currentUserId && currentUserId !== 'local') return currentUserId;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      setCurrentUserId(session.user.id);
      return session.user.id;
    }
    return 'local';
  }
  ```

- Call sites updated to `await resolveUserId()` instead of reading `currentUserId`:
  - `upsertExerciseNote` (line 488)
  - `getUserExerciseNotes` (line 457)
  - `getUserExerciseNotesBatch` (line 469)
  - `createExercise` (around line 438)

- If `resolveUserId()` returns `'local'` while `supabase.auth.getSession()` reports a session (shouldn't happen after step 1, but defense in depth), add a Sentry breadcrumb so we learn about any remaining paths. **Do not throw** — we don't want to crash writes on an auth edge case.

- `database.ts` does not currently import from `./supabase`; add the import. No circular dependency risk (supabase module is leaf).

### 3. Self-healing sync push

**File:** `src/services/sync.ts`

Before the `user_exercise_notes` push block (`sync.ts:115`), add:

```ts
// Defense-in-depth: rescue any rows that slipped through under 'local'.
await db.runAsync(
  `UPDATE user_exercise_notes SET user_id = ? WHERE user_id = 'local'`,
  session.user.id,
);
```

Same treatment for custom exercises before the `WHERE user_id IS NOT NULL` push at `sync.ts:97`:

```ts
await db.runAsync(
  `UPDATE exercises SET user_id = ? WHERE user_id = 'local'`,
  session.user.id,
);
```

Both are already inside the `if (!session) return;` guard, so they're no-ops when logged out.

### 4. Tests

**New files under `src/__tests__/`.** Follow existing patterns (jest-expo, mocks in `src/__mocks__/`).

- **`AuthContext.test.tsx`** — cold-start: mock `supabase.auth.getSession` to return a session; mock `onAuthStateChange` to fire `INITIAL_SESSION`. Assert `setCurrentUserId` is called with the session user id before any render of children. Also test `SIGNED_OUT` resets to `'local'`.
- **`database.notes.test.ts`** — unit test for `upsertExerciseNote`: call with `currentUserId = 'local'` but a mocked `supabase.auth.getSession` returning a real session; assert the row is written under the real id and `currentUserId` is updated.
- **`sync.rescue.test.ts`** — seed an in-memory `user_exercise_notes` row with `user_id = 'local'`, run `syncToSupabase`, assert the row's `user_id` was rewritten and the Supabase `.upsert` call received a payload with the real user id.

Use `jest` mocks for `./supabase` and `./database` where needed. Reuse test helpers from `src/__tests__/helpers/`.

## Implementation order

1. Step 1 — `AuthContext.tsx` fix (the actual bug).
2. Step 2 — `database.ts` `resolveUserId` helper + call-site updates.
3. Step 3 — `sync.ts` self-healing push.
4. Step 4 — tests covering each of the above.
5. Verification: `npm test`, `npx tsc --noEmit`, and a manual run on device per CLAUDE.md (build from `/Users/sachitgoyal/code/lift-ai/` after merging — not from the worktree).

## Out of scope

- Rescuing already-orphaned notes on device.
- Unfinished-workout sync.
- Deleting the module-level `currentUserId` singleton (tracked as future cleanup).
