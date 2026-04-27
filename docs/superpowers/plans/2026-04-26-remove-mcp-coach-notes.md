# Remove MCP Coach Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the AI-coach scratchpad note field (`user_exercise_notes.notes` column) entirely from the lift-ai schema, app, MCP server, tests, and docs. Also retire the legacy vestigial `exercises.notes` column.

**Architecture:** Pure deletion across two repos (lift-ai app + lift-ai-mcp server) plus a Supabase migration. App changes ride one PR/OTA, MCP changes ride a second deploy in a sibling repo, then the Supabase column drop runs last after both consumers stop reading it.

**Tech Stack:** TypeScript, React Native (Expo), expo-sqlite, Supabase Postgres, Zod (MCP schemas), Jest.

**Spec:** [docs/superpowers/specs/2026-04-26-remove-mcp-coach-notes-design.md](../specs/2026-04-26-remove-mcp-coach-notes-design.md)

---

## Phase 1: App repo (this worktree)

All Phase-1 work happens in `/Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869/`. The PR shipped from this branch becomes the OTA in the deploy sequence.

### Task 1: Narrow the `ExerciseNotes` type and discover breakage

**Files:**
- Modify: `src/types/database.ts:16-20`
- Modify: `src/services/sync.ts:27-33`

- [ ] **Step 1: Narrow `ExerciseNotes`**

In `src/types/database.ts`, replace the existing `ExerciseNotes` interface:

```ts
// Before
export interface ExerciseNotes {
  notes: string | null;
  form_notes: string | null;
  machine_notes: string | null;
}
```

```ts
// After
export interface ExerciseNotes {
  form_notes: string | null;
  machine_notes: string | null;
}
```

- [ ] **Step 2: Narrow `SyncExerciseNotesRow`**

In `src/services/sync.ts`, replace the existing interface:

```ts
// Before
interface SyncExerciseNotesRow {
  exercise_id: string;
  notes: string | null;
  form_notes: string | null;
  machine_notes: string | null;
}
```

```ts
// After
interface SyncExerciseNotesRow {
  exercise_id: string;
  form_notes: string | null;
  machine_notes: string | null;
}
```

- [ ] **Step 3: Run tsc to discover all breakage**

Run: `cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && npx tsc --noEmit 2>&1 | head -80`

Expected: Compilation errors in (at minimum) `database.ts`, `sync.ts`, `ExerciseDetailModal.tsx`, `WorkoutScreen.tsx`, `ExercisesScreen.tsx`, `factories.ts`, several test files. Save the full error list — Tasks 2–6 work through it.

- [ ] **Step 4: Do NOT commit yet**

Tasks 2–8 will resolve all the tsc errors and the broken tests. Single commit at end of Phase 1.

---

### Task 2: Update `database.ts` (SQL queries, helpers, migrations, schema)

**Files:**
- Modify: `src/services/database.ts` (multiple ranges below)

- [ ] **Step 1: Drop the legacy `ALTER TABLE exercises ADD COLUMN notes` line**

Delete lines 428–429:

```ts
// Delete:
  // Migration: add notes column to exercises table for sticky notes
  await database.runAsync('ALTER TABLE exercises ADD COLUMN notes TEXT').catch(() => {});
```

- [ ] **Step 2: Drop `notes` from the `CREATE TABLE user_exercise_notes` DDL**

In `initializeDatabase()`, modify the `CREATE TABLE IF NOT EXISTS user_exercise_notes` block (line ~465):

```ts
// Before
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS user_exercise_notes (
      user_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      notes TEXT,
      form_notes TEXT,
      machine_notes TEXT,
      PRIMARY KEY (user_id, exercise_id)
    )
  `);
```

```ts
// After
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS user_exercise_notes (
      user_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      form_notes TEXT,
      machine_notes TEXT,
      PRIMARY KEY (user_id, exercise_id)
    )
  `);
```

- [ ] **Step 3: Add new SQLite `DROP COLUMN` migrations**

Add these lines immediately after the `CREATE TABLE IF NOT EXISTS user_exercise_notes` block (i.e., new lines after the closing `\`);` on line ~474):

```ts
  // Migration (2026-04-26): remove AI-coach scratchpad notes — replaced by external agent knowledge.
  // See docs/superpowers/specs/2026-04-26-remove-mcp-coach-notes-design.md
  await database.runAsync('ALTER TABLE user_exercise_notes DROP COLUMN notes').catch(() => {});
  await database.runAsync('ALTER TABLE exercises DROP COLUMN notes').catch(() => {});
```

The `.catch(() => {})` makes them idempotent: fresh installs (column never existed) and re-runs (column already dropped) both no-op. Same pattern as every other migration in this function.

- [ ] **Step 4: Narrow `getUserExerciseNotes`**

Replace the function body (lines 520–530):

```ts
// Before
export async function getUserExerciseNotes(exerciseId: string): Promise<ExerciseNotes | null> {
  const userId = await resolveUserId();
  return withDb('getUserExerciseNotes', async (database) => {
    const rows = await database.getAllAsync<ExerciseNotesRow>(
      'SELECT exercise_id, notes, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ? AND exercise_id = ?',
      userId, exerciseId,
    );
    if (rows.length === 0) return null;
    return { notes: rows[0].notes, form_notes: rows[0].form_notes, machine_notes: rows[0].machine_notes };
  });
}
```

```ts
// After
export async function getUserExerciseNotes(exerciseId: string): Promise<ExerciseNotes | null> {
  const userId = await resolveUserId();
  return withDb('getUserExerciseNotes', async (database) => {
    const rows = await database.getAllAsync<ExerciseNotesRow>(
      'SELECT exercise_id, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ? AND exercise_id = ?',
      userId, exerciseId,
    );
    if (rows.length === 0) return null;
    return { form_notes: rows[0].form_notes, machine_notes: rows[0].machine_notes };
  });
}
```

- [ ] **Step 5: Narrow the `ExerciseNotesRow` row interface**

In `src/services/database.ts:27-32`, replace:

```ts
// Before
interface ExerciseNotesRow {
  exercise_id: string;
  notes: string | null;
  form_notes: string | null;
  machine_notes: string | null;
}
```

```ts
// After
interface ExerciseNotesRow {
  exercise_id: string;
  form_notes: string | null;
  machine_notes: string | null;
}
```

- [ ] **Step 6: Narrow `getUserExerciseNotesBatch`**

Replace the function body (lines 532–547):

