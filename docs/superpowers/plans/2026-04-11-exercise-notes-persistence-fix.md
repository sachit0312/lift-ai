# Exercise Notes Persistence Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `currentUserId` staying `'local'` on cold start so that `user_exercise_notes` (machine/form/coach notes) are persisted under the real Supabase user id, pushed to Supabase, and survive sign-in wipes.

**Architecture:** Three changes: (1) `AuthContext` calls `setCurrentUserId` from the rehydrated session and on every auth event that carries a session, not just first-time `SIGNED_IN`. (2) `database.ts` resolves the user id at call time via a helper that falls back to `supabase.auth.getSession()` if the module global is still `'local'`. (3) `sync.ts` rewrites any leftover `user_id = 'local'` rows to the real id before pushing — self-healing defense in depth. Each change is covered by a unit test.

**Tech Stack:** Expo / React Native, TypeScript, SQLite via `expo-sqlite`, `@supabase/supabase-js`, Jest (`jest-expo` preset), `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-04-11-exercise-notes-persistence-fix-design.md`

---

## File Structure

**Source files modified:**
- `src/contexts/AuthContext.tsx` — propagate `setCurrentUserId` from rehydrated session and every event carrying a session.
- `src/services/database.ts` — add `resolveUserId` helper; swap read/write call sites to use it (`upsertExerciseNote`, `getUserExerciseNotes`, `getUserExerciseNotesBatch`, `createExercise`). Add `supabase` import.
- `src/services/sync.ts` — add self-healing `UPDATE ... WHERE user_id = 'local'` for `user_exercise_notes` and `exercises` at the top of `syncToSupabase`.

**Test files created:**
- `src/__tests__/authContext.currentUserId.test.tsx` — AuthContext cold-start + auth-event propagation.
- `src/__tests__/database.resolveUserId.test.ts` — `upsertExerciseNote` resolves session user id even when module global is `'local'`.
- `src/__tests__/sync.rescueLocal.test.ts` — `syncToSupabase` rewrites `'local'` rows before push.

**No schema changes. No migrations.** The fix is code-only; existing orphaned rows on-device are left behind by design (per spec "Non-goals").

---

## Task 1: AuthContext — propagate `currentUserId` on cold start and every session event

**Files:**
- Modify: `src/contexts/AuthContext.tsx:25-87`
- Test: `src/__tests__/authContext.currentUserId.test.tsx` (new)

### - [ ] Step 1.1: Write the failing test

Create `src/__tests__/authContext.currentUserId.test.tsx`:

