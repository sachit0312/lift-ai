import type { ExerciseBlock } from '../types/workout';
import type { TemplateExercise } from '../types/database';

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

// ─── Order diff & template update plan (F5) ───

export interface OrderDiff {
  currentOrder: string[];   // exercise_ids in workout order (filtered to template)
  templateOrder: string[];  // exercise_ids in template order (filtered to workout)
}

export interface TemplateUpdatePlan {
  templateId: string;
  setChanges: Array<{
    templateExerciseId: string;
    sets?: number;
    warmup_sets?: number;
  }>;
  reorderedTemplateExerciseIds: string[] | null;  // template_exercises.id[] in new order, null = no change
}

/** Returns an OrderDiff if workout exercise order differs from template order.
 *  Only compares exercises present in both the workout and the template. */
export function computeOrderDiff(
  blocks: ExerciseBlock[],
  templateExerciseIds: string[],
): OrderDiff | null {
  const templateSet = new Set(templateExerciseIds);
  // Deduplicate while preserving first-seen order (handles same exercise added twice)
  const seen = new Set<string>();
  const currentOrder = blocks.map(b => b.exercise.id).filter(id => {
    if (!templateSet.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const workoutSet = new Set(currentOrder);
  const templateOrder = templateExerciseIds.filter(id => workoutSet.has(id));
  if (currentOrder.length !== templateOrder.length) return { currentOrder, templateOrder };
  for (let i = 0; i < currentOrder.length; i++) {
    if (currentOrder[i] !== templateOrder[i]) return { currentOrder, templateOrder };
  }
  return null;
}

/** Builds a plan describing what template changes to apply based on workout modifications.
 *  Returns null if no changes detected. */
export function buildTemplateUpdatePlan(
  templateId: string,
  blocks: ExerciseBlock[],
  templateExercises: TemplateExercise[],
): TemplateUpdatePlan | null {
  const teLookup = new Map(templateExercises.map(te => [te.exercise_id, te]));
  const templateExerciseIds = templateExercises.map(te => te.exercise_id);

  // Set count changes
  const setDiffs = computeSetDiffs(blocks);
  const setChanges = setDiffs
    .map(diff => {
      const te = teLookup.get(diff.exerciseId);
      if (!te) return null;
      return {
        templateExerciseId: te.id,
        sets: diff.workingAfter !== diff.workingBefore ? diff.workingAfter : undefined,
        warmup_sets: diff.warmupAfter !== diff.warmupBefore ? diff.warmupAfter : undefined,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Order changes — map workout exercise_id order → template_exercise row IDs
  const orderDiff = computeOrderDiff(blocks, templateExerciseIds);
  let reorderedTemplateExerciseIds: string[] | null = null;
  if (orderDiff) {
    reorderedTemplateExerciseIds = orderDiff.currentOrder
      .map(exId => teLookup.get(exId)?.id)
      .filter((id): id is string => id !== undefined);
  }

  if (setChanges.length === 0 && !reorderedTemplateExerciseIds) return null;
  return { templateId, setChanges, reorderedTemplateExerciseIds };
}
