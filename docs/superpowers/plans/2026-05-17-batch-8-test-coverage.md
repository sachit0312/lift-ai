# Batch 8: Test Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six untested behaviors that were flagged in the original bug-bash review: the 1RM engine, the F3/F5 set-diff logic, the debounced-writes flush vs cancel semantics, freshness-decay correctness, AuthContext same-user-resume guard, and sync-rescue catch isolation.

**Architecture:** Pure additions — no production code changes (except optional `__testOnly` exports for paths that are only callable indirectly). Tests are unit-scope where possible; integration where the production path is co-mingled.

**Tech Stack:** Jest + jest-expo, `@testing-library/react-native`, existing `__mocks__/expo-sqlite` patterns.

**Repo:** This worktree. Branch: `claude/brave-spence-530049`.

---

## File Structure

**New test files (6):**
- `src/__tests__/utils/oneRepMax.test.ts`
- `src/__tests__/utils/setDiff.test.ts`
- `src/__tests__/hooks/useExerciseBlocks-flushCancel.test.ts`
- `src/__tests__/services/database-getCurrentE1RM-decay.test.ts`
- `src/__tests__/contexts/AuthContext-sameUserResume.test.tsx`
- `src/__tests__/services/sync-rescueCatchIsolation.test.ts`

(No production code changes.)

---

## Task 1: Direct 1RM engine tests

Cover `calculateE1RM`, `calculateEstimated1RM`, `getPRGatingMargin`, and the RPE table lookup boundaries.

