import type { ExerciseBlock } from '../types/workout';

export interface SetDiff {
  exerciseId: string;
  exerciseName: string;
  warmupBefore: number;
  warmupAfter: number;
  workingBefore: number;
  workingAfter: number;
}

/** Compares current set tag counts vs original template counts.
 *  Only reports diffs for blocks that have original counts stamped (template-based).
 *  Exercises removed mid-workout are not reported — F5 handles removal separately. */
export function computeSetDiffs(blocks: ExerciseBlock[]): SetDiff[] {
  const diffs: SetDiff[] = [];
  for (const block of blocks) {
    if (block.originalWarmupSets == null || block.originalWorkingSets == null) continue;
    const warmupAfter = block.sets.filter(s => s.tag === 'warmup').length;
    // failure/drop are working-set variants — count all non-warmup sets as "working"
    const workingAfter = block.sets.filter(s => s.tag !== 'warmup').length;
    if (warmupAfter !== block.originalWarmupSets || workingAfter !== block.originalWorkingSets) {
      diffs.push({
        exerciseId: block.exercise.id,
        exerciseName: block.exercise.name,
        warmupBefore: block.originalWarmupSets,
        warmupAfter,
        workingBefore: block.originalWorkingSets,
        workingAfter,
      });
    }
  }
  return diffs;
}

export function hasSetChanges(blocks: ExerciseBlock[]): boolean {
  return computeSetDiffs(blocks).length > 0;
}
