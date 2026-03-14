# Exercise Notes Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split exercise notes into three types (form_notes, machine_notes, coach notes) with different visibility/access rules, and create a unified Exercise Detail Modal.

**Architecture:** Two new nullable TEXT columns on exercises table. New ExerciseDetailModal component replaces ExerciseHistoryModal as the primary entry point when tapping an exercise. Workout inline notes repurposed for machine_notes. MCP tools updated to expose form_notes but not machine_notes.

**Tech Stack:** React Native (Expo), SQLite (expo-sqlite), Supabase, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-exercise-notes-redesign.md`

---

## Chunk 1: Database & Types Foundation

### Task 1: Add form_notes and machine_notes columns to SQLite + types

**Files:**
- Create: `supabase/migrations/010_exercise_note_types.sql` (next available number after 009)
- Modify: `src/types/database.ts:5-15`
- Modify: `src/services/database.ts` (initSchema, parseExercise, parseExerciseFromJoin, parseExerciseFromTemplateJoin, updateExerciseNotes)

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/010_exercise_note_types.sql
ALTER TABLE exercises ADD COLUMN form_notes TEXT DEFAULT NULL;
ALTER TABLE exercises ADD COLUMN machine_notes TEXT DEFAULT NULL;
```

- [ ] **Step 2: Update Exercise interface in types**

In `src/types/database.ts`, add to the `Exercise` interface after the `notes` field:

```typescript
  form_notes: string | null;
  machine_notes: string | null;
```

- [ ] **Step 3: Update SQLite schema in database.ts**

In `src/services/database.ts`, find the `initSchema` function's exercises CREATE TABLE and add the two columns. Then add ALTER TABLE migrations (same pattern as existing migration blocks that add columns):

```typescript
// After existing ALTER TABLE for notes
try {
  await db.execAsync(`ALTER TABLE exercises ADD COLUMN form_notes TEXT`);
} catch {}
try {
  await db.execAsync(`ALTER TABLE exercises ADD COLUMN machine_notes TEXT`);
} catch {}
```

- [ ] **Step 4: Update parseExercise row mapper**

In `src/services/database.ts`, find `parseExercise()` (~line 171). Add to the returned object:

```typescript
form_notes: row.form_notes ?? null,
machine_notes: row.machine_notes ?? null,
```

- [ ] **Step 5: Update parseExerciseFromJoin row mapper**

Find `parseExerciseFromJoin()` (~line 192). Add:

```typescript
form_notes: row.e_form_notes ?? null,
machine_notes: row.e_machine_notes ?? null,
```

- [ ] **Step 6: Update parseExerciseFromTemplateJoin row mapper**

Find `parseExerciseFromTemplateJoin()` (~line 215). Add:

```typescript
form_notes: row.exercise_form_notes ?? null,
machine_notes: row.exercise_machine_notes ?? null,
```

- [ ] **Step 7: Update SQL SELECT statements that join exercises**

Search for all SQL queries that select exercise columns with `e_` or `exercise_` prefixes. Add `form_notes` and `machine_notes` to those SELECTs with matching prefix aliases. Key queries:
- `getWorkoutSets()` — uses `e_` prefix
- `getTemplateExercises()` — uses `exercise_` prefix
- Any other joins that select exercise fields

- [ ] **Step 8: Add updateExerciseFormNotes and updateExerciseMachineNotes functions**

After existing `updateExerciseNotes()` (~line 426):

```typescript
export async function updateExerciseFormNotes(exerciseId: string, formNotes: string | null): Promise<void> {
  try {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE exercises SET form_notes = ? WHERE id = ?`,
      [formNotes, exerciseId]
    );
  } catch (error) {
    Sentry.captureException(error);
  }
}

export async function updateExerciseMachineNotes(exerciseId: string, machineNotes: string | null): Promise<void> {
  try {
    const db = getDatabase();
    await db.runAsync(
      `UPDATE exercises SET machine_notes = ? WHERE id = ?`,
      [machineNotes, exerciseId]
    );
  } catch (error) {
    Sentry.captureException(error);
  }
}
```

- [ ] **Step 9: Update getAllExercises SELECT**

Find `getAllExercises()` and ensure the SELECT includes `form_notes, machine_notes`.

- [ ] **Step 10: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/010_exercise_note_types.sql src/types/database.ts src/services/database.ts
git commit -m "feat: add form_notes and machine_notes columns to exercises"
```

---

### Task 2: Update sync layer for new columns

**Files:**
- Modify: `src/services/sync.ts` (push exercises, pull exercises)

- [ ] **Step 1: Update exercise push**

In `syncToSupabase()` (~line 85), find the exercise SELECT query. Add `form_notes, machine_notes` to the SELECT columns and include them in the upsert data object.

