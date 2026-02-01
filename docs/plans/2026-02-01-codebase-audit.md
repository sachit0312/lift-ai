# Codebase Audit & Hardening Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix bugs, remove dead code, add test infrastructure + tests, fix COOP/COEP for web, and ensure CLAUDE.md is accurate.

**Architecture:** Static analysis fixes, Jest test setup with mocked expo-sqlite, dead code removal, web compatibility fix, documentation update.

**Tech Stack:** Jest, @testing-library/react-native, expo-sqlite mock, TypeScript

---

### Task 1: Fix COOP/COEP Headers for Expo Web (Critical Bug)

The app's SQLite (OPFS VFS) requires `SharedArrayBuffer`, which needs cross-origin isolation headers. The Metro dev server doesn't send these by default, causing `Invalid VFS state` errors on web.

**Files:**
- Modify: `/Users/sachitgoyal/code/workout-enhanced/metro.config.js`

**Step 1: Update metro.config.js to add COOP/COEP headers**

```javascript
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

// Add COOP/COEP headers for SharedArrayBuffer support (needed by expo-sqlite OPFS on web)
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      middleware(req, res, next);
    };
  },
};

module.exports = config;
```

**Step 2: Verify fix**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx expo start --web`
Navigate to `http://localhost:8081` in Chrome, open DevTools console.
Expected: No `Invalid VFS state` errors. `self.crossOriginIsolated` returns `true`.

**Step 3: Commit**

```bash
git add metro.config.js
git commit -m "fix: add COOP/COEP headers for SharedArrayBuffer on web"
```

---

### Task 2: Remove Dead Code & Unused Styles

**Files:**
- Modify: `/Users/sachitgoyal/code/workout-enhanced/src/screens/WorkoutScreen.tsx`
- Delete: `/Users/sachitgoyal/code/workout-enhanced/coop-proxy.js` (if exists and unused)

**Step 1: Remove unused styles from WorkoutScreen.tsx**

The following styles are defined but never used in any JSX:
- `tipBtn` (line 1133) — not referenced in render
- `tipBtnText` (line 1142) — not referenced in render
- `tipSection` (line 1356) — not referenced in render
- `aiCard` (line 1478) — not referenced in render (AI summary removed)
- `aiHeader` (line 1486) — not referenced in render
- `aiLabel` (line 1491) — not referenced in render
- `aiText` (line 1497) — not referenced in render

Remove these 7 style entries from the `StyleSheet.create` call.

**Step 2: Remove coop-proxy.js if unused**

Check if `coop-proxy.js` is referenced anywhere. If not, delete it.

**Step 3: Remove empty src/components/ directory**

```bash
rmdir /Users/sachitgoyal/code/workout-enhanced/src/components
```

**Step 4: Verify TypeScript compiles clean**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove dead styles, unused files, empty components dir"
```

---

### Task 3: Fix Bug — Exercise Notes Not Persisted

In `WorkoutScreen.tsx`, exercise notes are tracked in local state (`block.notes`) but never saved to the database. The `notesInput` `onChangeText` only updates local state — there's no `updateWorkoutSet` or similar call to persist notes.

**Files:**
- Modify: `/Users/sachitgoyal/code/workout-enhanced/src/screens/WorkoutScreen.tsx`

**Step 1: Notes are per-exercise, but the DB schema has notes per-set (`workout_sets.notes`), not per-exercise block.**

For now, the pragmatic fix: don't persist exercise-level notes since the schema doesn't support it. But at minimum, the notes should persist for the duration of the workout session (they already do via state). No code change needed unless we add an `exercise_notes` column. Document this as a known limitation.

Actually, reviewing the schema more carefully: `workout_sets.notes` exists, and the notes UI is per exercise block, not per set. The current behavior (notes only live in memory during the session) is acceptable. Skip this task — it's a feature gap, not a bug.

---

### Task 4: Fix Bug — `handleSetChange` Uses Stale State

In `WorkoutScreen.tsx:444-462`, `handleSetChange` reads `exerciseBlocks` from the closure after calling `setExerciseBlocks`, which means it reads the stale value, not the updated one. The set ID lookup happens from the old state. This works by accident because the set ID doesn't change, but it's fragile.

**Files:**
- Modify: `/Users/sachitgoyal/code/workout-enhanced/src/screens/WorkoutScreen.tsx`

**Step 1: Fix stale closure in handleSetChange**

Replace lines 444-462:

```typescript
async function handleSetChange(
  blockIdx: number,
  setIdx: number,
  field: 'weight' | 'reps',
  value: string,
) {
  const set = exerciseBlocks[blockIdx]?.sets[setIdx];
  if (!set) return;

  setExerciseBlocks((prev) => {
    const next = [...prev];
    const block = { ...next[blockIdx], sets: [...next[blockIdx].sets] };
    block.sets[setIdx] = { ...block.sets[setIdx], [field]: value };
    next[blockIdx] = block;
    return next;
  });

  const numVal = value === '' ? null : Number(value);
  await updateWorkoutSet(set.id, { [field]: numVal });
}
```

The fix: read `set` before calling `setExerciseBlocks`, so we capture the ID from the current render (which is correct since IDs don't change between renders).

**Step 2: Verify TypeScript compiles clean**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "fix: read set data before state update in handleSetChange"
```

