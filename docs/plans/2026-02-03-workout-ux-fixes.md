# Workout UX Fixes + Exercises Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 4 UX issues (timer toggle, unified notes, create exercise modal, timer buttons when OFF) and add a new Exercises tab with 1RM progression charts.

**Architecture:**
- Fix timer by keeping ±15 buttons functional regardless of enabled state, add spacing to prevent accidental toggle
- Unify description → notes field throughout the app
- Convert inline create-exercise form to full-screen modal
- Add 5th Exercises tab reusing ExerciseHistoryModal components

**Tech Stack:** React Native, expo-sqlite, react-native-chart-kit, TypeScript

---

## Task 1: Fix Timer ±15 Buttons When OFF

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx:630-637` (handleAdjustExerciseRest)
- Modify: `src/screens/WorkoutScreen.tsx:815-840` (timer UI)

**Step 1: Update handleAdjustExerciseRest to also enable timer**

In `src/screens/WorkoutScreen.tsx`, find `handleAdjustExerciseRest` and update:

```typescript
function handleAdjustExerciseRest(blockIdx: number, delta: number) {
  setExerciseBlocks((prev) => {
    const next = [...prev];
    const newSeconds = Math.max(15, next[blockIdx].restSeconds + delta);
    // If adjusting, also ensure timer is enabled
    next[blockIdx] = { ...next[blockIdx], restSeconds: newSeconds, restEnabled: true };
    return next;
  });
}
```

**Step 2: Add more spacing between buttons and toggle**

Update the header rest controls styles to add gap:

```typescript
headerRestControls: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.sm,  // was spacing.xs
},
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "fix: timer ±15 buttons auto-enable timer when OFF"
```

---

## Task 2: Unify Description and Notes Fields

**Files:**
- Modify: `src/screens/ExercisePickerScreen.tsx` (change description → notes)
- Modify: `src/services/database.ts:createExercise` (save to notes field)
- Test: `src/screens/__tests__/ExercisePickerScreen.test.tsx`

**Step 1: Write failing test**

In `src/screens/__tests__/ExercisePickerScreen.test.tsx`, add:

```typescript
it('saves description field as notes', async () => {
  const { getByTestId, getByText } = render(<ExercisePickerScreen />);

  // Open create form
  await waitFor(() => expect(getByTestId('create-exercise-toggle')).toBeTruthy());
  await act(async () => { fireEvent.press(getByTestId('create-exercise-toggle')); });

  // Fill form with notes
  await act(async () => {
    fireEvent.changeText(getByTestId('exercise-name-input'), 'Test Exercise');
    fireEvent.changeText(getByTestId('exercise-notes-input'), 'Keep elbows tucked');
  });

  // Save
  await act(async () => { fireEvent.press(getByTestId('save-exercise-btn')); });

  // Verify createExercise was called with notes
  expect(createExercise).toHaveBeenCalledWith(
    expect.objectContaining({
      notes: 'Keep elbows tucked',
    })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=ExercisePickerScreen -t "saves description field as notes"`
Expected: FAIL (testID not found or notes not passed)

**Step 3: Update ExercisePickerScreen form**

In `src/screens/ExercisePickerScreen.tsx`:

1. Rename state: `newExDescription` → `newExNotes`
2. Update label from "Description (optional)" → "Notes (optional)"
3. Add testID: `exercise-notes-input`
4. In `handleCreateExercise`, pass `notes: newExNotes.trim() || null` instead of `description`

**Step 4: Update createExercise in database.ts**

In `src/services/database.ts`, update `createExercise`:

```typescript
export async function createExercise(data: {
  name: string;
  type: ExerciseType;
  muscle_groups: string[];
  training_goal: TrainingGoal;
  description?: string;
  notes?: string | null;
}): Promise<Exercise> {
  const db = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  // Use notes if provided, fall back to description for backward compat
  const notesValue = data.notes ?? data.description ?? null;

  await db.runAsync(
    `INSERT INTO exercises (id, user_id, name, type, muscle_groups, training_goal, description, notes, created_at)
     VALUES (?, '', ?, ?, ?, ?, '', ?, ?)`,
    [id, data.name, data.type, JSON.stringify(data.muscle_groups), data.training_goal, notesValue, now]
  );
  // ... rest unchanged
}
```

**Step 5: Run test to verify it passes**

Run: `npm test -- --testPathPattern=ExercisePickerScreen -t "saves description field as notes"`
Expected: PASS

**Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/screens/ExercisePickerScreen.tsx src/services/database.ts src/screens/__tests__/ExercisePickerScreen.test.tsx
git commit -m "feat: unify description and notes fields"
```

---

## Task 3: Convert Create Exercise to Full-Screen Modal

**Files:**
- Modify: `src/screens/ExercisePickerScreen.tsx`
- Test: `src/screens/__tests__/ExercisePickerScreen.test.tsx`

**Step 1: Write failing test**

```typescript
it('opens full-screen modal for create exercise', async () => {
  const { getByTestId, getByText, queryByTestId } = render(<ExercisePickerScreen />);

  await waitFor(() => expect(getByTestId('create-exercise-toggle')).toBeTruthy());

  // Exercise list should be visible initially
  expect(queryByTestId('exercise-search')).toBeTruthy();

  // Open create modal
  await act(async () => { fireEvent.press(getByTestId('create-exercise-toggle')); });

  // Modal should cover the screen - search should not be visible
  await waitFor(() => {
    expect(getByTestId('create-exercise-modal')).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=ExercisePickerScreen -t "opens full-screen modal"`
Expected: FAIL

**Step 3: Refactor to full-screen modal**

In `src/screens/ExercisePickerScreen.tsx`:

1. Add state: `const [showCreateModal, setShowCreateModal] = useState(false);`

2. Replace inline form with Modal:

```tsx
<Modal
  visible={showCreateModal}
  animationType="slide"
  testID="create-exercise-modal"
  onRequestClose={() => setShowCreateModal(false)}
>
  <SafeAreaView style={styles.createModalContainer}>
    <View style={styles.createModalHeader}>
      <TouchableOpacity onPress={() => setShowCreateModal(false)}>
        <Ionicons name="close" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.createModalTitle}>Create Exercise</Text>
      <View style={{ width: 24 }} />
    </View>

    <ScrollView style={styles.createModalBody} keyboardShouldPersistTaps="handled">
      {/* Form fields - same as before but styled for full screen */}
      <Text style={styles.createLabel}>Name</Text>
      <TextInput ... />

      <Text style={styles.createLabel}>Type</Text>
      {/* Type chips */}

      <Text style={styles.createLabel}>Muscle Groups</Text>
      {/* Muscle chips */}

      <Text style={styles.createLabel}>Notes (optional)</Text>
      <TextInput ... />

      <TouchableOpacity style={styles.createSaveBtn} onPress={handleCreateExercise}>
        <Text style={styles.createSaveBtnText}>Create & Add</Text>
      </TouchableOpacity>
    </ScrollView>
  </SafeAreaView>
</Modal>
```

3. Update toggle button to open modal:
```tsx
<TouchableOpacity
  style={styles.createToggle}
  onPress={() => setShowCreateModal(true)}
  testID="create-exercise-toggle"
>
  <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
  <Text style={styles.createToggleText}>Create New Exercise</Text>
</TouchableOpacity>
```

4. Add modal styles:
```typescript
createModalContainer: {
  flex: 1,
  backgroundColor: colors.background,
},
createModalHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: spacing.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
},
createModalTitle: {
  color: colors.text,
  fontSize: fontSize.xl,
  fontWeight: fontWeight.bold,
},
createModalBody: {
  flex: 1,
  padding: spacing.md,
},
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=ExercisePickerScreen -t "opens full-screen modal"`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/screens/ExercisePickerScreen.tsx src/screens/__tests__/ExercisePickerScreen.test.tsx
git commit -m "feat: convert create exercise to full-screen modal"
```

---

## Task 4: Create ExercisesScreen

**Files:**
- Create: `src/screens/ExercisesScreen.tsx`
- Create: `src/screens/__tests__/ExercisesScreen.test.tsx`

**Step 1: Write failing test**

Create `src/screens/__tests__/ExercisesScreen.test.tsx`:

```typescript
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../services/database', () => ({
  getAllExercises: jest.fn().mockResolvedValue([
    { id: 'ex1', name: 'Bench Press', type: 'weighted', muscle_groups: ['Chest'], training_goal: 'hypertrophy', notes: null },
    { id: 'ex2', name: 'Squat', type: 'weighted', muscle_groups: ['Quads'], training_goal: 'strength', notes: null },
  ]),
  getExerciseHistory: jest.fn().mockResolvedValue([]),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: Function) => {
    const mockReact = require('react');
    mockReact.useEffect(() => { cb(); }, []);
  },
}));

