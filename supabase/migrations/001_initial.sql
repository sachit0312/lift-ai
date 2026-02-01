-- Workout Enhanced initial schema

CREATE TABLE exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'weighted' CHECK (type IN ('weighted', 'bodyweight', 'machine', 'cable')),
  muscle_groups JSONB NOT NULL DEFAULT '[]',
  training_goal TEXT NOT NULL DEFAULT 'hypertrophy' CHECK (training_goal IN ('strength', 'hypertrophy', 'endurance')),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE template_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  default_sets INTEGER NOT NULL DEFAULT 3,
  default_reps INTEGER NOT NULL DEFAULT 10,
  default_weight REAL NOT NULL DEFAULT 0
);

CREATE TABLE workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID REFERENCES templates(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ai_summary TEXT,
  notes TEXT
);

CREATE TABLE workout_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  set_number INTEGER NOT NULL,
  reps INTEGER,
  weight REAL,
  tag TEXT NOT NULL DEFAULT 'working' CHECK (tag IN ('working', 'warmup', 'failure', 'drop')),
  rpe REAL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  notes TEXT
);

-- RLS
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exercises" ON exercises FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own templates" ON templates FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own template exercises" ON template_exercises FOR ALL
  USING (template_id IN (SELECT id FROM templates WHERE user_id = auth.uid()));
CREATE POLICY "Users manage own workouts" ON workouts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own workout sets" ON workout_sets FOR ALL
  USING (workout_id IN (SELECT id FROM workouts WHERE user_id = auth.uid()));
