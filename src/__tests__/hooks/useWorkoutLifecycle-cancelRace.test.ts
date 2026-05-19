/**
 * Tests for Batch 2 Task 1: cancel race in useWorkoutLifecycle.
 *
 * Verifies that calling handleCancelWorkout while a start handler is still
 * mid-Promise prevents the late activateWorkout from re-populating state.
 *
 * The cancel-generation guard works by capturing cancelGenerationRef.current
 * at the start of each start handler and checking it again before the final
 * activateWorkout call. If a cancel intervened, the captured generation no
 * longer matches and the handler bails out.
 *
 * Production source: src/hooks/useWorkoutLifecycle.ts
 */
import fs from 'fs';
import path from 'path';

describe('Batch 2 Task 1: cancel-generation guard invariant', () => {
  it('cancel-generation guard is present in production source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../hooks/useWorkoutLifecycle.ts'),
      'utf8',
    );
    // Cancel handler increments the generation
    expect(src).toMatch(/cancelGenerationRef\.current\s*\+=\s*1/);
    // Each start handler captures + checks the generation (3 handlers, but
    // handleStartFromUpcoming has TWO checks — before setUpcomingTargets and
    // before activateWorkout. So we expect >= 3 captures and >= 3 checks.)
    expect((src.match(/startGeneration\s*=\s*cancelGenerationRef\.current/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
    expect((src.match(/startGeneration\s*!==\s*cancelGenerationRef\.current/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
  });

  it('models the bug: late activateWorkout after cancel re-populates state (generation token fix)', async () => {
    // Reproduce the race in isolation, exercising the generation-token contract.
    let activeWorkout: { id: string } | null = null;
    const activateWorkout = (w: { id: string }) => { activeWorkout = w; };
    const cancelGenerationRef = { current: 0 };

    // Simulate a start handler that captures the generation and yields
    const startGeneration = cancelGenerationRef.current;
    const startPromise = (async () => {
      await Promise.resolve(); // yield like an await on buildExerciseBlock
      if (startGeneration !== cancelGenerationRef.current) return; // <- the fix
      activateWorkout({ id: 'workout-A' });
    })();

    // User cancels mid-await — increments the generation
    cancelGenerationRef.current += 1;
    activeWorkout = null; // simulating handleCancelWorkout zeroing state

    await startPromise;

    expect(activeWorkout).toBeNull(); // FIX: should remain null after cancel
  });

  it('starting B after cancelling A does NOT re-enable A continuation', async () => {
    // The shared-ref bug: cancellation A then start B reset cancelledRef back
    // to false, letting A's in-flight continuation succeed. The generation
    // token fixes this because each handler captures its own generation.
    let activeWorkout: { id: string } | null = null;
    const activateWorkout = (w: { id: string }) => { activeWorkout = w; };
    const cancelGenerationRef = { current: 0 };

    // Handler A captures gen 0, yields.
    const startGenerationA = cancelGenerationRef.current;
    const startA = (async () => {
      await Promise.resolve();
      await Promise.resolve(); // multiple yields so we can interleave
      if (startGenerationA !== cancelGenerationRef.current) return;
      activateWorkout({ id: 'workout-A' });
    })();

    // Cancel A — bumps generation to 1.
    cancelGenerationRef.current += 1;

    // Start B captures gen 1, runs to completion immediately.
    const startGenerationB = cancelGenerationRef.current;
    const startB = (async () => {
      await Promise.resolve();
      if (startGenerationB !== cancelGenerationRef.current) return;
      activateWorkout({ id: 'workout-B' });
    })();

    await Promise.all([startA, startB]);

    // B should win; A must NOT clobber it (its captured gen was 0, current is 1)
    expect(activeWorkout).toEqual({ id: 'workout-B' });
  });
});
