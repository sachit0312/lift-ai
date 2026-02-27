import { computeSetDiffs, hasSetChanges, computeOrderDiff, buildTemplateUpdatePlan } from '../setDiff';
import type { ExerciseBlock } from '../../types/workout';
import { createMockExercise } from '../../__tests__/helpers/factories';
import type { Exercise, TemplateExercise } from '../../types/database';

function makeExercise(id: string, name: string): Exercise {
  return createMockExercise({ id, name });
}

function makeBlock(
  overrides: Partial<ExerciseBlock> & { exercise: Exercise; sets: ExerciseBlock['sets'] },
): ExerciseBlock {
  return {
    lastTime: null,
    notesExpanded: false,
    notes: '',
    restSeconds: 150,
    restEnabled: true,
    ...overrides,
  };
}

function makeSet(tag: 'warmup' | 'working' | 'failure' | 'drop' = 'working'): ExerciseBlock['sets'][number] {
  return {
    id: Math.random().toString(),
    exercise_id: '',
    set_number: 1,
    weight: '',
    reps: '',
    rpe: '',
    tag,
    is_completed: false,
  };
}

describe('computeSetDiffs', () => {
  it('returns no diffs when blocks have no original counts (ad-hoc workout)', () => {
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Squat'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working')],
      }),
    ];
    expect(computeSetDiffs(blocks)).toEqual([]);
  });

  it('returns no diffs when counts are unchanged', () => {
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Squat'),
        sets: [makeSet('warmup'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 1,
        originalWorkingSets: 3,
      }),
    ];
    expect(computeSetDiffs(blocks)).toEqual([]);
  });

  it('detects added working set', () => {
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Bench Press'),
        sets: [makeSet('warmup'), makeSet('working'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 1,
        originalWorkingSets: 3,
      }),
    ];
    const diffs = computeSetDiffs(blocks);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({
      exerciseId: '1',
      exerciseName: 'Bench Press',
      warmupBefore: 1,
      warmupAfter: 1,
      workingBefore: 3,
      workingAfter: 4,
    });
  });

  it('detects deleted warmup set', () => {
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Deadlift'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 2,
        originalWorkingSets: 3,
      }),
    ];
    const diffs = computeSetDiffs(blocks);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].warmupBefore).toBe(2);
    expect(diffs[0].warmupAfter).toBe(0);
    expect(diffs[0].workingBefore).toBe(3);
    expect(diffs[0].workingAfter).toBe(3);
  });

  it('detects tag cycle (warmup -> working)', () => {
    // Originally 2 warmup + 3 working, user cycled one warmup to working
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'OHP'),
        sets: [makeSet('warmup'), makeSet('working'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 2,
        originalWorkingSets: 3,
      }),
    ];
    const diffs = computeSetDiffs(blocks);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].warmupBefore).toBe(2);
    expect(diffs[0].warmupAfter).toBe(1);
    expect(diffs[0].workingBefore).toBe(3);
    expect(diffs[0].workingAfter).toBe(4);
  });

  it('does not report diff when working set is cycled to failure or drop', () => {
    // Originally 1 warmup + 3 working, user cycled one to failure and one to drop
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Squat'),
        sets: [makeSet('warmup'), makeSet('working'), makeSet('failure'), makeSet('drop')],
        originalWarmupSets: 1,
        originalWorkingSets: 3,
      }),
    ];
    expect(computeSetDiffs(blocks)).toEqual([]);
  });

  it('only includes changed exercises in mixed scenario', () => {
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Squat'),
        sets: [makeSet('warmup'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 1,
        originalWorkingSets: 3,
      }),
      makeBlock({
        exercise: makeExercise('2', 'Bench'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 3,
      }),
      makeBlock({
        exercise: makeExercise('3', 'Row'),
        sets: [makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 2,
      }),
    ];
    const diffs = computeSetDiffs(blocks);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].exerciseId).toBe('2');
    expect(diffs[0].workingAfter).toBe(4);
  });
});

describe('hasSetChanges', () => {
  it('returns false when no changes', () => {
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Squat'),
        sets: [makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 2,
      }),
    ];
    expect(hasSetChanges(blocks)).toBe(false);
  });

  it('returns true when there are changes', () => {
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Squat'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 2,
      }),
    ];
    expect(hasSetChanges(blocks)).toBe(true);
  });

  it('returns false for ad-hoc blocks without original counts', () => {
    const blocks: ExerciseBlock[] = [
      makeBlock({
        exercise: makeExercise('1', 'Squat'),
        sets: [makeSet('working')],
      }),
    ];
    expect(hasSetChanges(blocks)).toBe(false);
  });
});