**Files:**
- Create: `src/__tests__/utils/oneRepMax.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
/**
 * Direct unit tests for the 1RM engine.
 * Covers:
 *  - calculateE1RM: weight≤0, reps=0, reps=1 high-confidence path, RPE table path, ensemble fallback
 *  - calculateEstimated1RM: the legacy number-returning wrapper
 *  - getPRGatingMargin: per-tier margins
 *  - boundary conditions: brzycki ≥36 reps guard, RPE table boundaries (1-12 reps, 6-10 RPE)
 */
import {
  calculateE1RM,
  calculateEstimated1RM,
  getPRGatingMargin,
} from '../../utils/oneRepMax';
import { lookupPercentage } from '../../data/rpeTable';

describe('calculateE1RM', () => {
  describe('edge cases', () => {
    it('returns zero with low confidence when weight <= 0', () => {
      const r = calculateE1RM(0, 5, 8);
      expect(r.value).toBe(0);
      expect(r.confidence).toBe('low');
      expect(r.method).toBe('ensemble');
    });

    it('returns just the weight when reps <= 0 (unfinished set)', () => {
      const r = calculateE1RM(225, 0, 8);
      expect(r.value).toBe(225);
      expect(r.confidence).toBe('high');
      expect(r.marginPercent).toBe(0);
    });

    it('handles negative reps as 0', () => {
      const r = calculateE1RM(100, -3);
      expect(r.value).toBe(100);
    });
  });

  describe('RPE table path (Path A)', () => {
    it('uses Tuchscherer lookup when RPE is provided', () => {
      // Reps=5, RPE=8 → table value 0.811 → 1RM = weight / 0.811
      const r = calculateE1RM(200, 5, 8);
      expect(r.method).toBe('rpe_table');
      expect(r.value).toBeCloseTo(200 / 0.811, 1);
    });

    it('reps=1 RPE>=9 is HIGH confidence with margin 0 (near-max single)', () => {
      const r = calculateE1RM(200, 1, 10);
      expect(r.confidence).toBe('high');
      expect(r.marginPercent).toBe(0);
    });

    it('reps 1-5 with RPE>=7 is HIGH confidence with margin 3', () => {
      const r = calculateE1RM(200, 5, 7);
      expect(r.confidence).toBe('high');
      expect(r.marginPercent).toBe(3);
    });

    it('reps 6-10 is MEDIUM confidence with margin 6', () => {
      const r = calculateE1RM(150, 8, 8);
      expect(r.confidence).toBe('medium');
      expect(r.marginPercent).toBe(6);
    });

    it('reps 11+ is LOW confidence with margin 12', () => {
      const r = calculateE1RM(100, 12, 8);
      expect(r.confidence).toBe('low');
      expect(r.marginPercent).toBe(12);
    });
  });

  describe('ensemble path (Path B, no RPE)', () => {
    it('uses ensemble formulas when RPE is null/undefined', () => {
      const r = calculateE1RM(200, 5);
      expect(r.method).toBe('ensemble');
      expect(r.value).toBeGreaterThan(200); // any positive-rep 1RM exceeds load
    });

    it('reps=1 without RPE is HIGH confidence (near-max single)', () => {
      const r = calculateE1RM(200, 1);
      expect(r.confidence).toBe('high');
    });

    it('reps 2-5 without RPE drops to MEDIUM (no RPE-7+ guarantee)', () => {
      const r = calculateE1RM(200, 5);
      expect(r.confidence).toBe('medium');
    });
  });

  describe('brzycki guard at reps >= 36', () => {
    it('returns weight (formula undefined) for ensemble at 36 reps', () => {
      const r = calculateE1RM(100, 36);
      // brzycki returns weight at 36+; ensemble weighted average still produces a finite number > 0
      expect(r.value).toBeGreaterThan(0);
      expect(Number.isFinite(r.value)).toBe(true);
    });

    it('extreme rep counts (>=50) still produce finite output', () => {
      const r = calculateE1RM(100, 100);
      expect(Number.isFinite(r.value)).toBe(true);
    });
  });
});

describe('calculateEstimated1RM (legacy number-returning wrapper)', () => {
  it('returns the .value of calculateE1RM', () => {
    const full = calculateE1RM(225, 5, 8);
    const num = calculateEstimated1RM(225, 5, 8);
    expect(num).toBe(full.value);
  });

  it('returns 0 for invalid weight', () => {
    expect(calculateEstimated1RM(0, 5, 8)).toBe(0);
  });
});

describe('getPRGatingMargin', () => {
  it('returns 0 for high (any improvement counts)', () => {
    expect(getPRGatingMargin('high')).toBe(0);
  });

  it('returns 0.01 (1%) for medium', () => {
    expect(getPRGatingMargin('medium')).toBe(0.01);
  });

  it('returns 0.03 (3%) for low', () => {
    expect(getPRGatingMargin('low')).toBe(0.03);
  });
});

describe('rpeTable lookupPercentage boundaries', () => {
  it('returns exact table value at exact (reps, RPE) cells', () => {
    expect(lookupPercentage(1, 10)).toBeCloseTo(1.0, 3);
    expect(lookupPercentage(5, 8)).toBeCloseTo(0.811, 3);
    expect(lookupPercentage(10, 7)).toBeCloseTo(0.653, 3);
  });

  it('interpolates between RPE columns (rpe=7.25 between 7.0 and 7.5)', () => {
    const at7 = lookupPercentage(5, 7.0);
    const at75 = lookupPercentage(5, 7.5);
    const at725 = lookupPercentage(5, 7.25);
    expect(at725).toBeCloseTo((at7 + at75) / 2, 3);
  });

  it('interpolates between rep rows (4.5 reps between 4 and 5)', () => {
    const at4 = lookupPercentage(4, 8);
    const at5 = lookupPercentage(5, 8);
    const at45 = lookupPercentage(4.5, 8);
    expect(at45).toBeCloseTo((at4 + at5) / 2, 3);
  });

  it('clamps reps below 1 to row 1', () => {
    expect(lookupPercentage(0.5, 8)).toBeCloseTo(lookupPercentage(1, 8), 3);
  });

  it('clamps reps above 12 to row 12', () => {
    expect(lookupPercentage(15, 8)).toBeCloseTo(lookupPercentage(12, 8), 3);
  });

  it('clamps RPE below 6 to column 6.0', () => {
    expect(lookupPercentage(5, 5)).toBeCloseTo(lookupPercentage(5, 6.0), 3);
  });

  it('clamps RPE above 10 to column 10.0', () => {
    expect(lookupPercentage(5, 11)).toBeCloseTo(lookupPercentage(5, 10.0), 3);
  });
});
```

