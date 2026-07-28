# Batch 7: Simplifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four conservative simplifications: delete dead `getE1RMWithConfidence`, delete dead theme stylesheets, fix `formatDate` DST bug by adopting `formatLastPerformed`'s calendar-day math via a shared `daysAgo` helper, collapse `AuthContext`'s `loading` + `syncing` booleans into an `authPhase` enum.

**Architecture:** Each fix is local — one or two files. No new abstractions. The DST fix introduces a small `utils/daysAgo` helper used by both date-formatters. The `authPhase` enum replaces two booleans that consumers always check together.

**Tech Stack:** TypeScript, React Native (Expo), Jest.

**Repo:** This worktree (`/Users/sachitgoyal/code/lift-ai/.claude/worktrees/brave-spence-530049/`). Branch: `claude/brave-spence-530049`.

**Deferred to a future batch (risk vs reward unfavorable):**
- Extract `<ExerciseForm>` component — three call sites diverge enough (testIDs, button text, notes-field presence, layout) that a shared component would need significant prop surface; net dedup is marginal.
- Generic `useDebouncedKeyedWriter<T>` — `useNotesDebounce` + `pendingSetWritesRef` + session-notes debounce all carry race-sensitive guards that were tuned across Batches 2-4; consolidation now risks regressing recently-fixed races.
- `usePRTracker` hook — `currentBestE1RMRef` / `originalBestE1RMRef` / `block.bestE1RM` triple coordinates across `useExerciseBlocks`, `useSetCompletion`, and `useWorkoutLifecycle`; the in-sync invariant was tightened in Batch 2 fix commit `5ee8d32` and a refactor would re-open that surface.

---

## File Structure

**Modified files (6):**
- `src/services/database.ts` — Task 1 (delete `getE1RMWithConfidence`)
- `src/services/__tests__/database.test.ts` — Task 1 (delete its test block)
- `src/theme/sharedStyles.ts` — Task 2 (delete 4 stylesheets)
- `src/theme/index.ts` — Task 2 (drop re-exports)
- `src/utils/format.ts` — Task 3 (use `daysAgo` helper)
- `src/utils/formatLastPerformed.ts` — Task 3 (use `daysAgo` helper)
- `src/contexts/AuthContext.tsx` — Task 4 (authPhase enum)
- `src/navigation/RootNavigator.tsx` — Task 4 (consume new shape)
- `src/screens/ProfileScreen.tsx` — Task 4 (consume new shape; uses session/user, but verify)

**New files (1):**
- `src/utils/daysAgo.ts` — Task 3 (shared local-timezone calendar-day diff)

**New test files (2):**
- `src/__tests__/utils/daysAgo.test.ts`
- `src/__tests__/contexts/AuthContext-authPhase.test.tsx`

---

## Task 1: Delete dead `getE1RMWithConfidence`

**Problem.** `getE1RMWithConfidence` is exported from `database.ts:1386` and only consumed by its own test block (`database.test.ts:506-540`). After Batch 6, `ExerciseHistoryContent` migrated to `getE1RMSummary` (which already returns a confidence result). The standalone function is dead.

**Files:**
- Modify: `src/services/database.ts` — delete `getE1RMWithConfidence` (lines 1386 onward, find the function)
- Modify: `src/services/__tests__/database.test.ts` — delete its `describe('getE1RMWithConfidence', ...)` block + the import
- Modify: `src/services/database.ts` — update the JSDoc on `getE1RMSummary` to drop the reference to "and `getE1RMWithConfidence`"

- [ ] **Step 1: Verify zero non-test consumers**

Run:
```bash
grep -rn 'getE1RMWithConfidence' src/ --include='*.ts' --include='*.tsx' | grep -v __tests__
```
Expected: only the function declaration itself in `database.ts` and the JSDoc reference. If any non-test file imports it, STOP and report BLOCKED.

- [ ] **Step 2: Delete the function**

In `src/services/database.ts`, locate `export function getE1RMWithConfidence(exerciseId: string): Promise<E1RMResult | null>` and delete the function entirely. Also delete its JSDoc.

- [ ] **Step 3: Update `getE1RMSummary` JSDoc**

In `src/services/database.ts`, find the `getE1RMSummary` JSDoc and replace any mention of `getE1RMWithConfidence` with the remaining two (`getBestE1RM`, `getCurrentE1RM`):

```typescript
 * The pre-existing single-purpose functions (getBestE1RM, getCurrentE1RM)
 * remain exported for callers that need only one value (e.g., PR detection
 * in useWorkoutLifecycle / useSetCompletion).
```

