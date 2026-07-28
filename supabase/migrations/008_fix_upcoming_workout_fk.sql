-- Fix FK constraint that blocks deleting upcoming_workouts when completed workouts reference them.
-- ON DELETE SET NULL: when an upcoming workout is deleted, completed workouts that referenced it
-- simply get upcoming_workout_id set to NULL. Historical workout data is preserved.
--
-- NOTE: workouts.upcoming_workout_id was added by hand to the live dev/prod databases and never
-- captured in a migration, so this file used to drop a constraint on a column migrations/ had
-- never created. A replay from scratch died here, and the workouts push then failed with
-- "column does not exist" — which also skips the workout_sets push entirely. The column is now
-- created below so this file stands alone, and every statement is idempotent and safe to re-run.
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS upcoming_workout_id UUID;

ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_upcoming_workout_id_fkey;
ALTER TABLE workouts ADD CONSTRAINT workouts_upcoming_workout_id_fkey
  FOREIGN KEY (upcoming_workout_id) REFERENCES upcoming_workouts(id) ON DELETE SET NULL;
