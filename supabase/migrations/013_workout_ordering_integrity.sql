-- Migration 013: Workout ordering integrity
--
-- Adds programmed_order to workout_sets to preserve the original plan order
-- through finish (exercise_order captures performed order).
--
-- Adds planned_exercise_ids JSON array to workouts so the full plan survives
-- mid-workout exercise removal (which hard-deletes workout_sets rows).

ALTER TABLE workout_sets ADD COLUMN programmed_order INTEGER;

CREATE INDEX IF NOT EXISTS workout_sets_workout_programmed_idx
  ON workout_sets(workout_id, programmed_order);

ALTER TABLE workouts ADD COLUMN planned_exercise_ids TEXT;
-- JSON array of exercise_ids in plan order, e.g. '["uuid-a","uuid-b"]'.
-- NULL for ad-hoc empty workouts and pre-migration rows.
