# Remove MCP Coach Notes (`user_exercise_notes.notes`)

**Date:** 2026-04-26
**Status:** Approved (design); awaiting plan + implementation
**Author:** Sachit + Claude (brainstorming session)

## Summary

Remove the AI-coach scratchpad note field on exercises (`user_exercise_notes.notes`) entirely from the system. The agent now keeps its own knowledge externally (Obsidian wiki / its own note system), so the in-app hidden-from-user notes column is obsolete.

This is a **removal of a feature**, not a refactor. Sibling concepts that look similar but are unrelated (`form_notes`, `machine_notes`, workout-level `coach_notes`, upcoming-workout `notes`) are explicitly preserved.

## Motivation

The `notes` field on `user_exercise_notes` was originally added so the MCP agent could leave persistent annotations on each exercise that the user wouldn't see in the app. In practice the agent now writes its observations to Obsidian and uses its own scheduled-task system; the in-DB scratchpad is dead weight that:

- Confuses the data model (three "notes" concepts on a single table where two are user-visible and one is not)
- Maintains a code path with no UI
- Forces ongoing thought about whether to expose the field, what to filter, etc.
- Creates a vestigial Supabase column and a vestigial legacy migration helper

## Goal

Eliminate the AI-coach `notes` field and all references to it across the schema, app code, MCP server, tests, and docs. Leave no dead column, no orphaned wrapper, no stale documentation. Use the same change to also retire the legacy `exercises.notes` column (already half-orphaned — added via `ALTER` for an old schema, only ever read by a one-time migration).

## In Scope

### Schema changes
- **Supabase:** `ALTER TABLE user_exercise_notes DROP COLUMN notes` (run on dev, then prod, via SQL Editor — standard CLAUDE.md pattern)
- **Supabase:** `ALTER TABLE exercises DROP COLUMN notes` (same migration file, run on both)
- **SQLite (local, in `database.ts` init):** Add idempotent `ALTER TABLE user_exercise_notes DROP COLUMN notes` and `ALTER TABLE exercises DROP COLUMN notes` wrapped in `.catch(() => {})` per the existing forward-only migration convention
- **SQLite (in `database.ts` init):** Remove the existing `ALTER TABLE exercises ADD COLUMN notes TEXT` line (~line 429) and its comment

### App code (`src/`)

#### `src/types/database.ts`
- Narrow `ExerciseNotes` from `{ notes: string \| null; form_notes: string \| null; machine_notes: string \| null }` to `{ form_notes: string \| null; machine_notes: string \| null }`
- `ExerciseWithNotes = Exercise & ExerciseNotes` automatically narrows
- Update the `SyncExerciseNotesRow` interface (used in sync.ts) to drop `notes`

#### `src/services/database.ts`
- `upsertExerciseNote(exerciseId, field, value)`: narrow field union from `'notes' | 'form_notes' | 'machine_notes'` to `'form_notes' | 'machine_notes'`
- `VALID_NOTE_FIELDS`: drop `'notes'` from the set
- The INSERT statement inside `upsertExerciseNote`: drop `notes` from columns list and `excluded.notes` from `ON CONFLICT … DO UPDATE`
- `getUserExerciseNotes()`: drop `notes` from SELECT and from returned object
- `getUserExerciseNotesBatch()`: drop `notes` from SELECT and from returned map values
- Delete `updateExerciseNotes()` thin wrapper (~line 564) entirely — only used in tests
- Delete `migrateExerciseNotesToUserTable()` (~line 1349) entirely
- The `CREATE TABLE user_exercise_notes` DDL inside `initializeDatabase()`: drop the `notes TEXT` column (line ~469). Existing installs reach the column-removed state via the new `DROP COLUMN` migration; fresh installs never have the column.

#### `src/contexts/AuthContext.tsx`
- Remove the call to `migrateExerciseNotesToUserTable()` after sign-in
- If no other imports remain from `database.ts`, leave the import statement narrowed; otherwise just drop the unused import

#### `src/services/sync.ts`
- Push (line ~141–155): `SELECT exercise_id, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ?` (drop `notes` from SELECT). Drop `notes: n.notes` from the `mappedNotes` object.
- Pull: drop `notes` from the `.select('…')` string for `user_exercise_notes` and from the local upsert SQL.
- Rescue block at the top of `syncToSupabase()` is unchanged — it touches only `user_id`, not `notes`.

