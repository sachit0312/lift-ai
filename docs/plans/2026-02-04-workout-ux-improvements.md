# Workout UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve template editing UX with inline steppers, add swipe-to-delete for workout sets, speed up workout screen loading, and fix exercise history modal layout.

**Architecture:**
- TemplateDetailScreen: Replace text-based sets/rest display with inline stepper controls using icons (dumbbell for sets, timer for rest)
- WorkoutScreen: Add react-native-gesture-handler Swipeable for set row deletion
- WorkoutScreen: Show idle UI immediately, load upcoming workout in background
- ExerciseHistoryModal: Refactor recent performances to side-by-side layout (date left, best set right)

**Tech Stack:** React Native, react-native-gesture-handler, TypeScript

---

## Task 1: Install react-native-gesture-handler (if not present)

**Files:**
- Check: `package.json`

**Step 1: Check if already installed**

Run: `grep "react-native-gesture-handler" package.json`

If present, skip to Task 2. If not:

**Step 2: Install package**

Run: `npm install react-native-gesture-handler`

**Step 3: Verify installation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit (if installed)**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-native-gesture-handler"
```

---

## Task 2: Refactor TemplateDetailScreen - Inline Stepper Controls

**Files:**
- Modify: `src/screens/TemplateDetailScreen.tsx`
- Test: `src/screens/__tests__/TemplateDetailScreen.test.tsx`

**Step 1: Write failing test for stepper controls**

Add to `src/screens/__tests__/TemplateDetailScreen.test.tsx`:

```typescript
it('renders inline stepper controls for sets and rest', async () => {
  const { getByTestId, getByText } = render(<TemplateDetailScreen />);

  await waitFor(() => {
    // Sets stepper: dumbbell icon with - and + buttons
    expect(getByTestId('sets-decrease-0')).toBeTruthy();
    expect(getByTestId('sets-value-0')).toBeTruthy();
    expect(getByTestId('sets-increase-0')).toBeTruthy();

    // Rest stepper: timer icon with - and + buttons
    expect(getByTestId('rest-decrease-0')).toBeTruthy();
    expect(getByTestId('rest-value-0')).toBeTruthy();
    expect(getByTestId('rest-increase-0')).toBeTruthy();
  });
});

it('increments sets when + is pressed', async () => {
  const { getByTestId, getByText } = render(<TemplateDetailScreen />);

  await waitFor(() => expect(getByTestId('sets-value-0')).toBeTruthy());

  const initialValue = getByTestId('sets-value-0').props.children;

  await act(async () => {
    fireEvent.press(getByTestId('sets-increase-0'));
  });

  await waitFor(() => {
    expect(updateTemplateExerciseDefaults).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sets: expect.any(Number) })
    );
  });
});

