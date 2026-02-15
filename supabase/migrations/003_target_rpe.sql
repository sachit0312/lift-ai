-- Add target_rpe column to upcoming_workout_sets
-- Allows MCP coach to prescribe RPE per set
ALTER TABLE upcoming_workout_sets ADD COLUMN target_rpe REAL;
