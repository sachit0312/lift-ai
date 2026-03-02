-- Failure sets are implicitly RPE 10; no need to store it explicitly.
-- This cleans up historical data where RPE was hardcoded to 10 for failure sets.
UPDATE workout_sets SET rpe = NULL WHERE tag = 'failure' AND rpe IS NOT NULL;