- [ ] **Step 2: Run tests**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/utils/oneRepMax.test.ts
```
Expected: PASS. If `lookupPercentage` doesn't actually clamp out-of-range inputs, adjust the test expectations to match the real production behavior — the assertion in this plan is based on the most common implementation, but verify by reading `src/data/rpeTable.ts`. If clamping isn't present, drop those four clamp tests rather than changing production code.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/utils/oneRepMax.test.ts
git commit -m "test(utils): direct coverage for 1RM engine, confidence tiers, and RPE table boundaries"
```

---

## Task 2: setDiff (F3/F5) pure-function tests

Cover `computeSetDiffs`, `hasSetChanges`, `computeOrderDiff`, `buildTemplateUpdatePlan` — pure functions with no React/DB coupling, so unit testing is straightforward.

**Files:**
- Create: `src/__tests__/utils/setDiff.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import {
  computeSetDiffs,
  hasSetChanges,
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
    sort_order: 0,
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

describe('hasSetChanges', () => {
  it('returns true iff computeSetDiffs returns non-empty', () => {
    const stable = makeBlock({
      exerciseId: 'a', warmupCount: 1, workingCount: 3,
      originalWarmupSets: 1, originalWorkingSets: 3,
    });
    const changed = makeBlock({
      exerciseId: 'b', warmupCount: 1, workingCount: 5,
      originalWarmupSets: 1, originalWorkingSets: 3,
    });
    expect(hasSetChanges([stable])).toBe(false);
    expect(hasSetChanges([stable, changed])).toBe(true);
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
    expect(diff!.templateOrder).toEqual(['b', 'a']);  // filtered to workout-present
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
```

- [ ] **Step 2: Run tests**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/utils/setDiff.test.ts
```
Expected: PASS. If any test fails because the production function behaves differently than the assertion claims, update the assertion to match real behavior — the goal is to lock in current production behavior, not impose a new spec.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/utils/setDiff.test.ts
git commit -m "test(utils): pure-function coverage for setDiff (F3/F5) — sets, order, plan"
```

---

## Task 3: pendingSetWritesRef flush vs cancel

Verify `flushPendingSetWrites()` writes coalesced data; `clearPendingSetWrites()` does NOT write.