- [ ] **Step 2: Update exercise pull**

In `pullExercisesAndTemplates()` or `pullExercises()`, find where exercises are fetched from Supabase. Add `form_notes, machine_notes` to the `.select()` call. In the SQLite upsert, add `form_notes, machine_notes` to both INSERT columns and ON CONFLICT UPDATE.

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/sync.ts
git commit -m "feat: sync form_notes and machine_notes to Supabase"
```

---

## Chunk 2: Workout Screen — Machine Notes Inline

### Task 3: Rename notes → machineNotes in ExerciseBlock and hooks

**Files:**
- Modify: `src/hooks/useExerciseBlocks.ts`
- Modify: `src/hooks/useNotesDebounce.ts`
- Modify: `src/components/ExerciseBlockItem.tsx`

- [ ] **Step 1: Update ExerciseBlock type**

Find `ExerciseBlock` in `src/types/workout.ts` (or wherever it's defined). Rename:
- `notes: string` → `machineNotes: string`
- `notesExpanded: boolean` → `machineNotesExpanded: boolean`

- [ ] **Step 2: Update useExerciseBlocks initialization**

Find where ExerciseBlock objects are created (in `useWorkoutLifecycle` or `useExerciseBlocks`). Change:
- `notes: exercise.notes ?? ''` → `machineNotes: exercise.machine_notes ?? ''`
- `notesExpanded: false` → `machineNotesExpanded: false`

- [ ] **Step 3: Rename handlers in useExerciseBlocks**

- `handleNotesChange` → `handleMachineNotesChange`
- `handleToggleNotes` → `handleToggleMachineNotes`

Update the handler bodies:
- `handleMachineNotesChange`: update `machineNotes` field, call debounced save for `machine_notes`
- `handleToggleMachineNotes`: toggle `machineNotesExpanded`

- [ ] **Step 4: Update useNotesDebounce to save machine_notes**

In `useNotesDebounce.ts`, change the `updateExerciseNotes(exerciseId, notes)` call to `updateExerciseMachineNotes(exerciseId, notes)`.

Remove the set-level notes save (first set notes write) — machine notes are exercise-level only, not duplicated to workout_sets.

- [ ] **Step 5: Update ExerciseBlockItem props and rendering**

In `ExerciseBlockItem.tsx`:
- Update props: `onNotesChange` → `onMachineNotesChange`, `onToggleNotes` → `onToggleMachineNotes`
- Update notes section (~lines 307-361):
  - Button label: "Notes" → "Settings" (or keep icon-only with gear)
  - Conditional: `block.notesExpanded` → `block.machineNotesExpanded`
  - TextInput value: `block.notes` → `block.machineNotes`
  - Placeholder: `"Exercise notes..."` → `"Machine settings, seat position, attachments..."`
  - Label text above input: add "Machine Settings"
  - TestID: `exercise-notes-${blockIdx}` → `machine-notes-${blockIdx}`

- [ ] **Step 6: Update WorkoutScreen prop passing**

In `WorkoutScreen.tsx`, update the ExerciseBlockItem props:
- `onNotesChange` → `onMachineNotesChange`
- `onToggleNotes` → `onToggleMachineNotes`

Connect to the renamed handlers from useExerciseBlocks.

- [ ] **Step 7: Run type-check and tests**

Run: `npx tsc --noEmit && npm test`
Expected: Pass (update test mocks if needed for renamed fields).

- [ ] **Step 8: Commit**

```bash
git add src/types/workout.ts src/hooks/useExerciseBlocks.ts src/hooks/useNotesDebounce.ts src/components/ExerciseBlockItem.tsx src/screens/WorkoutScreen.tsx
git commit -m "feat: rename workout inline notes to machine notes"
```

---

## Chunk 3: Exercise Detail Modal

### Task 4: Create ExerciseDetailModal component

**Files:**
- Create: `src/components/ExerciseDetailModal.tsx`
- Modify: `src/services/database.ts` (add getRecentExerciseHistory)

- [ ] **Step 1: Add getRecentExerciseHistory to database.ts**

```typescript
export async function getRecentExerciseHistory(exerciseId: string, limit: number = 3): Promise<Array<{
  workout_name: string;
  workout_date: string;
  set_count: number;
  best_weight: number;
  best_reps: number;
  best_rpe: number | null;
}>> {
  try {
    const db = getDatabase();
    // Query recent workouts containing this exercise, with summary stats
    const rows = await db.getAllAsync(`
      SELECT
        w.template_name as workout_name,
        w.date as workout_date,
        COUNT(ws.id) as set_count,
        MAX(ws.weight) as best_weight,
        MAX(ws.reps) as best_reps,
        MAX(ws.rpe) as best_rpe
      FROM workout_sets ws
      JOIN workouts w ON ws.workout_id = w.id
      WHERE ws.exercise_id = ? AND ws.is_completed = 1
      GROUP BY w.id
      ORDER BY w.date DESC
      LIMIT ?
    `, [exerciseId, limit]);
    return rows as any;
  } catch (error) {
    Sentry.captureException(error);
    return [];
  }
}
```

- [ ] **Step 2: Create ExerciseDetailModal**

Create `src/components/ExerciseDetailModal.tsx`:

```typescript
interface ExerciseDetailModalProps {
  visible: boolean;
  exercise: Exercise | null;
  onClose: () => void;
  onExerciseUpdated?: () => void; // callback to refresh parent data
}
```

**Layout (single scrollable page):**
1. Modal wrapper (react-native Modal, slide presentation)
2. Header: exercise name, type badge (use `exerciseTypeColor`), muscle groups, "Edit" button, close "X"
3. e1RM banner: call `getBestE1RM(exerciseId)` from `src/services/database.ts` — show all-time best. This function already exists.
4. Form Notes section: editable TextInput, "Synced with coach" badge, 500ms debounce save to `updateExerciseFormNotes()`
5. Machine Settings section: editable TextInput, "Private" badge (means "not visible to AI coach"), 500ms debounce save to `updateExerciseMachineNotes()`
6. Recent History: call `getRecentExerciseHistory(exerciseId, 3)`, render last 3 workouts as compact rows. "See all" button.
7. **Nested ExerciseHistoryModal**: State `historyModalVisible` (boolean). "See all" sets it to true. Renders `<ExerciseHistoryModal visible={historyModalVisible} exercise={exercise} onClose={() => setHistoryModalVisible(false)} />` inside ExerciseDetailModal.

**Important:** Coach notes (`exercises.notes`) are NOT rendered anywhere in this modal — they are AI-only.

**Debounce pattern for form/machine notes in modal:**
- Use local state for each textarea (`formNotesText`, `machineNotesText`)
- `useRef` for debounce timers (one per field)
- On text change: update local state + schedule 500ms debounced DB write
- `useEffect` cleanup on unmount: clear timers and flush pending writes (call the DB update functions directly for any dirty fields)
- Fire-and-forget `syncToSupabase()` after each save
- Call `onExerciseUpdated?.()` after saves so parent can refresh

**Edit button:** Opens the same edit modal pattern from ExercisesScreen (name, type chips, muscle groups). No notes fields in edit modal.

- [ ] **Step 3: Style the modal**

Use theme tokens from `src/theme/tokens.ts`. Match the mockup:
- Dark background (#13132a or `colors.surface`)
- Section dividers
- Note badges: purple for "Synced with coach", amber for "Private"
- Type badge colors from `exerciseTypeColor()`
- History rows: compact cards with date, set count, best set summary

- [ ] **Step 4: Run type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ExerciseDetailModal.tsx src/services/database.ts
git commit -m "feat: create ExerciseDetailModal with form notes, machine notes, and history"
```

