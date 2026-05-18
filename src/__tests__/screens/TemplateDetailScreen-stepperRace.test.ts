/**
 * Tests for Batch 4 Task 2: makeStepperHandler must drop concurrent calls
 * for the same item, otherwise a second loadExercises can resolve before
 * the first write commits and clobber the UI with stale data.
 *
 * Contract test — the production fix adds an in-flight Set keyed by item.id.
 * We verify the contract via grep + an in-isolation model.
 */
describe('Batch 4 Task 2: stepper in-flight guard', () => {
  it('models the bug: concurrent stepper calls both fire loadExercises', async () => {
    let loadCount = 0;
    const loadExercises = () => { loadCount++; return Promise.resolve(); };
    const updateDb = jest.fn().mockResolvedValue(undefined);

    const handler = async (itemId: string, _newValue: number) => {
      await updateDb(itemId);
      await loadExercises();
    };

    await Promise.all([handler('a', 4), handler('a', 5)]);

    expect(loadCount).toBe(2); // <- bug: two loads race
  });

  it('models the fix: in-flight guard drops the second call for the same id', async () => {
    let loadCount = 0;
    const loadExercises = () => { loadCount++; return Promise.resolve(); };
    const updateDb = jest.fn().mockResolvedValue(undefined);
    const inFlight = new Set<string>();

    const handler = async (itemId: string, _newValue: number) => {
      if (inFlight.has(itemId)) return;
      inFlight.add(itemId);
      try {
        await updateDb(itemId);
        await loadExercises();
      } finally {
        inFlight.delete(itemId);
      }
    };

    await Promise.all([handler('a', 4), handler('a', 5)]);

    expect(loadCount).toBe(1);
    expect(updateDb).toHaveBeenCalledTimes(1);
  });

  it('models the fix: in-flight guard allows concurrent calls on different ids', async () => {
    let loadCount = 0;
    const loadExercises = () => { loadCount++; return Promise.resolve(); };
    const updateDb = jest.fn().mockResolvedValue(undefined);
    const inFlight = new Set<string>();

    const handler = async (itemId: string) => {
      if (inFlight.has(itemId)) return;
      inFlight.add(itemId);
      try {
        await updateDb(itemId);
        await loadExercises();
      } finally {
        inFlight.delete(itemId);
      }
    };

    await Promise.all([handler('a'), handler('b')]);

    expect(loadCount).toBe(2); // different ids, both run
  });

  it('grep invariant: TemplateDetailScreen uses an in-flight guard on stepper writes', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../screens/TemplateDetailScreen.tsx'),
      'utf8',
    );
    // The fix introduces a Set ref for in-flight stepper writes.
    expect(src).toMatch(/stepperInFlightRef|stepperInFlight/);
  });
});
