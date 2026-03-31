export type ExerciseType = 'weighted' | 'bodyweight' | 'machine' | 'cable';
export type TrainingGoal = 'strength' | 'hypertrophy' | 'endurance';
export type SetTag = 'working' | 'warmup' | 'failure' | 'drop';

export interface Exercise {
  id: string;
  user_id: string | null;
  name: string;
  type: ExerciseType;
  muscle_groups: string[];
  training_goal: TrainingGoal;
  description: string;
  created_at: string;
}

export interface ExerciseNotes {
  notes: string | null;
  form_notes: string | null;
  machine_notes: string | null;
}

export type ExerciseWithNotes = Exercise & ExerciseNotes;

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
  warmup_sets: number;
  rest_seconds: number;
  exercise?: Exercise;
}

export interface Workout {
  id: string;
  user_id: string;
  template_id: string | null;
  upcoming_workout_id: string | null;
  started_at: string;
  finished_at: string | null;
  coach_notes: string | null;
  exercise_coach_notes: string | null;
  session_notes: string | null;
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
  target_weight?: number | null;
  target_reps?: number | null;
  target_rpe?: number | null;
  exercise_order?: number;  // 0 = unknown (historical), 1+ = sequence position
}

export interface UpcomingWorkout {
  id: string;
  date: string;
  template_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface UpcomingWorkoutExercise {
  id: string;
  upcoming_workout_id: string;
  exercise_id: string;
  order: number;
  rest_seconds: number;
  notes: string | null;
  exercise?: Exercise;
  sets?: UpcomingWorkoutSet[];
}

export interface UpcomingWorkoutSet {
  id: string;
  upcoming_exercise_id: string;
  set_number: number;
  target_weight: number;
  target_reps: number;
  target_rpe?: number | null;
  tag?: SetTag;
}