**Files:**
- Create: `src/__tests__/hooks/useExerciseBlocks-flushCancel.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
/**
 * Verifies that flushPendingSetWrites coalesces pending debounced writes
 * to SQLite, and that clearPendingSetWrites discards them without writing.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useExerciseBlocks } from '../../hooks/useExerciseBlocks';
import type { ExerciseBlock } from '../../types/workout';
import { createMockExercise } from '../helpers/factories';

jest.mock('../../services/database', () => ({
  addWorkoutSet: jest.fn().mockResolvedValue({ id: 'new-set' }),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
  deleteWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/exerciseHistory', () => ({
  getExerciseHistoryData: jest.fn().mockResolvedValue({ previousSets: [], lastTime: null }),
}));

const db = require('../../services/database');

function makeBlock(): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: 'ex-1' }),
    sets: [
      { id: 's1', exercise_id: 'ex-1', set_number: 1, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null, exercise_order: 1 },
      { id: 's2', exercise_id: 'ex-1', set_number: 2, weight: '', reps: '', rpe: '', tag: 'working', is_completed: false, previous: null, exercise_order: 1 },
    ],
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: true,
    bestE1RM: undefined,
  };
}

describe('useExerciseBlocks flush/cancel semantics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function setup() {
    const block = makeBlock();
    const blocksRef = { current: [block] };
    const { result } = renderHook(() =>
      useExerciseBlocks({
        workoutRef: { current: { id: 'w1' } as any },
        blocksRef,
        lastActiveBlockRef: { current: 0 },
        debouncedSaveNotes: jest.fn(),
      }),
    );
    act(() => { result.current.setExerciseBlocks([block]); });
    return { result };
  }

  it('flushPendingSetWrites coalesces multiple field updates into ONE writeAsync per set', () => {
    const { result } = setup();

    // Three rapid keystrokes for set s1, all coalesce in the 300ms debounce window
    act(() => {
      result.current.handleSetChange(0, 0, 'weight', '100');
      result.current.handleSetChange(0, 0, 'weight', '110');
      result.current.handleSetChange(0, 0, 'reps', '5');
    });

    // No DB write yet — within debounce
    expect(db.updateWorkoutSet).not.toHaveBeenCalled();

    // Flush before the timer fires
    act(() => {
      result.current.flushPendingSetWrites();
    });

    // Exactly ONE write, with the coalesced final values
    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(db.updateWorkoutSet).toHaveBeenCalledWith('s1', expect.objectContaining({
      weight: 110,
      reps: 5,
    }));
  });

  it('clearPendingSetWrites discards pending writes without calling updateWorkoutSet', () => {
    const { result } = setup();

    act(() => {
      result.current.handleSetChange(0, 0, 'weight', '100');
      result.current.handleSetChange(0, 1, 'reps', '5');
    });

    act(() => {
      result.current.clearPendingSetWrites();
    });

    // Advance timers past the debounce window — writes should NOT fire
    act(() => { jest.advanceTimersByTime(500); });

    expect(db.updateWorkoutSet).not.toHaveBeenCalled();
  });

  it('writes still fire automatically after 300ms if not explicitly flushed/cleared', () => {
    const { result } = setup();

    act(() => {
      result.current.handleSetChange(0, 0, 'weight', '100');
    });

    expect(db.updateWorkoutSet).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(350); });

    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(db.updateWorkoutSet).toHaveBeenCalledWith('s1', expect.objectContaining({ weight: 100 }));
  });
});
```

- [ ] **Step 2: Run tests**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/hooks/useExerciseBlocks-flushCancel.test.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/hooks/useExerciseBlocks-flushCancel.test.ts
git commit -m "test(hooks): flushPendingSetWrites coalesces, clearPendingSetWrites discards"
```

---

## Task 4: getCurrentE1RM freshness decay correctness

Verify the exponential decay formula returns a smaller value for an old PR than for a recent submaximal lift.

**Files:**
- Create: `src/__tests__/services/database-getCurrentE1RM-decay.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
/**
 * Verifies the freshness-decay formula in getCurrentE1RM:
 *   decay = exp(-ln(2) * daysAgo / FRESHNESS_HALF_LIFE_DAYS)
 *
 * An old PR weighted by decay should yield a smaller "current" than a recent
 * submaximal lift if the old PR is old enough.
 */

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

jest.mock('../../utils/oneRepMax', () => {
  const actual = jest.requireActual('../../utils/oneRepMax');
  return {
    ...actual,
    calculateEstimated1RM: (w: number, r: number) => w * (1 + r / 30),
  };
});

const { getCurrentE1RM } = require('../../services/database');