it('adjusts rest by 15 seconds when +/- pressed', async () => {
  const { getByTestId } = render(<TemplateDetailScreen />);

  await waitFor(() => expect(getByTestId('rest-value-0')).toBeTruthy());

  await act(async () => {
    fireEvent.press(getByTestId('rest-increase-0'));
  });

  await waitFor(() => {
    expect(updateTemplateExerciseDefaults).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ rest_seconds: expect.any(Number) })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=TemplateDetailScreen -t "inline stepper"`
Expected: FAIL (testIDs not found)

**Step 3: Refactor TemplateDetailScreen card layout**

Replace the current card body in `renderItem` with inline steppers:

```tsx
const renderItem = useCallback(({ item, index }: { item: TemplateExercise; index: number }) => (
  <View style={styles.card}>
    <View style={[styles.cardAccent, { backgroundColor: exerciseTypeColor(item.exercise?.type) }]} />
    <View style={styles.cardBody}>
      {/* Exercise name row */}
      <Text style={styles.exerciseName}>{item.exercise?.name ?? 'Unknown'}</Text>

      {/* Muscle groups */}
      {item.exercise?.muscle_groups && item.exercise.muscle_groups.length > 0 && (
        <Text style={styles.muscles}>{item.exercise.muscle_groups.join(', ')}</Text>
      )}

      {/* Stepper controls row */}
      <View style={styles.stepperRow}>
        {/* Sets stepper */}
        <View style={styles.stepperGroup}>
          <Ionicons name="barbell-outline" size={16} color={colors.textSecondary} />
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => handleDecreaseSets(item)}
            testID={`sets-decrease-${index}`}
          >
            <Text style={styles.stepperBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.stepperValue} testID={`sets-value-${index}`}>
            {item.default_sets}
          </Text>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => handleIncreaseSets(item)}
            testID={`sets-increase-${index}`}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Rest stepper */}
        <View style={styles.stepperGroup}>
          <Ionicons name="timer-outline" size={16} color={colors.textSecondary} />
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => handleDecreaseRest(item)}
            testID={`rest-decrease-${index}`}
          >
            <Text style={styles.stepperBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.stepperValue} testID={`rest-value-${index}`}>
            {item.rest_seconds}
          </Text>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => handleIncreaseRest(item)}
            testID={`rest-increase-${index}`}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>

    <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemove(item)}>
      <Ionicons name="trash-outline" size={18} color={colors.error} />
    </TouchableOpacity>
  </View>
), [handleDecreaseSets, handleIncreaseSets, handleDecreaseRest, handleIncreaseRest, handleRemove]);
```

**Step 4: Add stepper handler functions**

```typescript
const handleIncreaseSets = useCallback((item: TemplateExercise) => {
  const newSets = item.default_sets + 1;
  updateTemplateExerciseDefaults(item.id, { sets: newSets })
    .then(loadExercises)
    .catch((e) => console.error('Failed to update sets', e));
}, [loadExercises]);

const handleDecreaseSets = useCallback((item: TemplateExercise) => {
  if (item.default_sets <= 1) return;
  const newSets = item.default_sets - 1;
  updateTemplateExerciseDefaults(item.id, { sets: newSets })
    .then(loadExercises)
    .catch((e) => console.error('Failed to update sets', e));
}, [loadExercises]);

const handleIncreaseRest = useCallback((item: TemplateExercise) => {
  const newRest = item.rest_seconds + 15;
  updateTemplateExerciseDefaults(item.id, { rest_seconds: newRest })
    .then(loadExercises)
    .catch((e) => console.error('Failed to update rest', e));
}, [loadExercises]);

const handleDecreaseRest = useCallback((item: TemplateExercise) => {
  if (item.rest_seconds <= 15) return;
  const newRest = item.rest_seconds - 15;
  updateTemplateExerciseDefaults(item.id, { rest_seconds: newRest })
    .then(loadExercises)
    .catch((e) => console.error('Failed to update rest', e));
}, [loadExercises]);
```

**Step 5: Add stepper styles**

```typescript
stepperRow: {
  flexDirection: 'row',
  alignItems: 'center',
  marginTop: spacing.md,
  gap: spacing.lg,
},
stepperGroup: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.xs,
},
stepperBtn: {
  width: 32,
  height: 32,
  borderRadius: borderRadius.sm,
  backgroundColor: colors.surfaceLight,
  alignItems: 'center',
  justifyContent: 'center',
},
stepperBtnText: {
  color: colors.textSecondary,
  fontSize: fontSize.lg,
  fontWeight: fontWeight.bold,
},
stepperValue: {
  color: colors.text,
  fontSize: fontSize.md,
  fontWeight: fontWeight.semibold,
  minWidth: 32,
  textAlign: 'center',
},
```

**Step 6: Remove old modal-based edit handlers**

Delete `handleEditDefaults`, `handleEditRestTimer`, and related modal state/JSX (showDefaultsModal, defaultsValue, editingItem, editingField).

**Step 7: Run test to verify it passes**

Run: `npm test -- --testPathPattern=TemplateDetailScreen`
Expected: PASS

**Step 8: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 9: Commit**

```bash
git add src/screens/TemplateDetailScreen.tsx src/screens/__tests__/TemplateDetailScreen.test.tsx
git commit -m "feat: replace template exercise editing with inline steppers"
```

---

## Task 3: Add Swipe-to-Delete for Workout Sets

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx`
- Test: `src/screens/__tests__/WorkoutScreen.test.tsx`

