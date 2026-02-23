-- Add warmup_sets to template_exercises for distinguishing warmup from working sets
ALTER TABLE template_exercises ADD COLUMN warmup_sets INTEGER NOT NULL DEFAULT 0;

-- Add tag to upcoming_workout_sets so MCP coach can prescribe set types
ALTER TABLE upcoming_workout_sets ADD COLUMN tag TEXT DEFAULT 'working'
  CHECK (tag IN ('working', 'warmup', 'failure', 'drop'));
