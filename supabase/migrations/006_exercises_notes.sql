-- Add notes column to exercises table (was previously local-only in SQLite)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS notes TEXT;