**Step 1: Write failing test**

Add to `src/screens/__tests__/WorkoutScreen.test.tsx`:

```typescript
it('renders swipeable set rows', async () => {
  // Start a workout first
  const { getByTestId } = render(<WorkoutScreen />);

  await waitFor(() => expect(getByTestId('start-empty-workout')).toBeTruthy());
  await act(async () => { fireEvent.press(getByTestId('start-empty-workout')); });

  // Add an exercise
  await waitFor(() => expect(getByTestId('add-exercise-btn')).toBeTruthy());
  await act(async () => { fireEvent.press(getByTestId('add-exercise-btn')); });

  // The set row should be wrapped in Swipeable
  await waitFor(() => {
    expect(getByTestId('swipeable-set-0-0')).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=WorkoutScreen -t "swipeable set rows"`
Expected: FAIL (testID not found)

**Step 3: Import Swipeable and wrap set rows**

At top of `WorkoutScreen.tsx`:

```typescript
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
```

Wrap the entire SafeAreaView content in GestureHandlerRootView:

```tsx
return (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={styles.container}>
      {/* ... existing content ... */}
    </SafeAreaView>
  </GestureHandlerRootView>
);
```

**Step 4: Create SwipeableSetRow component**

Add inside WorkoutScreen.tsx:

```tsx
const SwipeableSetRow = React.memo(function SwipeableSetRow({
  set,
  setIdx,
  blockIdx,
  block,
  onDelete,
  children,
}: {
  set: LocalSet;
  setIdx: number;
  blockIdx: number;
  block: ExerciseBlock;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const swipeableRef = useRef<Swipeable>(null);

  // Don't allow delete if it's the last set
  const canDelete = block.sets.length > 1;

  const renderRightActions = () => {
    if (!canDelete) return null;
    return (
      <TouchableOpacity
        style={styles.swipeDeleteBtn}
        onPress={() => {
          swipeableRef.current?.close();
          onDelete();
        }}
      >
        <Ionicons name="trash" size={20} color={colors.white} />
      </TouchableOpacity>
    );
  };

  const handleSwipeOpen = (direction: 'left' | 'right') => {
    if (direction === 'right' && canDelete) {
      // Full swipe deletes immediately
      onDelete();
    }
  };

  if (!canDelete) {
    return <View testID={`swipeable-set-${blockIdx}-${setIdx}`}>{children}</View>;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      onSwipeableOpen={handleSwipeOpen}
      rightThreshold={80}
      testID={`swipeable-set-${blockIdx}-${setIdx}`}
    >
      {children}
    </Swipeable>
  );
});
```

**Step 5: Wrap set rows with SwipeableSetRow**

In the set rows mapping:

```tsx
{block.sets.map((set, setIdx) => {
  const tagLabel = getSetTagLabel(set.tag);
  const tagColor = getSetTagColor(set.tag);
  const prevText = set.previous
    ? `${set.previous.weight}×${set.previous.reps}`
    : '—';
  const hasError = validationErrors[`${blockIdx}-${setIdx}`];

  return (
    <SwipeableSetRow
      key={set.id}
      set={set}
      setIdx={setIdx}
      blockIdx={blockIdx}
      block={block}
      onDelete={() => handleDeleteSet(blockIdx, setIdx)}
    >
      <View
        style={[
          styles.setRow,
          set.is_completed && styles.setRowCompleted,
        ]}
      >
        {/* ... existing set row content ... */}
      </View>
    </SwipeableSetRow>
  );
})}
```

**Step 6: Add swipe delete button style**

