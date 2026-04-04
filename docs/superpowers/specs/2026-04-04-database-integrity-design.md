# Spec: Database Integrity — Foreign Keys & Transactions

**Date**: 2026-04-04
**Status**: Approved

## Problem

The SQLite database layer has two categories of data consistency risks:

### 1. Foreign Key Enforcement Is Never Enabled

SQLite disables FK enforcement by default. `PRAGMA foreign_keys = ON` must be set per-connection after `PRAGMA journal_mode = WAL`. Without it, all `ON DELETE CASCADE` constraints defined in the schema are silently dead — deleting a parent row leaves orphaned child rows.

**Affected constraints:**
- `template_exercises.template_id → templates(id) ON DELETE CASCADE`
- `workout_sets.workout_id → workouts(id) ON DELETE CASCADE`
- `upcoming_workout_exercises.upcoming_workout_id → upcoming_workouts(id) ON DELETE CASCADE`
- `upcoming_workout_sets.upcoming_exercise_id → upcoming_workout_exercises(id) ON DELETE CASCADE`

### 2. Multi-Step Delete Operations Are Not Wrapped in Transactions

If the app crashes or the process is interrupted between two sequential `runAsync` calls, child rows remain (orphaned) or parent rows remain (dangling references).

**Affected functions:**
- `deleteWorkout` — two `runAsync` calls (sets then workout), no transaction
- `clearLocalUpcomingWorkout` — three `runAsync` calls, no transaction
- `deleteTemplate` — two `runAsync` calls (template_exercises then templates), no transaction
- `clearAllLocalData` — nine `runAsync` calls, no transaction

## Constraints

1. **Do NOT wrap `clearAllLocalData` in a single transaction** — it is called in sync flows which may run concurrently via `Promise.all`. SQLite cannot handle concurrent transactions (documented in CLAUDE.md).
2. **Do NOT wrap sync pull loops in transactions** — same reason.
3. **FK enablement may cause failures** if any existing operation deletes a child row before its parent, or inserts a child pointing to a nonexistent parent. Audit all delete operations to confirm correct dependency order.
4. **Per-connection PRAGMA** — `PRAGMA foreign_keys = ON` must be set after the database is opened, every time. It is not persisted to the database file.

## Delete Dependency Order (FK-safe)

When FKs are enforced, child rows must be deleted before parent rows:

```
exercises (root)
  └─ user_exercise_notes (exercise_id → exercises)
  └─ template_exercises (exercise_id → exercises)
     templates (root)
       └─ template_exercises (template_id → templates ON DELETE CASCADE)
       └─ workouts.template_id → templates (no cascade, nullable)
  └─ workout_sets (exercise_id → exercises)
     workouts (root for workout_sets)
       └─ workout_sets (workout_id → workouts ON DELETE CASCADE)
  └─ upcoming_workout_exercises (exercise_id → exercises)
     upcoming_workouts (root for upcoming chain)
       └─ upcoming_workout_exercises (upcoming_workout_id → upcoming_workouts ON DELETE CASCADE)
          └─ upcoming_workout_sets (upcoming_exercise_id → upcoming_workout_exercises ON DELETE CASCADE)
```

**Correct delete order for `clearAllLocalData`:**
1. `upcoming_workout_sets` (leaf)
2. `upcoming_workout_exercises`
3. `upcoming_workouts`
4. `workout_sets` (leaf)
5. `workouts`
6. `template_exercises` (child of both templates and exercises)
7. `templates`
8. `user_exercise_notes` (child of exercises)
9. `exercises` (root — must be last)

This matches the existing order in `clearAllLocalData`. Good.

**Correct delete order for `deleteWorkout`:**
1. `workout_sets` WHERE workout_id = ?
2. `workouts` WHERE id = ?

Note: when FKs are ON, step 1 is actually redundant because `workout_sets` has `ON DELETE CASCADE` from `workouts`. But we keep the explicit delete for clarity.

**Correct delete order for `deleteTemplate`:**
1. `template_exercises` WHERE template_id = ? (also redundant with CASCADE, kept for clarity)
2. `templates` WHERE id = ?

**Correct delete order for `clearLocalUpcomingWorkout`:**
1. `upcoming_workout_sets`
2. `upcoming_workout_exercises`
3. `upcoming_workouts`

Note: These deletes are NOT scoped to a specific ID — they clear the entire table. This is intentional.

## Solution Design

### FK Pragma
Add `PRAGMA foreign_keys = ON;` as a separate `execAsync` call in `initSchema`, immediately after the WAL pragma. Using a separate `execAsync` from the `CREATE TABLE` block ensures ordering and visibility.

### Transactions
Use `database.withTransactionAsync(async () => { ... })` pattern (already available in mock) to wrap:
- `deleteWorkout` — wraps both deletes
- `clearLocalUpcomingWorkout` — wraps all three deletes
- `deleteTemplate` — wraps both deletes
- `clearAllLocalData` — NOT wrapped (concurrent calls risk)

## Acceptance Criteria

1. `PRAGMA foreign_keys = ON` is emitted during `initSchema`.
2. `deleteWorkout`, `deleteTemplate`, `clearLocalUpcomingWorkout` each use `withTransactionAsync`.
3. `clearAllLocalData` remains non-transactional but deletes in the correct FK-safe order.
4. All existing tests pass.
5. New tests verify:
   - FK pragma is set during schema init
   - `deleteWorkout` uses a transaction
   - `deleteTemplate` uses a transaction
   - `clearLocalUpcomingWorkout` uses a transaction
   - `clearAllLocalData` does NOT use a transaction (safe for concurrent callers)