#### `src/components/ExerciseDetailModal.tsx`
- Line 34: `useState<ExerciseNotes>({ notes: null, form_notes: null, machine_notes: null })` → `useState<ExerciseNotes>({ form_notes: null, machine_notes: null })`
- Line 50: `const notes = n ?? { notes: null, form_notes: null, machine_notes: null }` → `const notes = n ?? { form_notes: null, machine_notes: null }`

#### `src/screens/WorkoutScreen.tsx`
- Line 146: `const { notes, form_notes, machine_notes, ...exercise } = updated` → `const { form_notes, machine_notes, ...exercise } = updated`

#### `src/screens/ExercisesScreen.tsx`
- Line 84: same destructure narrowing as WorkoutScreen.tsx

### Tests
- `src/services/__tests__/database.test.ts`: delete `describe('updateExerciseNotes', …)` block (~line 155); delete the import of `updateExerciseNotes` (line 25). Any remaining tests that pass `'notes'` as the `field` arg to `upsertExerciseNote` should be deleted (no longer a valid field).
- `src/__tests__/helpers/factories.ts:19`: drop `notes: null` from `createMockExerciseNotes` return literal
- `src/components/__tests__/ExerciseDetailModal.test.tsx` (lines 67, 83): drop `notes: null` from mock return literals fed to `getUserExerciseNotes`
- `src/services/__tests__/sync.test.ts:1152`: drop `notes: null` from `mockNotes` fixture
- `src/services/__tests__/sync.test.ts:1171`: replace `expect(notesInsertCall![0]).toMatch(/ON CONFLICT.*notes=excluded\.notes/s)` with two assertions:
  - `expect(notesInsertCall![0]).toMatch(/ON CONFLICT.*form_notes=excluded\.form_notes/s)` — confirms upsert still includes form_notes
  - `expect(notesInsertCall![0]).not.toMatch(/[\s,(]notes=excluded\.notes/)` — confirms the bare `notes` column is gone. The character class `[\s,(]` ensures we don't match the substring inside `form_notes=excluded.form_notes`.
  - Update the positional param assertions on lines 1172–1174 to match the new column order in the upsert (params shift left by one since `notes` is gone). Implementer should run the test once after changing `database.ts` to confirm new positions.
