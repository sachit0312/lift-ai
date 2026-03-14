# Global Exercises with User-Scoped Notes

**Date:** 2026-03-14
**Status:** Draft

## Problem

Exercises are fully user-scoped today. Each user has their own copy of every exercise definition (name, type, muscle_groups). This means:
- No canonical exercise library — each user maintains their own
- The MCP coach can't manage a shared exercise catalog
- Adding a second user would duplicate the entire exercise set

## Design

### Core Principle

Exercise **definitions** (name, type, muscle_groups, description, training_goal) are global. Exercise **notes** (notes, form_notes, machine_notes) are per-user. Users can also create **custom exercises** that are private to them.

### Data Model

#### `exercises` table (modified)

`user_id` becomes **nullable**:
- `NULL` = global canonical exercise (managed by admin MCP key)
- `<uuid>` = user's custom/private exercise

**Columns removed:** `notes`, `form_notes`, `machine_notes` (moved to `user_exercise_notes`)

**Columns retained:** `id`, `user_id` (nullable), `name`, `type`, `muscle_groups`, `training_goal`, `description`, `created_at`

#### `user_exercise_notes` table (new)

```sql
CREATE TABLE user_exercise_notes (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  notes       TEXT,          -- coach/AI-only (hidden from user UI)
  form_notes  TEXT,          -- technique tips (synced with MCP)
  machine_notes TEXT,        -- machine settings (private from AI)
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, exercise_id)
);
```

#### RLS Policies

**`exercises` table:**
- SELECT: `user_id IS NULL OR user_id = auth.uid()` — everyone reads global, users read own custom
- INSERT: `user_id = auth.uid()` — users can only create custom exercises (user_id must be theirs)
- UPDATE: `user_id = auth.uid()` — users can only edit their own custom exercises
- DELETE: `user_id = auth.uid()` — users can only delete their own custom exercises
- Global exercises (`user_id IS NULL`): only modifiable via service role key (admin MCP)

**`user_exercise_notes` table:**
- ALL operations: `user_id = auth.uid()` — full CRUD on own notes only

### MCP Access Model

#### Regular User JWT (existing behavior, adapted)
- **Read:** Global exercises + own custom exercises + own notes
- **Write exercises:** Create/edit own custom exercises only
- **Write notes:** Own `notes` and `form_notes` on any visible exercise (global or custom) via `user_exercise_notes`
- **Never:** `machine_notes` (unchanged — still private from AI)

#### Admin MCP Key (new)
- **Authentication:** Service role key (already exists in MCP `.env`)
- **Detection:** New env var `MCP_ADMIN_MODE=true` or a dedicated admin endpoint
- **Permissions:** Create + edit global exercise **definitions only** (name, type, muscle_groups, description, training_goal). No delete. No notes — admin does not set notes.
- **Scope:** Only exercise definitions. Cannot touch `user_exercise_notes`, templates, workouts, etc.

### Migration Strategy

Since there's only one user today, the migration is straightforward:

#### Supabase Migration (`011_global_exercises.sql`)

```sql
-- 1. Create user_exercise_notes table
CREATE TABLE user_exercise_notes (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  notes       TEXT,
  form_notes  TEXT,
  machine_notes TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, exercise_id)
);

ALTER TABLE user_exercise_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exercise notes"
  ON user_exercise_notes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2. Migrate existing notes from exercises to user_exercise_notes
INSERT INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
SELECT user_id, id, notes, form_notes, machine_notes
FROM exercises
WHERE notes IS NOT NULL OR form_notes IS NOT NULL OR machine_notes IS NOT NULL;

-- 3. Drop note columns from exercises
ALTER TABLE exercises DROP COLUMN notes;
ALTER TABLE exercises DROP COLUMN form_notes;
ALTER TABLE exercises DROP COLUMN machine_notes;

-- 4. Make user_id nullable (global exercises have NULL user_id)
ALTER TABLE exercises ALTER COLUMN user_id DROP NOT NULL;

-- 5. Nullify user_id on existing exercises to make them global
UPDATE exercises SET user_id = NULL;

-- 6. Update RLS policies
DROP POLICY "Users manage own exercises" ON exercises;

CREATE POLICY "Read global and own exercises"
  ON exercises FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Create own custom exercises"
  ON exercises FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Update own custom exercises"
  ON exercises FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Delete own custom exercises"
  ON exercises FOR DELETE
  USING (user_id = auth.uid());
```

