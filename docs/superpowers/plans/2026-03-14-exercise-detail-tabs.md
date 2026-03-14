# ExerciseDetailModal Tab Redesign

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped compact history + "See all" modal stacking with a two-tab layout (Details / History) inside ExerciseDetailModal.

**Architecture:** Extract ExerciseHistoryModal's content (charts, PR banner, plateau badge, detailed session breakdowns with RPE/tags) into a standalone `ExerciseHistoryContent` component. Render it as the History tab inside ExerciseDetailModal. Delete ExerciseHistoryModal entirely — all three screens already use ExerciseDetailModal. Remove the buggy `getRecentExerciseHistory` SQL function.

**Tech Stack:** React Native, expo-sqlite, react-native-chart-kit, @testing-library/react-native

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/ExerciseHistoryContent.tsx` | **Create** | Extracted history content: data loading, PR banner, charts, plateau, sessions. No Modal wrapper. |
| `src/components/ExerciseDetailModal.tsx` | **Modify** | Add tab bar (Details / History), render ExerciseHistoryContent in History tab. Remove compact history rows, "See all", nested modal. |
| `src/components/ExerciseHistoryModal.tsx` | **Delete** | No longer used by any screen. |
| `src/services/database.ts` | **Modify** | Remove `getRecentExerciseHistory` function. |
| `src/components/__tests__/ExerciseDetailModal.test.tsx` | **Modify** | Update tests for tab behavior. Remove compact history / "See all" tests. Add tab switching test. |
| `src/components/__tests__/ExerciseHistoryModal.test.tsx` | **Delete** | Component deleted. |
| `src/components/__tests__/ExerciseHistoryContent.test.tsx` | **Create** | Port existing ExerciseHistoryModal tests to test the extracted content component. |
| `src/screens/__tests__/HistoryScreen.test.tsx` | **Modify** | Remove ExerciseHistoryModal mock (it's gone). ExerciseDetailModal mock stays. |
| `CLAUDE.md` | **Modify** | Update ExerciseDetailModal description (tabs), remove ExerciseHistoryModal as standalone, remove `getRecentExerciseHistory`. |

---

## Task 1: Extract ExerciseHistoryContent from ExerciseHistoryModal

**Files:**
- Create: `src/components/ExerciseHistoryContent.tsx`
- Reference: `src/components/ExerciseHistoryModal.tsx`

- [ ] **Step 1: Create `ExerciseHistoryContent.tsx`**

Copy the entire body of `ExerciseHistoryModal` (data loading, all JSX inside the `<ScrollView>`, all styles, helper types/functions) into a new component. The key differences from ExerciseHistoryModal:

- **No `<Modal>` wrapper** — just returns `<View>` containing a loading spinner or scrollable content
- **No header/close button** — the parent (ExerciseDetailModal) owns those
- **Props:** `{ exercise: Exercise }` — visible is always true when rendered, exercise is never null (parent guards)
- **Data loading:** `useEffect` triggers on `exercise.id` change (not `visible`)
- Move all types (`DataPoint`, `VolumePoint`, `RecentSession`, `HistoryData`, `EMPTY_DATA`), the `thinLabels` helper, and the `isCompletedWorkingSet` filter into this file
- Move all history-related styles into this file
- Keep the `paddingHorizontal: spacing.lg` on the outer View (matching the current body style)

```typescript
// Props — minimal, parent handles modal chrome
interface Props {
  exercise: Exercise;
}