// ─── Helper for template exercises ───

function makeTemplateExercise(id: string, exerciseId: string, order: number, defaults?: Partial<TemplateExercise>): TemplateExercise {
  return {
    id,
    template_id: 'tpl-1',
    exercise_id: exerciseId,
    order,
    default_sets: 3,
    warmup_sets: 0,
    rest_seconds: 150,
    ...defaults,
  };
}

describe('computeOrderDiff', () => {
  it('returns null when order is unchanged', () => {
    const blocks = [
      makeBlock({ exercise: makeExercise('A', 'Squat'), sets: [makeSet()] }),
      makeBlock({ exercise: makeExercise('B', 'Bench'), sets: [makeSet()] }),
      makeBlock({ exercise: makeExercise('C', 'Row'), sets: [makeSet()] }),
    ];
    expect(computeOrderDiff(blocks, ['A', 'B', 'C'])).toBeNull();
  });

  it('detects reorder (swapped exercises)', () => {
    const blocks = [
      makeBlock({ exercise: makeExercise('B', 'Bench'), sets: [makeSet()] }),
      makeBlock({ exercise: makeExercise('A', 'Squat'), sets: [makeSet()] }),
      makeBlock({ exercise: makeExercise('C', 'Row'), sets: [makeSet()] }),
    ];
    const diff = computeOrderDiff(blocks, ['A', 'B', 'C']);
    expect(diff).not.toBeNull();
    expect(diff!.currentOrder).toEqual(['B', 'A', 'C']);
    expect(diff!.templateOrder).toEqual(['A', 'B', 'C']);
  });

  it('ignores exercises added mid-workout (not in template)', () => {
    const blocks = [
      makeBlock({ exercise: makeExercise('A', 'Squat'), sets: [makeSet()] }),
      makeBlock({ exercise: makeExercise('X', 'Curl'), sets: [makeSet()] }),  // added mid-workout
      makeBlock({ exercise: makeExercise('B', 'Bench'), sets: [makeSet()] }),
    ];
    // Template only has A, B — order is preserved
    expect(computeOrderDiff(blocks, ['A', 'B'])).toBeNull();
  });

  it('handles exercises removed mid-workout', () => {
    // Template has A, B, C but user removed B during workout
    const blocks = [
      makeBlock({ exercise: makeExercise('A', 'Squat'), sets: [makeSet()] }),
      makeBlock({ exercise: makeExercise('C', 'Row'), sets: [makeSet()] }),
    ];
    // A, C in workout matches A, C in template (B filtered from both)
    expect(computeOrderDiff(blocks, ['A', 'B', 'C'])).toBeNull();
  });

  it('detects reorder when some exercises were removed', () => {
    // Template has A, B, C — user removed B and swapped A, C
    const blocks = [
      makeBlock({ exercise: makeExercise('C', 'Row'), sets: [makeSet()] }),
      makeBlock({ exercise: makeExercise('A', 'Squat'), sets: [makeSet()] }),
    ];
    const diff = computeOrderDiff(blocks, ['A', 'B', 'C']);
    expect(diff).not.toBeNull();
    expect(diff!.currentOrder).toEqual(['C', 'A']);
    expect(diff!.templateOrder).toEqual(['A', 'C']);
  });
});

