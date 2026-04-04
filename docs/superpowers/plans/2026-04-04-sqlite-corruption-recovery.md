# SQLite Corruption Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace soft-delete DB recovery with nuclear file-delete recovery so logout/login always restores from Supabase — even after SQLite corruption.

**Architecture:** Add `resetDatabase()` to `database.ts` that closes the connection, deletes the SQLite file, and reinitializes. Swap it into `AuthContext.tsx`'s login flow. Keep `clearAllLocalData()` for non-corruption use.

**Tech Stack:** expo-sqlite, Jest, Supabase REST API

---

### Task 1: Update expo-sqlite mock with `closeAsync` and `deleteDatabaseAsync`

**Files:**
- Modify: `src/__mocks__/expo-sqlite.ts`

- [ ] **Step 1: Add missing mock methods**

```typescript
const mockDb = {
  getAllAsync: jest.fn().mockResolvedValue([]),
  getFirstAsync: jest.fn().mockResolvedValue(null),
  runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
  execAsync: jest.fn().mockResolvedValue(undefined),
  withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
  closeAsync: jest.fn().mockResolvedValue(undefined),
};

export function openDatabaseAsync() {
  return Promise.resolve(mockDb);
}

export function deleteDatabaseAsync() {
  return Promise.resolve(undefined);
}

export const __mockDb = mockDb;
```

- [ ] **Step 2: Run existing tests to confirm no regressions**

Run: `npx jest src/services/__tests__/database.resilience.test.ts --verbose`
Expected: All 9 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/__mocks__/expo-sqlite.ts
git commit -m "test: add closeAsync and deleteDatabaseAsync to expo-sqlite mock"
```

---

### Task 2: Add `resetDatabase()` to `database.ts`

**Files:**
- Modify: `src/services/database.ts:233-251` (module-level db vars + getDb)

- [ ] **Step 1: Write failing test for `resetDatabase`**

Add to `src/services/__tests__/database.resilience.test.ts`:

```typescript
import {
  getAllExercises,
  getExerciseById,
  createExercise,
  getWorkoutHistory,
  clearAllLocalData,
  resetDatabase,
} from '../database';

// ... existing tests ...

// ─── resetDatabase ───

describe('resetDatabase', () => {
  it('closes the database connection', async () => {
    // Ensure db is initialized by calling any query
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    await getAllExercises();
    __mockDb.closeAsync.mockClear();

    await resetDatabase();

    expect(__mockDb.closeAsync).toHaveBeenCalledTimes(1);
  });

  it('deletes the database file', async () => {
    const SQLite = require('expo-sqlite');
    jest.spyOn(SQLite, 'deleteDatabaseAsync');

    await resetDatabase();

    expect(SQLite.deleteDatabaseAsync).toHaveBeenCalledWith('workout-enhanced.db');
  });

  it('reinitializes the database after deletion', async () => {
    const SQLite = require('expo-sqlite');
    jest.spyOn(SQLite, 'openDatabaseAsync');
    __mockDb.execAsync.mockClear();

    // resetDatabase should call openDatabaseAsync + initSchema (execAsync) again
    // But since module caches the singleton, we need to reset internal state.
    // The function itself resets db + dbInitPromise, so openDatabaseAsync will be called.
    await resetDatabase();

    // After reset, db operations should still work
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    const result = await getAllExercises();
    expect(result).toEqual([]);
  });

  it('survives closeAsync failure (corrupted DB)', async () => {
    __mockDb.closeAsync.mockRejectedValueOnce(new Error('DB corrupted'));

    // Should not throw — close failure is swallowed
    await expect(resetDatabase()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/__tests__/database.resilience.test.ts --verbose -t "resetDatabase"`
Expected: FAIL — `resetDatabase` is not exported

- [ ] **Step 3: Implement `resetDatabase` in `database.ts`**

Extract DB name to a constant and add the function after `getDb()`:

```typescript
const DB_NAME = 'workout-enhanced.db';

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      db = await SQLite.openDatabaseAsync(DB_NAME);
      await initSchema(db);
      return db;
    })();
  }
  return dbInitPromise;
}

/** Nuclear reset: close connection, delete the SQLite file, reinitialize fresh schema.
 *  Use when the DB file is corrupted beyond repair (e.g. phone died mid-write). */
export async function resetDatabase(): Promise<void> {
  try {
    if (db) await db.closeAsync();
  } catch {
    // May fail if DB is corrupted — that's fine, we're deleting it anyway
  }
  db = undefined as unknown as SQLite.SQLiteDatabase;
  dbInitPromise = null;
  await SQLite.deleteDatabaseAsync(DB_NAME);
  await getDb();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/services/__tests__/database.resilience.test.ts --verbose`
Expected: All tests PASS (existing 9 + new 4)

- [ ] **Step 5: Commit**

```bash
git add src/services/database.ts src/services/__tests__/database.resilience.test.ts
git commit -m "feat: add resetDatabase() for nuclear SQLite recovery"
```

---

### Task 3: Update auth flow to use `resetDatabase`

**Files:**
- Modify: `src/contexts/AuthContext.tsx:5,58`

- [ ] **Step 1: Update import**

Change line 5 from:
```typescript
import { clearAllLocalData, setCurrentUserId, migrateExerciseNotesToUserTable } from '../services/database';
```
to:
```typescript
import { resetDatabase, setCurrentUserId, migrateExerciseNotesToUserTable } from '../services/database';
```

- [ ] **Step 2: Replace `clearAllLocalData()` call**

Change line 58 from:
```typescript
                  await clearAllLocalData();
```
to:
```typescript
                  await resetDatabase();
```

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "fix: use resetDatabase in auth flow for corruption-proof recovery"
```

---

### Task 4: Delete stale Apr 1 upcoming workout from prod Supabase

**Files:** None (API call only)

- [ ] **Step 1: Delete upcoming workout sets, exercises, then workout**

Using prod Supabase service role key from `/Users/sachitgoyal/code/lift-ai-mcp/.env`, delete in dependency order:
1. `DELETE FROM upcoming_workout_sets WHERE upcoming_workout_exercise_id IN (SELECT id FROM upcoming_workout_exercises WHERE upcoming_workout_id = '<id>')`
2. `DELETE FROM upcoming_workout_exercises WHERE upcoming_workout_id = '<id>'`
3. `DELETE FROM upcoming_workouts WHERE id = '<id>'`

Use the Supabase REST API with service role key auth.

---