```typescript
swipeDeleteBtn: {
  backgroundColor: colors.error,
  justifyContent: 'center',
  alignItems: 'center',
  width: 80,
  height: '100%',
  borderRadius: borderRadius.md,
  marginLeft: spacing.xs,
},
```

**Step 7: Run test to verify it passes**

Run: `npm test -- --testPathPattern=WorkoutScreen -t "swipeable"`
Expected: PASS

**Step 8: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 9: Commit**

```bash
git add src/screens/WorkoutScreen.tsx src/screens/__tests__/WorkoutScreen.test.tsx
git commit -m "feat: add swipe-to-delete for workout sets"
```

---

## Task 4: Speed Up Workout Screen Loading

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx`

**Step 1: Refactor loadState to show UI immediately**

Replace the current `loadState` function:

```typescript
async function loadState() {
  setLoading(true);
  try {
    const active = await getActiveWorkout();
    setActiveWorkout(active);
    workoutRef.current = active;

    if (active) {
      setTemplateName(active.template_name ?? null);
      await loadActiveWorkout(active);
    } else {
      // Load templates immediately (fast, local only)
      const t = await getAllTemplates();
      setTemplates(t);

      // Show UI right away
      setLoading(false);

      // Load upcoming workout in background (slow, network)
      loadUpcomingWorkoutInBackground();
    }
  } catch (e) {
    console.error('Failed to load workout state', e);
  } finally {
    // Only set loading false if we didn't already (active workout case)
    if (activeWorkout) {
      setLoading(false);
    }
  }
}

