-- Persist AI coach notes on completed workouts
-- coach_notes: workout-level coaching rationale (from upcoming_workouts.notes)
-- exercise_coach_notes: JSON map of exercise_id -> note (from upcoming_workout_exercises.notes)
-- ai_summary was never meaningfully populated — drop it

ALTER TABLE workouts DROP COLUMN IF EXISTS ai_summary;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS coach_notes TEXT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS exercise_coach_notes TEXT;
