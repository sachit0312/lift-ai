# Implementation Plan: Persist AI Coach Notes

**Spec:** `docs/superpowers/specs/2026-03-30-persist-coach-notes-design.md`
**Date:** 2026-03-30

## Steps

### Step 1: App Schema + Types + Database Functions
**Files:** `src/services/database.ts`, `src/types/database.ts`, `supabase/migrations/009_coach_notes.sql`

1. Create migration file `supabase/migrations/009_coach_notes.sql`
2. In `database.ts`:
   - Update `CREATE TABLE workouts`: replace `ai_summary TEXT` with `coach_notes TEXT, exercise_coach_notes TEXT`
   - Add migration in `migrateDatabase()`: drop `ai_summary`, add `coach_notes`, `exercise_coach_notes`
   - Update `WorkoutRow` interface: `ai_summary` → `coach_notes`, `exercise_coach_notes`
   - Update `WorkoutHistoryRow` interface: `w_ai_summary` → `w_coach_notes`, `w_exercise_coach_notes`
   - Update `startWorkout()`: return `coach_notes: null, exercise_coach_notes: null` instead of `ai_summary: null`
   - Update `finishWorkout()`: remove `summary` parameter, just keep `sessionNotes`
   - Update `getWorkoutHistory()` query: select `coach_notes`, `exercise_coach_notes`
   - Add `updateWorkoutCoachNotes(workoutId: string, coachNotes: string | null, exerciseCoachNotes: string | null)` function
3. In `types/database.ts`:
   - Update `Workout` interface: replace `ai_summary` with `coach_notes: string | null`, `exercise_coach_notes: string | null`

### Step 2: App Lifecycle + Sync + UI
**Files:** `src/hooks/useWorkoutLifecycle.ts`, `src/services/sync.ts`, `src/screens/HistoryScreen.tsx`

1. In `useWorkoutLifecycle.ts` → `handleStartFromUpcoming()`:
   - After `startWorkout()`, build `exerciseCoachNotes` JSON map from `upcomingWorkout.exercises`
   - Call `updateWorkoutCoachNotes(workout.id, upcomingWorkout.workout.notes, JSON.stringify(exerciseCoachNotes))`
2. In `useWorkoutLifecycle.ts` → `confirmFinish()`:
   - Remove `summary` argument from `finishWorkout()` call
3. In `sync.ts` → `syncToSupabase()`:
   - Replace `ai_summary` with `coach_notes`, `exercise_coach_notes` in SELECT and upsert columns
4. In `sync.ts` → `pullWorkoutHistory()`:
   - Replace `ai_summary` with `coach_notes`, `exercise_coach_notes` in row type and INSERT/upsert
5. In `HistoryScreen.tsx`:
   - Replace `ai_summary` references with `coach_notes`

### Step 3: App Tests
**Files:** `src/__tests__/helpers/factories.ts`, `src/services/__tests__/sync.test.ts`, `src/services/__tests__/database.test.ts`

1. Update `factories.ts`: replace `ai_summary: null` with `coach_notes: null, exercise_coach_notes: null`
2. Update `sync.test.ts`: replace all `ai_summary` with `coach_notes` (and add `exercise_coach_notes: null` where needed)
3. Update `database.test.ts`: replace `w_ai_summary` with `w_coach_notes` and add `w_exercise_coach_notes`

### Step 4: MCP Types + Read Tools
**Files (in `/Users/sachitgoyal/code/lift-ai-mcp/`):** `src/types.ts`, `src/tools/read/workouts.ts`, `src/tools/read/exercises.ts`

1. In `types.ts`:
   - `Workout`: replace `ai_summary` with `coach_notes: string | null`, `exercise_coach_notes: string | null`
   - `WorkoutHistoryRow`: add `coach_notes: string | null`
2. In `workouts.ts` → `get_workout_history`:
   - Add `coach_notes` to select and response
3. In `workouts.ts` → `get_workout_detail`:
   - Replace `ai_summary` with `coach_notes`
   - Parse `exercise_coach_notes` JSON, inline per-exercise coach note with each exercise group
4. In `exercises.ts` → `get_exercise_history`:
   - Add `target_weight`, `target_reps`, `target_rpe` to per-set data
   - Join `workouts.exercise_coach_notes` and extract per-exercise coach note for each session

### Step 5: Run Tests + Type-check
1. `npm test` in app directory
2. `npx tsc --noEmit` in app directory
3. `npm run build` in MCP directory
