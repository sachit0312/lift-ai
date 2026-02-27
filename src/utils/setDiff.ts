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
  const templateExerciseIds = templateExercises.map(te => te.exercise_id);

  // Group by exercise_id to handle duplicates (same exercise twice in template)
  const teByExerciseId = new Map<string, TemplateExercise[]>();
  for (const te of templateExercises) {
    const arr = teByExerciseId.get(te.exercise_id) ?? [];
    arr.push(te);
    teByExerciseId.set(te.exercise_id, arr);
  }
  const consumed = new Set<string>();
  function matchTE(exerciseId: string): TemplateExercise | undefined {
    const candidates = teByExerciseId.get(exerciseId) ?? [];
    for (const te of candidates) {
      if (!consumed.has(te.id)) { consumed.add(te.id); return te; }
    }
    return undefined;
  }

  // Set count changes
  const setDiffs = computeSetDiffs(blocks);
  const setChanges = setDiffs
    .map(diff => {
      const te = matchTE(diff.exerciseId);
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
    // Reset consumed set for order matching — order diffs are independent of set diffs
    const orderConsumed = new Set<string>();
    reorderedTemplateExerciseIds = orderDiff.currentOrder
      .map(exId => {
        const candidates = teByExerciseId.get(exId) ?? [];
        for (const te of candidates) {
          if (!orderConsumed.has(te.id)) { orderConsumed.add(te.id); return te.id; }
        }
        return undefined;
      })
      .filter((id): id is string => id !== undefined);
  }

  if (setChanges.length === 0 && !reorderedTemplateExerciseIds) return null;
  return { templateId, setChanges, reorderedTemplateExerciseIds };
}
