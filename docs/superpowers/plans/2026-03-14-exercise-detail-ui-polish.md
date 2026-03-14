# ExerciseDetailModal UI Polish

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 visual issues identified from device screenshots of the ExerciseDetailModal.

**Architecture:** Targeted style and JSX changes to ExerciseDetailModal (Details tab) and ExerciseHistoryContent (History tab). No new files, no DB changes, no new features.

**Tech Stack:** React Native StyleSheet, theme tokens

---

## Issues (from screenshots)

| # | Issue | Screenshot Evidence |
|---|-------|-------------------|
| 1 | **Duplicate e1RM** — Details shows "Est. 1RM 237 lb", History shows "ESTIMATED 1RM 204 lb / 237 lb". Redundant. | Both tabs show e1RM |
| 2 | **"Current vs All-time" confusing** — History PR banner shows "204 lb Current" next to "237 lb All-time · Mar 4". User doesn't understand what "Current" means (it's freshness-weighted decay). | History tab PR banner |
| 3 | **Charts too narrow** — `screenWidth` already subtracts `spacing.lg * 2` for ScrollView padding, then chart width subtracts another `spacing.md * 2`. Double subtraction = 80px narrower than needed. | Both charts visibly narrow with whitespace on right |
| 4 | **Excessive spacing between charts** — `chartContainer` has `marginBottom: spacing.xl` (32px) creating a large gap between 1RM and Volume charts. | Large blank area between charts |
| 5 | **Content too padded** — Both tabs use `paddingHorizontal: spacing.lg` (24px per side = 48px total). On a modal that's already inset from screen edges, this is too much. | Content feels narrow/constrained on both tabs |

---

## File Map

| File | Changes |
|------|---------|
| `src/components/ExerciseDetailModal.tsx` | Remove e1RM banner + related state/loading from Details tab. Reduce body padding. |
| `src/components/ExerciseHistoryContent.tsx` | Simplify PR banner labels. Fix chart width. Tighten chart spacing. Reduce body padding. Update screenWidth calc. |
| `src/components/__tests__/ExerciseDetailModal.test.tsx` | Remove e1RM-related tests (banner no longer on Details tab). |
| `src/components/__tests__/ExerciseHistoryContent.test.tsx` | Update PR banner assertions if text changes. |

---

## Task 1: Remove e1RM from Details tab

**File:** `src/components/ExerciseDetailModal.tsx`

**Why:** The History tab already shows e1RM in a richer format (with charts). Showing a simpler version on Details is redundant and confusing — the user sees two different numbers (237 all-time vs 204 current) and doesn't know which is "real".

- [ ] **Step 1:** Remove state and imports related to e1RM loading:
  - Delete: `const [loading, setLoading] = useState(false);`
  - Delete: `const [bestE1RM, setBestE1RM] = useState<number | null>(null);`
  - Delete: `getBestE1RM` from the database import
  - Delete: `ActivityIndicator` from the react-native import (no longer used)
  - Delete: the entire `loadData` async function
  - Delete: `loadData(exercise.id);` call from the `useEffect`

- [ ] **Step 2:** Simplify Details tab content — remove loading spinner and e1RM banner:
  - Remove the `{loading ? <ActivityIndicator> : (` conditional wrapper
  - Remove the e1RM banner JSX block (trophy icon + "Est. 1RM" + value)
  - The Details tab now just renders the ScrollView directly with Form Notes + Machine Settings

- [ ] **Step 3:** Remove unused styles:
  - Delete: `e1rmBanner`, `e1rmLabel`, `e1rmValue`

- [ ] **Step 4:** Verify: `npx tsc --noEmit`

---

## Task 2: Simplify PR banner on History tab

**File:** `src/components/ExerciseHistoryContent.tsx`

**Why:** "204 lb Current" next to "237 lb All-time · Mar 4" is confusing. "Current" is a freshness-weighted decay concept that most users won't understand. The user just wants to know their best.

