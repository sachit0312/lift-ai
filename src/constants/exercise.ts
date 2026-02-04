import type { ExerciseType } from '../types/database';
import type { Ionicons } from '@expo/vector-icons';

export const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms',
] as const;

export const EXERCISE_TYPES: ExerciseType[] = ['weighted', 'bodyweight', 'machine', 'cable'];

export const EXERCISE_TYPE_OPTIONS: { value: ExerciseType; label: string }[] = [
  { value: 'weighted', label: 'Weighted' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
];

export const EXERCISE_TYPE_OPTIONS_WITH_ICONS: { value: ExerciseType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'weighted', label: 'Weighted', icon: 'barbell-outline' },
  { value: 'bodyweight', label: 'Bodyweight', icon: 'body-outline' },
  { value: 'machine', label: 'Machine', icon: 'cog-outline' },
  { value: 'cable', label: 'Cable', icon: 'git-pull-request-outline' },
];

export const REST_SECONDS: Record<string, number> = {
  strength: 180,
  hypertrophy: 90,
  endurance: 60,
};

export const DEFAULT_REST_SECONDS = 150;