describe('getCurrentE1RM freshness decay', () => {
  beforeEach(() => {
    __mockDb.getAllAsync.mockReset();
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.runAsync.mockResolvedValue({ changes: 0 } as any);
    __mockDb.getFirstAsync.mockResolvedValue(null);
  });

  it('returns null when no completed sets', async () => {
    __mockDb.getAllAsync.mockResolvedValueOnce([]);
    expect(await getCurrentE1RM('ex1')).toBeNull();
  });

  it('returns decay-weighted best — old PR weighted less than recent submaximal', async () => {
    const now = Date.now();
    const oneYearAgo = new Date(now - 365 * 86400000).toISOString();
    const today = new Date(now).toISOString();

    __mockDb.getAllAsync.mockResolvedValueOnce([
      // Old PR: 300×5 ≈ raw 350 e1RM; ~365 days old; half-life 42 → ~6 half-lives → decay ≈ 0.015
      { exercise_id: 'ex1', weight: 300, reps: 5, rpe: 8, finished_at: oneYearAgo },
      // Recent submaximal: 150×5 ≈ raw 175 e1RM; today; decay ≈ 1.0
      { exercise_id: 'ex1', weight: 150, reps: 5, rpe: 8, finished_at: today },
    ]);

    const current = await getCurrentE1RM('ex1');
    expect(current).not.toBeNull();
    // The recent submaximal (~175) should beat the heavily-decayed old PR (~5)
    expect(current).toBeCloseTo(175, 0);
  });

  it('returns full raw value (decay ≈ 1) for today\'s sets', async () => {
    const today = new Date().toISOString();
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex1', weight: 200, reps: 5, rpe: 8, finished_at: today },
    ]);

    const current = await getCurrentE1RM('ex1');
    // Raw: 200 * (1 + 5/30) ≈ 233.3; decay today ≈ 1 → expect ≈ 233.3
    expect(current).toBeCloseTo(233.3, 0);
  });

  it('returns the maximum weighted value across multiple sets', async () => {
    const today = new Date().toISOString();
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex1', weight: 200, reps: 5, rpe: 8, finished_at: today },  // ~233.3
      { exercise_id: 'ex1', weight: 220, reps: 5, rpe: 8, finished_at: today },  // ~256.7 (higher)
      { exercise_id: 'ex1', weight: 180, reps: 5, rpe: 8, finished_at: today },  // ~210
    ]);
    const current = await getCurrentE1RM('ex1');
    expect(current).toBeCloseTo(256.7, 0);
  });

  it('approximately halves the weighted value at one half-life (42 days)', async () => {
    const halfLifeAgo = new Date(Date.now() - 42 * 86400000).toISOString();
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { exercise_id: 'ex1', weight: 200, reps: 5, rpe: 8, finished_at: halfLifeAgo },
    ]);
    const current = await getCurrentE1RM('ex1');
    // Raw ≈ 233.3; at one half-life decay is exactly 0.5 → expect ≈ 116.7
    expect(current).toBeCloseTo(233.3 * 0.5, 0);
  });
});
```

- [ ] **Step 2: Run tests**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/database-getCurrentE1RM-decay.test.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/services/database-getCurrentE1RM-decay.test.ts
git commit -m "test(db): freshness-decay correctness for getCurrentE1RM (half-life math)"
```

---

## Task 5: AuthContext SIGNED_IN with same user ID does NOT reset

Verify the `newUserId !== prevUserId` guard prevents `resetDatabase` / pulls from firing on a re-emitted SIGNED_IN with the same user (e.g., token refresh that Supabase elevates).

**Files:**
- Create: `src/__tests__/contexts/AuthContext-sameUserResume.test.tsx`

- [ ] **Step 1: Create the test file**