**New design:**
- Show all-time best prominently: **"237 lb"** with "Best · Mar 4" subtitle
- Only show recent form if it's meaningfully lower (>5% drop): "Recent form: 204 lb" in a smaller, separated line
- This makes the primary number unambiguous and the secondary number contextual

- [ ] **Step 1:** Replace ONLY the `prRow` View and its children (below `prHeader`). Keep `prHeader` (trophy icon + "Estimated 1RM" label) unchanged. Replace with:
  ```tsx
  <Text style={styles.prValue}>{data.prValue} lb</Text>
  <Text style={styles.prSubtext}>Best · {data.prDateFormatted}</Text>
  {data.currentE1rm > 0 && data.currentE1rm < data.prValue * 0.95 && (
    <View style={styles.currentRow}>
      <Text style={styles.currentValue}>Recent form: {data.currentE1rm} lb</Text>
    </View>
  )}
  ```

- [ ] **Step 2:** Replace styles — remove `prRow`, `prStat`, `prAllTime`. Add:
  ```typescript
  currentRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  currentValue: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  ```

- [ ] **Step 3:** Verify: `npx tsc --noEmit`

---

## Task 3: Fix chart width

**File:** `src/components/ExerciseHistoryContent.tsx`

**Why:** Charts are 80px narrower than available space. `screenWidth = window.width - 48` (for ScrollView padding), then `chart width = screenWidth - 32` = window - 80. The second subtraction is wrong.

- [ ] **Step 1:** Change both `LineChart` `width` props from `screenWidth - spacing.md * 2` to just `screenWidth`.

- [ ] **Step 2:** Verify: `npx tsc --noEmit`

---

## Task 4: Tighten spacing and padding

**File:** `src/components/ExerciseHistoryContent.tsx` and `src/components/ExerciseDetailModal.tsx`

**Why:** Too much whitespace makes content feel constrained and disconnected.

- [ ] **Step 1:** In ExerciseHistoryContent, change `chartContainer` style:
  - From: `marginTop: spacing.lg, marginBottom: spacing.xl` (24px top, 32px bottom)
  - To: `marginTop: spacing.md, marginBottom: spacing.sm` (16px top, 8px bottom)

- [ ] **Step 2:** In ExerciseHistoryContent, reduce body padding:
  - From: `paddingHorizontal: spacing.lg` (24px)
  - To: `paddingHorizontal: spacing.md` (16px)

- [ ] **Step 3:** Update `screenWidth` to match new padding:
  - From: `Dimensions.get('window').width - spacing.lg * 2`
  - To: `Dimensions.get('window').width - spacing.md * 2`

- [ ] **Step 4:** In ExerciseDetailModal, reduce Details tab body padding:
  - From: `paddingHorizontal: spacing.lg` (24px)
  - To: `paddingHorizontal: spacing.md` (16px)

- [ ] **Step 5:** Verify: `npx tsc --noEmit`

---

## Task 5: Update tests

- [ ] **Step 1:** In `ExerciseDetailModal.test.tsx`:
  - Remove `getBestE1RM` from the `jest.mock('../../services/database')` block
  - Remove `getBestE1RM` from the named import statement (`import { getBestE1RM, ... }`)
  - Remove `(getBestE1RM as jest.Mock).mockResolvedValue(null)` from the `beforeEach` block
  - Remove test "shows e1RM banner when bestE1RM is available"
  - Remove test "hides e1RM banner when bestE1RM is null"
  - Remove test "shows loading indicator then content" (no more loading state on Details)

- [ ] **Step 2:** In `ExerciseHistoryContent.test.tsx`:
  - Update PR banner test: assert "Best" text instead of "Current" label
  - If there's a test checking for "All-time" text, update to match new format

- [ ] **Step 3:** Run full test suite:
  `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/'`
  All tests must pass.

---

## Verification

1. `npx tsc --noEmit` — zero errors
2. All tests pass
3. **Details tab:** Form Notes + Machine Settings only, no e1RM banner, content wider
4. **History tab:** PR banner shows "237 lb" + "Best · Mar 4", charts wider, tighter spacing
5. Charts fill available width (no right-side whitespace)