```tsx
import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';
import { Text } from 'react-native';

// --- Mocks (must be before imports) ---

const setCurrentUserIdMock = jest.fn();
const clearAllLocalDataMock = jest.fn().mockResolvedValue(undefined);
const migrateExerciseNotesToUserTableMock = jest.fn().mockResolvedValue(undefined);

jest.mock('../services/database', () => ({
  setCurrentUserId: (...args: any[]) => setCurrentUserIdMock(...args),
  clearAllLocalData: (...args: any[]) => clearAllLocalDataMock(...args),
  migrateExerciseNotesToUserTable: (...args: any[]) => migrateExerciseNotesToUserTableMock(...args),
}));

jest.mock('../services/sync', () => ({
  pullExercisesAndTemplates: jest.fn().mockResolvedValue(undefined),
  pullWorkoutHistory: jest.fn().mockResolvedValue(undefined),
  pullUpcomingWorkout: jest.fn().mockResolvedValue(undefined),
}));

// Authoritative mock session the test controls
let mockInitialSession: any = null;
const authStateListeners: Array<(event: string, session: any) => void> = [];

jest.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: mockInitialSession } })),
      onAuthStateChange: jest.fn((cb: (event: string, session: any) => void) => {
        authStateListeners.push(cb);
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
  },
}));

jest.mock('@sentry/react-native', () => ({
  setUser: jest.fn(),
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

// Imported AFTER mocks
import { AuthProvider } from '../contexts/AuthContext';

function Child() {
  return <Text testID="child">ok</Text>;
}

describe('AuthContext → currentUserId propagation', () => {
  beforeEach(() => {
    setCurrentUserIdMock.mockClear();
    clearAllLocalDataMock.mockClear();
    migrateExerciseNotesToUserTableMock.mockClear();
    mockInitialSession = null;
    authStateListeners.length = 0;
  });

  it('sets currentUserId to session.user.id on cold start with restored session', async () => {
    mockInitialSession = { user: { id: 'user-123', email: 't@t.com' } };

    const { findByTestId } = render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await findByTestId('child');
    await waitFor(() => {
      expect(setCurrentUserIdMock).toHaveBeenCalledWith('user-123');
    });
  });

  it('sets currentUserId to "local" on cold start without a session', async () => {
    mockInitialSession = null;

    const { findByTestId } = render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await findByTestId('child');
    await waitFor(() => {
      expect(setCurrentUserIdMock).toHaveBeenCalledWith('local');
    });
  });

  it('sets currentUserId on INITIAL_SESSION event', async () => {
    mockInitialSession = null;

    render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await waitFor(() => expect(authStateListeners.length).toBeGreaterThan(0));

    await act(async () => {
      authStateListeners[0]('INITIAL_SESSION', { user: { id: 'user-456' } });
    });

    expect(setCurrentUserIdMock).toHaveBeenCalledWith('user-456');
  });

  it('sets currentUserId on TOKEN_REFRESHED without re-running clearAllLocalData', async () => {
    mockInitialSession = { user: { id: 'user-abc' } };

    render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await waitFor(() => expect(authStateListeners.length).toBeGreaterThan(0));
    clearAllLocalDataMock.mockClear();

    await act(async () => {
      authStateListeners[0]('TOKEN_REFRESHED', { user: { id: 'user-abc' } });
    });

    expect(setCurrentUserIdMock).toHaveBeenCalledWith('user-abc');
    expect(clearAllLocalDataMock).not.toHaveBeenCalled();
  });

  it('resets currentUserId to "local" on SIGNED_OUT', async () => {
    mockInitialSession = { user: { id: 'user-xyz' } };

    render(
      <AuthProvider>
        <Child />
      </AuthProvider>,
    );

    await waitFor(() => expect(authStateListeners.length).toBeGreaterThan(0));
    setCurrentUserIdMock.mockClear();

    await act(async () => {
      authStateListeners[0]('SIGNED_OUT', null);
    });

    expect(setCurrentUserIdMock).toHaveBeenCalledWith('local');
  });
});
```

### - [ ] Step 1.2: Run the test to confirm it fails

Run: `npm test -- src/__tests__/authContext.currentUserId.test.tsx`

Expected: FAIL. The first test ("sets currentUserId to session.user.id on cold start") will fail because the current `AuthContext` never calls `setCurrentUserId` from the `getSession().then(...)` block. The INITIAL_SESSION and TOKEN_REFRESHED tests will fail because the current code only handles `SIGNED_IN`.

### - [ ] Step 1.3: Apply the fix in `AuthContext.tsx`

Replace `src/contexts/AuthContext.tsx` lines 25-87 with:

```tsx
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        previousUserIdRef.current = session?.user?.id ?? null;
        setSession(session);
        // Keep the database module's currentUserId in sync with the rehydrated session.
        // Without this, cold-start writes to user_exercise_notes land under 'local'
        // and are never pushed to Supabase.
        setCurrentUserId(session?.user?.id ?? 'local');
        if (session?.user) {
          Sentry.setUser({ email: session.user.email, id: session.user.id });
        }
      })
      .catch((error) => {
        Sentry.captureException(error);
        if (__DEV__) console.error('Failed to get session:', error);
      })
      .finally(() => {
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        const prevUserId = previousUserIdRef.current;
        const newUserId = newSession?.user?.id ?? null;
        setSession(newSession);

        // Always mirror the session into the database module, regardless of event type.
        // INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED / SIGNED_IN all count.
        setCurrentUserId(newUserId ?? 'local');

        if (event === 'SIGNED_IN') {
          if (newSession?.user) {
            Sentry.setUser({ email: newSession.user.email, id: newSession.user.id });
          }
          if (newUserId !== prevUserId) {
            setSyncing(true);
            try {
              await Promise.race([
                (async () => {
                  await clearAllLocalData();
                  await Promise.all([
                    pullExercisesAndTemplates(),
                    pullWorkoutHistory(),
                  ]);
                  await migrateExerciseNotesToUserTable(newSession!.user.id);
                  await pullUpcomingWorkout();
                })(),
                new Promise<void>((_, reject) =>
                  setTimeout(() => reject(new Error('sign-in sync timeout')), SYNC_TIMEOUT_MS),
                ),
              ]);
            } catch (error) {
              Sentry.captureException(error);
              if (__DEV__) console.error('Failed to sync data on sign in:', error);
            } finally {
              setSyncing(false);
            }
          }
        } else if (event === 'SIGNED_OUT') {
          Sentry.setUser(null);
        }

        previousUserIdRef.current = newUserId;
      },
    );

    return () => subscription.unsubscribe();
  }, []);
```

Key changes vs. the original:
- Added `setCurrentUserId(session?.user?.id ?? 'local')` in the initial `getSession().then(...)` block.
- Added unconditional `setCurrentUserId(newUserId ?? 'local')` at the top of the `onAuthStateChange` callback so every event that carries a session (including `INITIAL_SESSION` and `TOKEN_REFRESHED`) propagates to the DB module.
- Removed the now-redundant `setCurrentUserId(newSession!.user.id)` that was inside the `SIGNED_IN` branch.
- Removed `setCurrentUserId('local')` from the `SIGNED_OUT` branch (the unconditional call at the top already handles it because `newUserId` is `null` → `'local'`).
- The expensive `clearAllLocalData + pull` block is still guarded by `newUserId !== prevUserId` inside `SIGNED_IN` — unchanged.

### - [ ] Step 1.4: Run the test to confirm it passes

Run: `npm test -- src/__tests__/authContext.currentUserId.test.tsx`

Expected: PASS. All five cases green.

### - [ ] Step 1.5: Type-check

Run: `npx tsc --noEmit`

Expected: no errors.

### - [ ] Step 1.6: Commit

```bash
git add src/contexts/AuthContext.tsx src/__tests__/authContext.currentUserId.test.tsx
git commit -m "$(cat <<'EOF'
fix: propagate auth session user id to database module on cold start

currentUserId was staying 'local' across the whole session when the app
was opened with a restored Supabase session, because INITIAL_SESSION is
not SIGNED_IN and the initial getSession() branch never called
setCurrentUserId. Notes written during that window were stored under
user_id='local', never pushed to Supabase, and wiped on next sign-in.

AuthContext now mirrors session.user.id into the database module from
both the initial getSession() and every onAuthStateChange event.
EOF
)"
```

---

## Task 2: `database.ts` — `resolveUserId` helper + call-time resolution

**Files:**
- Modify: `src/services/database.ts` — add `resolveUserId` helper near line 237 (next to `currentUserId`), add `supabase` import, update call sites in `upsertExerciseNote` (line 488), `getUserExerciseNotes` (line 457), `getUserExerciseNotesBatch` (line 469), and `createExercise` (line 438 area).
- Test: `src/__tests__/database.resolveUserId.test.ts` (new)

### - [ ] Step 2.1: Write the failing test

Create `src/__tests__/database.resolveUserId.test.ts`:

```ts
// --- Mocks (must be before imports) ---

let mockSession: any = null;
jest.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: mockSession } })),
    },
  },
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import * as db from '../services/database';
import { __mockDb } from '../__mocks__/expo-sqlite';

describe('database.upsertExerciseNote — user id resolution', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockClear();
    __mockDb.getFirstAsync.mockReset().mockResolvedValue(null);
    __mockDb.getAllAsync.mockReset().mockResolvedValue([]);
    db.setCurrentUserId('local');
    mockSession = null;
  });

  it('falls back to supabase session user id when currentUserId is "local"', async () => {
    mockSession = { user: { id: 'user-from-session' } };

    await db.upsertExerciseNote('exercise-1', 'machine_notes', 'pin 4, seat 3');

    const upsertCall = __mockDb.runAsync.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('user_exercise_notes'),
    );
    expect(upsertCall).toBeDefined();
    // First bound arg after the SQL should be the resolved user id
    expect(upsertCall![1]).toBe('user-from-session');
    // The module global should now be updated
    expect(db.getCurrentUserId()).toBe('user-from-session');
  });

  it('uses currentUserId when it is already a real id', async () => {
    db.setCurrentUserId('already-set-user');
    mockSession = { user: { id: 'should-not-be-used' } };

    await db.upsertExerciseNote('exercise-2', 'machine_notes', 'notes');

    const upsertCall = __mockDb.runAsync.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('user_exercise_notes'),
    );
    expect(upsertCall![1]).toBe('already-set-user');
  });

  it('falls through to "local" when no session and no prior id', async () => {
    mockSession = null;
    db.setCurrentUserId('local');

    await db.upsertExerciseNote('exercise-3', 'machine_notes', 'offline note');

    const upsertCall = __mockDb.runAsync.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('user_exercise_notes'),
    );
    expect(upsertCall![1]).toBe('local');
  });
});
```

### - [ ] Step 2.2: Run the test to confirm it fails

Run: `npm test -- src/__tests__/database.resolveUserId.test.ts`

Expected: FAIL. The first case ("falls back to supabase session user id") will fail because `upsertExerciseNote` currently reads the module global directly without consulting `supabase.auth.getSession()`.

### - [ ] Step 2.3: Add the `supabase` import to `database.ts`

At the top of `src/services/database.ts`, with the other imports, add:

```ts
import { supabase } from './supabase';
```

(Place it near the existing imports — `database.ts` currently imports from `expo-sqlite` and `@sentry/react-native`. No circular risk: `supabase.ts` is a leaf that only imports `@supabase/supabase-js` and `expo-secure-store`.)

### - [ ] Step 2.4: Add the `resolveUserId` helper

In `src/services/database.ts`, directly below the existing `currentUserId` declaration (line 237 area):

```ts
let currentUserId = 'local';
export function setCurrentUserId(id: string) { currentUserId = id; }
export function getCurrentUserId(): string { return currentUserId; }

/**
 * Returns the effective user id for DB reads/writes.
 *
 * If the module global is a real id, returns it. Otherwise consults the live
 * Supabase session and self-heals the global. Returns 'local' only when there
 * is genuinely no session (logged out / offline first run).
 *
 * Defense in depth: AuthContext is supposed to keep currentUserId in sync,
 * but if a write fires before that propagation (cold-start race, future code
 * path we forgot), this prevents silent 'local' orphans.
 */
async function resolveUserId(): Promise<string> {
  if (currentUserId && currentUserId !== 'local') return currentUserId;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const id = session?.user?.id;
    if (id) {
      currentUserId = id;
      return id;
    }
  } catch (err) {
    Sentry.captureException(err);
  }
  return 'local';
}
```

### - [ ] Step 2.5: Update `upsertExerciseNote` to use `resolveUserId`

Find the existing function (line ~488):

```ts
export function upsertExerciseNote(exerciseId: string, field: 'notes' | 'form_notes' | 'machine_notes', value: string | null): Promise<void> {
  const userId = currentUserId;
  return withDb('upsertExerciseNote', async (database) => {
    // ... existing body ...
  });
}
```

Replace with:

```ts
export async function upsertExerciseNote(
  exerciseId: string,
  field: 'notes' | 'form_notes' | 'machine_notes',
  value: string | null,
): Promise<void> {
  const userId = await resolveUserId();
  return withDb('upsertExerciseNote', async (database) => {
    // ... existing body unchanged, still uses `userId` ...
  });
}
```

