-- 1. Create user_exercise_notes table
CREATE TABLE user_exercise_notes (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  notes       TEXT,
  form_notes  TEXT,
  machine_notes TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, exercise_id)
);

ALTER TABLE user_exercise_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exercise notes"
  ON user_exercise_notes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION update_uen_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ language 'plpgsql';

CREATE TRIGGER trg_uen_updated_at BEFORE UPDATE ON user_exercise_notes
  FOR EACH ROW EXECUTE FUNCTION update_uen_updated_at();

-- 2. Migrate existing notes
INSERT INTO user_exercise_notes (user_id, exercise_id, notes, form_notes, machine_notes)
SELECT user_id, id, notes, form_notes, machine_notes
FROM exercises
WHERE (notes IS NOT NULL OR form_notes IS NOT NULL OR machine_notes IS NOT NULL)
  AND user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3. Drop note columns from exercises
ALTER TABLE exercises DROP COLUMN IF EXISTS notes;
ALTER TABLE exercises DROP COLUMN IF EXISTS form_notes;
ALTER TABLE exercises DROP COLUMN IF EXISTS machine_notes;

-- 4. Make user_id nullable
ALTER TABLE exercises ALTER COLUMN user_id DROP NOT NULL;

-- 5. Convert all existing exercises to global
UPDATE exercises SET user_id = NULL;

-- 6. Update RLS policies
DROP POLICY IF EXISTS "Users manage own exercises" ON exercises;

CREATE POLICY "Read global and own exercises"
  ON exercises FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Create own custom exercises"
  ON exercises FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Update own custom exercises"
  ON exercises FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Delete own custom exercises"
  ON exercises FOR DELETE
  USING (user_id = auth.uid());
-- Admin (service role key) bypasses RLS entirely
