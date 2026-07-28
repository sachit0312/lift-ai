/**
 * Tests for recomputeSessionBestE1RM (src/utils/bestE1RM.ts).
 *
 * This function has no direct test coverage even though its docstring describes a real
 * regression: the revert paths (un-checking a PR set, deleting a PR set) used to reset the
 * running best e1RM straight to the pre-workout `originalBest`, discarding any OTHER PR set
 * still completed in the session. With a 300 all-time best, hitting 310 then 325 and then
 * un-checking the 310 set reset the running best to 300 even though the 325 set was still
 * completed — so a later 305 fired a false PR badge + confetti + haptics for what was
 * actually a regression.
 *
 * Uses the REAL calculateE1RM (not mocked) so the RPE-table / ensemble / confidence-tier
 * logic is genuinely exercised, not just plumbing.
 */
import { recomputeSessionBestE1RM } from '../bestE1RM';
import { calculateE1RM } from '../oneRepMax';
import type { LocalSet } from '../../types/workout';

function makeSet(overrides: Partial<LocalSet> & { id: string }): LocalSet {
  return {
    exercise_id: 'ex-1',
    set_number: 1,
    weight: '100',
    reps: '5',
    rpe: '',
    tag: 'working',
    is_completed: true,
    ...overrides,
  };
}

describe('recomputeSessionBestE1RM', () => {
  it('excluding the higher of two completed PR sets still returns the lower PR, not originalBest', () => {
    // Pins the false-PR regression described in the docstring: un-checking the heavier of two
    // PR sets must fall back to the OTHER still-completed PR, never jump back to the
    // pre-workout best and let a later lighter set look like a fresh PR.
    const originalBest = 200;
    const lowerSet = makeSet({ id: 'set-lower', weight: '210', reps: '1', rpe: '' });
    const higherSet = makeSet({ id: 'set-higher', weight: '220', reps: '1', rpe: '' });

    const expectedLowerE1RM = calculateE1RM(210, 1, null).value;
    const expectedHigherE1RM = calculateE1RM(220, 1, null).value;
    // Sanity: both sets really do beat the pre-workout best, and higher > lower.
    expect(expectedHigherE1RM).toBeGreaterThan(expectedLowerE1RM);
    expect(expectedLowerE1RM).toBeGreaterThan(originalBest);

    const result = recomputeSessionBestE1RM(
      [lowerSet, higherSet],
      originalBest,
      'set-higher', // exclude the higher (heavier) set, as if it were just un-checked
    );

    expect(result).toBeCloseTo(expectedLowerE1RM);
    expect(result).not.toBe(originalBest);
  });

  it('returns undefined when originalBest is undefined and no sets are completed', () => {
    const sets = [makeSet({ id: 'set-1', is_completed: false })];
    expect(recomputeSessionBestE1RM(sets, undefined)).toBeUndefined();
  });

  it('skips sets with zero or blank weight', () => {
    const originalBest = 150;
    const zeroWeight = makeSet({ id: 'set-zero-weight', weight: '0', reps: '5' });
    const blankWeight = makeSet({ id: 'set-blank-weight', weight: '', reps: '5' });

    const result = recomputeSessionBestE1RM([zeroWeight, blankWeight], originalBest);
    expect(result).toBe(originalBest);
  });

  it('skips sets with zero or blank reps', () => {
    const originalBest = 150;
    const zeroReps = makeSet({ id: 'set-zero-reps', weight: '200', reps: '0' });
    const blankReps = makeSet({ id: 'set-blank-reps', weight: '200', reps: '' });

    const result = recomputeSessionBestE1RM([zeroReps, blankReps], originalBest);
    expect(result).toBe(originalBest);
  });

  it('treats a failure-tagged set as RPE 10, matching the completion path', () => {
    // A failure set stores rpe as null/blank (inherently RPE 10), but the e1RM math must use
    // 10 explicitly — same rule as the live completion path in WorkoutScreen.
    const failureSet = makeSet({ id: 'set-failure', weight: '225', reps: '6', rpe: '', tag: 'failure' });

    const expected = calculateE1RM(225, 6, 10).value;
    const result = recomputeSessionBestE1RM([failureSet], undefined);

    expect(result).toBeCloseTo(expected);
    // Also confirm it genuinely differs from treating rpe as absent (null), so the test
    // would fail if the failure->RPE10 mapping regressed.
    const withoutFailureMapping = calculateE1RM(225, 6, null).value;
    expect(expected).not.toBeCloseTo(withoutFailureMapping, 5);
  });

  it('ignores uncompleted sets even with large weight/reps', () => {
    const originalBest = 100;
    const uncompleted = makeSet({ id: 'set-uncompleted', weight: '500', reps: '10', is_completed: false });

    const result = recomputeSessionBestE1RM([uncompleted], originalBest);
    expect(result).toBe(originalBest);
  });

  it('honors excludeSetId, dropping only the targeted set from consideration', () => {
    const originalBest = 100;
    const included = makeSet({ id: 'set-included', weight: '150', reps: '5' });
    const excluded = makeSet({ id: 'set-excluded', weight: '400', reps: '5' });

    const expectedIncluded = calculateE1RM(150, 5, null).value;
    const result = recomputeSessionBestE1RM([included, excluded], originalBest, 'set-excluded');

    expect(result).toBeCloseTo(Math.max(originalBest, expectedIncluded));
    // The excluded set's e1RM (from 400lbs) would clearly have been higher — confirm it did
    // NOT leak into the result.
    const expectedExcluded = calculateE1RM(400, 5, null).value;
    expect(result).not.toBeCloseTo(expectedExcluded, 0);
  });

  it('uses an explicit RPE value when provided on a non-failure set', () => {
    const setWithRpe = makeSet({ id: 'set-rpe', weight: '185', reps: '5', rpe: '8', tag: 'working' });
    const expected = calculateE1RM(185, 5, 8).value;

    const result = recomputeSessionBestE1RM([setWithRpe], undefined);
    expect(result).toBeCloseTo(expected);
  });
});