---

### Task 5: Wire ExerciseDetailModal into Exercises screen

**Files:**
- Modify: `src/screens/ExercisesScreen.tsx`

- [ ] **Step 1: Replace ExerciseHistoryModal with ExerciseDetailModal**

In `ExercisesScreen.tsx`:
- Import `ExerciseDetailModal` instead of `ExerciseHistoryModal`
- Replace the modal component (~line 174-178):

```typescript
<ExerciseDetailModal
  visible={!!selectedExercise}
  exercise={selectedExercise}
  onClose={() => setSelectedExercise(null)}
  onExerciseUpdated={loadExercises}
/>
```

- [ ] **Step 2: Remove notes field from edit modal**

In the long-press edit modal (~lines 240-248), remove the notes TextInput and `editNotes` state. Coach notes (`exercises.notes`) are now hidden from the user. Form notes and machine notes are edited via ExerciseDetailModal.

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/screens/ExercisesScreen.tsx
git commit -m "feat: use ExerciseDetailModal in Exercises tab"
```

---

### Task 6: Wire ExerciseDetailModal into Workout screen

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx`
- Modify: `src/hooks/useWorkoutLifecycle.ts` (if history modal state lives here)

- [ ] **Step 1: Replace ExerciseHistoryModal with ExerciseDetailModal**

In `WorkoutScreen.tsx`:
- Import `ExerciseDetailModal`
- Replace the ExerciseHistoryModal usage (~line 174-178):

```typescript
<ExerciseDetailModal
  visible={!!lifecycle.historyExercise}
  exercise={lifecycle.historyExercise}
  onClose={lifecycle.handleCloseHistoryModal}
  onExerciseUpdated={() => {
    // Refresh exercise data in blocks if form/machine notes changed
  }}
/>
```

