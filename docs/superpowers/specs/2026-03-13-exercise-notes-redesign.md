# Exercise Notes Redesign

## Summary

Split the single `exercises.notes` field into three distinct note types per exercise, each with different visibility and access rules.

## Note Types

| Note | DB Column | User Can Edit | MCP Can Edit | Synced to Supabase | Shown In |
|------|-----------|---------------|--------------|-------------------|----------|
| **Form Notes** | `form_notes` | Exercise detail modal | Yes (read/write) | Yes | Exercise detail modal |
| **Machine Notes** | `machine_notes` | Exercise detail modal + workout inline | No (not exposed to MCP) | Yes (cross-device) | Workout screen (toggle below sets), exercise detail modal |
| **Coach Notes** | `notes` (existing) | No (hidden from user) | Yes (read/write) | Yes | Not shown in UI — AI-only |

- Coach tips (from `upcoming_workout_exercises.notes`) remain unchanged — purple collapsible in workout only.
- "Private" badge on machine notes means "not visible to AI coach" — it still syncs for cross-device use.

## Database Changes

### SQLite (`src/services/database.ts`)

Add two columns to `exercises` table:
```sql
ALTER TABLE exercises ADD COLUMN form_notes TEXT DEFAULT NULL;
ALTER TABLE exercises ADD COLUMN machine_notes TEXT DEFAULT NULL;
```

### Supabase Migration

Migration file: `supabase/migrations/011_exercise_note_types.sql`

**Execution steps (per CLAUDE.md):**
1. Create migration file in repo
2. Apply to dev (`gcpnqpqqwcwvyzoivolp`) via Supabase SQL Editor
3. Test with dev build
4. Apply to prod (`lgnkxjiqzsqiwrqrsxww`) via Supabase SQL Editor
5. Deploy code

### Data Migration

No data migration needed. Existing `exercises.notes` stays as-is (coach/AI field). `form_notes` and `machine_notes` start as NULL.

## UI Changes

### 1. Exercise Detail Modal (new shared component)

`src/components/ExerciseDetailModal.tsx`

**New entry point** that replaces:
- Tap exercise in Exercises tab (currently opens ExerciseHistoryModal)
- Tap exercise name in Workout screen (currently no action / opens history modal in some places)

**ExerciseHistoryModal still exists** — accessed via "See all" button inside this modal.

**Triggered by**: Tapping exercise name in Exercises tab, Workout screen, or History screen.

**Single scrollable page layout:**
- Header: exercise name, type badge, muscle groups, "Edit" button
- e1RM banner (all-time best)
- Form Notes section (editable textarea, "Synced with coach" badge)
- Machine Settings section (editable textarea, "Private" badge)
- Recent History: last 3 workout sessions for this exercise (compact: date, set count, best set). "See all" button opens ExerciseHistoryModal (full charts, PR banner, plateau detection).

**Edit button** opens existing edit modal (name, type chips, muscle group chips) — same as current long-press behavior. Form notes field NOT in the edit modal (it's already editable in the detail modal).

### 2. Workout Screen — Machine Notes Inline

**Replaces**: Current notes toggle (which showed `exercises.notes`).

- Same toggle button position in exercise block header.
- When expanded, shows editable textarea **below sets** (same position as current notes).
- Label: "Machine Settings"
- Debounced save (500ms) to `exercises.machine_notes`, same pattern as current notes debounce.
- Fire-and-forget sync to Supabase after debounced save.

### 3. Exercises Screen

**Tap** exercise: opens Exercise Detail Modal (replaces current ExerciseHistoryModal).

**Long-press**: opens Edit modal (name, type, muscle groups) — unchanged.

## Sync Changes (`src/services/sync.ts`)

### Push
- Include `form_notes` and `machine_notes` in exercise upsert to Supabase.
- Same fire-and-forget pattern as current `notes`.
- Sync failures logged to Sentry, no user-visible error.

### Pull
- Pull `form_notes` and `machine_notes` from Supabase, upsert with last-write-wins (same as current `notes`).

## MCP Changes (separate repo: `/Users/sachitgoyal/code/lift-ai-mcp/`)

### Tools that read exercises
`get_exercise_list`, `search_exercises`, `get_exercise_history`: Return `notes` (coach) and `form_notes`. Do NOT return `machine_notes`.

### Tools that write exercises
- `create_exercise`: Accept optional `form_notes` and `notes` parameters. No `machine_notes`.
- `update_exercise`: Accept `form_notes` and `notes`. No `machine_notes`.

## Type Changes (`src/types/database.ts`)

```typescript
interface Exercise {
  // ... existing fields
  notes: string | null;          // coach/AI notes (hidden from user)
  form_notes: string | null;     // form/technique tips
  machine_notes: string | null;  // machine settings (user-only)
}
```

## Hook Changes

### `useNotesDebounce`
The current debounce saves to `exercises.notes` — change to save to `exercises.machine_notes` for the workout inline toggle. Form notes saves happen in the Exercise Detail Modal (separate debounce, not through this hook).

### `useExerciseBlocks`
- `ExerciseBlock.notes` → `ExerciseBlock.machineNotes` (what's shown inline in workout)
- `ExerciseBlock.notesExpanded` → `ExerciseBlock.machineNotesExpanded`
- `handleNotesChange` → `handleMachineNotesChange`
- `handleToggleNotes` → `handleToggleMachineNotes`

### `ExerciseBlockItem`
- Notes section renders `machineNotes` with "Machine Settings" label.
- Tap exercise name opens Exercise Detail Modal.

## What Stays the Same

- Coach tips from upcoming workouts (purple collapsible section) — workout screen only, not in Exercise Detail Modal.
- Session notes (free-form workout-level notes) — unchanged.
- Set-level `workout_sets.notes` column — unchanged.
- `exercises.notes` column and all existing data — unchanged, just hidden from user UI.
- ExerciseHistoryModal — still exists, accessed via "See all" in Exercise Detail Modal.

## Files to Create/Modify

**New files:**
- `src/components/ExerciseDetailModal.tsx` — shared exercise detail modal
- `supabase/migrations/011_exercise_note_types.sql` — migration

**Modified files:**
- `src/types/database.ts` — add `form_notes`, `machine_notes` to Exercise
- `src/services/database.ts` — add columns to CREATE TABLE, add update functions, update row mapper
- `src/services/sync.ts` — include new columns in push/pull
- `src/hooks/useExerciseBlocks.ts` — rename notes → machineNotes
- `src/hooks/useNotesDebounce.ts` — save to machine_notes instead of notes
- `src/components/ExerciseBlockItem.tsx` — machine notes UI, tap → modal
- `src/screens/ExercisesScreen.tsx` — tap opens ExerciseDetailModal
- `src/screens/WorkoutScreen.tsx` — wire up ExerciseDetailModal
- MCP server tools (separate repo, deferred)