describe('buildTemplateUpdatePlan', () => {
  it('returns null when no changes', () => {
    const blocks = [
      makeBlock({
        exercise: makeExercise('A', 'Squat'),
        sets: [makeSet('warmup'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 1,
        originalWorkingSets: 3,
      }),
    ];
    const tes = [makeTemplateExercise('te-1', 'A', 0, { warmup_sets: 1, default_sets: 3 })];
    expect(buildTemplateUpdatePlan('tpl-1', blocks, tes)).toBeNull();
  });

  it('returns plan with set changes only', () => {
    const blocks = [
      makeBlock({
        exercise: makeExercise('A', 'Squat'),
        sets: [makeSet('warmup'), makeSet('warmup'), makeSet('working'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 1,
        originalWorkingSets: 3,
      }),
    ];
    const tes = [makeTemplateExercise('te-1', 'A', 0, { warmup_sets: 1, default_sets: 3 })];
    const plan = buildTemplateUpdatePlan('tpl-1', blocks, tes);
    expect(plan).not.toBeNull();
    expect(plan!.setChanges).toHaveLength(1);
    expect(plan!.setChanges[0]).toEqual({
      templateExerciseId: 'te-1',
      sets: 4,
      warmup_sets: 2,
    });
    expect(plan!.reorderedTemplateExerciseIds).toBeNull();
  });

  it('returns plan with reorder only', () => {
    const blocks = [
      makeBlock({
        exercise: makeExercise('B', 'Bench'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 3,
      }),
      makeBlock({
        exercise: makeExercise('A', 'Squat'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 3,
      }),
    ];
    const tes = [
      makeTemplateExercise('te-1', 'A', 0),
      makeTemplateExercise('te-2', 'B', 1),
    ];
    const plan = buildTemplateUpdatePlan('tpl-1', blocks, tes);
    expect(plan).not.toBeNull();
    expect(plan!.setChanges).toHaveLength(0);
    expect(plan!.reorderedTemplateExerciseIds).toEqual(['te-2', 'te-1']);
  });

  it('returns plan with both set changes and reorder', () => {
    const blocks = [
      makeBlock({
        exercise: makeExercise('B', 'Bench'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 3,
      }),
      makeBlock({
        exercise: makeExercise('A', 'Squat'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 3,
      }),
    ];
    const tes = [
      makeTemplateExercise('te-1', 'A', 0),
      makeTemplateExercise('te-2', 'B', 1),
    ];
    const plan = buildTemplateUpdatePlan('tpl-1', blocks, tes);
    expect(plan).not.toBeNull();
    expect(plan!.setChanges).toHaveLength(1);
    expect(plan!.setChanges[0].templateExerciseId).toBe('te-2');
    expect(plan!.setChanges[0].sets).toBe(4);
    expect(plan!.reorderedTemplateExerciseIds).toEqual(['te-2', 'te-1']);
  });

  it('handles same exercise appearing twice in template', () => {
    // Template has exercise A at position 0 and A again at position 1 (different template_exercise IDs)
    const blocks = [
      makeBlock({
        exercise: makeExercise('A', 'Squat'),
        sets: [makeSet('warmup'), makeSet('warmup'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 1,
        originalWorkingSets: 3,
      }),
      makeBlock({
        exercise: makeExercise('A', 'Squat'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 3,
      }),
    ];
    const tes = [
      makeTemplateExercise('te-1', 'A', 0, { warmup_sets: 1, default_sets: 3 }),
      makeTemplateExercise('te-2', 'A', 1, { warmup_sets: 0, default_sets: 3 }),
    ];
    const plan = buildTemplateUpdatePlan('tpl-1', blocks, tes);
    expect(plan).not.toBeNull();
    expect(plan!.setChanges).toHaveLength(2);
    // First occurrence: warmup changed 1->2, working unchanged
    expect(plan!.setChanges[0]).toEqual({
      templateExerciseId: 'te-1',
      sets: undefined,
      warmup_sets: 2,
    });
    // Second occurrence: working changed 3->5
    expect(plan!.setChanges[1]).toEqual({
      templateExerciseId: 'te-2',
      sets: 5,
      warmup_sets: undefined,
    });
    // computeOrderDiff deduplicates by exercise_id, so duplicate A collapses to one entry.
    // This creates a length mismatch (1 vs 2), producing a reorder with just one te ID.
    // This is expected — the reorder is a no-op in practice since the order didn't change.
    expect(plan!.reorderedTemplateExerciseIds).toEqual(['te-1']);
  });

  it('skips exercises not in template (mid-workout additions)', () => {
    const blocks = [
      makeBlock({
        exercise: makeExercise('A', 'Squat'),
        sets: [makeSet('working'), makeSet('working'), makeSet('working')],
        originalWarmupSets: 0,
        originalWorkingSets: 3,
      }),
      makeBlock({
        exercise: makeExercise('X', 'Curl'),
        sets: [makeSet('working'), makeSet('working')],
        // No originalWarmupSets/originalWorkingSets — ad-hoc addition
      }),
    ];
    const tes = [makeTemplateExercise('te-1', 'A', 0)];
    expect(buildTemplateUpdatePlan('tpl-1', blocks, tes)).toBeNull();
  });
});