(The body of the function — the `INSERT ... ON CONFLICT ... DO UPDATE` SQL — stays as-is; only the function signature becomes `async` and the `userId` line becomes `await resolveUserId()`. If the existing body references `userId` via closure inside the `withDb` callback, that still works because `withDb` receives `userId` through the outer scope.)

### - [ ] Step 2.6: Update `getUserExerciseNotes` and `getUserExerciseNotesBatch` to use `resolveUserId`

Find `getUserExerciseNotes` (line ~457):

```ts
export function getUserExerciseNotes(exerciseId: string): Promise<ExerciseNotes | null> {
  const userId = currentUserId;
  return withDb('getUserExerciseNotes', async (database) => {
    // ... existing body ...
  });
}
```

Replace `const userId = currentUserId;` with `const userId = await resolveUserId();` and make the outer function `async`:

```ts
export async function getUserExerciseNotes(exerciseId: string): Promise<ExerciseNotes | null> {
  const userId = await resolveUserId();
  return withDb('getUserExerciseNotes', async (database) => {
    // ... existing body ...
  });
}
```

Do the exact same swap in `getUserExerciseNotesBatch` (line ~469-471):

```ts
export async function getUserExerciseNotesBatch(exerciseIds: string[]): Promise<Map<string, ExerciseNotes>> {
  const userId = await resolveUserId();
  return withDb('getUserExerciseNotesBatch', async (database) => {
    // ... existing body ...
  });
}
```

### - [ ] Step 2.7: Update `createExercise` to use `resolveUserId`

Find `createExercise` (line ~438). It currently uses `currentUserId` directly in the INSERT parameters and the returned object:

```ts
id, currentUserId, e.name, e.type, JSON.stringify(e.muscle_groups), e.training_goal, e.description, now,
// ...
return { id, user_id: currentUserId, name: e.name, /* ... */ };
```

At the top of the function body, add:

```ts
const userId = await resolveUserId();
```

Replace both `currentUserId` references with `userId`. Make the function `async` if it isn't already. Verify callers all already `await` (`createExercise` returns `Promise<Exercise>`, so they do).

### - [ ] Step 2.8: Run the `resolveUserId` tests to confirm green

Run: `npm test -- src/__tests__/database.resolveUserId.test.ts`

Expected: all three cases PASS.

### - [ ] Step 2.9: Run the full test suite

Run: `npm test`

Expected: no regressions. All existing tests still pass.

### - [ ] Step 2.10: Type-check

Run: `npx tsc --noEmit`

Expected: no errors. If any caller breaks because a previously-sync function is now async, fix by adding `await` at the call site — these should be limited to places already inside async functions.

### - [ ] Step 2.11: Commit

```bash
git add src/services/database.ts src/__tests__/database.resolveUserId.test.ts
git commit -m "$(cat <<'EOF'
fix: resolve user id at call time for note read/write paths

Adds resolveUserId() helper that returns the module-level currentUserId
when it's a real id, otherwise falls back to supabase.auth.getSession()
and self-heals the global. upsertExerciseNote, getUserExerciseNotes,
getUserExerciseNotesBatch, and createExercise now use it instead of
reading the global directly.

Prevents silent 'local' orphans if a write races ahead of AuthContext
propagation.
EOF
)"
```

---

## Task 3: `sync.ts` — self-healing rescue of `'local'` rows before push

**Files:**
- Modify: `src/services/sync.ts:88-129` (inside `syncToSupabase`, right after `const db = await getDb();`, before the exercises push block)
- Test: `src/__tests__/sync.rescueLocal.test.ts` (new)

### - [ ] Step 3.1: Write the failing test

Create `src/__tests__/sync.rescueLocal.test.ts`:

