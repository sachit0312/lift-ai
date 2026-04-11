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
  /** 1-indexed position of this exercise in the workout; 0 = unknown/historical */
  exercise_order?: number;
}

export interface ExerciseBlock {
  exercise: Exercise;
  sets: LocalSet[];
  lastTime: string | null;
  machineNotesExpanded: boolean;
  machineNotes: string;
  restSeconds: number;
  restEnabled: boolean;
  bestE1RM?: number;
  originalWarmupSets?: number;
  originalWorkingSets?: number;
}
