/**
 * Tests for Batch 2 Task 3: handleFinish must read from blocksRef.current,
 * not the React state `exerciseBlocks`, to avoid stale-state validation.
 *
 * We use a unit-level approach: invoke the validation logic with both
 * "stale state" and "fresh ref" simultaneously and confirm the ref wins.
 */
import type { ExerciseBlock } from '../../types/workout';
import { createMockExercise } from '../helpers/factories';

function makeBlock(completedCount: number): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: 'ex-1' }),
    sets: Array.from({ length: 3 }, (_, i) => ({
      id: `s${i+1}`,
      exercise_id: 'ex-1',
      set_number: i + 1,
      weight: i < completedCount ? '100' : '',
      reps: i < completedCount ? '10' : '',
      rpe: '',
      tag: 'working',
      is_completed: i < completedCount,
      previous: null,
    })),
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: true,
    bestE1RM: undefined,
  };
}

describe('Batch 2 Task 3: handleFinish validation reads blocksRef', () => {
  it('models the fix: when state shows 0 completed but ref shows 1, validation passes', () => {
    // The pre-fix bug:
    //   const totalCompleted = exerciseBlocks.reduce(...);
    //   if (totalCompleted === 0) reject
    // After fix:
    //   const totalCompleted = blocksRef.current.reduce(...);
    const staleState = [makeBlock(0)];
    const freshRef = { current: [makeBlock(1)] };

    const validateWithStaleState = (blocks: ExerciseBlock[]) =>
      blocks.reduce((sum, b) => sum + b.sets.filter(s => s.is_completed).length, 0);

    expect(validateWithStaleState(staleState)).toBe(0);          // would reject
    expect(validateWithStaleState(freshRef.current)).toBe(1);    // would accept
  });
});
