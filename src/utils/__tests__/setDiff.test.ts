import { computeSetDiffs, hasSetChanges } from '../setDiff';
import type { ExerciseBlock } from '../../types/workout';
import { createMockExercise } from '../../__tests__/helpers/factories';
import type { Exercise } from '../../types/database';

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