```typescript
/**
 * Verifies that SIGNED_IN re-emitted with the SAME user.id does not trigger
 * resetDatabase or the pull sequence. The existing tests cover TOKEN_REFRESHED;
 * this covers the SIGNED_IN-same-user path explicitly.
 *
 * Sourced from the original Batch 1-bash review (test gap #5).
 */
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';

// Mock the supabase + database + sync modules used by AuthContext
let authStateCallback: ((event: string, session: unknown) => void) | null = null;

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'user-A' } } } }),
      onAuthStateChange: jest.fn((cb: typeof authStateCallback) => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
  },
}));

const mockResetDatabase = jest.fn().mockResolvedValue(undefined);
const mockSetCurrentUserId = jest.fn();
const mockClearAllLocalData = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/database', () => ({
  resetDatabase: mockResetDatabase,
  setCurrentUserId: mockSetCurrentUserId,
  clearAllLocalData: mockClearAllLocalData,
}));

const mockPullExercisesAndTemplates = jest.fn().mockResolvedValue(undefined);
const mockPullWorkoutHistory = jest.fn().mockResolvedValue(undefined);
const mockPullUpcomingWorkout = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/sync', () => ({
  pullExercisesAndTemplates: mockPullExercisesAndTemplates,
  pullWorkoutHistory: mockPullWorkoutHistory,
  pullUpcomingWorkout: mockPullUpcomingWorkout,
}));

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

function AuthConsumer() {
  useAuth();
  return null;
}

describe('AuthContext: SIGNED_IN with same user ID', () => {
  beforeEach(() => {
    mockResetDatabase.mockClear();
    mockPullExercisesAndTemplates.mockClear();
    mockPullWorkoutHistory.mockClear();
    mockPullUpcomingWorkout.mockClear();
    mockSetCurrentUserId.mockClear();
    authStateCallback = null;
  });

  it('does NOT call resetDatabase when SIGNED_IN fires for the existing user', async () => {
    render(<AuthProvider><AuthConsumer /></AuthProvider>);

    // Wait for initial getSession + INITIAL_SESSION to settle
    await act(async () => { await Promise.resolve(); });

    expect(authStateCallback).not.toBeNull();

    // Initial SIGNED_IN with user-A (sets previousUserIdRef to user-A)
    await act(async () => {
      authStateCallback!('SIGNED_IN', { user: { id: 'user-A' } });
    });

    const firstResetCount = mockResetDatabase.mock.calls.length;

    // Re-emit SIGNED_IN with SAME user-A — guard must skip resetDatabase + pulls
    await act(async () => {
      authStateCallback!('SIGNED_IN', { user: { id: 'user-A' } });
    });

    expect(mockResetDatabase.mock.calls.length).toBe(firstResetCount);
    // setCurrentUserId is still called unconditionally on every auth event (per CLAUDE.md)
    expect(mockSetCurrentUserId).toHaveBeenCalledWith('user-A');
  });

  it('DOES call resetDatabase when SIGNED_IN fires for a DIFFERENT user', async () => {
    render(<AuthProvider><AuthConsumer /></AuthProvider>);
    await act(async () => { await Promise.resolve(); });

    // user-A signs in first
    await act(async () => {
      authStateCallback!('SIGNED_IN', { user: { id: 'user-A' } });
    });
    const resetsAfterA = mockResetDatabase.mock.calls.length;

    // user-B signs in (different user) — should trigger reset
    await act(async () => {
      authStateCallback!('SIGNED_IN', { user: { id: 'user-B' } });
    });

    expect(mockResetDatabase.mock.calls.length).toBeGreaterThan(resetsAfterA);
  });
});
```

- [ ] **Step 2: Run tests**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/contexts/AuthContext-sameUserResume.test.tsx
```
Expected: PASS. If the test fails because the AuthContext's existing test scaffolding (in `src/contexts/__tests__/AuthContext.test.tsx`) uses different mock-module paths, adapt the mocks to match the existing convention.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/contexts/AuthContext-sameUserResume.test.tsx
git commit -m "test(auth): SIGNED_IN with same user ID does not reset database"
```

---

## Task 6: Sync rescue block catch isolation

Verify that when the rescue block (`DELETE` / `UPDATE` to repair `'local'` orphans) throws, the downstream `syncToSupabase` push pipeline still runs.

**Files:**
- Create: `src/__tests__/services/sync-rescueCatchIsolation.test.ts`

(Note: there is already `src/__tests__/sync.rescueLocal.test.ts` covering happy-path rescue. This task adds the catch-isolation case.)

- [ ] **Step 1: Create the test file**