import ExercisesScreen from '../ExercisesScreen';

describe('ExercisesScreen', () => {
  it('renders exercise list with search', async () => {
    const { getByTestId, getByText } = render(<ExercisesScreen />);

    await waitFor(() => {
      expect(getByTestId('exercise-search')).toBeTruthy();
      expect(getByText('Bench Press')).toBeTruthy();
      expect(getByText('Squat')).toBeTruthy();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=ExercisesScreen`
Expected: FAIL (module not found)

**Step 3: Create ExercisesScreen**

Create `src/screens/ExercisesScreen.tsx`:

```typescript
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { getAllExercises } from '../services/database';
import ExerciseHistoryModal from '../components/ExerciseHistoryModal';
import type { Exercise } from '../types/database';

export default function ExercisesScreen() {
  const [loading, setLoading] = useState(true);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState('');
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadExercises();
    }, [])
  );

  async function loadExercises() {
    setLoading(true);
    try {
      const all = await getAllExercises();
      setExercises(all);
    } finally {
      setLoading(false);
    }
  }

  const filtered = exercises.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.muscle_groups.some(m => m.toLowerCase().includes(search.toLowerCase()))
  );

  const renderExercise = useCallback(({ item }: { item: Exercise }) => (
    <TouchableOpacity
      style={styles.exerciseCard}
      onPress={() => setSelectedExercise(item)}
      activeOpacity={0.7}
    >
      <View style={styles.exerciseInfo}>
        <Text style={styles.exerciseName}>{item.name}</Text>
        <Text style={styles.exerciseMeta}>
          {item.type} · {item.muscle_groups.join(', ') || 'No muscles'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  ), []);

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Exercises</Text>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search exercises..."
          placeholderTextColor={colors.textMuted}
          testID="exercise-search"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderExercise}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <ExerciseHistoryModal
        visible={!!selectedExercise}
        exercise={selectedExercise}
        onClose={() => setSelectedExercise(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    marginLeft: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  exerciseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  exerciseMeta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
});
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=ExercisesScreen`
Expected: PASS

**Step 5: Commit**

```bash
git add src/screens/ExercisesScreen.tsx src/screens/__tests__/ExercisesScreen.test.tsx
git commit -m "feat: add ExercisesScreen with search and history modal"
```

---

## Task 5: Add Exercises Tab to Navigator

**Files:**
- Modify: `src/navigation/TabNavigator.tsx`

**Step 1: Import ExercisesScreen**

```typescript
import ExercisesScreen from '../screens/ExercisesScreen';
```

**Step 2: Add icon mapping**

Update `tabIcon` function:

```typescript
const icons: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Workout: ['barbell', 'barbell-outline'],
  Templates: ['documents', 'documents-outline'],
  Exercises: ['fitness', 'fitness-outline'],  // NEW
  History: ['time', 'time-outline'],
  Profile: ['person', 'person-outline'],
};
```

**Step 3: Add Tab.Screen**

After Templates tab, before History:

```tsx
<Tab.Screen name="Exercises" component={ExercisesScreen} />
```

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/navigation/TabNavigator.tsx
git commit -m "feat: add Exercises tab to bottom navigation"
```

---

## Task 6: Update ExerciseHistoryModal to Show Best Set per Session

**Files:**
- Modify: `src/components/ExerciseHistoryModal.tsx`
- Test: `src/components/__tests__/ExerciseHistoryModal.test.tsx`

**Step 1: Write failing test**

Add to `ExerciseHistoryModal.test.tsx`:

```typescript
it('shows best set per session in recent performances', async () => {
  (getExerciseHistory as jest.Mock).mockResolvedValue([
    {
      workout: { id: 'w1', started_at: '2024-01-15T10:00:00Z' },
      sets: [
        { id: 's1', set_number: 1, weight: 135, reps: 10, is_completed: true },
        { id: 's2', set_number: 2, weight: 145, reps: 8, is_completed: true },  // Best: 145*1.267 = 183.7
        { id: 's3', set_number: 3, weight: 135, reps: 6, is_completed: true },
      ],
    },
  ]);

  const { getByText } = render(
    <ExerciseHistoryModal
      visible={true}
      exercise={{ id: 'ex1', name: 'Test', type: 'weighted', muscle_groups: [], training_goal: 'hypertrophy', description: '', notes: null, user_id: '', created_at: '' }}
      onClose={jest.fn()}
    />
  );

  await waitFor(() => {
    // Should show best set (145x8) not all sets
    expect(getByText(/Best: 145lb × 8/)).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=ExerciseHistoryModal -t "shows best set"`
Expected: FAIL

**Step 3: Update ExerciseHistoryModal**

In `loadData()`, update recent sessions logic:

```typescript
const recent = history.slice(0, 3).map(h => {
  const completedSets = h.sets.filter(s => s.is_completed && s.weight && s.reps);
  // Find best set by estimated 1RM
  let bestSet = completedSets[0];
  let best1RM = 0;
  for (const s of completedSets) {
    const e1rm = (s.weight ?? 0) * (1 + (s.reps ?? 0) / 30);
    if (e1rm > best1RM) {
      best1RM = e1rm;
      bestSet = s;
    }
  }
  return {
    date: new Date(h.workout.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    bestSet,
  };
});
setRecentSessions(recent);
```

Update rendering:

```tsx
{recentSessions.map((session, i) => (
  <View key={i} style={styles.sessionCard}>
    <Text style={styles.sessionDate}>{session.date}</Text>
    {session.bestSet && (
      <Text style={styles.sessionSet}>
        Best: {session.bestSet.weight}lb × {session.bestSet.reps}
      </Text>
    )}
  </View>
))}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=ExerciseHistoryModal -t "shows best set"`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/components/ExerciseHistoryModal.tsx src/components/__tests__/ExerciseHistoryModal.test.tsx
git commit -m "feat: show best set per session in exercise history"
```

---

## Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add Exercises tab documentation**

Add under ## Screens section:

```markdown
- **ExercisesScreen** (`src/screens/ExercisesScreen.tsx`): Flat searchable list of all exercises. Tap exercise to open ExerciseHistoryModal showing 1RM chart, PR info, and best set from last 3 sessions.
```

**Step 2: Update notes documentation**

Update the Sticky Exercise Notes section to reflect unified notes/description behavior.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Exercises tab and unified notes"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Timer ±15 auto-enables | WorkoutScreen.tsx |
| 2 | Unify description/notes | ExercisePickerScreen, database.ts |
| 3 | Full-screen create modal | ExercisePickerScreen.tsx |
| 4 | Create ExercisesScreen | New screen + tests |
| 5 | Add Exercises tab | TabNavigator.tsx |
| 6 | Best set per session | ExerciseHistoryModal.tsx |
| 7 | Update docs | CLAUDE.md |

**Total commits:** 7
**Estimated time:** 30-45 minutes
