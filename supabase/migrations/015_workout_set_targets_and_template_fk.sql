-- 015: Reconcile migrations/ with the live schema, and unblock template deletion.
--
-- Part 1 — workout_sets planned-target columns.
-- sync.ts pushes target_weight / target_reps / target_rpe on every workout set (they persist the
-- plan a workout was started from, so planned-vs-actual survives sync), but no migration ever
-- created them; they were added by hand to dev and prod. Without these, a database rebuilt from
-- migrations/ fails the workout_sets push with "column does not exist" and silently syncs no sets.
--
-- Deliberately nullable with no default: NULL means "this set had no planned target" (ad-hoc sets,
-- user-added sets mid-workout, and every pre-existing row), which is distinct from a target of 0.
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS target_weight REAL;
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS target_reps INTEGER;
ALTER TABLE workout_sets ADD COLUMN IF NOT EXISTS target_rpe REAL;

-- Part 2 — allow deleting a template that has workout history.
-- workouts.template_id referenced templates(id) with no ON DELETE clause, so deleting any template
-- that had ever been used raised a foreign key violation. The delete failed both locally and
-- remotely, and the user only saw "Failed to delete template. Please try again."
--
-- ON DELETE SET NULL matches how upcoming_workout_id is handled above: the workout history is kept
-- and simply loses its template association. This mirrors the local SQLite behaviour in
-- database.ts deleteTemplate(), which nulls template_id inside the delete transaction.
ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_template_id_fkey;
ALTER TABLE workouts ADD CONSTRAINT workouts_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;

-- upcoming_workouts.template_id carries the identical unguarded FK, and the MCP tool
-- create_upcoming_workout writes it whenever the coach plans a session from a template. Left
-- as-is, a single planned workout would still block the delete on the Postgres side even
-- though the local SQLite delete now succeeds — and the next pull would resurrect the template.
ALTER TABLE upcoming_workouts DROP CONSTRAINT IF EXISTS upcoming_workouts_template_id_fkey;
ALTER TABLE upcoming_workouts ADD CONSTRAINT upcoming_workouts_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;