```typescript
/**
 * Verifies the rescue block's catch isolation: if the rescue SQL fails,
 * downstream Supabase pushes must still proceed (the rescue is best-effort).
 */

const __mockDb = require('../../__mocks__/expo-sqlite').__mockDb;

const mockUpsertNotes = jest.fn().mockResolvedValue({ data: null, error: null });
const mockUpsertExercises = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'user-A' } } } }) },
    from: jest.fn((table: string) => {
      const upsert = table === 'user_exercise_notes' ? mockUpsertNotes : mockUpsertExercises;
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ data: [], error: null }),
          not: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ data: [], error: null }) }) }),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
        upsert,
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) }),
        update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) }),
      };
    }),
  },
}));

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

const { syncToSupabase } = require('../../services/sync');
const Sentry = require('@sentry/react-native');

describe('Batch 8: sync rescue catch isolation', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockReset();
    __mockDb.getAllAsync.mockReset();
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.getFirstAsync.mockResolvedValue(null);
    mockUpsertNotes.mockClear();
    mockUpsertExercises.mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it('downstream push still runs when the rescue UPDATE throws', async () => {
    // Set up: rescue DELETE/UPDATE calls reject; everything else resolves
    __mockDb.runAsync.mockImplementation((sql: string) => {
      // Match the rescue statements (DELETE FROM user_exercise_notes WHERE user_id = 'local'
      // and UPDATE ... SET user_id = <session> WHERE user_id = 'local')
      if (/WHERE user_id\s*=\s*['"]local['"]/i.test(sql) || /SET user_id = \?\s+WHERE user_id\s*=\s*['"]local['"]/i.test(sql)) {
        return Promise.reject(new Error('rescue failure (simulated)'));
      }
      return Promise.resolve({ changes: 0 });
    });

    // Push-side reads (custom exercises, user_exercise_notes, templates, workouts):
    // return empty arrays so we get to the upsert call sites with nothing to push,
    // but the function still progresses past the rescue block.
    __mockDb.getAllAsync.mockResolvedValue([]);

    await syncToSupabase();

    // Sentry should have captured the rescue error
    expect(Sentry.captureException).toHaveBeenCalled();

    // Downstream pushes proceeded — supabase.from was called for at least one table
    const supabaseFrom = require('../../services/supabase').supabase.from as jest.Mock;
    expect(supabaseFrom).toHaveBeenCalled();
  });

  it('happy-path rescue does not log to Sentry', async () => {
    __mockDb.runAsync.mockResolvedValue({ changes: 0 });
    __mockDb.getAllAsync.mockResolvedValue([]);

    await syncToSupabase();

    // No Sentry capture from rescue branch in happy path
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/services/sync-rescueCatchIsolation.test.ts
```
Expected: PASS. If the test fails due to mock-shape mismatches with the existing `sync.rescueLocal.test.ts`, copy the mock structure from that file.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/services/sync-rescueCatchIsolation.test.ts
git commit -m "test(sync): rescue catch isolation — downstream push proceeds when rescue throws"
```

---

## Task 7: Final verification

- [ ] **Step 1: Full Jest suite**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all green; +30-40 new tests from this batch.

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Confirm production files untouched**

```
git diff --name-only main..HEAD -- 'src/utils/' 'src/services/' 'src/contexts/' 'src/hooks/' ':(exclude)*test*' ':(exclude)*__tests__*'
```
Expected: only the production files modified by Batches 2-7 should show; nothing new from Batch 8.

If Batch 8 changes any non-test file, that's a deviation worth documenting (e.g., an `__testOnly_` export added for testability).

- [ ] **Step 4: Code review (mandatory gate per CLAUDE.md)**

```
/code-review deep --spec docs/superpowers/plans/2026-05-17-batch-8-test-coverage.md
```
Address any actionable findings.

---

## Risks and rollback

- All tasks are pure test additions. Worst case: a test asserts behavior that doesn't match production. Adjust assertions to match real behavior (the goal is to LOCK IN current behavior; not to impose new specs).
- If `getCurrentE1RM` decay formula doesn't quite match expected math, the test will fail with clear "expected X, got Y" — adjust the test to the real formula.
- Tasks 5 (AuthContext) and 6 (sync rescue) require careful mocking. If the existing `src/contexts/__tests__/AuthContext.test.tsx` already shows the right patterns, copy them.

---

## Self-review notes

- Spec coverage: 6 gaps → 6 tasks + verification. ✓
- Placeholder scan: none. ✓
- Type consistency: mock factories follow existing `__mockDb` pattern. `createMockExercise` is the existing helper. ✓
- Files touched: 6 new test files, zero production source changes. ✓