- [ ] **Step 4: Delete the test block + import**

In `src/services/__tests__/database.test.ts`:
- Remove `getE1RMWithConfidence` from the import on line 30
- Delete the `describe('getE1RMWithConfidence', () => { ... })` block at line 506 (use the surrounding `});` to find the bounds)

- [ ] **Step 5: Build + tests**

```
npx tsc --noEmit
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: tsc 0; tests pass (count drops by the number of removed tests, ~3).

- [ ] **Step 6: Commit**

```bash
git add src/services/database.ts src/services/__tests__/database.test.ts
git commit -m "refactor(db): delete dead getE1RMWithConfidence (superseded by getE1RMSummary)"
```

---

## Task 2: Delete dead theme stylesheets

**Problem.** `src/theme/sharedStyles.ts` exports `cardStyles`, `buttonStyles`, `inputStyles`, `emptyStateStyles` — all four have zero non-self consumers. Verified by `grep` (only the file itself and the re-export in `theme/index.ts` reference them).

**Files:**
- Modify: `src/theme/sharedStyles.ts` — delete 4 stylesheets
- Modify: `src/theme/index.ts` — drop the 4 re-exports

- [ ] **Step 1: Verify zero consumers**

```bash
grep -rn 'cardStyles\|buttonStyles\|inputStyles\|emptyStateStyles' src/ --include='*.ts' --include='*.tsx' | grep -v 'theme/'
```
Expected: zero matches. If any consumer is found, STOP and report BLOCKED.

- [ ] **Step 2: Delete from `sharedStyles.ts`**

In `src/theme/sharedStyles.ts`, delete lines 72-180 (the four StyleSheet declarations). Keep `modalStyles` (lines 4-70).

- [ ] **Step 3: Update `src/theme/index.ts`**

Find:

```typescript
export { modalStyles, cardStyles, buttonStyles, inputStyles, emptyStateStyles } from './sharedStyles';
```

Replace with:

```typescript
export { modalStyles } from './sharedStyles';
```

- [ ] **Step 4: Build + tests**

```
npx tsc --noEmit
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -6
```
Expected: tsc 0; tests green. If tsc reports unused imports of the deleted styles, they were truly unused — fix the import lists.

- [ ] **Step 5: Commit**

```bash
git add src/theme/sharedStyles.ts src/theme/index.ts
git commit -m "refactor(theme): delete dead cardStyles/buttonStyles/inputStyles/emptyStateStyles"
```

---

## Task 3: Shared `daysAgo` helper — fix `formatDate` DST bug

**Problem.** `formatDate` (`src/utils/format.ts:11-26`) computes day difference via ms-based math: `Math.floor((now - d) / 86400000)`. This breaks across DST boundaries — a timestamp 23 hours ago can falsely register as `0` days (today) on a "fall back" day or `1` day on "spring forward". `formatLastPerformed` already uses correct local-timezone calendar-day math. Extract that into a shared helper and use it in both.

**Files:**
- Create: `src/utils/daysAgo.ts`
- Modify: `src/utils/format.ts`
- Modify: `src/utils/formatLastPerformed.ts`
- Test: `src/__tests__/utils/daysAgo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/utils/daysAgo.test.ts`:

```typescript
/**
 * Tests for Batch 7 Task 3: daysAgo computes calendar-day diff in local
 * timezone — robust to DST boundaries.
 */
import { daysAgo } from '../../utils/daysAgo';