---

### Task 5: Set Up Jest Test Infrastructure

**Files:**
- Create: `/Users/sachitgoyal/code/workout-enhanced/jest.config.js`
- Create: `/Users/sachitgoyal/code/workout-enhanced/src/__mocks__/expo-sqlite.ts`
- Modify: `/Users/sachitgoyal/code/workout-enhanced/package.json` (add devDependencies + test script)

**Step 1: Install test dependencies**

```bash
cd /Users/sachitgoyal/code/workout-enhanced
npx expo install -- --save-dev jest @testing-library/react-native @testing-library/jest-native jest-expo
```

**Step 2: Create jest.config.js**

```javascript
module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@supabase/.*|react-native-url-polyfill)'
  ],
  setupFilesAfterSetup: [],
};
```

**Step 3: Add test script to package.json**

Add to scripts: `"test": "jest"`

**Step 4: Create expo-sqlite mock**

```typescript
// src/__mocks__/expo-sqlite.ts
const mockDb = {
  getAllAsync: jest.fn().mockResolvedValue([]),
  runAsync: jest.fn().mockResolvedValue({ changes: 0 }),
  execAsync: jest.fn().mockResolvedValue(undefined),
};

export function openDatabaseAsync() {
  return Promise.resolve(mockDb);
}

export const __mockDb = mockDb;
```

**Step 5: Verify jest runs**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx jest --passWithNoTests`
Expected: Pass with "No tests found" or similar

**Step 6: Commit**

```bash
git add jest.config.js src/__mocks__/expo-sqlite.ts package.json package-lock.json
git commit -m "chore: set up Jest test infrastructure with expo-sqlite mock"
```

---

### Task 6: Add Database Service Unit Tests

**Files:**
- Create: `/Users/sachitgoyal/code/workout-enhanced/src/services/__tests__/database.test.ts`

**Step 1: Write tests for database.ts**

```typescript
import { __mockDb } from '../../__mocks__/expo-sqlite';

jest.mock('expo-sqlite');

// Reset mock between tests
beforeEach(() => {
  jest.clearAllMocks();
});

describe('createExercise', () => {
  it('inserts exercise and returns it with generated id', async () => {
    const { createExercise } = require('../database');
    __mockDb.runAsync.mockResolvedValueOnce({ changes: 1 });

    const result = await createExercise({
      name: 'Bench Press',
      type: 'weighted',
      muscle_groups: ['chest', 'triceps'],
      training_goal: 'hypertrophy',
      description: '',
    });

    expect(result.name).toBe('Bench Press');
    expect(result.type).toBe('weighted');
    expect(result.muscle_groups).toEqual(['chest', 'triceps']);
    expect(result.id).toBeDefined();
    expect(__mockDb.runAsync).toHaveBeenCalledTimes(1);
  });
});

describe('getAllExercises', () => {
  it('returns parsed exercises with muscle_groups as array', async () => {
    const { getAllExercises } = require('../database');
    __mockDb.getAllAsync.mockResolvedValueOnce([
      { id: '1', name: 'Squat', type: 'weighted', muscle_groups: '["quads","glutes"]', training_goal: 'strength', description: '', created_at: '2026-01-01', user_id: 'local' },
    ]);

    const result = await getAllExercises();
    expect(result).toHaveLength(1);
    expect(result[0].muscle_groups).toEqual(['quads', 'glutes']);
  });
});

describe('createTemplate', () => {
  it('inserts template and returns it', async () => {
    const { createTemplate } = require('../database');
    __mockDb.runAsync.mockResolvedValueOnce({ changes: 1 });

    const result = await createTemplate('Push Day');
    expect(result.name).toBe('Push Day');
    expect(result.id).toBeDefined();
  });
});

describe('startWorkout', () => {
  it('creates workout with null template_id for empty workout', async () => {
    const { startWorkout } = require('../database');
    __mockDb.runAsync.mockResolvedValueOnce({ changes: 1 });

    const result = await startWorkout(null);
    expect(result.template_id).toBeNull();
    expect(result.finished_at).toBeNull();
    expect(result.id).toBeDefined();
  });
});

