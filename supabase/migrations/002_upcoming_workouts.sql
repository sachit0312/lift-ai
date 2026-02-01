-- Upcoming workouts schema + drop unused template defaults

-- New tables
CREATE TABLE upcoming_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  template_id UUID REFERENCES templates(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE upcoming_workout_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upcoming_workout_id UUID NOT NULL REFERENCES upcoming_workouts(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  rest_seconds INTEGER NOT NULL DEFAULT 90,
  notes TEXT
);

CREATE TABLE upcoming_workout_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upcoming_exercise_id UUID NOT NULL REFERENCES upcoming_workout_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  target_weight REAL NOT NULL,
  target_reps INTEGER NOT NULL
);

-- RLS
ALTER TABLE upcoming_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE upcoming_workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE upcoming_workout_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own upcoming workouts" ON upcoming_workouts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own upcoming workout exercises" ON upcoming_workout_exercises
  FOR ALL USING (upcoming_workout_id IN (SELECT id FROM upcoming_workouts WHERE user_id = auth.uid()));

CREATE POLICY "Users manage own upcoming workout sets" ON upcoming_workout_sets
  FOR ALL USING (upcoming_exercise_id IN (SELECT id FROM upcoming_workout_exercises WHERE upcoming_workout_id IN (SELECT id FROM upcoming_workouts WHERE user_id = auth.uid())));

-- Drop unused columns from template_exercises
ALTER TABLE template_exercises DROP COLUMN IF EXISTS default_reps;
ALTER TABLE template_exercises DROP COLUMN IF EXISTS default_weight;