```ts
// Before
export async function getUserExerciseNotesBatch(exerciseIds: string[]): Promise<Map<string, ExerciseNotes>> {
  if (exerciseIds.length === 0) return new Map();
  const userId = await resolveUserId();
  return withDb('getUserExerciseNotesBatch', async (database) => {
    const placeholders = exerciseIds.map(() => '?').join(',');
    const rows = await database.getAllAsync<ExerciseNotesRow>(
      `SELECT exercise_id, notes, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ? AND exercise_id IN (${placeholders})`,
      userId, ...exerciseIds,
    );
    const map = new Map<string, ExerciseNotes>();
    for (const r of rows) {
      map.set(r.exercise_id, { notes: r.notes, form_notes: r.form_notes, machine_notes: r.machine_notes });
    }
    return map;
  });
}
```

```ts
// After
export async function getUserExerciseNotesBatch(exerciseIds: string[]): Promise<Map<string, ExerciseNotes>> {
  if (exerciseIds.length === 0) return new Map();
  const userId = await resolveUserId();
  return withDb('getUserExerciseNotesBatch', async (database) => {
    const placeholders = exerciseIds.map(() => '?').join(',');
    const rows = await database.getAllAsync<ExerciseNotesRow>(
      `SELECT exercise_id, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ? AND exercise_id IN (${placeholders})`,
      userId, ...exerciseIds,
    );
    const map = new Map<string, ExerciseNotes>();
    for (const r of rows) {
      map.set(r.exercise_id, { form_notes: r.form_notes, machine_notes: r.machine_notes });
    }
    return map;
  });
}
```

- [ ] **Step 7: Narrow `VALID_NOTE_FIELDS` and `upsertExerciseNote`**

Replace lines 549–562:

```ts
// Before
const VALID_NOTE_FIELDS = new Set(['notes', 'form_notes', 'machine_notes'] as const);

export async function upsertExerciseNote(exerciseId: string, field: 'notes' | 'form_notes' | 'machine_notes', value: string | null): Promise<void> {
  if (!VALID_NOTE_FIELDS.has(field)) throw new Error(`Invalid note field: ${field}`);
  const userId = await resolveUserId();
  return withDb('upsertExerciseNote', async (database) => {
    await database.runAsync(
      `INSERT INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
       VALUES (?, ?, NULL, NULL, NULL)
       ON CONFLICT(user_id, exercise_id) DO UPDATE SET ${field} = ?`,
      userId, exerciseId, value,
    );
  });
}
```

```ts
// After
const VALID_NOTE_FIELDS = new Set(['form_notes', 'machine_notes'] as const);

export async function upsertExerciseNote(exerciseId: string, field: 'form_notes' | 'machine_notes', value: string | null): Promise<void> {
  if (!VALID_NOTE_FIELDS.has(field)) throw new Error(`Invalid note field: ${field}`);
  const userId = await resolveUserId();
  return withDb('upsertExerciseNote', async (database) => {
    await database.runAsync(
      `INSERT INTO user_exercise_notes (user_id, exercise_id, form_notes, machine_notes)
       VALUES (?, ?, NULL, NULL)
       ON CONFLICT(user_id, exercise_id) DO UPDATE SET ${field} = ?`,
      userId, exerciseId, value,
    );
  });
}
```

- [ ] **Step 8: Delete `updateExerciseNotes` wrapper**

Delete lines 564–566 entirely:

```ts
// Delete this whole function:
export function updateExerciseNotes(exerciseId: string, notes: string | null): Promise<void> {
  return upsertExerciseNote(exerciseId, 'notes', notes);
}
```

- [ ] **Step 9: Delete `migrateExerciseNotesToUserTable`**

Delete lines 1347–1359 entirely (the helper, its docstring, and its section comment):

```ts
// Delete:
// ─── Migration: Exercise Notes to User Table ───

/** One-time migration: copy notes from legacy exercises columns to user_exercise_notes.
 *  Must be called after auth provides a real userId. Idempotent via INSERT OR IGNORE. */
export function migrateExerciseNotesToUserTable(userId: string): Promise<void> {
  return withDb('migrateExerciseNotesToUserTable', async (database) => {
    await database.runAsync(`
      INSERT OR IGNORE INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
      SELECT ?, id, notes, form_notes, machine_notes FROM exercises
      WHERE (notes IS NOT NULL OR form_notes IS NOT NULL OR machine_notes IS NOT NULL)
    `, userId);
  });
}
```

- [ ] **Step 10: Verify tsc on database.ts itself is clean**

Run: `cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && npx tsc --noEmit 2>&1 | grep -E "src/services/database.ts" | head -20`

Expected: Empty output (no remaining tsc errors in database.ts). Errors in other files are expected; they're handled in later tasks.

---

### Task 3: Update `sync.ts` (push + pull paths)

**Files:**
- Modify: `src/services/sync.ts:141-156` (push), `src/services/sync.ts:354-371` (pull)

- [ ] **Step 1: Drop `notes` from push SELECT and upsert payload**

Replace lines 141–155:

```ts
// Before
    // User exercise notes — push all (use session.user.id, not getCurrentUserId(), to avoid stale 'local' on token refresh)
    const noteRows = await db.getAllAsync<SyncExerciseNotesRow>(
      'SELECT exercise_id, notes, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ?',
      session.user.id,
    );
    if (noteRows.length > 0) {
      const mappedNotes = noteRows.map(n => ({
        user_id: session.user.id,
        exercise_id: n.exercise_id,
        notes: n.notes,
        form_notes: n.form_notes,
        machine_notes: n.machine_notes,
      }));
      const { error: notesErr } = await supabase.from('user_exercise_notes').upsert(mappedNotes, { onConflict: 'user_id,exercise_id' });
      if (notesErr) handleSyncError('user_exercise_notes', notesErr);
    }
```

```ts
// After
    // User exercise notes — push all (use session.user.id, not getCurrentUserId(), to avoid stale 'local' on token refresh)
    const noteRows = await db.getAllAsync<SyncExerciseNotesRow>(
      'SELECT exercise_id, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ?',
      session.user.id,
    );
    if (noteRows.length > 0) {
      const mappedNotes = noteRows.map(n => ({
        user_id: session.user.id,
        exercise_id: n.exercise_id,
        form_notes: n.form_notes,
        machine_notes: n.machine_notes,
      }));
      const { error: notesErr } = await supabase.from('user_exercise_notes').upsert(mappedNotes, { onConflict: 'user_id,exercise_id' });
      if (notesErr) handleSyncError('user_exercise_notes', notesErr);
    }
```

- [ ] **Step 2: Drop `notes` from pull SELECT and local upsert**

Replace lines 353–370 (full block):