- `src/screens/__tests__/WorkoutScreen.test.tsx:898`: drop `notes: null` from the `getUserExerciseNotes` mock return (lines 1028 and 1220 in this same file have `notes: null` on `Exercise`-typed literals — those are already stale because `Exercise` has no `notes` field; leave them alone, tsc isn't checking them today).
- `src/__tests__/sync.rescueLocal.test.ts:39`: drop `notes: null` from the `user_exercise_notes` mock fixture (raw object, not type-checked — tsc won't catch this; explicit deletion required).
- `src/contexts/__tests__/AuthContext.test.tsx`: delete the `migrateExerciseNotesToUserTable` mock import (line 26), the mock factory entry (line 38), and the `.toHaveBeenCalledWith` assertions (lines 332, 333, 502). These reference a function being deleted in this spec; tsc won't catch them because they go through `jest.fn()` typed `any`.
- `src/__tests__/authContext.currentUserId.test.tsx:14`: delete the `migrateExerciseNotesToUserTable` mock factory line. Same reason.
- `src/services/__tests__/sync.resilience.test.ts`, `src/services/__tests__/database.resilience.test.ts`, `src/__tests__/database.resolveUserId.test.ts`: grep for any `'notes'` field references or `notes:` keys in test fixtures and remove. These are not expected to be many — most use `'machine_notes'` or `'form_notes'` already.

### MCP server (`/Users/sachitgoyal/code/lift-ai-mcp/`)

#### `src/tools/write/exercises.ts`
- `create_exercise`: drop `notes` from the Zod input schema (line ~27); drop `notes` from the destructure on line 30; drop `notes` from the `if (notes !== undefined …)` branch and from the noteRecord assignment on line ~48. The remaining branch only writes `form_notes`.
- `update_exercise`: same pattern — drop `notes` from input schema (line ~73), from destructure (line ~76), from `hasNoteUpdates` check (line ~88), and from noteRecord assignment (line ~118).
- Update the tool description on line 65 to drop "notes" from the parenthetical list.

#### `src/tools/read/exercises.ts`
- `get_exercise_list` (lines ~25–35): drop `notes` from the `user_exercise_notes` `.select(…)` string and from the returned object literal
- `search_exercises` (lines ~79–89): same as above
- `get_exercise_history` (lines ~146–152, 205): drop `notes` from `.select('notes, form_notes')` → `.select('form_notes')`; drop `exercise_notes: noteData?.notes ?? null` from the response shape; keep `exercise_form_notes`

#### Carve-out (do NOT modify)
- `src/validation/schemas.ts`: `notesSchema` is **kept**. It's reused by `create_upcoming_workout` for `upcoming_workouts.notes` and `upcoming_workout_exercises.notes` — these are out of scope. The `create_exercise` / `update_exercise` tools currently use an inline `z.string().max(2000).nullable().optional()` for their `notes` param (not `notesSchema`), so removing those inline schemas leaves the shared schema untouched.

### Documentation
- `CLAUDE.md` (lift-ai project): Update the database section's prose. Specifically:
  - Line listing "Three note types in user_exercise_notes" → change to "Two note types in user_exercise_notes"
  - Drop `notes` from the field list (`notes` (coach/AI-only, hidden from user))
  - Update CRUD function listing if it mentions `updateExerciseNotes`
  - Remove the line "Coach notes (`notes` field) NOT rendered." in the ExerciseDetailModal section
  - Update the MCP section's note-access rules: "`notes` (coach) and `form_notes` readable/writable via `user_exercise_notes`. `machine_notes` NEVER exposed to MCP." → "`form_notes` readable/writable via `user_exercise_notes`. `machine_notes` NEVER exposed to MCP."
  - Update the gotcha paragraph about three note types and how they're stored
  - Update tool descriptions in the MCP Tools section that mention `notes` parameter on create/update_exercise

## Out of Scope (preserved untouched)

These look related but are unrelated features. Implementer must not touch them:

- `user_exercise_notes.form_notes` — user-visible technique tips, MCP-readable. Survives.
- `user_exercise_notes.machine_notes` — user-visible pin/seat settings, AI-private. Survives.
- `workouts.coach_notes` — workout-level AI plan annotations. Different table, different lifecycle.
- `workouts.exercise_coach_notes` — JSON map of per-exercise AI annotations on a specific workout. Different lifecycle.
- `upcoming_workouts.notes` — coach tips on planned workouts that flow into `coach_notes` at start time.
- `upcoming_workout_exercises.notes` — per-exercise coach tips on planned workouts that flow into `exercise_coach_notes` at start time.
- `workout_sets.notes` — per-set notes column on a different table entirely.
- MCP `create_upcoming_workout` tool — uses `notes` for upcoming-workout coach tips; unchanged.
- MCP `get_workout_detail`, `get_workout_history` — do not join `user_exercise_notes` at all; unchanged.

## Architecture (after the change)

`user_exercise_notes` reduces from `(user_id, exercise_id, notes, form_notes, machine_notes)` to `(user_id, exercise_id, form_notes, machine_notes)`. `exercises` loses its vestigial `notes` column.

```ts
// src/types/database.ts — after
type ExerciseNotes = {
  form_notes: string | null;
  machine_notes: string | null;
};
type ExerciseWithNotes = Exercise & ExerciseNotes;
```

```ts
// src/services/database.ts — after
export const VALID_NOTE_FIELDS = new Set(['form_notes', 'machine_notes'] as const);
export async function upsertExerciseNote(
  exerciseId: string,
  field: 'form_notes' | 'machine_notes',
  value: string | null,
): Promise<void> { … }
```

```ts
// MCP create_exercise — after
{
  name: nameSchema,
  type: exerciseTypeSchema,
  muscle_groups: z.array(muscleGroupSchema).min(1, 'At least one muscle group required'),
  description: descriptionSchema,
  training_goal: trainingGoalSchema.default('hypertrophy'),
  form_notes: formNotesSchema,
}
```

UI is unaffected at the JSX level — `ExerciseDetailModal` and `ExerciseHistoryContent` only render `form_notes` and `machine_notes` today. The change is purely type-narrowing + state-initializer cleanup.

## Deploy ordering (mandatory)

Both the app and the MCP server SELECT `notes` from `user_exercise_notes`. If we drop the Supabase column before either is updated, those reads will throw a PostgreSQL "column does not exist" error. Required order:

1. **Ship app OTA** with all client-side changes: type narrowing, sync no longer SELECTs `notes`. SQLite `DROP COLUMN` migrations land in this same release — they're local-only and safe to run before the Supabase column is dropped.
2. **Wait for OTA adoption** — overnight is enough; Sachit is the sole user. Confirm the new build is running on the device before proceeding.
3. **Deploy MCP server** with cleaned tool schemas (no `notes` parameter on writes, no `notes`/`exercise_notes` field on reads). The new MCP code no longer SELECTs the column, so it's safe regardless of whether Supabase has dropped it yet.
4. **Run Supabase migration** dropping `user_exercise_notes.notes` and `exercises.notes` on dev first, verify, then prod (standard CLAUDE.md pattern: SQL Editor on both projects). Both consumers (app + MCP) have already stopped reading the column, so this is the safe terminal step.

## Migration file

Create `supabase/migrations/014_remove_coach_notes.sql`:

```sql
-- Remove AI-coach scratchpad notes (replaced by external agent knowledge).
-- See docs/superpowers/specs/2026-04-26-remove-mcp-coach-notes-design.md
ALTER TABLE user_exercise_notes DROP COLUMN IF EXISTS notes;
ALTER TABLE exercises DROP COLUMN IF EXISTS notes;
```

`IF EXISTS` makes the SQL idempotent across dev/prod runs.

## Risks & mitigations

- **Risk:** Stale Claude Desktop session has cached MCP tool schemas and tries to call `create_exercise` with `notes`. **Mitigation:** Zod will reject the call cleanly with a clear error; user reloads the MCP client and the new schema is fetched. Acceptable for a personal-use app.
- **Risk:** Supabase column dropped before app OTA reaches user. **Mitigation:** Deploy ordering above is mandatory; prod migration only runs after OTA is confirmed installed.
- **Risk:** Implementer accidentally deletes `notesSchema` from MCP `validation/schemas.ts` thinking it's part of the cleanup. **Mitigation:** Spec explicitly carves it out and explains why.
- **Risk:** Sync test positional parameter assertions (`sync.test.ts:1172–1174`) shift index because `notes` is gone from the column list. **Mitigation:** Spec calls this out; implementer runs the test and updates positions.
- **Risk:** Some other test file or fixture not enumerated above still passes `notes:`. **Mitigation:** TypeScript will catch all of them at compile time once `ExerciseNotes` is narrowed. Plan should include a `tsc --noEmit` pass as a hard gate.

## Verification plan

After implementation, before merging:

1. `npx tsc --noEmit` passes (catches every missed `.notes` reference)
2. `npm test` passes (Jest)
3. `grep -rni "user_exercise_notes" src/` returns no SELECT or INSERT mentioning `notes` (only `form_notes` / `machine_notes`)
4. `grep -rni "\.notes\b" src/services/database.ts src/services/sync.ts` returns no matches related to exercise notes (workout-set `.notes` is unrelated and may match)
5. In the MCP repo: `npx tsc --noEmit` passes; manual MCP tool schema inspection via `mcp__lift-ai__create_exercise` (after deploy) confirms `notes` is no longer an accepted parameter
6. Run the dev Supabase migration; manually `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_exercise_notes';` confirms `notes` is gone
7. Cold-start the app on physical device (after OTA): create a new exercise, edit form_notes and machine_notes, confirm both round-trip correctly
8. End-to-end MCP test: have the agent call `create_exercise` (without `notes`), `update_exercise` (with `form_notes`), `get_exercise_history` — all return clean shapes with no `notes`/`exercise_notes` keys

## Test strategy

This is a pure deletion — no new behavior to test. Existing tests narrow:
- `database.test.ts`: drop `updateExerciseNotes` describe block; other note tests survive
- `sync.test.ts`: regex assertion updated as specified above; param positions shift
- `factories.ts`: factory simplified
- `ExerciseDetailModal.test.tsx`: mocks simplified
- All other tests: TypeScript compilation will surface anything missed

No new tests are required. Code-review (deep, with this spec) is the gate that confirms nothing was missed beyond what TypeScript catches.
