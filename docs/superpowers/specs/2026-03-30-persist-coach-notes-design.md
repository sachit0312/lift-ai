# Persist AI Coach Notes in Workout History

**Date:** 2026-03-30
**Status:** Approved

## Problem

When the MCP AI coach creates an upcoming workout via `create_upcoming_workout`, it writes:
- Workout-level notes (`upcoming_workouts.notes`) — overall coaching rationale
- Per-exercise notes (`upcoming_workout_exercises.notes`) — exercise-specific tips

These notes are shown during the workout (idle screen bullets, purple coach tips per exercise) but are **ephemeral**. Once the workout finishes and the upcoming workout is cleaned up, the notes are gone. The AI coach can never look back at what it recommended to evaluate how the user performed against the plan.

Additionally, `ai_summary` is a dead field on the `workouts` table — never meaningfully populated. Remove it.

## Solution: Approach B (JSON blob)

### Schema Changes

**`workouts` table:**
- Remove `ai_summary TEXT`
- Add `coach_notes TEXT` — workout-level coaching notes, copied from `upcoming_workouts.notes` when starting an AI-planned workout
- Add `exercise_coach_notes TEXT` — JSON map of `{ "exercise_id": "note text", ... }`, built from `upcoming_workout_exercises.notes` when starting an AI-planned workout

Both columns are nullable (null for non-AI workouts, manually started workouts, etc.).

### App Changes

#### 1. Database (`src/services/database.ts`)
- Update `CREATE TABLE workouts`: drop `ai_summary`, add `coach_notes TEXT`, `exercise_coach_notes TEXT`
- Add migration: `ALTER TABLE workouts DROP COLUMN ai_summary; ALTER TABLE workouts ADD COLUMN coach_notes TEXT; ALTER TABLE workouts ADD COLUMN exercise_coach_notes TEXT;`
- Update `WorkoutRow` and `WorkoutHistoryRow` interfaces: replace `ai_summary` with `coach_notes` and `exercise_coach_notes`
- Update `startWorkout()` return: replace `ai_summary: null` with `coach_notes: null, exercise_coach_notes: null`
- Update `finishWorkout()`: remove `summary` parameter, keep `sessionNotes`
- Update `getWorkoutHistory()` query: select `coach_notes`, `exercise_coach_notes` instead of `ai_summary`
- Add `updateWorkoutCoachNotes(workoutId, coachNotes, exerciseCoachNotes)` function to persist coach notes after starting

#### 2. Types (`src/types/database.ts`)
- Update `Workout` interface: replace `ai_summary` with `coach_notes: string | null` and `exercise_coach_notes: string | null`

#### 3. Workout Lifecycle (`src/hooks/useWorkoutLifecycle.ts`)
- In `handleStartFromUpcoming()`, after `startWorkout()` and before `activateWorkout()`:
  - Copy `upcomingWorkout.workout.notes` → `coach_notes`
  - Build JSON map from `upcomingWorkout.exercises` → `exercise_coach_notes`
  - Call `updateWorkoutCoachNotes()` to persist both
- Remove `summary` param from `finishWorkout()` call in `confirmFinish()`

#### 4. Sync (`src/services/sync.ts`)
- **Push (`syncToSupabase`)**: Replace `ai_summary` with `coach_notes`, `exercise_coach_notes` in SELECT and upsert
- **Pull (`pullWorkoutHistory`)**: Replace `ai_summary` with `coach_notes`, `exercise_coach_notes` in the row type and INSERT/upsert

#### 5. History UI (`src/screens/HistoryScreen.tsx`)
- Replace `ai_summary` rendering with `coach_notes` rendering (same visual treatment — if present, show it)

#### 6. Tests
- Update factories (`src/__tests__/helpers/factories.ts`): replace `ai_summary` with `coach_notes`, `exercise_coach_notes`
- Update sync tests (`src/services/__tests__/sync.test.ts`): replace all `ai_summary` references
- Update database tests (`src/services/__tests__/database.test.ts`): replace `w_ai_summary` references

### MCP Changes

#### 1. Types (`src/types.ts`)
- `Workout` interface: replace `ai_summary` with `coach_notes: string | null` and `exercise_coach_notes: string | null`
- `WorkoutHistoryRow` interface: add `coach_notes: string | null`

#### 2. Read Tools — `get_workout_detail` (`src/tools/read/workouts.ts`)
- Return `coach_notes` and `exercise_coach_notes` (parsed from JSON) instead of `ai_summary`
- Inline the per-exercise coach note with each exercise group for easy consumption

#### 3. Read Tools — `get_workout_history` (`src/tools/read/workouts.ts`)
- Add `coach_notes` to the select and response so the AI can see at a glance which workouts had coaching plans

#### 4. Read Tools — `get_exercise_history` (`src/tools/read/exercises.ts`)
- Add `target_weight`, `target_reps`, `target_rpe` to the per-set data returned
- Join `workouts.exercise_coach_notes` and extract the per-exercise coach note for each session
- This lets the AI compare what it planned (targets + notes) vs what the user actually did

#### 5. Write Tools — No changes needed
`create_upcoming_workout` already stores everything correctly.

### Supabase Migration

Run on **both** dev (`gcpnqpqqwcwvyzoivolp`) and prod (`lgnkxjiqzsqiwrqrsxww`) via SQL Editor:

```sql
ALTER TABLE workouts DROP COLUMN IF EXISTS ai_summary;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS coach_notes TEXT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS exercise_coach_notes TEXT;
```

Migration file: `supabase/migrations/009_coach_notes.sql`

### Data Flow After Changes

```
MCP create_upcoming_workout
  → upcoming_workouts.notes (workout-level)
  → upcoming_workout_exercises.notes (per-exercise)
  → upcoming_workout_sets.target_weight/reps/rpe (per-set)
       ↓
App pullUpcomingWorkout() → local SQLite
       ↓
App handleStartFromUpcoming()
  → startWorkout() creates workout row
  → updateWorkoutCoachNotes(coach_notes, exercise_coach_notes JSON)
  → updateWorkoutSet() persists target_weight/reps/rpe per set
       ↓
User completes workout
       ↓
App finishWorkout() + syncToSupabase()
  → pushes coach_notes, exercise_coach_notes, targets to Supabase
       ↓
MCP get_workout_detail / get_exercise_history
  → reads coach_notes, exercise_coach_notes, targets
  → AI can compare plan vs actual performance
```

### Not Changing
- User-entered `session_notes` — untouched, already works
- `target_weight`/`target_reps`/`target_rpe` persistence — already works
- Coach tips UI during workout — still reads from live `upcomingTargets` data
- `create_upcoming_workout` MCP tool — already complete
