-- Add form_notes and machine_notes columns to exercises table
ALTER TABLE exercises ADD COLUMN form_notes TEXT DEFAULT NULL;
ALTER TABLE exercises ADD COLUMN machine_notes TEXT DEFAULT NULL;
