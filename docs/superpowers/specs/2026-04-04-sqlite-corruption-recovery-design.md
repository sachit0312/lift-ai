# SQLite Corruption Recovery

**Date:** 2026-04-04
**Status:** Draft
**Scope:** 2 files modified, 1 test file added/updated

## Problem

When the phone dies mid-workout, the SQLite WAL (Write-Ahead Log) checkpoint can be interrupted, leaving the database file corrupted at the page level. The current recovery path — `clearAllLocalData()` — runs `DELETE FROM` on each table, which silently fails on a corrupted file. This means logout/login doesn't recover the app: exercises don't show, history has no workout names, and the active workout is gone.

## Solution: Nuclear Database Reset in Auth Flow

Replace `clearAllLocalData()` with a new `resetDatabase()` function in the auth login flow. Instead of running SQL deletes on potentially corrupted tables, delete the entire SQLite file and reinitialize from scratch.

### Why this is safe

The auth login flow already:
1. Clears all local data
2. Pulls everything from Supabase (exercises, templates, workouts, notes, upcoming workout)

Deleting the file instead of running 9 `DELETE FROM` statements is strictly better — it's faster, can't fail on corruption, and the subsequent pull repopulates everything identically.

## Design

### 1. `resetDatabase()` in `database.ts`

```typescript
export async function resetDatabase(): Promise<void> {
  // 1. Close existing connection (try/catch — may fail on corruption)
  try { if (db) await db.closeAsync(); } catch {}
  
  // 2. Reset module-level state
  db = undefined;
  dbInitPromise = null;
  
  // 3. Delete the SQLite file
  await SQLite.deleteDatabaseAsync('workout-enhanced.db');
  
  // 4. Reinitialize with fresh schema
  await getDb();
}
```

### 2. Auth flow update in `AuthContext.tsx`

Replace `clearAllLocalData()` with `resetDatabase()` in the `SIGNED_IN` handler (line 58). No other changes to the auth flow — the pull sequence remains identical.

### 3. Keep `clearAllLocalData()` as-is

Don't remove it — it's used in tests and may be useful for non-corruption scenarios. Just stop using it in the auth login path.

## What this does NOT fix

- **In-progress workout data:** If the phone dies mid-workout, sets that were debounced to SQLite but not yet synced to Supabase are lost. The `resetDatabase` approach recovers everything that was previously synced, but the active session is gone. Periodic sync of in-progress workouts would fix this but is a separate, larger feature.
- **Proactive corruption detection:** We don't run `PRAGMA integrity_check` on startup. Adding this would let us detect corruption early and trigger recovery automatically, but it adds ~100-500ms startup latency. Out of scope for now.

## Cleanup: Delete stale upcoming workout

The Apr 1 Pull Day 1 upcoming workout is still in prod Supabase. Delete it (and its exercises/sets) via Supabase REST API so it doesn't resurface after the DB reset + re-sync.

## Testing

- Unit test for `resetDatabase()`: verify it resets module state and reinitializes cleanly
- Verify existing `clearAllLocalData` tests still pass (function unchanged)
- Manual verification: logout → login should restore all data from Supabase on the physical device

## Files Changed

| File | Change |
|------|--------|
| `src/services/database.ts` | Add `resetDatabase()` export, extract DB name constant |
| `src/contexts/AuthContext.tsx` | Import `resetDatabase`, replace `clearAllLocalData` call |
| `src/services/__tests__/database.resilience.test.ts` | Add `resetDatabase` tests |
