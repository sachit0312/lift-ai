import type { Exercise } from '../types/database';

export function filterExercises(exercises: Exercise[], searchTerm: string): Exercise[] {
  const term = searchTerm.toLowerCase();
  return exercises.filter(e =>
    e.name.toLowerCase().includes(term) ||
    e.muscle_groups.some(m => m.toLowerCase().includes(term))
  );
}