```ts
// --- Mocks (must be before imports) ---

const upsertMock = jest.fn().mockResolvedValue({ error: null });
const fromMock = jest.fn((_table: string) => ({
  upsert: upsertMock,
}));

jest.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({
        data: { session: { user: { id: 'real-user' } } },
      })),
    },
    from: (...args: any[]) => fromMock(...args),
  },
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { __mockDb } from '../__mocks__/expo-sqlite';
import { syncToSupabase } from '../services/sync';

describe('syncToSupabase — rescue local rows', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockClear().mockResolvedValue({ changes: 0 });
    __mockDb.getAllAsync.mockReset();
    upsertMock.mockClear();
    fromMock.mockClear();

    // Stub all the SELECTs syncToSupabase makes. Only user_exercise_notes
    // is relevant — return one row after the rescue UPDATE runs.
    __mockDb.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM exercises')) return [];
      if (sql.includes('FROM user_exercise_notes')) {
        return [{ exercise_id: 'e1', notes: null, form_notes: null, machine_notes: 'pin 4' }];
      }
      if (sql.includes('FROM templates')) return [];
      if (sql.includes('FROM template_exercises')) return [];
      if (sql.includes('FROM workouts')) return [];
      return [];
    });
  });

  it('rewrites user_exercise_notes rows from user_id="local" to session.user.id before pushing', async () => {
    await syncToSupabase();

    // Rescue UPDATE must run BEFORE the notes push SELECT
    const rescueCall = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('UPDATE user_exercise_notes') &&
      call[0].includes("user_id = 'local'"),
    );
    expect(rescueCall).toBeDefined();
    expect(rescueCall![1]).toBe('real-user');

    // And the upsert to Supabase must use the real user id
    expect(fromMock).toHaveBeenCalledWith('user_exercise_notes');
    const notesUpsertCall = upsertMock.mock.calls.find((call: any[]) =>
      Array.isArray(call[0]) && call[0][0]?.user_id === 'real-user',
    );
    expect(notesUpsertCall).toBeDefined();
  });

  it('rewrites exercises rows from user_id="local" to session.user.id before the push filter', async () => {
    await syncToSupabase();

    const exerciseRescue = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('UPDATE exercises') &&
      call[0].includes("user_id = 'local'"),
    );
    expect(exerciseRescue).toBeDefined();
    expect(exerciseRescue![1]).toBe('real-user');
  });

  it('does nothing when no session', async () => {
    // Temporarily override the session mock to return null
    const supa = jest.requireMock('../services/supabase').supabase;
    (supa.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: null } });

    await syncToSupabase();

    const rescueCall = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes("user_id = 'local'"),
    );
    expect(rescueCall).toBeUndefined();
  });
});
```

### - [ ] Step 3.2: Run the test to confirm it fails

Run: `npm test -- src/__tests__/sync.rescueLocal.test.ts`

Expected: FAIL. `syncToSupabase` does not currently issue any `UPDATE ... WHERE user_id = 'local'` statements.

### - [ ] Step 3.3: Add the rescue block in `syncToSupabase`

In `src/services/sync.ts`, find the start of `syncToSupabase` (line ~88-95):

```ts
export async function syncToSupabase(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const db = await getDb();

    // Each sync step runs independently — one step's failure must not block others.
    // Exercises — only push custom exercises (global exercises have user_id = NULL)
    const exercises = await db.getAllAsync<SyncExerciseRow>(
```

Insert the rescue block immediately after `const db = await getDb();`, before the exercises SELECT:

```ts
    const db = await getDb();

    // Self-healing rescue: any rows written under the default 'local' user
    // (e.g., during a race with AuthContext propagation) get rewritten to the
    // real session user id so they're picked up by the push queries below.
    try {
      await db.runAsync(
        `UPDATE user_exercise_notes SET user_id = ? WHERE user_id = 'local'`,
        session.user.id,
      );
      await db.runAsync(
        `UPDATE exercises SET user_id = ? WHERE user_id = 'local'`,
        session.user.id,
      );
    } catch (err) {
      handleSyncError('rescue local rows', err);
    }

    // Each sync step runs independently — one step's failure must not block others.
    // Exercises — only push custom exercises (global exercises have user_id = NULL)
    const exercises = await db.getAllAsync<SyncExerciseRow>(
```