async function loadUpcomingWorkoutInBackground() {
  try {
    await Promise.race([
      pullUpcomingWorkout(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
  } catch (e) {
    console.error('pullUpcomingWorkout failed or timed out', e);
  }

  const upcoming = await getUpcomingWorkoutForToday();
  setUpcomingWorkout(upcoming);
}
```

**Step 2: Add loading state for template tap**

Add state:

```typescript
const [startingTemplateId, setStartingTemplateId] = useState<string | null>(null);
```

Update `handleStartFromTemplate`:

```typescript
async function handleStartFromTemplate(template: Template) {
  try {
    setStartingTemplateId(template.id);  // Show spinner on this card
    const workout = await startWorkout(template.id);
    const templateExercises = await getTemplateExercises(template.id);

    const blocks: ExerciseBlock[] = [];
    for (const te of templateExercises) {
      if (!te.exercise) continue;
      blocks.push(await buildExerciseBlock(workout.id, te.exercise, te.default_sets, te.rest_seconds));
    }

    activateWorkout(workout, blocks, template.name);
  } catch (e) {
    console.error('Failed to start workout', e);
  } finally {
    setStartingTemplateId(null);
  }
}
```

**Step 3: Update NoActiveWorkout to show inline spinner**

Update the template card in NoActiveWorkout:

```tsx
{templates.map((t) => (
  <TouchableOpacity
    key={t.id}
    style={styles.templateCard}
    onPress={() => onStartTemplate(t)}
    disabled={startingTemplateId === t.id}
  >
    <View style={styles.templateCardLeft} />
    <View style={styles.templateCardBody}>
      <Text style={styles.templateName}>{t.name}</Text>
    </View>
    {startingTemplateId === t.id ? (
      <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.md }} />
    ) : (
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    )}
  </TouchableOpacity>
))}
```

Pass `startingTemplateId` as a prop to NoActiveWorkout.

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "perf: show workout idle screen immediately, load upcoming in background"
```

---

## Task 5: Fix Exercise History Modal Recent Performances Layout

**Files:**
- Modify: `src/components/ExerciseHistoryModal.tsx`
- Test: `src/components/__tests__/ExerciseHistoryModal.test.tsx`

**Step 1: Write failing test**

Add to `src/components/__tests__/ExerciseHistoryModal.test.tsx`:

```typescript
it('renders recent performances with side-by-side layout', async () => {
  (getExerciseHistory as jest.Mock).mockResolvedValue([
    {
      workout: { id: 'w1', started_at: '2024-01-15T10:00:00Z' },
      sets: [
        { id: 's1', set_number: 1, weight: 135, reps: 8, is_completed: true },
      ],
    },
    {
      workout: { id: 'w2', started_at: '2024-01-12T10:00:00Z' },
      sets: [
        { id: 's2', set_number: 1, weight: 130, reps: 10, is_completed: true },
      ],
    },
    {
      workout: { id: 'w3', started_at: '2024-01-08T10:00:00Z' },
      sets: [
        { id: 's3', set_number: 1, weight: 125, reps: 12, is_completed: true },
      ],
    },
  ]);

  const { getByTestId } = render(
    <ExerciseHistoryModal
      visible={true}
      exercise={createMockExercise()}
      onClose={jest.fn()}
    />
  );

  await waitFor(() => {
    // Each session row should have date and best set on same row
    expect(getByTestId('session-row-0')).toBeTruthy();
    expect(getByTestId('session-date-0')).toBeTruthy();
    expect(getByTestId('session-best-0')).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=ExerciseHistoryModal -t "side-by-side"`
Expected: FAIL (testIDs not found)

**Step 3: Update recent performances rendering**

In `ExerciseHistoryModal.tsx`, replace the recent sessions rendering:

```tsx
{recentSessions.length > 0 && (
  <View style={styles.recentSection}>
    <Text style={styles.sectionTitle}>Recent Performances</Text>
    {recentSessions.map((session, i) => (
      <View key={i} style={styles.sessionRow} testID={`session-row-${i}`}>
        <Text style={styles.sessionDate} testID={`session-date-${i}`}>
          {session.date}
        </Text>
        {session.bestSet && (
          <Text style={styles.sessionBest} testID={`session-best-${i}`}>
            {session.bestSet.weight}lb × {session.bestSet.reps}
          </Text>
        )}
      </View>
    ))}
  </View>
)}
```

**Step 4: Update styles for side-by-side layout**

Replace session card styles:

```typescript
sessionRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  backgroundColor: colors.surface,
  borderRadius: borderRadius.md,
  padding: spacing.md,
  marginBottom: spacing.sm,
},
sessionDate: {
  color: colors.textSecondary,
  fontSize: fontSize.sm,
  fontWeight: fontWeight.medium,
},
sessionBest: {
  color: colors.text,
  fontSize: fontSize.md,
  fontWeight: fontWeight.semibold,
},
```

Remove old `sessionCard` and `sessionSet` styles.

**Step 5: Run test to verify it passes**

Run: `npm test -- --testPathPattern=ExerciseHistoryModal -t "side-by-side"`
Expected: PASS

**Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/components/ExerciseHistoryModal.tsx src/components/__tests__/ExerciseHistoryModal.test.tsx
git commit -m "fix: use side-by-side layout for exercise history recent performances"
```

---

## Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Document new features**

Add/update under ## Screens:

```markdown
- **TemplateDetailScreen**: Edit template name, view/edit/remove exercises with inline stepper controls for sets (±1) and rest timer (±15s). Steppers use icons (barbell for sets, timer for rest) with no text labels.
```

Update WorkoutScreen entry:

```markdown
- Long-press set number to delete set (except last set). **Alternatively, swipe left on a set row to delete immediately.**
```

Update ExerciseHistoryModal entry in ## Components:

```markdown
- **ExerciseHistoryModal**: ... recent performances (last 3 sessions with best set displayed in side-by-side layout: date left, weight×reps right).
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with UX improvements"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Install gesture handler | package.json |
| 2 | Inline steppers for template | TemplateDetailScreen.tsx |
| 3 | Swipe-to-delete sets | WorkoutScreen.tsx |
| 4 | Faster workout loading | WorkoutScreen.tsx |
| 5 | Fix history modal layout | ExerciseHistoryModal.tsx |
| 6 | Update docs | CLAUDE.md |

**Total commits:** 6
