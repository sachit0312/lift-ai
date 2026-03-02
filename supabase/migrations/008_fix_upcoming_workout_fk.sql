-- Fix FK constraint that blocks deleting upcoming_workouts when completed workouts reference them.
-- ON DELETE SET NULL: when an upcoming workout is deleted, completed workouts that referenced it
-- simply get upcoming_workout_id set to NULL. Historical workout data is preserved.
ALTER TABLE workouts DROP CONSTRAINT workouts_upcoming_workout_id_fkey;
ALTER TABLE workouts ADD CONSTRAINT workouts_upcoming_workout_id_fkey
  FOREIGN KEY (upcoming_workout_id) REFERENCES upcoming_workouts(id) ON DELETE SET NULL;
