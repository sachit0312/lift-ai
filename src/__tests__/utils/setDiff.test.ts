import {
  computeSetDiffs,
  computeOrderDiff,
  buildTemplateUpdatePlan,
} from '../../utils/setDiff';
import type { ExerciseBlock, LocalSet } from '../../types/workout';
import type { TemplateExercise } from '../../types/database';
import { createMockExercise } from '../helpers/factories';

function makeSet(tag: LocalSet['tag'] = 'working'): LocalSet {
  return {
    id: 'set-' + Math.random(),
    exercise_id: 'ex',
    set_number: 1,
    weight: '',
    reps: '',
    rpe: '',
    tag,
    is_completed: false,
    previous: null,
  };
}

function makeBlock(opts: {
  exerciseId: string;
  exerciseName?: string;
  warmupCount: number;
  workingCount: number;
  originalWarmupSets?: number | null;
  originalWorkingSets?: number | null;
}): ExerciseBlock {
  const sets: LocalSet[] = [];
  for (let i = 0; i < opts.warmupCount; i++) sets.push(makeSet('warmup'));
  for (let i = 0; i < opts.workingCount; i++) sets.push(makeSet('working'));
  return {
    exercise: createMockExercise({ id: opts.exerciseId, name: opts.exerciseName ?? opts.exerciseId }),
    sets,
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: true,
    bestE1RM: undefined,
    originalWarmupSets: opts.originalWarmupSets ?? null,
    originalWorkingSets: opts.originalWorkingSets ?? null,
  } as ExerciseBlock;
}

function makeTE(exerciseId: string, id?: string): TemplateExercise {
  return {
    id: id ?? `te-${exerciseId}`,
    template_id: 't1',
    exercise_id: exerciseId,
    order: 0,
    default_sets: 3,
    rest_seconds: 90,
    warmup_sets: 1,
    exercise: createMockExercise({ id: exerciseId }),
  } as TemplateExercise;
}

describe('computeSetDiffs', () => {
  it('returns empty when originals are not stamped', () => {
    const block = makeBlock({ exerciseId: 'ex1', warmupCount: 1, workingCount: 3 });
    expect(computeSetDiffs([block])).toEqual([]);
  });

  it('returns diff when working count changed', () => {
    const block = makeBlock({
      exerciseId: 'ex1', warmupCount: 1, workingCount: 4,
      originalWarmupSets: 1, originalWorkingSets: 3,
    });
    const diffs = computeSetDiffs([block]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].workingBefore).toBe(3);
    expect(diffs[0].workingAfter).toBe(4);
  });

  it('treats failure/drop tags as working sets', () => {
    const block = makeBlock({
      exerciseId: 'ex1', warmupCount: 1, workingCount: 2,
      originalWarmupSets: 1, originalWorkingSets: 3,
    });
    // Add a failure and a drop set — they should count as working
    block.sets.push(makeSet('failure'));
    block.sets.push(makeSet('drop'));
    const diffs = computeSetDiffs([block]);
    // workingAfter = 2 working + 1 failure + 1 drop = 4
    expect(diffs[0].workingAfter).toBe(4);
  });

  it('returns no diff when counts match', () => {
    const block = makeBlock({
      exerciseId: 'ex1', warmupCount: 1, workingCount: 3,
      originalWarmupSets: 1, originalWorkingSets: 3,
    });
    expect(computeSetDiffs([block])).toEqual([]);
  });
});

