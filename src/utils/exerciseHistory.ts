import type { PreviousSetData } from '../types/workout';
import { getExerciseHistory } from '../services/database';

/**
 * Fetches the last workout session for an exercise, returning previous set data
 * and a summary string. Used by both useExerciseBlocks and useWorkoutLifecycle.
 */
export async function getExerciseHistoryData(exerciseId: string): Promise<{ previousSets: PreviousSetData[]; lastTime: string | null }> {
  try {
    const hist = await getExerciseHistory(exerciseId, 1);
    if (hist.length === 0) return { previousSets: [], lastTime: null };
    const sets = hist[0].sets.filter((s) => s.is_completed);
    const previousSets = sets.map((s) => ({ weight: s.weight ?? 0, reps: s.reps ?? 0 }));
    let lastTime: string | null = null;
    if (sets.length > 0) {
      const setCount = sets.length;
      const avgReps = Math.round(sets.reduce((a, s) => a + (s.reps ?? 0), 0) / setCount);
      const maxWeight = Math.max(...sets.map((s) => s.weight ?? 0));
      lastTime = `Last: ${setCount}\u00D7${avgReps} @ ${maxWeight}lb`;
    }
    return { previousSets, lastTime };
  } catch {
    return { previousSets: [], lastTime: null };
  }
}
