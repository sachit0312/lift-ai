-- Migration 013: Workout ordering integrity
--
-- Adds programmed_order to workout_sets to preserve the original plan order
-- through finish (exercise_order captures performed order).
--
-- Adds planned_exercise_ids JSON array to workouts so the full plan survives
-- mid-workout exercise removal (which hard-deletes workout_sets rows).

ALTER TABLE workout_sets ADD COLUMN programmed_order INTEGER;

-- Ghost-row sentinel rule: a row represents a planned-but-skipped exercise when
-- programmed_order IS NOT NULL AND exercise_order = 0 AND is_completed = 0
-- AND reps = 0 AND weight = 0.
-- NOTE: exercise_order uses 0 (not NULL) because workout_sets.exercise_order
-- was declared NOT NULL DEFAULT 0 in migration 007. The NOT NULL constraint is
-- intentional and must not be dropped. Callers must use the composite sentinel
-- above, NOT an exercise_order IS NULL check.
CREATE INDEX IF NOT EXISTS workout_sets_workout_programmed_idx
  ON workout_sets(workout_id, programmed_order);

ALTER TABLE workouts ADD COLUMN planned_exercise_ids TEXT;
-- JSON array of exercise_ids in plan order, e.g. '["uuid-a","uuid-b"]'.
-- NULL for ad-hoc empty workouts and pre-migration rows.
