-- Rename workouts.notes to session_notes for clarity
-- (distinguishes from exercise-level notes and upcoming workout notes)
ALTER TABLE workouts RENAME COLUMN notes TO session_notes;