```ts
// Before
  // Pull user's exercise notes
  const { data: notes, error: notesErr } = await supabase
    .from('user_exercise_notes')
    .select('exercise_id, notes, form_notes, machine_notes')
    .eq('user_id', session.user.id);

  if (notesErr) handleSyncError('pull user_exercise_notes', notesErr);
  else if (notes && notes.length > 0) {
    for (const n of notes) {
      await db.runAsync(
        `INSERT INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, exercise_id) DO UPDATE SET
           notes=excluded.notes, form_notes=excluded.form_notes, machine_notes=excluded.machine_notes`,
        session.user.id, n.exercise_id, n.notes, n.form_notes, n.machine_notes,
      );
    }
  }
```

```ts
// After
  // Pull user's exercise notes
  const { data: notes, error: notesErr } = await supabase
    .from('user_exercise_notes')
    .select('exercise_id, form_notes, machine_notes')
    .eq('user_id', session.user.id);

  if (notesErr) handleSyncError('pull user_exercise_notes', notesErr);
  else if (notes && notes.length > 0) {
    for (const n of notes) {
      await db.runAsync(
        `INSERT INTO user_exercise_notes (user_id, exercise_id, form_notes, machine_notes)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, exercise_id) DO UPDATE SET
           form_notes=excluded.form_notes, machine_notes=excluded.machine_notes`,
        session.user.id, n.exercise_id, n.form_notes, n.machine_notes,
      );
    }
  }
```

- [ ] **Step 3: Verify sync.ts has no remaining `notes` references on `user_exercise_notes`**

Run: `grep -nE "user_exercise_notes|notes" /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869/src/services/sync.ts | grep -v "form_notes\|machine_notes\|coach_notes\|session_notes\|exercise_notes_table\|//\|workout"`