- [ ] **Step 2: Handle onExerciseUpdated callback**

When a user edits machine notes in the ExerciseDetailModal during a workout, the inline machine notes in the ExerciseBlock should update. In WorkoutScreen, implement `onExerciseUpdated`:
- Get the exercise ID from `lifecycle.historyExercise`
- Re-fetch the exercise from SQLite via `getExerciseById(exerciseId)`
- Find the matching ExerciseBlock by exercise ID (not index — blocks may have reordered)
- Update the block's `exercise` field and `machineNotes` field with fresh data
- This ensures the inline machine notes textarea reflects any edits made in the modal

- [ ] **Step 3: Run type-check and tests**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 4: Commit**

```bash
git add src/screens/WorkoutScreen.tsx src/hooks/useWorkoutLifecycle.ts
git commit -m "feat: use ExerciseDetailModal in Workout screen"
```

---

## Chunk 4: History Screen + Tests + Cleanup

### Task 7: Wire ExerciseDetailModal into History screen

**Files:**
- Modify: `src/screens/HistoryScreen.tsx`

- [ ] **Step 1: Replace ExerciseHistoryModal with ExerciseDetailModal**

Same pattern as Exercises and Workout screens. Find where exercise name tap opens ExerciseHistoryModal and replace with ExerciseDetailModal.

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/screens/HistoryScreen.tsx
git commit -m "feat: use ExerciseDetailModal in History screen"
```

---

### Task 8: Update tests

**Files:**
- Modify: test files that reference `notes`/`notesExpanded` on ExerciseBlock
- Modify: `src/__tests__/helpers/` (test factories)

- [ ] **Step 1: Update test factories**

In `src/__tests__/helpers/`, find `createMockExercise` and add:
```typescript
form_notes: null,
machine_notes: null,
```

Find any ExerciseBlock mock factories and rename `notes` → `machineNotes`, `notesExpanded` → `machineNotesExpanded`.

- [ ] **Step 2: Update existing tests**

Search for `notesExpanded`, `handleNotesChange`, `handleToggleNotes`, `exercise-notes-` in test files and update to new names (`machineNotesExpanded`, `handleMachineNotesChange`, `handleToggleMachineNotes`, `machine-notes-`). Also update CLAUDE.md TestID reference from `exercise-notes-{blockIdx}` to `machine-notes-{blockIdx}`.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/ src/__mocks__/
git commit -m "test: update tests for notes redesign"
```

---

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture section**

Update these specific CLAUDE.md sections:
- **Database** section: Add `form_notes` and `machine_notes` to exercises table description. Note that `notes` is AI-only (hidden from user).
- **Types** section: Update Exercise type to show all three note fields.
- **Hooks** section: Rename `useNotesDebounce` references to reflect machine_notes. Update `useExerciseBlocks` field names.
- **WorkoutScreen** section: Change "Exercise notes" bullet to "Machine notes" with new behavior. Add ExerciseDetailModal description.
- **ExercisesScreen** section: Tap → ExerciseDetailModal (replaces ExerciseHistoryModal as primary entry).
- **ExerciseDetailModal** (new section): Shared component, single scrollable page, form notes + machine notes + history preview, nested ExerciseHistoryModal via "See all".
- **MCP** section: Add form_notes to tool descriptions. Note machine_notes excluded.
- **E2E Testing** TestIDs: `exercise-notes-{blockIdx}` → `machine-notes-{blockIdx}`
- **Gotchas**: Update exercise notes persistence note to distinguish machine notes (workout inline) from form notes (modal only).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for notes redesign"
```

---

### Task 10: Apply Supabase migrations

- [ ] **Step 1: Apply migration to dev Supabase**

Go to Supabase dashboard for dev project (`gcpnqpqqwcwvyzoivolp`), open SQL Editor, run:

```sql
ALTER TABLE exercises ADD COLUMN form_notes TEXT DEFAULT NULL;
ALTER TABLE exercises ADD COLUMN machine_notes TEXT DEFAULT NULL;
```

- [ ] **Step 2: Test with dev build**

Verify sync works — exercise form_notes and machine_notes round-trip through Supabase.

- [ ] **Step 3: Apply migration to prod Supabase**

Same SQL on prod project (`lgnkxjiqzsqiwrqrsxww`).

---

## Deferred: MCP Changes (separate repo)

MCP server changes are in `/Users/sachitgoyal/code/lift-ai-mcp/` and should be done in a separate session:
- `get_exercise_list`, `search_exercises`, `get_exercise_history`: add `form_notes` to response
- `create_exercise`, `update_exercise`: accept `form_notes` parameter
- Do NOT expose `machine_notes` in any MCP tool
