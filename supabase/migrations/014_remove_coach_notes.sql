-- Remove AI-coach scratchpad notes (replaced by external agent knowledge).
-- See docs/superpowers/specs/2026-04-26-remove-mcp-coach-notes-design.md
ALTER TABLE user_exercise_notes DROP COLUMN IF EXISTS notes;
ALTER TABLE exercises DROP COLUMN IF EXISTS notes;
