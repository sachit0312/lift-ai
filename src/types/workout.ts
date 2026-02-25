import type { Exercise, SetTag } from './database';

export interface PreviousSetData {
  weight: number;
  reps: number;
}

export interface LocalSet {
  id: string;
  exercise_id: string;
  set_number: number;
  weight: string;
  reps: string;
  rpe: string;
  tag: SetTag;
  is_completed: boolean;
  previous?: PreviousSetData | null;
}

export interface ExerciseBlock {
  exercise: Exercise;
  sets: LocalSet[];
  lastTime: string | null;
  notesExpanded: boolean;
  notes: string;
  restSeconds: number;
  restEnabled: boolean;
}
