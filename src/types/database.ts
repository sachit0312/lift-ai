export type ExerciseType = 'weighted' | 'bodyweight' | 'machine' | 'cable';
export type TrainingGoal = 'strength' | 'hypertrophy' | 'endurance';
export type SetTag = 'working' | 'warmup' | 'failure' | 'drop';

export interface Exercise {
  id: string;
  user_id: string;
  name: string;
  type: ExerciseType;
  muscle_groups: string[];
  training_goal: TrainingGoal;
  description: string;
  created_at: string;
}

export interface Template {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  order: number;
  default_sets: number;
  default_reps: number;
  default_weight: number;
  exercise?: Exercise;
}

export interface Workout {
  id: string;
  user_id: string;
  template_id: string | null;
  started_at: string;
  finished_at: string | null;
  ai_summary: string | null;
  notes: string | null;
  template_name?: string;
}

export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  tag: SetTag;
  rpe: number | null;
  is_completed: boolean;
  notes: string | null;
}