describe('Batch 7 Task 3: daysAgo', () => {
  it('returns 0 for a timestamp earlier today', () => {
    const earlierToday = new Date();
    earlierToday.setHours(earlierToday.getHours() - 1);
    expect(daysAgo(earlierToday.toISOString())).toBe(0);
  });

  it('returns 1 for a timestamp on the previous calendar day', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 0, 0);
    expect(daysAgo(yesterday.toISOString())).toBe(1);
  });

  it('returns 7 for a timestamp one week ago', () => {
    const now = new Date();
    const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 12, 0, 0);
    expect(daysAgo(weekAgo.toISOString())).toBe(7);
  });

  it('handles month boundary correctly', () => {
    const now = new Date(2026, 2, 1, 0, 0, 0); // 1 March 2026
    const lastMonth = new Date(2026, 1, 28, 23, 0, 0); // 28 Feb 2026
    // Mock the system clock for this test
    const realDate = Date;
    global.Date = class extends realDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) {
          super(now);
        } else {
          super(...args);
        }
      }
      static now() { return now.getTime(); }
    } as DateConstructor;

    try {
      expect(daysAgo(lastMonth.toISOString())).toBe(1);
    } finally {
      global.Date = realDate;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/utils/daysAgo.test.ts
```
Expected: FAIL — `Cannot find module '../../utils/daysAgo'`.

- [ ] **Step 3: Create the helper**

Create `src/utils/daysAgo.ts`:

```typescript
/**
 * Calendar-day difference in the LOCAL timezone, robust to DST boundaries.
 *
 * Uses `new Date(year, month, day)` to normalize both timestamps to local midnight,
 * then converts the difference to days via 86400000 ms. Because both endpoints are
 * normalized to the same time-of-day in local time, DST shifts cancel out across
 * any single day boundary and do not affect the integer result.
 *
 * Returns a non-negative integer. Future timestamps return 0.
 */
export function daysAgo(iso: string): number {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(0, Math.round((today.getTime() - dateDay.getTime()) / 86400000));
}
```

- [ ] **Step 4: Run tests to verify all 4 pass**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/utils/daysAgo.test.ts
```
Expected: PASS.

- [ ] **Step 5: Migrate `formatDate` to use `daysAgo`**

Replace `src/utils/format.ts`:

```typescript
import { daysAgo } from './daysAgo';

export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '--';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = daysAgo(iso);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}
```

- [ ] **Step 6: Migrate `formatLastPerformed` to use `daysAgo`**

Replace `src/utils/formatLastPerformed.ts`:

```typescript
import { daysAgo } from './daysAgo';

export function formatLastPerformed(isoDate: string): string {
  const diffDays = daysAgo(isoDate);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`;
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
```

- [ ] **Step 7: Run full Jest suite for regressions**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all green. The existing `format.test.ts` and `formatLastPerformed.test.ts` should pass unchanged — both functions return the same labels at every input the old code returned correctly, and the formerly-incorrect DST-boundary cases now resolve to the right day.

- [ ] **Step 8: Commit**

```bash
git add src/utils/daysAgo.ts src/utils/format.ts src/utils/formatLastPerformed.ts src/__tests__/utils/daysAgo.test.ts
git commit -m "refactor(utils): share daysAgo helper, fix formatDate DST bug"
```

---

## Task 4: AuthContext `authPhase` enum

**Problem.** `AuthContext.tsx` exposes `loading: boolean` and `syncing: boolean` independently. `RootNavigator` reads both and ORs them (`loading || syncing` → spinner). Two booleans + a typed value (`session`) means 6 representable states, only 3 of which make sense. An enum makes the legal states explicit and prevents impossible combos like `loading && syncing`.

**Files:**
- Modify: `src/contexts/AuthContext.tsx`
- Modify: `src/navigation/RootNavigator.tsx`
- Test: `src/__tests__/contexts/AuthContext-authPhase.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/contexts/AuthContext-authPhase.test.tsx`:

```typescript
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
    expect(src).toMatch(/authPhase/);
    // The old `loading || syncing` predicate should be gone
    expect(src).not.toMatch(/loading\s*\|\|\s*syncing/);
    expect(src).not.toMatch(/syncing\s*\|\|\s*loading/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/__tests__/contexts/AuthContext-authPhase.test.tsx
```
Expected: FAIL — pre-fix grep doesn't see `authPhase`.

- [ ] **Step 3: Refactor `AuthContext.tsx`**

Edit `src/contexts/AuthContext.tsx`. Update the type and state:

Find the interface declaration around line 11-16 (the one exposing `loading: boolean; syncing: boolean;`). Replace with:

```typescript
export type AuthPhase = 'initializing' | 'syncing' | 'ready';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  authPhase: AuthPhase;
}
```

(Keep the actual field shape but replace `loading` and `syncing` with `authPhase`. If there are other fields like `user`, preserve them.)

Find the state declarations around lines 21-22:

```typescript
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
```

Replace with:

```typescript
  const [authPhase, setAuthPhase] = useState<AuthPhase>('initializing');
```

Now find every `setLoading(...)` and `setSyncing(...)` call in the file. Map them:
- `setLoading(true)` → no equivalent; initial state is `'initializing'`; if the code re-enters this state (e.g., on signout), use `setAuthPhase('initializing')` only if intent matches; otherwise skip
- `setLoading(false)` → `setAuthPhase('ready')` (only when not also entering sync)
- `setSyncing(true)` → `setAuthPhase('syncing')`
- `setSyncing(false)` → `setAuthPhase('ready')` (transition back when sync completes)

Carefully read the existing flow before mechanical replacement. Common shape:
1. Mount: `loading = true`
2. Auth resolves: `loading = false`, `syncing = false`
3. SIGNED_IN with new user: `syncing = true`, run pulls
4. Pulls complete: `syncing = false`

Map to:
1. Mount: `authPhase = 'initializing'`
2. Auth resolves: `authPhase = 'ready'`
3. SIGNED_IN with new user: `authPhase = 'syncing'`
4. Pulls complete: `authPhase = 'ready'`

Update the `useMemo` return value at line 96 from:

```typescript
    () => ({ session, user: session?.user ?? null, loading, syncing }),
    [session, loading, syncing]
```

to:

```typescript
    () => ({ session, user: session?.user ?? null, authPhase }),
    [session, authPhase]
```

- [ ] **Step 4: Update `RootNavigator.tsx`**

Find the destructure on line 18:

```typescript
  const { session, loading, syncing } = useAuth();
```

Replace with:

```typescript
  const { session, authPhase } = useAuth();
```

Find the predicate that renders the spinner (likely `if (loading || syncing) return <Spinner />`). Replace with:

```typescript
  if (authPhase !== 'ready') return <Spinner />;
```

Or whatever the spinner JSX is — just replace the condition.

- [ ] **Step 5: Build + run all tests**

```
npx tsc --noEmit
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: tsc 0. If pre-existing AuthContext tests assert on `loading` or `syncing`, update them MINIMALLY to assert on `authPhase` equivalents. Document the deviation if you do.

- [ ] **Step 6: Grep verify**

```bash
grep -rn 'loading\s*&&\|loading\s*\|\||\bsyncing\b' src/contexts src/navigation 2>&1 | head -10
```
Expected: minimal matches (only internal AuthContext usage, e.g., `setLoading` if any remains).

- [ ] **Step 7: Commit**

```bash
git add src/contexts/AuthContext.tsx src/navigation/RootNavigator.tsx src/__tests__/contexts/AuthContext-authPhase.test.tsx
git commit -m "refactor(auth): collapse loading + syncing booleans into authPhase enum"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full Jest suite**

```
npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' 2>&1 | tail -8
```
Expected: all green. Net test count change: -3 (removed `getE1RMWithConfidence` block) + 4 (`daysAgo`) + 2 (`authPhase` invariants) ≈ +3 from prior 699 ≈ 702.

- [ ] **Step 2: Typecheck**

```
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Grep checks**

```bash
echo "=== getE1RMWithConfidence gone ==="
grep -rn 'getE1RMWithConfidence' src/ --include='*.ts' --include='*.tsx' || echo "clean"

echo "=== dead theme styles gone ==="
grep -rn 'cardStyles\|buttonStyles\|inputStyles\|emptyStateStyles' src/ --include='*.ts' --include='*.tsx' || echo "clean"

echo "=== shared daysAgo ==="
grep -n 'from .*daysAgo' src/utils/format.ts src/utils/formatLastPerformed.ts

echo "=== authPhase ==="
grep -n 'authPhase\|AuthPhase' src/contexts/AuthContext.tsx src/navigation/RootNavigator.tsx
```

Expected: matches at the new sites; zero matches for removed names.

- [ ] **Step 4: Code review (mandatory gate per CLAUDE.md)**

```
/code-review deep --spec docs/superpowers/plans/2026-05-17-batch-7-simplifications.md
```
Address actionable findings.

---

## Risks and rollback

- **Task 1 + 2 dead-code deletes.** If a non-test consumer is later identified, restoration is trivial via `git revert`. Verified zero non-test refs in Steps 1 of each.
- **Task 3 `daysAgo`.** Calendar-day math in local timezone matches `formatLastPerformed`'s existing logic; no user-visible regression except DST edge cases that were previously wrong.
- **Task 4 `authPhase` enum.** Most invasive — touches `AuthContext`, `RootNavigator`, and any test that mocks the auth context shape. Carefully map every `setLoading`/`setSyncing` call. If existing AuthContext tests break, update them minimally.

---

## Self-review notes

- Spec coverage: 4 selected fixes → 4 tasks + verification. ✓
- Placeholder scan: none. ✓
- Type consistency: `AuthPhase` is a new exported type; consumers use `authPhase: AuthPhase`. `daysAgo(iso: string): number` consistent in both consumers. ✓
- Deferred items (ExerciseForm, useDebouncedKeyedWriter, usePRTracker) explicitly documented as risk-vs-reward losses, not gaps. ✓
- Files touched: 7 source + 2 test = 9 files. ✓
