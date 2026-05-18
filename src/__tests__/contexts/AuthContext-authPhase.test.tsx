/**
 * Tests for Batch 7 Task 4: AuthContext exposes a single `authPhase` enum
 * that captures the three legal states (initializing | syncing | ready).
 */
import fs from 'fs';
import path from 'path';

describe('Batch 7 Task 4: AuthContext authPhase enum', () => {
  it('grep invariant: AuthContext exposes authPhase, not loading + syncing', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../contexts/AuthContext.tsx'),
      'utf8',
    );
    // The interface should declare authPhase, not the two booleans
    expect(src).toMatch(/authPhase:\s*AuthPhase/);
    // The two old boolean fields should be gone from the public type
    expect(src).not.toMatch(/^\s*loading:\s*boolean;\s*$/m);
    expect(src).not.toMatch(/^\s*syncing:\s*boolean;\s*$/m);
  });

  it('grep invariant: RootNavigator branches on authPhase, not on two booleans', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../navigation/RootNavigator.tsx'),
      'utf8',
    );
    // Specifically verify the branching predicate uses authPhase !== 'ready'
    expect(src).toMatch(/authPhase\s*!==\s*['"]ready['"]/);
    // The old `loading || syncing` predicate should be gone
    expect(src).not.toMatch(/loading\s*\|\|\s*syncing/);
    expect(src).not.toMatch(/syncing\s*\|\|\s*loading/);
  });
});