describe('computeOrderDiff', () => {
  it('returns null when workout order matches template (subset matched)', () => {
    const blocks = [
      makeBlock({ exerciseId: 'a', warmupCount: 0, workingCount: 1 }),
      makeBlock({ exerciseId: 'b', warmupCount: 0, workingCount: 1 }),
    ];
    expect(computeOrderDiff(blocks, ['a', 'b'])).toBeNull();
  });

  it('returns diff when order differs', () => {
    const blocks = [
      makeBlock({ exerciseId: 'b', warmupCount: 0, workingCount: 1 }),
      makeBlock({ exerciseId: 'a', warmupCount: 0, workingCount: 1 }),
    ];
    const diff = computeOrderDiff(blocks, ['a', 'b']);
    expect(diff).not.toBeNull();
    expect(diff!.currentOrder).toEqual(['b', 'a']);
    // templateOrder preserves the template's original order, filtered to workout-present exercises
    expect(diff!.templateOrder).toEqual(['a', 'b']);
  });

  it('ignores workout-only exercises (added mid-workout)', () => {
    // Workout has [a, mid-added, b]; template only knows about [a, b].
    // computeOrderDiff filters blocks down to template exercises only.
    const blocks = [
      makeBlock({ exerciseId: 'a', warmupCount: 0, workingCount: 1 }),
      makeBlock({ exerciseId: 'midAdded', warmupCount: 0, workingCount: 1 }),
      makeBlock({ exerciseId: 'b', warmupCount: 0, workingCount: 1 }),
    ];
    expect(computeOrderDiff(blocks, ['a', 'b'])).toBeNull();
  });

  it('ignores template-only exercises (skipped in workout)', () => {
    const blocks = [
      makeBlock({ exerciseId: 'a', warmupCount: 0, workingCount: 1 }),
    ];
    // template has [a, b], workout only has [a]
    expect(computeOrderDiff(blocks, ['a', 'b'])).toBeNull();
  });

  it('handles a duplicate exercise in the workout (dedup currentOrder by first-seen)', () => {
    // Workout has exercise 'a' twice (mid-workout addition); template has [a, b]
    const blocks = [
      makeBlock({ exerciseId: 'a', warmupCount: 0, workingCount: 1 }),
      makeBlock({ exerciseId: 'a', warmupCount: 0, workingCount: 1 }), // duplicate
      makeBlock({ exerciseId: 'b', warmupCount: 0, workingCount: 1 }),
    ];
    // computeOrderDiff dedups currentOrder; should still see [a, b] order matches template — null
    expect(computeOrderDiff(blocks, ['a', 'b'])).toBeNull();
  });
});

describe('buildTemplateUpdatePlan', () => {
  it('returns null when no changes detected', () => {
    const blocks = [
      makeBlock({
        exerciseId: 'a', warmupCount: 1, workingCount: 3,
        originalWarmupSets: 1, originalWorkingSets: 3,
      }),
    ];
    const tes = [makeTE('a')];
    expect(buildTemplateUpdatePlan('t1', blocks, tes)).toBeNull();
  });

  it('reports set count changes only when present', () => {
    const blocks = [
      makeBlock({
        exerciseId: 'a', warmupCount: 1, workingCount: 5,
        originalWarmupSets: 1, originalWorkingSets: 3,
      }),
    ];
    const tes = [makeTE('a', 'te-a-1')];
    const plan = buildTemplateUpdatePlan('t1', blocks, tes);
    expect(plan).not.toBeNull();
    expect(plan!.setChanges).toEqual([
      { templateExerciseId: 'te-a-1', sets: 5, warmup_sets: undefined },
    ]);
    expect(plan!.reorderedTemplateExerciseIds).toBeNull();
  });

  it('reports order changes only when present', () => {
    const blocks = [
      makeBlock({
        exerciseId: 'b', warmupCount: 1, workingCount: 3,
        originalWarmupSets: 1, originalWorkingSets: 3,
      }),
      makeBlock({
        exerciseId: 'a', warmupCount: 1, workingCount: 3,
        originalWarmupSets: 1, originalWorkingSets: 3,
      }),
    ];
    const tes = [makeTE('a', 'te-a'), makeTE('b', 'te-b')];
    const plan = buildTemplateUpdatePlan('t1', blocks, tes);
    expect(plan).not.toBeNull();
    expect(plan!.setChanges).toEqual([]);
    expect(plan!.reorderedTemplateExerciseIds).toEqual(['te-b', 'te-a']);
  });

  it('reports warmup_sets change when only warmup count differs (working unchanged)', () => {
    const blocks = [
      makeBlock({
        exerciseId: 'a', warmupCount: 2, workingCount: 3,
        originalWarmupSets: 1, originalWorkingSets: 3,
      }),
    ];
    const tes = [makeTE('a', 'te-a')];
    const plan = buildTemplateUpdatePlan('t1', blocks, tes);
    expect(plan).not.toBeNull();
    expect(plan!.setChanges).toEqual([
      { templateExerciseId: 'te-a', sets: undefined, warmup_sets: 2 },
    ]);
  });

  it('reports both set count + order when both changed', () => {
    const blocks = [
      makeBlock({
        exerciseId: 'b', warmupCount: 1, workingCount: 4,  // +1 working
        originalWarmupSets: 1, originalWorkingSets: 3,
      }),
      makeBlock({
        exerciseId: 'a', warmupCount: 1, workingCount: 3,
        originalWarmupSets: 1, originalWorkingSets: 3,
      }),
    ];
    const tes = [makeTE('a', 'te-a'), makeTE('b', 'te-b')];
    const plan = buildTemplateUpdatePlan('t1', blocks, tes);
    expect(plan).not.toBeNull();
    expect(plan!.setChanges).toEqual([
      { templateExerciseId: 'te-b', sets: 4, warmup_sets: undefined },
    ]);
    expect(plan!.reorderedTemplateExerciseIds).toEqual(['te-b', 'te-a']);
  });
});
