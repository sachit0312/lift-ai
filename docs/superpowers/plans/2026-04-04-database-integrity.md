# Plan: Database Integrity — Foreign Keys & Transactions

**Date**: 2026-04-04
**Spec**: `docs/superpowers/specs/2026-04-04-database-integrity-design.md`
**Status**: Implementation complete

## Steps

### Step 1: Add FK pragma in `initSchema`
- File: `src/services/database.ts`
- After the WAL `execAsync` call and before CREATE TABLE statements, add `PRAGMA foreign_keys = ON;`
- Done inside the first `execAsync` block (the large schema init) — add as the second PRAGMA line right after `journal_mode = WAL`

### Step 2: Wrap `deleteWorkout` in a transaction
- File: `src/services/database.ts`
- Wrap the two sequential `runAsync` calls in `database.withTransactionAsync`

### Step 3: Wrap `deleteTemplate` in a transaction
- File: `src/services/database.ts`
- Wrap the two sequential `runAsync` calls in `database.withTransactionAsync`

### Step 4: Wrap `clearLocalUpcomingWorkout` in a transaction
- File: `src/services/database.ts`
- Wrap the three sequential `runAsync` calls in `database.withTransactionAsync`

### Step 5: Write new tests
- File: `src/services/__tests__/database.resilience.test.ts`
- Add a new describe block: `'FK pragma and transaction integrity'`
- Tests:
  1. FK pragma is emitted during schema init (`execAsync` is called with a string containing `PRAGMA foreign_keys`)
  2. `deleteWorkout` uses `withTransactionAsync`
  3. `deleteTemplate` uses `withTransactionAsync`
  4. `clearLocalUpcomingWorkout` uses `withTransactionAsync`
  5. `clearAllLocalData` does NOT use `withTransactionAsync`

### Step 6: Run tests and type-check
- `npx jest --verbose src/services/__tests__/database.resilience.test.ts`
- `npx jest --verbose` (all tests)
- `npx tsc --noEmit`

### Step 7: Commit
- Conventional commit: `fix: enable FK enforcement and wrap multi-step deletes in transactions`