#### SQLite Migration (in `database.ts` `initializeDatabase()`)

```sql
-- New table
CREATE TABLE IF NOT EXISTS user_exercise_notes (
  user_id     TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  notes       TEXT,
  form_notes  TEXT,
  machine_notes TEXT,
  PRIMARY KEY (user_id, exercise_id)
);

-- Migrate existing notes (user_id comes from auth session)
INSERT INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
SELECT '<current_user_id>', id, notes, form_notes, machine_notes
FROM exercises
WHERE notes IS NOT NULL OR form_notes IS NOT NULL OR machine_notes IS NOT NULL;

-- Note: SQLite doesn't support DROP COLUMN easily.
-- Leave columns on exercises table but stop reading/writing them.
-- They become dead columns (harmless).
```

### Changes by Layer

#### 1. Types (`src/types/database.ts`)

**`Exercise` interface** — remove `notes`, `form_notes`, `machine_notes` fields.

**New `UserExerciseNotes` interface:**
```typescript
export interface UserExerciseNotes {
  user_id: string;
  exercise_id: string;
  notes: string | null;
  form_notes: string | null;
  machine_notes: string | null;
}
```

**New `ExerciseWithNotes` type** (convenience for UI):
```typescript
export type ExerciseWithNotes = Exercise & {
  notes: string | null;
  form_notes: string | null;
  machine_notes: string | null;
};
```

#### 2. Database Service (`src/services/database.ts`)

**Row interfaces:** Remove note fields from `ExerciseRow`. Add `UserExerciseNotesRow`.

**Parsing functions:** `parseExercise()`, `parseExerciseFromJoin()`, `parseExerciseFromTemplateJoin()` — stop mapping note columns from exercise rows.

**New functions:**
- `getUserExerciseNotes(userId: string, exerciseId: string): Promise<UserExerciseNotes | null>` — single exercise
- `getBulkUserExerciseNotes(userId: string, exerciseIds: string[]): Promise<Map<string, UserExerciseNotes>>` — batch
- `upsertUserExerciseNotes(userId: string, exerciseId: string, field: 'notes' | 'form_notes' | 'machine_notes', value: string | null): Promise<void>` — replaces `updateExerciseNotes()`, `updateExerciseFormNotes()`, `updateExerciseMachineNotes()`

**Modified functions:**
- `createExercise()` — remove `notes` param. If creating a custom exercise, set `user_id`. If notes needed at creation time, follow with `upsertUserExerciseNotes()`.
- `updateExercise()` — stop writing note columns
- Remove: `updateExerciseNotes()`, `updateExerciseFormNotes()`, `updateExerciseMachineNotes()` (replaced by `upsertUserExerciseNotes()`)

**Join queries** (for templates, workout history): Join `user_exercise_notes` to get notes alongside exercise data where needed.

#### 3. Sync Service (`src/services/sync.ts`)

**Push (`syncToSupabase()`):**
- Exercise push: stop including note columns. Add `user_id` only for custom exercises (where `user_id IS NOT NULL` locally).
- New: push `user_exercise_notes` table separately. Upsert on `(user_id, exercise_id)`.

**Pull (`pullExercises()` → rename to `pullExercisesAndNotes()`):**
- Pull exercises: fetch where `user_id IS NULL OR user_id = eq(session.user.id)`. No note columns.
- Pull notes: fetch `user_exercise_notes` where `user_id = session.user.id`. Upsert into local SQLite.

**Important:** Global exercises are read-only from the app's perspective (no push). Only custom exercises push.

#### 4. Notes Debounce Hook (`src/hooks/useNotesDebounce.ts`)

- Replace `updateExerciseMachineNotes(exerciseId, value)` calls with `upsertUserExerciseNotes(userId, exerciseId, 'machine_notes', value)`.
- Need to pass `userId` into the hook (from auth context or prop).

#### 5. ExerciseDetailModal (`src/components/ExerciseDetailModal.tsx`)

- Props: receive `ExerciseWithNotes` instead of `Exercise` (or load notes separately).
- Replace `updateExerciseFormNotes()` / `updateExerciseMachineNotes()` calls with `upsertUserExerciseNotes()`.
- UI unchanged — same form_notes and machine_notes fields.

#### 6. ExercisesScreen (`src/screens/ExercisesScreen.tsx`)

