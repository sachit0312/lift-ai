import { filterExercises } from '../exerciseSearch';
import type { Exercise } from '../../types/database';

const createExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: '1',
  user_id: null,
  name: 'Bench Press',
  type: 'weighted',
  muscle_groups: ['Chest', 'Triceps'],
  training_goal: 'hypertrophy',
  description: '',
  created_at: '2024-01-01',
  ...overrides,
});

const exercises: Exercise[] = [
  createExercise({ id: '1', name: 'Bench Press', muscle_groups: ['Chest', 'Triceps'] }),
  createExercise({ id: '2', name: 'Squat', muscle_groups: ['Quads', 'Glutes'] }),
  createExercise({ id: '3', name: 'Pull Up', muscle_groups: ['Back', 'Biceps'], type: 'bodyweight' }),
  createExercise({ id: '4', name: 'Cable Fly', muscle_groups: ['Chest'], type: 'cable' }),
];

describe('filterExercises', () => {
  it('filters by exercise name', () => {
    const result = filterExercises(exercises, 'bench');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Bench Press');
  });

  it('filters by muscle group', () => {
    const result = filterExercises(exercises, 'chest');
    expect(result).toHaveLength(2);
    expect(result.map(e => e.name)).toEqual(['Bench Press', 'Cable Fly']);
  });

  it('is case insensitive for name search', () => {
    const result = filterExercises(exercises, 'SQUAT');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Squat');
  });

  it('is case insensitive for muscle group search', () => {
    const result = filterExercises(exercises, 'BACK');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Pull Up');
  });

  it('returns empty array when no match found', () => {
    const result = filterExercises(exercises, 'deadlift');
    expect(result).toHaveLength(0);
  });

  it('returns all exercises for empty search term', () => {
    const result = filterExercises(exercises, '');
    expect(result).toHaveLength(4);
  });

  it('matches partial name strings', () => {
    const result = filterExercises(exercises, 'pull');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Pull Up');
  });

  it('matches partial muscle group strings', () => {
    const result = filterExercises(exercises, 'tri');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Bench Press');
  });

  it('returns empty array when exercises list is empty', () => {
    const result = filterExercises([], 'bench');
    expect(result).toHaveLength(0);
  });
});