Note: this is wrapped in its own `try` so a rescue failure doesn't abort the rest of `syncToSupabase`. Errors route to Sentry via `handleSyncError`.

### - [ ] Step 3.4: Run the test to confirm it passes

Run: `npm test -- src/__tests__/sync.rescueLocal.test.ts`

Expected: all three cases PASS.

### - [ ] Step 3.5: Run the full test suite

Run: `npm test`

Expected: no regressions.

### - [ ] Step 3.6: Type-check

Run: `npx tsc --noEmit`

Expected: no errors.

### - [ ] Step 3.7: Commit

```bash
git add src/services/sync.ts src/__tests__/sync.rescueLocal.test.ts
git commit -m "$(cat <<'EOF'
fix: rewrite local user_id rows to session user before sync push

syncToSupabase now runs UPDATE ... WHERE user_id='local' on
user_exercise_notes and exercises at the top of the push flow, so any
row that slipped through under the default module-level id gets rescued
before the existing push queries (which filter by session.user.id) would
otherwise skip it. Defense in depth against future propagation races.
EOF
)"
```

---

## Task 4: Manual verification on device

**Files:** none. This is a post-merge verification step that belongs in the commit chain only as a checklist.

### - [ ] Step 4.1: Run the full suite one more time

Run: `npm test`

Expected: all green.

### - [ ] Step 4.2: Type-check

Run: `npx tsc --noEmit`

Expected: no errors.

### - [ ] Step 4.3: Merge to main and build to device

Per CLAUDE.md: do **not** build from this worktree. Use the `merge-to-master` skill (or manual merge) to land this branch on `main`, then from `/Users/sachitgoyal/code/lift-ai/` run the build via the `run-on-device` skill.

### - [ ] Step 4.4: Smoke test on device

1. Open the app (already signed in). Navigate to an exercise detail modal.
2. Write machine notes. Wait a few seconds for debounce to flush.
3. Kill the app. Re-open. Confirm notes are still there.
4. Sign out, sign back in. Confirm notes are still there (they should now be pulled from Supabase).
5. Check Supabase dashboard (`lift-ai-dev` project, ref `gcpnqpqqwcwvyzoivolp`) → `user_exercise_notes` table → confirm rows exist under your real user id, with the `machine_notes` column populated.

Expected: notes survive both cold start and sign-out/sign-in. No `user_id='local'` rows in the `user_exercise_notes` table on Supabase (which would be a schema violation anyway — Supabase only has real UUIDs).

---

## Self-Review

**Spec coverage:**
- Goal 1 (`currentUserId` always in sync) → Task 1.
- Goal 2 (writes can't silently land under `'local'`) → Task 2 `resolveUserId`.
- Goal 3 (sync self-heals any stragglers) → Task 3.
- Goal 4 (tests catch regressions) → each task ships with its own test.
- Non-goal (rescue orphaned on-device notes): explicitly skipped. Not in plan.
- Non-goal (unfinished-workout sync): explicitly skipped. Not in plan.
- Non-goal (remove the module global): explicitly skipped. Not in plan.

**Placeholder scan:** none. Every code step shows the code to write or the exact diff location.

**Type consistency:** `resolveUserId()` returns `Promise<string>`. It's `await`ed at every call site. `upsertExerciseNote`, `getUserExerciseNotes`, `getUserExerciseNotesBatch`, and `createExercise` become `async` — they already return Promises in their current form, so the outer signatures are compatible. `setCurrentUserId` / `getCurrentUserId` signatures unchanged. The `UPDATE ... WHERE user_id = 'local'` SQL in Task 3 matches the literal string the Task 3 test greps for.

**Plan file:** `docs/superpowers/plans/2026-04-11-exercise-notes-persistence-fix.md`