- Exercise list: loads all exercises (global + custom). No note columns.
- When opening ExerciseDetailModal: fetch notes for that exercise via `getUserExerciseNotes()`.
- Edit modal: unchanged (only edits name/type/muscles, which are definition-level).
- **New distinction in UI (optional/future):** Could show a badge for "custom" exercises, but not required now.

#### 7. WorkoutScreen (`src/screens/WorkoutScreen.tsx`)

- `ExerciseBlock` type: notes become optional/loaded separately.
- `handleExerciseUpdated()`: update notes in the notes data structure, not on the exercise itself.
- `useExerciseBlocks`: when building blocks, load notes for each exercise via `getBulkUserExerciseNotes()`.

#### 8. MCP Server (`/Users/sachitgoyal/code/lift-ai-mcp/`)

**Read tools:**
- `get_exercise_list`: join `user_exercise_notes` to include `notes`, `form_notes` (never `machine_notes`). Show global + user's custom exercises.
- `search_exercises`: same join.
- `get_exercise_history`: same join for exercise-level notes.

**Write tools:**
- `create_exercise`:
  - Regular user: creates custom exercise (`user_id` = their ID). Optionally writes notes to `user_exercise_notes`.
  - Admin: creates global exercise (`user_id` = NULL). Can set `notes`/`form_notes` on the exercise-level (admin notes are global? or per-admin?).
- `update_exercise`:
  - Regular user: can only update own custom exercises (definition). Can update own notes on any exercise via `user_exercise_notes`.
  - Admin: can update global exercise definitions. Cannot touch user notes.
- `assertExerciseOwnership()`: adapt to handle `user_id IS NULL` (global) — reject regular user edits to global exercises.

**New MCP tool (optional):**
- `update_exercise_notes`: Dedicated tool for regular user MCP to write `notes`/`form_notes` to `user_exercise_notes` for a given exercise (regardless of whether it's global or custom). Cleaner separation from `update_exercise`.

**Admin detection:**
- Check for `MCP_ADMIN_MODE=true` env var, or check if auth is via service role key.
- When admin: `create_exercise` and `update_exercise` operate on global rows (`user_id = NULL`). Skip ownership check. Admin cannot set notes — definitions only.

### What Doesn't Change

- **Templates:** Reference `exercise_id` — no change needed. Templates don't store notes.
- **Workouts / workout_sets:** Reference exercises by ID — no change.
- **Upcoming workouts:** Per-exercise `notes` field on `upcoming_workout_exercises` is coach-generated tips, not exercise notes. Unaffected.
- **Live Activity / Widget:** No exercise note awareness.
- **1RM engine:** No exercise note awareness.
- **Exercise search/filter:** Operates on definition fields (name, type, muscle_groups). Unaffected.

### Implementation Order

1. **Supabase migration** — run on both dev and prod
2. **SQLite migration** — new table + stop writing note columns on exercises
3. **Types** — new interfaces
4. **Database service** — new note functions, modify exercise functions
5. **Sync service** — split exercise and notes sync
6. **Hooks** — update useNotesDebounce
7. **Components** — ExerciseDetailModal, ExercisesScreen, WorkoutScreen
8. **MCP server** — read/write tools, admin mode
9. **Verify** — type-check, unit tests, manual test on device

### Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Notes lost during migration | Migration copies notes before dropping columns. Single user = easy to verify. |
| SQLite can't DROP COLUMN | Leave dead columns. Stop reading/writing them. Harmless. |
| Join performance for notes | `user_exercise_notes` PK is `(user_id, exercise_id)` — lookups are O(1). Batch function for bulk loads. |
| MCP admin accidentally modifying user data | Admin mode only touches `exercises` table definition fields. RLS + code guards. |
| Sync race between exercise pull and notes pull | Pull exercises first, then notes. Notes reference exercise IDs that must exist. |

### Resolved Decisions

1. **No admin notes.** Admin MCP only manages exercise definitions. All notes (notes, form_notes, machine_notes) live exclusively in `user_exercise_notes`. Notes start empty for each user until they or their MCP coach populate them. No fallback/default notes on the `exercises` table.

2. **No global exercise deletion.** Global exercises can be created and edited, never deleted. Avoids cascading impact on templates and workout history.

3. **Custom exercise visibility in templates.** Templates are user-scoped, so a user's custom exercises in their templates is fine. No cross-user concern.