Expected: Should only show the rescue-block comment lines (which mention `user_exercise_notes` table-wide but don't reference the `notes` column). No live `notes` column references.

---

### Task 4: Update `AuthContext.tsx`

**Files:**
- Modify: `src/contexts/AuthContext.tsx:5,70`

- [ ] **Step 1: Remove `migrateExerciseNotesToUserTable` from import**

Replace line 5:

```ts
// Before
import { resetDatabase, setCurrentUserId, migrateExerciseNotesToUserTable } from '../services/database';
```

```ts
// After
import { resetDatabase, setCurrentUserId } from '../services/database';
```

- [ ] **Step 2: Remove the `await migrateExerciseNotesToUserTable(...)` call**

Delete line 70 (`await migrateExerciseNotesToUserTable(newSession!.user.id);`) entirely from the SIGNED_IN flow. The surrounding `await Promise.all([...])` and `await pullUpcomingWorkout()` calls remain.

After the edit, the SIGNED_IN block looks like:

```ts
              await Promise.race([
                (async () => {
                  await resetDatabase();
                  await Promise.all([
                    pullExercisesAndTemplates(),
                    pullWorkoutHistory(),
                  ]);
                  await pullUpcomingWorkout();
                })(),
                new Promise<void>((_, reject) =>
                  setTimeout(() => reject(new Error('sign-in sync timeout')), SYNC_TIMEOUT_MS),
                ),
              ]);
```

---

### Task 5: Update components and screens

**Files:**
- Modify: `src/components/ExerciseDetailModal.tsx:34,50`
- Modify: `src/screens/WorkoutScreen.tsx:146`
- Modify: `src/screens/ExercisesScreen.tsx:84`

- [ ] **Step 1: Narrow `loadedNotes` initial state in `ExerciseDetailModal.tsx`**

Line 34, replace:

```tsx
// Before
  const [loadedNotes, setLoadedNotes] = useState<ExerciseNotes>({ notes: null, form_notes: null, machine_notes: null });
```

```tsx
// After
  const [loadedNotes, setLoadedNotes] = useState<ExerciseNotes>({ form_notes: null, machine_notes: null });
```

- [ ] **Step 2: Narrow the fallback inside the load effect**

Line 50, replace:

```tsx
// Before
      const notes = n ?? { notes: null, form_notes: null, machine_notes: null };
```

```tsx
// After
      const notes = n ?? { form_notes: null, machine_notes: null };
```

- [ ] **Step 3: Drop `notes` from the destructure in `WorkoutScreen.tsx`**

Line 146, replace:

```tsx
// Before
    const { notes, form_notes, machine_notes, ...exercise } = updated;
```

```tsx
// After
    const { form_notes, machine_notes, ...exercise } = updated;
```

- [ ] **Step 4: Drop `notes` from the destructure in `ExercisesScreen.tsx`**

Line 84, replace:

```tsx
// Before
    const { notes, form_notes, machine_notes, ...exercise } = updated;
```

```tsx
// After
    const { form_notes, machine_notes, ...exercise } = updated;
```

- [ ] **Step 5: Verify tsc on src/ is now clean**

Run: `cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && npx tsc --noEmit 2>&1 | grep -E "^src/" | head -30`

Expected: Empty output for non-test files. Test files may still error — Tasks 6 and 7 fix those.

---

### Task 6: Update test fixtures and mocks (TypeScript-checked)

**Files:**
- Modify: `src/__tests__/helpers/factories.ts:19`
- Modify: `src/components/__tests__/ExerciseDetailModal.test.tsx:67,83`
- Modify: `src/screens/__tests__/WorkoutScreen.test.tsx:898`
- Modify: `src/services/__tests__/sync.test.ts:1152,1171-1174`

- [ ] **Step 1: Drop `notes` key from `createMockExerciseNotes` factory**

`src/__tests__/helpers/factories.ts:19`, replace:

```ts
// Before
export function createMockExerciseNotes(overrides: Partial<ExerciseNotes> = {}): ExerciseNotes {
  return {
    notes: null,
    form_notes: null,
    machine_notes: null,
    ...overrides,
  };
}
```

```ts
// After
export function createMockExerciseNotes(overrides: Partial<ExerciseNotes> = {}): ExerciseNotes {
  return {
    form_notes: null,
    machine_notes: null,
    ...overrides,
  };
}
```

- [ ] **Step 2: Drop `notes: null` from `ExerciseDetailModal.test.tsx` mocks**

`src/components/__tests__/ExerciseDetailModal.test.tsx:67`, replace:

```tsx
// Before
    (getUserExerciseNotes as jest.Mock).mockResolvedValueOnce({ notes: null, form_notes: 'Keep elbows tucked', machine_notes: null });
```

```tsx
// After
    (getUserExerciseNotes as jest.Mock).mockResolvedValueOnce({ form_notes: 'Keep elbows tucked', machine_notes: null });
```

`src/components/__tests__/ExerciseDetailModal.test.tsx:83`, replace:

```tsx
// Before
    (getUserExerciseNotes as jest.Mock).mockResolvedValueOnce({ notes: null, form_notes: null, machine_notes: 'Seat 5' });
```

```tsx
// After
    (getUserExerciseNotes as jest.Mock).mockResolvedValueOnce({ form_notes: null, machine_notes: 'Seat 5' });
```

- [ ] **Step 3: Drop `notes: null` from `WorkoutScreen.test.tsx:898`**

`src/screens/__tests__/WorkoutScreen.test.tsx:898`, replace:

```tsx
// Before
      (getUserExerciseNotes as jest.Mock).mockResolvedValueOnce({ notes: null, form_notes: null, machine_notes: 'Existing note' });
```

```tsx
// After
      (getUserExerciseNotes as jest.Mock).mockResolvedValueOnce({ form_notes: null, machine_notes: 'Existing note' });
```

**Do NOT touch lines 1028 or 1220** in this same file — those are `Exercise`-typed object literals that already had no `notes` field at the type level (the `notes: null` is dead but tsc doesn't see it because they don't go through `ExerciseNotes`-typed slots).

- [ ] **Step 4: Update `sync.test.ts` mockNotes fixture and SQL regex assertions**

`src/services/__tests__/sync.test.ts:1152`, replace:

```ts
// Before
    const mockNotes = [
      { exercise_id: 'ex-1', notes: null, form_notes: 'keep back straight', machine_notes: 'Use seat 3' },
    ];
```

```ts
// After
    const mockNotes = [
      { exercise_id: 'ex-1', form_notes: 'keep back straight', machine_notes: 'Use seat 3' },
    ];
```

`src/services/__tests__/sync.test.ts:1171`, replace the single-line regex assertion with two stricter assertions:

```ts
// Before
    expect(notesInsertCall![0]).toMatch(/ON CONFLICT.*notes=excluded\.notes/s);
```

```ts
// After
    // Confirm form_notes is still being upserted
    expect(notesInsertCall![0]).toMatch(/ON CONFLICT.*form_notes=excluded\.form_notes/s);
    // Confirm the bare `notes` column is gone (boundary class avoids matching `form_notes=excluded.form_notes` substring)
    expect(notesInsertCall![0]).not.toMatch(/[\s,(]notes=excluded\.notes/);
```

- [ ] **Step 5: Update positional param assertions on lines 1172–1174**

After Task 2/3 narrowed the upsert SQL, the column order in the INSERT becomes `(user_id, exercise_id, form_notes, machine_notes)`. The positional `runAsync` call becomes `(sql, user_id, exercise_id, form_notes, machine_notes)`, so:
- `[0]` = SQL string
- `[1]` = user_id
- `[2]` = exercise_id (was `[2]` before — same position, unchanged)
- `[3]` = form_notes (was `[4]` before)
- `[4]` = machine_notes (was `[5]` before)

Replace lines 1172–1174:

```ts
// Before
    expect(notesInsertCall![2]).toBe('ex-1'); // exercise_id param
    expect(notesInsertCall![4]).toBe('keep back straight'); // form_notes
    expect(notesInsertCall![5]).toBe('Use seat 3'); // machine_notes
```

```ts
// After
    expect(notesInsertCall![2]).toBe('ex-1'); // exercise_id param
    expect(notesInsertCall![3]).toBe('keep back straight'); // form_notes
    expect(notesInsertCall![4]).toBe('Use seat 3'); // machine_notes
```

- [ ] **Step 6: Verify tsc on tests is now clean**

Run: `cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && npx tsc --noEmit 2>&1 | head -30`

Expected: Either empty output or only errors on tests touched in Task 7 (Jest mock factories typed `any`).

---

### Task 7: Delete tests for deleted code (Jest-only failures, not tsc-caught)

**Files:**
- Modify: `src/services/__tests__/database.test.ts:25,155-…`
- Modify: `src/contexts/__tests__/AuthContext.test.tsx:23-27,38,332-333,502`
- Modify: `src/__tests__/authContext.currentUserId.test.tsx:9,14`
- Modify: `src/__tests__/sync.rescueLocal.test.ts:39`

- [ ] **Step 1: Delete `updateExerciseNotes` import and describe block from `database.test.ts`**

In `src/services/__tests__/database.test.ts`:
- Line 25: Remove `updateExerciseNotes,` from the import block
- Lines ~155–177 (the `describe('updateExerciseNotes', () => { … })` block): Delete the entire block. It only tests the deleted wrapper.
- The neighboring `describe('upsertExerciseNote', …)` block stays. Verify there are no test cases inside that pass `'notes'` as the `field` argument (run `grep -n "upsertExerciseNote.*'notes'" src/services/__tests__/database.test.ts` — expected: empty output, currently only `'form_notes'` and `'machine_notes'` are tested). If any matches appear, delete those test cases (the field is no longer valid).

- [ ] **Step 2: Delete `migrateExerciseNotesToUserTable` mock and assertions from `AuthContext.test.tsx`**

In `src/contexts/__tests__/AuthContext.test.tsx`:
- Line 26: Remove `migrateExerciseNotesToUserTable: jest.fn().mockResolvedValue(undefined),` from the `jest.mock('../../services/database', () => ({ … }))` block
- Line 38: Remove `migrateExerciseNotesToUserTable` from the import: `import { resetDatabase, setCurrentUserId, migrateExerciseNotesToUserTable } from '../../services/database';` → `import { resetDatabase, setCurrentUserId } from '../../services/database';`
- Lines 332–333: Delete the two `expect(migrateExerciseNotesToUserTable)…` assertions
- Line 502: Delete the `expect(migrateExerciseNotesToUserTable).toHaveBeenCalledWith('user-B');` assertion

- [ ] **Step 3: Delete `migrateExerciseNotesToUserTable` mock from `authContext.currentUserId.test.tsx`**

In `src/__tests__/authContext.currentUserId.test.tsx`:
- Line 9: Delete `const mockMigrateExerciseNotesToUserTable = jest.fn().mockResolvedValue(undefined);`
- Line 14: Delete `migrateExerciseNotesToUserTable: (...args: any[]) => mockMigrateExerciseNotesToUserTable(...args),` from the `jest.mock(...)` block

- [ ] **Step 4: Drop `notes: null` from `sync.rescueLocal.test.ts:39`**

In `src/__tests__/sync.rescueLocal.test.ts:39`, change:

```ts
// Before
{ exercise_id: 'e1', notes: null, form_notes: null, machine_notes: 'pin 4' }
```

```ts
// After
{ exercise_id: 'e1', form_notes: null, machine_notes: 'pin 4' }
```

- [ ] **Step 5: Grep remaining test files for any straggler `notes:` keys on note-related fixtures**

Run:

```bash
cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && \
  grep -rn "notes: null" src/__tests__ src/**/__tests__ 2>/dev/null | \
  grep -v "form_notes\|machine_notes\|coach_notes\|session_notes\|workout_set"
```

**Expected matches to LEAVE ALONE** (these are `Exercise`-typed or `Workout`-typed object literals — `Exercise` and `Workout` types do not have a `notes` field at the type level, so the `notes: null` keys are dead-but-tsc-invisible. Removing them is harmless cleanup but not required by this spec):

- `src/screens/__tests__/WorkoutScreen.test.tsx`: lines 447, 1028, 1220, 1632, 1674, 1730 (all `Exercise`-shaped or `Workout`-shaped raw object literals)

**Any other match is a bug.** Specifically, anything that's a return value for `getUserExerciseNotes`, `getUserExerciseNotesBatch`, or any object cast to `ExerciseNotes`/`ExerciseWithNotes` must have the `notes: null,` key removed — it will cause a tsc error once the type is narrowed.

---

### Task 8: Run full app-side verification

- [ ] **Step 1: Run tsc**

Run: `cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && npx tsc --noEmit`

Expected: Exits with code 0, no output.

- [ ] **Step 2: Run Jest**

Run: `cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && npm test`

Expected: All tests pass. If any fail with "column notes does not exist" type errors, that means Step 5 missed a SQL string; investigate.

- [ ] **Step 3: Grep for any residual references**

Run:

```bash
cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && \
  grep -rnE "user_exercise_notes.*\\bnotes\\b|exercises.*\\bnotes\\b|migrateExerciseNotesToUserTable|updateExerciseNotes" \
    src/ 2>/dev/null | \
  grep -v "form_notes\|machine_notes\|coach_notes\|session_notes\|workout"
```

Expected: Empty output. If anything remains, address before moving on.

- [ ] **Step 4: Grep migration files**

Run: `grep -rn "exercises.notes\|user_exercise_notes.notes" /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869/supabase/migrations/`

Expected: No matches — migration file in Task 10 will be the only file mentioning these columns going forward.

---

### Task 9: Update CLAUDE.md (project docs)

**Files:**
- Modify: `CLAUDE.md` (multiple ranges)

- [ ] **Step 1: Update the `user_exercise_notes` description in the Database section**

Find the line (search for "Three note types in user_exercise_notes"):

```
**Three note types in user_exercise_notes**: `notes` (coach/AI-only, hidden from user), `form_notes` (technique tips, synced with MCP), `machine_notes` (seat/pin settings, private from AI).
```

Replace with:

```
**Two note types in user_exercise_notes**: `form_notes` (technique tips, synced with MCP), `machine_notes` (seat/pin settings, private from AI).
```

- [ ] **Step 2: Update the database table summary line**

Find: `user_exercise_notes (`user_id`, `exercise_id`, `notes`, `form_notes`, `machine_notes`)`

Replace `notes` → drop it: `user_exercise_notes (`user_id`, `exercise_id`, `form_notes`, `machine_notes`)`

- [ ] **Step 3: Update the ExerciseDetailModal section**

Find the line: `Coach notes (`notes` field) NOT rendered.` — delete this sentence.

- [ ] **Step 4: Update the MCP access rules**

Find the line in the MCP section: ``notes` (coach) and `form_notes` readable/writable via `user_exercise_notes`. `machine_notes` NEVER exposed to MCP (user-private).`

Replace with: ``form_notes` readable/writable via `user_exercise_notes`. `machine_notes` NEVER exposed to MCP (user-private).`

- [ ] **Step 5: Update the MCP tools section**

In the MCP tools listing (`get_exercise_list`, `search_exercises`, `get_exercise_history`, `create_exercise`, `update_exercise`):
- For `get_exercise_list`: change "(fetches notes + form_notes from user_exercise_notes)" → "(fetches form_notes from user_exercise_notes)"
- For `search_exercises`: same edit
- For `get_exercise_history`: change "returns exercise_notes + exercise_form_notes from user_exercise_notes" → "returns exercise_form_notes from user_exercise_notes"
- For `create_exercise`: change "inserts exercise definition + notes/form_notes into user_exercise_notes separately" → "inserts exercise definition + form_notes into user_exercise_notes separately"
- For `update_exercise`: change "notes/form_notes always go to user_exercise_notes — never exposes machine_notes" → "form_notes always go to user_exercise_notes — never exposes machine_notes"

- [ ] **Step 6: Update the gotcha paragraph about three note types**

Find the gotcha sentence about machine notes that lists "All three note types live in `user_exercise_notes` table…" and reword to "Both note types (`form_notes`, `machine_notes`) live in `user_exercise_notes` table…". Drop the description of the `notes` (coach/AI-only) field.

- [ ] **Step 7: Verify CLAUDE.md doesn't reference the deleted concepts**

Run:

```bash
cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && \
  grep -nE "Three note types|coach/AI-only|notes.*hidden from user|migrateExerciseNotesToUserTable|updateExerciseNotes" CLAUDE.md
```

Expected: Empty output.

---

### Task 10: Create the Supabase migration file

**Files:**
- Create: `supabase/migrations/014_remove_coach_notes.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Remove AI-coach scratchpad notes (replaced by external agent knowledge).
-- See docs/superpowers/specs/2026-04-26-remove-mcp-coach-notes-design.md
ALTER TABLE user_exercise_notes DROP COLUMN IF EXISTS notes;
ALTER TABLE exercises DROP COLUMN IF EXISTS notes;
```

- [ ] **Step 2: Verify the file**

Run: `cat /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869/supabase/migrations/014_remove_coach_notes.sql`

Expected: The two `ALTER TABLE` statements above.

- [ ] **Step 3: Do NOT run the migration yet**

Migration runs in Phase 3 deploy. The file is committed in Task 11 so it lives in version control before the deploy step.

---

### Task 11: Commit Phase 1 (app repo)

- [ ] **Step 1: Stage all Phase 1 changes**

Run:

```bash
cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && git status
```

Expected: Modified files include `src/types/database.ts`, `src/services/database.ts`, `src/services/sync.ts`, `src/contexts/AuthContext.tsx`, `src/components/ExerciseDetailModal.tsx`, `src/screens/WorkoutScreen.tsx`, `src/screens/ExercisesScreen.tsx`, several test files, `CLAUDE.md`, and a new file `supabase/migrations/014_remove_coach_notes.sql`.

- [ ] **Step 2: Commit**

Run:

```bash
cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && \
git add src/ supabase/migrations/014_remove_coach_notes.sql CLAUDE.md && \
git commit -m "$(cat <<'EOF'
refactor: remove MCP coach notes (user_exercise_notes.notes)

The AI-coach scratchpad note field on each exercise is now obsolete —
the agent maintains its own knowledge externally. Removes the column
on both SQLite and Supabase, deletes the legacy exercises.notes vestige
and its one-time migration helper, narrows ExerciseNotes to
{form_notes, machine_notes}, and updates MCP-affecting docs.

App side only; MCP server changes ship in lift-ai-mcp repo. Supabase
migration runs after both app OTA and MCP deploy reach users.

See docs/superpowers/specs/2026-04-26-remove-mcp-coach-notes-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify commit succeeded**

Run: `cd /Users/sachitgoyal/code/lift-ai/.claude/worktrees/priceless-colden-e16869 && git log -1 --stat`

Expected: One commit on `claude/priceless-colden-e16869`, ~10–15 files changed.

---

## Phase 2: MCP repo (`/Users/sachitgoyal/code/lift-ai-mcp/`)

All Phase-2 work happens in `/Users/sachitgoyal/code/lift-ai-mcp/`. Commit lands in that repo.

### Task 12: Update MCP write tools (`create_exercise`, `update_exercise`)

**Files:**
- Modify: `/Users/sachitgoyal/code/lift-ai-mcp/src/tools/write/exercises.ts`

- [ ] **Step 1: Update `create_exercise`**

Replace the schema and handler:

```ts
// Before (lines ~18–60)
  server.tool(
    'create_exercise',
    'Create a new exercise',
    {
      name: nameSchema,
      type: exerciseTypeSchema,
      muscle_groups: z.array(muscleGroupSchema).min(1, 'At least one muscle group required'),
      description: descriptionSchema,
      training_goal: trainingGoalSchema.default('hypertrophy'),
      notes: z.string().max(2000).nullable().optional().describe('AI coach notes (not shown to user in app). Pass null to clear.'),
      form_notes: formNotesSchema,
    },
    withTimeout(async ({ name, type, muscle_groups, description, training_goal, notes, form_notes }) => {
      try {
        const { userId } = getCurrentContext();

        // Insert exercise definition (user_id = userId for custom exercises)
        const { data, error } = await supabase
          .from('exercises')
          .insert({ name, type, muscle_groups, description, training_goal, user_id: userId })
          .select('id')
          .single();
        if (error) throw error;

        // Insert notes into user_exercise_notes if provided
        if (notes !== undefined || form_notes !== undefined) {
          const noteRecord: Record<string, unknown> = {
            user_id: userId,
            exercise_id: data.id,
          };
          if (notes !== undefined) noteRecord.notes = notes;
          if (form_notes !== undefined) noteRecord.form_notes = form_notes;

          const { error: noteErr } = await supabase
            .from('user_exercise_notes')
            .upsert(noteRecord, { onConflict: 'user_id,exercise_id' });
          if (noteErr) throw noteErr;
        }

        return ok({ success: true, id: data.id, message: `Exercise "${name}" created` });
      } catch (e) { return err(e); }
    })
  );
```

```ts
// After
  server.tool(
    'create_exercise',
    'Create a new exercise',
    {
      name: nameSchema,
      type: exerciseTypeSchema,
      muscle_groups: z.array(muscleGroupSchema).min(1, 'At least one muscle group required'),
      description: descriptionSchema,
      training_goal: trainingGoalSchema.default('hypertrophy'),
      form_notes: formNotesSchema,
    },
    withTimeout(async ({ name, type, muscle_groups, description, training_goal, form_notes }) => {
      try {
        const { userId } = getCurrentContext();

        // Insert exercise definition (user_id = userId for custom exercises)
        const { data, error } = await supabase
          .from('exercises')
          .insert({ name, type, muscle_groups, description, training_goal, user_id: userId })
          .select('id')
          .single();
        if (error) throw error;

        // Insert form_notes into user_exercise_notes if provided
        if (form_notes !== undefined) {
          const { error: noteErr } = await supabase
            .from('user_exercise_notes')
            .upsert({ user_id: userId, exercise_id: data.id, form_notes }, { onConflict: 'user_id,exercise_id' });
          if (noteErr) throw noteErr;
        }

        return ok({ success: true, id: data.id, message: `Exercise "${name}" created` });
      } catch (e) { return err(e); }
    })
  );
```

- [ ] **Step 2: Update `update_exercise`**

Replace the schema and handler:

```ts
// Before (lines ~63–141)
  server.tool(
    'update_exercise',
    'Update an existing exercise (name, type, muscle groups, description, training goal, notes)',
    {
      exercise_id: uuidSchema,
      name: nameSchema.optional(),
      type: exerciseTypeSchema.optional(),
      muscle_groups: z.array(muscleGroupSchema).min(1).optional(),
      description: descriptionSchema.optional(),
      training_goal: trainingGoalSchema.optional(),
      notes: z.string().max(2000).nullable().optional().describe('AI coach notes (not shown to user in app). Pass null to clear.'),
      form_notes: formNotesSchema,
    },
    withTimeout(async ({ exercise_id, name, type, muscle_groups, description, training_goal, notes, form_notes }) => {
      try {
        const { userId } = getCurrentContext();

        // Separate definition fields from note fields
        const definitionUpdates: Record<string, unknown> = {};
        if (name !== undefined) definitionUpdates.name = name;
        if (type !== undefined) definitionUpdates.type = type;
        if (muscle_groups !== undefined) definitionUpdates.muscle_groups = muscle_groups;
        if (description !== undefined) definitionUpdates.description = description;
        if (training_goal !== undefined) definitionUpdates.training_goal = training_goal;

        const hasNoteUpdates = notes !== undefined || form_notes !== undefined;
        const hasDefinitionUpdates = Object.keys(definitionUpdates).length > 0;

        if (!hasDefinitionUpdates && !hasNoteUpdates) {
          return ok({ success: false, message: 'No updates provided' });
        }

        let exerciseName = '';
        const results: string[] = [];

        // Update definition (only for custom exercises owned by user)
        if (hasDefinitionUpdates) {
          await assertExerciseOwnership(exercise_id, userId);
          const { data, error } = await supabase
            .from('exercises')
            .update(definitionUpdates)
            .eq('id', exercise_id)
            .select('id, name')
            .single();
          if (error) throw error;
          exerciseName = data.name;
          results.push('definition updated');
        }

        // Update notes (any user can write their own notes on any exercise)
        if (hasNoteUpdates) {
          const noteRecord: Record<string, unknown> = {
            user_id: userId,
            exercise_id: exercise_id,
          };
          if (notes !== undefined) noteRecord.notes = notes;
          if (form_notes !== undefined) noteRecord.form_notes = form_notes;

          const { error: noteErr } = await supabase
            .from('user_exercise_notes')
            .upsert(noteRecord, { onConflict: 'user_id,exercise_id' });
          if (noteErr) throw noteErr;
          results.push('notes updated');

          if (!exerciseName) {
            const { data: exData } = await supabase.from('exercises').select('name').eq('id', exercise_id).single();
            exerciseName = exData?.name ?? exercise_id;
          }
        }

        const allSucceeded = results.every(r => !r.includes('failed'));
        return ok({
          success: allSucceeded,
          id: exercise_id,
          message: `Exercise "${exerciseName}": ${results.join(', ')}`,
        });
      } catch (e) { return err(e); }
    })
  );
```

```ts
// After
  server.tool(
    'update_exercise',
    'Update an existing exercise (name, type, muscle groups, description, training goal, form_notes)',
    {
      exercise_id: uuidSchema,
      name: nameSchema.optional(),
      type: exerciseTypeSchema.optional(),
      muscle_groups: z.array(muscleGroupSchema).min(1).optional(),
      description: descriptionSchema.optional(),
      training_goal: trainingGoalSchema.optional(),
      form_notes: formNotesSchema,
    },
    withTimeout(async ({ exercise_id, name, type, muscle_groups, description, training_goal, form_notes }) => {
      try {
        const { userId } = getCurrentContext();

        // Separate definition fields from note fields
        const definitionUpdates: Record<string, unknown> = {};
        if (name !== undefined) definitionUpdates.name = name;
        if (type !== undefined) definitionUpdates.type = type;
        if (muscle_groups !== undefined) definitionUpdates.muscle_groups = muscle_groups;
        if (description !== undefined) definitionUpdates.description = description;
        if (training_goal !== undefined) definitionUpdates.training_goal = training_goal;

        const hasNoteUpdates = form_notes !== undefined;
        const hasDefinitionUpdates = Object.keys(definitionUpdates).length > 0;

        if (!hasDefinitionUpdates && !hasNoteUpdates) {
          return ok({ success: false, message: 'No updates provided' });
        }

        let exerciseName = '';
        const results: string[] = [];

        // Update definition (only for custom exercises owned by user)
        if (hasDefinitionUpdates) {
          await assertExerciseOwnership(exercise_id, userId);
          const { data, error } = await supabase
            .from('exercises')
            .update(definitionUpdates)
            .eq('id', exercise_id)
            .select('id, name')
            .single();
          if (error) throw error;
          exerciseName = data.name;
          results.push('definition updated');
        }

        // Update form_notes (any user can write their own notes on any exercise)
        if (hasNoteUpdates) {
          const { error: noteErr } = await supabase
            .from('user_exercise_notes')
            .upsert({ user_id: userId, exercise_id, form_notes }, { onConflict: 'user_id,exercise_id' });
          if (noteErr) throw noteErr;
          results.push('form_notes updated');

          if (!exerciseName) {
            const { data: exData } = await supabase.from('exercises').select('name').eq('id', exercise_id).single();
            exerciseName = exData?.name ?? exercise_id;
          }
        }

        const allSucceeded = results.every(r => !r.includes('failed'));
        return ok({
          success: allSucceeded,
          id: exercise_id,
          message: `Exercise "${exerciseName}": ${results.join(', ')}`,
        });
      } catch (e) { return err(e); }
    })
  );
```

- [ ] **Step 3: Confirm `notesSchema` import is gone if unused**

`write/exercises.ts` doesn't import `notesSchema` (it used inline `z.string()`), so no import edit needed. Verify:

Run: `grep -n "notesSchema\|formNotesSchema" /Users/sachitgoyal/code/lift-ai-mcp/src/tools/write/exercises.ts`

Expected: Only `formNotesSchema` references — no `notesSchema`.

---

### Task 13: Update MCP read tools (`get_exercise_list`, `search_exercises`, `get_exercise_history`)

**Files:**
- Modify: `/Users/sachitgoyal/code/lift-ai-mcp/src/tools/read/exercises.ts`

- [ ] **Step 1: Update `get_exercise_list`**

Replace lines ~25–37:

```ts
// Before
        const { data: noteRows } = exerciseIds.length > 0
          ? await supabase
              .from('user_exercise_notes')
              .select('exercise_id, notes, form_notes')
              .eq('user_id', userId)
              .in('exercise_id', exerciseIds)
          : { data: [] };

        const notesMap = new Map((noteRows ?? []).map(n => [n.exercise_id, n]));

        const result = (exercises ?? []).map(e => ({
          ...e,
          notes: notesMap.get(e.id)?.notes ?? null,
          form_notes: notesMap.get(e.id)?.form_notes ?? null,
        }));
```

```ts
// After
        const { data: noteRows } = exerciseIds.length > 0
          ? await supabase
              .from('user_exercise_notes')
              .select('exercise_id, form_notes')
              .eq('user_id', userId)
              .in('exercise_id', exerciseIds)
          : { data: [] };

        const notesMap = new Map((noteRows ?? []).map(n => [n.exercise_id, n]));

        const result = (exercises ?? []).map(e => ({
          ...e,
          form_notes: notesMap.get(e.id)?.form_notes ?? null,
        }));
```

- [ ] **Step 2: Update `search_exercises`**

Replace lines ~77–91 with the same pattern as `get_exercise_list`:

```ts
// Before
        const { data: noteRows } = exerciseIds.length > 0
          ? await supabase
              .from('user_exercise_notes')
              .select('exercise_id, notes, form_notes')
              .eq('user_id', userId)
              .in('exercise_id', exerciseIds)
          : { data: [] };

        const notesMap = new Map((noteRows ?? []).map(n => [n.exercise_id, n]));

        const result = (exercises ?? []).map(e => ({
          ...e,
          notes: notesMap.get(e.id)?.notes ?? null,
          form_notes: notesMap.get(e.id)?.form_notes ?? null,
        }));
```

```ts
// After
        const { data: noteRows } = exerciseIds.length > 0
          ? await supabase
              .from('user_exercise_notes')
              .select('exercise_id, form_notes')
              .eq('user_id', userId)
              .in('exercise_id', exerciseIds)
          : { data: [] };

        const notesMap = new Map((noteRows ?? []).map(n => [n.exercise_id, n]));

        const result = (exercises ?? []).map(e => ({
          ...e,
          form_notes: notesMap.get(e.id)?.form_notes ?? null,
        }));
```

- [ ] **Step 3: Update `get_exercise_history`**

Replace lines ~146–152 (the user_exercise_notes SELECT) and line 205 (the response shape):

```ts
// Before — lines ~146-152
        // Fetch exercise notes from user_exercise_notes
        const { data: noteData } = await supabase
          .from('user_exercise_notes')
          .select('notes, form_notes')
          .eq('user_id', userId)
          .eq('exercise_id', exercise_id)
          .maybeSingle();
```

```ts
// After
        // Fetch exercise form_notes from user_exercise_notes
        const { data: noteData } = await supabase
          .from('user_exercise_notes')
          .select('form_notes')
          .eq('user_id', userId)
          .eq('exercise_id', exercise_id)
          .maybeSingle();
```

```ts
// Before — line ~205 (inside response object)
        return ok({
          exercise_notes: noteData?.notes ?? null,
          exercise_form_notes: noteData?.form_notes ?? null,
          sessions: sorted,
        });
```

```ts
// After
        return ok({
          exercise_form_notes: noteData?.form_notes ?? null,
          sessions: sorted,
        });
```

- [ ] **Step 4: Verify no remaining references to the dropped column in MCP read tools**

Run: `grep -n "notes" /Users/sachitgoyal/code/lift-ai-mcp/src/tools/read/exercises.ts | grep -v "form_notes\|coach_notes\|exercise_notes_table\|//"`

Expected: Empty output.

---

### Task 14: Verify MCP repo

- [ ] **Step 1: Run MCP tsc**

Run: `cd /Users/sachitgoyal/code/lift-ai-mcp && npx tsc --noEmit`

Expected: Exits with code 0, no output.

- [ ] **Step 2: Run MCP tests if any exist**

Run: `cd /Users/sachitgoyal/code/lift-ai-mcp && (npm test 2>&1 || echo "no tests configured")`

Expected: All tests pass, or "no tests configured" message.

- [ ] **Step 3: Verify build succeeds**

Run: `cd /Users/sachitgoyal/code/lift-ai-mcp && npm run build 2>&1 | tail -20`

Expected: Successful build, no TypeScript errors.

- [ ] **Step 4: Grep for any lingering `notes` references on the column**

Run: `grep -rn "user_exercise_notes" /Users/sachitgoyal/code/lift-ai-mcp/src/ | grep -v "form_notes\|coach_notes"`

Expected: Output should only show table name in `.from(...)` calls — no SELECT, INSERT, or upsert payloads referencing the bare `notes` column.

- [ ] **Step 5: Verify `notesSchema` shared module untouched**

Run: `grep -n "notesSchema" /Users/sachitgoyal/code/lift-ai-mcp/src/validation/schemas.ts`

Expected: Definition still exists. The carve-out preserves it for `create_upcoming_workout`.

---

### Task 15: Commit MCP repo

- [ ] **Step 1: Stage and commit MCP changes**

Run:

```bash
cd /Users/sachitgoyal/code/lift-ai-mcp && git status
```

Expected: Modified files are `src/tools/write/exercises.ts` and `src/tools/read/exercises.ts`.

```bash
cd /Users/sachitgoyal/code/lift-ai-mcp && \
git add src/tools/write/exercises.ts src/tools/read/exercises.ts && \
git commit -m "$(cat <<'EOF'
refactor: remove `notes` (AI-coach scratchpad) from exercise tools

Drops the `notes` parameter from create_exercise/update_exercise and
the `notes`/`exercise_notes` field from get_exercise_list,
search_exercises, and get_exercise_history. Field is being removed
from the user_exercise_notes table — agent now maintains its own
knowledge externally (Obsidian wiki).

Pairs with lift-ai app commit removing the column. See lift-ai
docs/superpowers/specs/2026-04-26-remove-mcp-coach-notes-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify commit**

Run: `cd /Users/sachitgoyal/code/lift-ai-mcp && git log -1 --stat`

Expected: One commit, two files changed.

---

## Phase 3: Deploy (manual, human-driven)

This phase is for the human operator. The implementing agent should print the checklist below and STOP — do not execute deploys without explicit user instruction.

### Task 16: Print deploy checklist for human

- [ ] **Step 1: Print the deploy plan**

Tell the user:

> Phases 1 and 2 complete. Two commits ready to deploy:
> - lift-ai (this repo, branch `claude/priceless-colden-e16869`): app code + SQLite migrations + Supabase migration file
> - lift-ai-mcp: MCP tool schema cleanup
>
> **Required deploy order:**
>
> 1. **Merge lift-ai branch and ship app OTA** (use `/merge-to-master` then `npm run update:prod`). The new app will stop SELECTing `notes` from Supabase and will run the local SQLite `DROP COLUMN` migration on first launch.
> 2. **Confirm OTA installed on device** — open the app, confirm version updated. Overnight is enough for the OTA to propagate, but for a single user, just relaunch the app.
> 3. **Deploy MCP** — `cd /Users/sachitgoyal/code/lift-ai-mcp && /deploy-mcp` (or whatever the canonical deploy command is). The new MCP code stops SELECTing the `notes` column.
> 4. **Run Supabase migration on dev first**: open Supabase SQL Editor for `lift-ai-dev` (ref `gcpnqpqqwcwvyzoivolp`), paste contents of `supabase/migrations/014_remove_coach_notes.sql`, run it. Verify with `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_exercise_notes';` — `notes` should be gone.
> 5. **Run Supabase migration on prod**: same pattern on `lift.ai` prod (ref `lgnkxjiqzsqiwrqrsxww`).
> 6. **Smoke test**: open the app, create a new exercise, edit form_notes and machine_notes, confirm both round-trip. Have the agent call `mcp__lift-ai__create_exercise` and confirm `notes` is no longer accepted as a parameter (Zod should reject if passed). Have the agent call `mcp__lift-ai__get_exercise_history` and confirm response shape includes `exercise_form_notes` but NOT `exercise_notes`.

- [ ] **Step 2: STOP — do not execute deploys without explicit user authorization**

Per the project's working style (from CLAUDE.md/global memory): destructive operations like prod migrations require explicit confirmation. Wait for the user to say "go ahead" or to run the deploy commands themselves.