export default function ExerciseHistoryContent({ exercise }: Props) {
  // ... all existing data loading, charts, sessions
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No errors (file is standalone, not yet imported anywhere)

- [ ] **Step 3: Commit**

```bash
git add src/components/ExerciseHistoryContent.tsx
git commit -m "refactor: extract ExerciseHistoryContent from ExerciseHistoryModal"
```

---

## Task 2: Add tabs to ExerciseDetailModal

**Files:**
- Modify: `src/components/ExerciseDetailModal.tsx`

- [ ] **Step 1: Add tab state and tab bar**

Add state: `const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');`

Add a tab bar immediately below the header (inside the container, above the ScrollView/loading area):

```typescript
{/* Tab bar */}
<View style={styles.tabBar}>
  <TouchableOpacity
    style={[styles.tab, activeTab === 'details' && styles.tabActive]}
    onPress={() => setActiveTab('details')}
    testID="tab-details"
  >
    <Text style={[styles.tabText, activeTab === 'details' && styles.tabTextActive]}>Details</Text>
  </TouchableOpacity>
  <TouchableOpacity
    style={[styles.tab, activeTab === 'history' && styles.tabActive]}
    onPress={() => setActiveTab('history')}
    testID="tab-history"
  >
    <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>History</Text>
  </TouchableOpacity>
</View>
```

Tab bar styles (add to StyleSheet):

```typescript
tabBar: {
  flexDirection: 'row',
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
},
tab: {
  flex: 1,
  paddingVertical: spacing.sm,
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: layout.touchMin,
},
tabActive: {
  borderBottomWidth: 2,
  borderBottomColor: colors.primary,
},
tabText: {
  color: colors.textMuted,
  fontSize: fontSize.sm,
  fontWeight: fontWeight.semibold,
},
tabTextActive: {
  color: colors.primary,
},
```

- [ ] **Step 2: Conditionally render Details tab vs History tab**

Replace the current content area. When `activeTab === 'details'`: render existing content (e1RM banner, form notes, machine notes) wrapped in ScrollView. When `activeTab === 'history'`: render `<ExerciseHistoryContent exercise={exercise} />`.

The loading spinner + `getBestE1RM` loading stays on the Details tab only. ExerciseHistoryContent handles its own loading.

```typescript
{activeTab === 'details' ? (
  loading ? (
    <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
  ) : (
    <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* e1RM banner, form notes, machine notes — existing content */}
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  )
) : (
  <ExerciseHistoryContent exercise={exercise} />
)}
```

- [ ] **Step 3: Remove compact history section + "See all" + nested modal**

Delete from ExerciseDetailModal:
- The `RecentHistoryEntry` interface
- The `recentHistory` state
- The `showFullHistory` state
- The `getRecentExerciseHistory` import
- The `getRecentExerciseHistory` call from `loadData`
- The entire "Recent History" JSX section (lines ~223-246)
- The nested `<ExerciseHistoryModal>` JSX at the bottom (lines ~255-262)
- The `ExerciseHistoryModal` import
- The history-related styles: `historyRow`, `historyDate`, `historySets`, `historyBest`, `seeAllBtn`, `seeAllText`

Add the new import:
```typescript
import ExerciseHistoryContent from './ExerciseHistoryContent';
```

The `loadData` function now only fetches `getBestE1RM` (no more `Promise.all` with history):
```typescript
async function loadData(exerciseId: string) {
  setLoading(true);
  try {
    const e1rm = await getBestE1RM(exerciseId);
    setBestE1RM(e1rm);
  } catch (e) {
    Sentry.captureException(e);
  } finally {
    setLoading(false);
  }
}
```

- [ ] **Step 4: Reset tab to "details" when exercise changes**

In the existing `useEffect` that resets state on `[visible, exercise?.id]`, add:
```typescript
setActiveTab('details');
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/components/ExerciseDetailModal.tsx
git commit -m "feat: add Details/History tabs to ExerciseDetailModal"
```

---

## Task 3: Delete ExerciseHistoryModal + getRecentExerciseHistory

**Files:**
- Delete: `src/components/ExerciseHistoryModal.tsx`
- Delete: `src/components/__tests__/ExerciseHistoryModal.test.tsx`
- Modify: `src/services/database.ts`

- [ ] **Step 1: Delete ExerciseHistoryModal**

```bash
rm src/components/ExerciseHistoryModal.tsx
rm src/components/__tests__/ExerciseHistoryModal.test.tsx
```

- [ ] **Step 2: Remove `getRecentExerciseHistory` from database.ts**

Delete the entire `getRecentExerciseHistory` function from `src/services/database.ts`. Also remove its export.

- [ ] **Step 3: Verify no remaining imports of deleted code**

Run: `grep -r "ExerciseHistoryModal\|getRecentExerciseHistory" src/ --include="*.ts" --include="*.tsx" -l`

Expected: Only `ExerciseHistoryContent.tsx` should reference `ExerciseHistoryModal` stuff (but it shouldn't — it's a fresh extraction). If any files still import them, fix.

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete ExerciseHistoryModal and getRecentExerciseHistory"
```

---

## Task 4: Update tests

**Files:**
- Create: `src/components/__tests__/ExerciseHistoryContent.test.tsx`
- Modify: `src/components/__tests__/ExerciseDetailModal.test.tsx`
- Modify: `src/screens/__tests__/HistoryScreen.test.tsx`

- [ ] **Step 1: Create ExerciseHistoryContent tests**

Port tests from the deleted `ExerciseHistoryModal.test.tsx`. Key changes:
- Component is `ExerciseHistoryContent` not `ExerciseHistoryModal`
- No `visible` prop — always rendered when present
- No `exercise: null` case — parent guards this
- No `onClose` prop — no close button
- Props: `{ exercise: Exercise }` only
- Mock `getExerciseHistory` and `getCurrentE1RM` from database
- Mock `react-native-chart-kit` LineChart

Tests to port:
1. Shows "No workout data yet" when no history
2. Shows "N more sessions needed" with 1-2 sessions
3. Hides PR banner when < 3 sessions
4. Shows PR banner + charts with 3+ sessions
5. Shows all sets per session with RPE + tag badges
6. Filters warmup sets, excludes all-warmup sessions
7. Shows volume chart with 3+ sessions
8. Shows plateau badge when plateaued
9. Does not show plateau when improving
10. Renders session cards with dates and testIDs

- [ ] **Step 2: Run ExerciseHistoryContent tests**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/components/__tests__/ExerciseHistoryContent.test.tsx`
Expected: All tests pass

- [ ] **Step 3: Update ExerciseDetailModal tests**

Changes needed:
- Remove the `ExerciseHistoryModal` mock (no longer imported)
- Remove the `getRecentExerciseHistory` mock from database mock
- Remove test: "renders recent history entries" (compact rows are gone)
- Remove test: "opens ExerciseHistoryModal when See all is pressed" (no more See all)
- Add test: "shows Details tab by default"
- Add test: "switches to History tab when pressed"
- Mock `ExerciseHistoryContent` as a simple View with testID:
```typescript
jest.mock('../ExerciseHistoryContent', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(View, { testID: 'exercise-history-content' }),
  };
});
```
- Tab test: render modal, verify `tab-details` exists, press `tab-history`, verify `exercise-history-content` testID appears

- [ ] **Step 4: Run ExerciseDetailModal tests**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' src/components/__tests__/ExerciseDetailModal.test.tsx`
Expected: All tests pass

- [ ] **Step 5: Update HistoryScreen test**

Remove the `ExerciseDetailModal` mock's reference to ExerciseHistoryModal (if any). The current mock just stubs ExerciseDetailModal as a View — should be fine. Verify it still passes.

- [ ] **Step 6: Run full test suite**

Run: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/'`
Expected: All suites pass, 0 failures

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: update tests for ExerciseDetailModal tabs + ExerciseHistoryContent"
```

---

## Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update documentation**

- Update ExerciseDetailModal description: mention two tabs (Details: e1RM, form notes, machine notes; History: PR banner, charts, sessions with RPE/tags)
- Remove ExerciseHistoryModal as a standalone bullet (it's deleted)
- Add ExerciseHistoryContent description: extracted content component rendered in History tab
- Remove `getRecentExerciseHistory` from database function list
- Update testIDs: add `tab-details`, `tab-history`; remove references to "See all"

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for tab-based ExerciseDetailModal"
```

---

## Verification

1. `npx tsc --noEmit` — zero type errors
2. `npx jest --testPathIgnorePatterns=...` — all tests pass
3. Build to device — ExerciseDetailModal shows two tabs, Details has notes, History has charts + detailed sessions with RPE/tags
4. Tap exercise name in Exercises tab → modal opens on Details tab
5. Tap History tab → charts and sessions load
6. Tap exercise name in workout → same modal, same tabs
7. Edit form notes on Details tab → persists after close
8. Switch to History → back to Details → notes still there
</content>
</invoke>