describe('updateWorkoutSet', () => {
  it('does nothing when no updates provided', async () => {
    const { updateWorkoutSet } = require('../database');
    await updateWorkoutSet('set-1', {});
    // Should not call runAsync since no fields to update
    // (runAsync might be called for db init, but not for the update)
  });

  it('converts is_completed boolean to integer', async () => {
    const { updateWorkoutSet } = require('../database');
    __mockDb.runAsync.mockResolvedValue({ changes: 1 });

    await updateWorkoutSet('set-1', { is_completed: true });

    const call = __mockDb.runAsync.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE workout_sets')
    );
    expect(call).toBeDefined();
    // The value for is_completed should be 1 (integer), not true (boolean)
    expect(call).toContainEqual(1);
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx jest`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/services/__tests__/database.test.ts
git commit -m "test: add unit tests for database service"
```

---

### Task 7: Add Utility Tests

**Files:**
- Create: `/Users/sachitgoyal/code/workout-enhanced/src/utils/__tests__/uuid.test.ts`

**Step 1: Write UUID tests**

```typescript
import uuid from '../uuid';

describe('uuid', () => {
  it('returns a string', () => {
    expect(typeof uuid()).toBe('string');
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });

  it('matches UUID v4 format', () => {
    const id = uuid();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx jest src/utils`
Expected: All pass

**Step 3: Commit**

```bash
git add src/utils/__tests__/uuid.test.ts
git commit -m "test: add unit tests for UUID utility"
```

---

### Task 8: Add History Screen Formatting Tests

**Files:**
- Create: `/Users/sachitgoyal/code/workout-enhanced/src/screens/__tests__/HistoryScreen.test.ts`

The `formatDuration` and `formatDate` helper functions in HistoryScreen.tsx are not exported. Extract them to a utility or test them indirectly. Since they're simple pure functions, the pragmatic approach: extract to a shared utility.

**Step 1: Extract formatDuration and formatDate to src/utils/format.ts**

```typescript
// src/utils/format.ts
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
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);

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

**Step 2: Update HistoryScreen.tsx to import from utils**

Replace the local `formatDuration` and `formatDate` with:
```typescript
import { formatDuration, formatDate } from '../utils/format';
```

Remove the local function definitions (lines 27-52 in HistoryScreen.tsx).

**Step 3: Write tests**

```typescript
// src/utils/__tests__/format.test.ts
import { formatDuration, formatDate } from '../format';

describe('formatDuration', () => {
  it('returns -- for null finishedAt', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', null)).toBe('--');
  });

  it('formats minutes for under 1 hour', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T10:45:00Z')).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T11:30:00Z')).toBe('1h 30m');
  });
});

describe('formatDate', () => {
  it('returns Today for current date', () => {
    const now = new Date().toISOString();
    expect(formatDate(now)).toBe('Today');
  });
});
```

**Step 4: Verify all tests pass**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx jest`

**Step 5: Commit**

```bash
git add src/utils/format.ts src/utils/__tests__/format.test.ts src/screens/HistoryScreen.tsx
git commit -m "refactor: extract format utils, add tests"
```

---

### Task 9: Fix Type Safety Issue — `template_name` on Workout

In `WorkoutScreen.tsx:308`, the code does `workout.template_name = template.name` — but `template_name` is an optional property on the `Workout` interface that comes from a SQL JOIN in `getWorkoutHistory()`, not from `startWorkout()`. This mutation works but is type-unsafe.

**Files:**
- Modify: `/Users/sachitgoyal/code/workout-enhanced/src/screens/WorkoutScreen.tsx`

**Step 1: Instead of mutating the workout object, store template name in separate state**

In WorkoutScreen, add a `templateName` state:
```typescript
const [templateName, setTemplateName] = useState<string | null>(null);
```

In `handleStartFromTemplate`, replace `workout.template_name = template.name;` with:
```typescript
setTemplateName(template.name);
```

In the active workout header, replace `activeWorkout.template_name` with `templateName`:
```typescript
<Text style={styles.headerTitle}>
  {templateName ?? 'Workout'}
</Text>
```

Also set `setTemplateName(null)` in cancel and dismiss handlers.

**Step 2: Verify TypeScript compiles clean**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "fix: use separate state for template name instead of mutating workout object"
```

---

### Task 10: Update CLAUDE.md

**Files:**
- Modify: `/Users/sachitgoyal/code/workout-enhanced/CLAUDE.md`

**Step 1: Update CLAUDE.md with:**
- Add test commands: `npx jest` for tests, `npx jest --watch` for watch mode
- Add note about COOP/COEP headers in metro.config.js for web support
- Add note about format utilities in src/utils/format.ts
- Remove any stale references
- Add "Known Limitations" section mentioning: exercise notes are session-only (not persisted to DB)

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with test setup, web fix, known limitations"
```

---

### Execution Strategy

**Sequential execution** — tasks have dependencies:
1. Task 1 (COOP/COEP fix) — standalone critical bug
2. Task 2 (dead code) — standalone cleanup
3. Task 4 (stale state fix) — standalone bug fix
4. Task 5 (Jest setup) — must come before tests
5. Task 6 (DB tests) — depends on Task 5
6. Task 7 (UUID tests) — depends on Task 5
7. Task 8 (format tests + refactor) — depends on Task 5
8. Task 9 (type safety) — standalone fix
9. Task 10 (docs) — must be last

Tasks 1, 2, 4 can run in parallel. Tasks 6, 7, 8 can run in parallel after Task 5.

---

### Verification

After all tasks, run:
```bash
cd /Users/sachitgoyal/code/workout-enhanced
npx tsc --noEmit        # Type check
npx jest                 # All tests pass
npx expo start --web     # Web works without VFS errors
```
