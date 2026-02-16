# 10 Issues Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 10 UX issues across WorkoutScreen, HistoryScreen, ProfileScreen, TemplateDetailScreen, and database layer.

**Architecture:** Mostly UI changes across existing screens. Two schema changes (rest_seconds on template_exercises, new chart dependency). One new shared component (ExerciseHistoryModal). All changes are additive — no breaking migrations needed since template_exercises is CREATE IF NOT EXISTS.

**Tech Stack:** React Native, expo-sqlite, react-native-chart-kit (new dep for issue #9), existing theme system.

---

### Task 1: Fix Workout Scroll (Issue #1)

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx:1094-1099`

**Step 1: Fix scrollContent style**

In `WorkoutScreen.tsx`, the `scrollContent` style at line 1094 needs `flexGrow: 1` removed (it shouldn't be there) and `paddingBottom` increased. The real issue is the ScrollView doesn't have enough bottom padding to scroll past the rest timer bar.

Change `scrollContent` style:

```typescript
scrollContent: {
  padding: spacing.md,
  paddingBottom: 200,
  maxWidth: 500,
  alignSelf: 'center' as any,
  width: '100%' as any,
},
```

Also remove the dynamic spacer `<View style={{ height: restSeconds > 0 ? 120 : 40 }} />` at line 831 since we're using fixed paddingBottom now.

**Step 2: Verify scroll works**

Run: `npx expo start --ios` and test scrolling during an active workout with several exercises.

**Step 3: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "fix: ensure workout screen scrolls with adequate bottom padding"
```

---

### Task 2: Improve Workout Header Layout (Issue #2)

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx:679-697` (header JSX)
- Modify: `src/screens/WorkoutScreen.tsx:1046-1075` (header styles)

**Step 1: Restructure header to two rows**

Replace the header section (lines 679-697) with:

```tsx
<View style={styles.header}>
  <View style={styles.headerRow1}>
    <TouchableOpacity onPress={handleCancelWorkout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Ionicons name="close" size={24} color={colors.textMuted} />
    </TouchableOpacity>
    <Text style={styles.headerTitle} numberOfLines={1}>
      {templateName ?? 'Workout'}
    </Text>
    <TouchableOpacity style={styles.finishBtn} onPress={handleFinish} testID="finish-workout-btn">
      <Ionicons name="checkmark" size={16} color={colors.white} style={{ marginRight: 4 }} />
      <Text style={styles.finishBtnText}>Finish</Text>
    </TouchableOpacity>
  </View>
  <View style={styles.headerRow2}>
    <View style={styles.timerRow}>
      <Ionicons name="time-outline" size={16} color={colors.primary} style={{ marginRight: 4 }} />
      <Text style={styles.headerTimer}>{elapsed}</Text>
    </View>
    <Text style={styles.headerProgress} testID="sets-progress">{completedSetsCount}/{totalSetsCount} sets</Text>
  </View>
</View>
```

**Step 2: Update header styles**

Replace header styles with:

```typescript
header: {
  paddingHorizontal: spacing.md,
  paddingTop: spacing.sm,
  paddingBottom: spacing.md,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
  backgroundColor: colors.background,
},
headerRow1: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: spacing.sm,
},
headerRow2: {
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
  gap: spacing.lg,
},
headerTitle: {
  color: colors.text,
  fontSize: fontSize.xl,
  fontWeight: fontWeight.bold,
  flex: 1,
  textAlign: 'center',
  marginHorizontal: spacing.sm,
},
timerRow: {
  flexDirection: 'row',
  alignItems: 'center',
},
headerTimer: {
  color: colors.primary,
  fontSize: fontSize.lg,
  fontWeight: fontWeight.bold,
},
headerProgress: {
  color: colors.textSecondary,
  fontSize: fontSize.lg,
  fontWeight: fontWeight.medium,
},
```

**Step 3: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "fix: split workout header into two rows for better spacing"
```

---

### Task 3: History — Filter Incomplete Sets + Fix Tags (Issue #3)

**Files:**
- Modify: `src/screens/HistoryScreen.tsx:81-96` (handleExpand — filter sets)
- Modify: `src/screens/HistoryScreen.tsx:141-149` (set row rendering — fix tag display)

**Step 1: Filter out incomplete sets in handleExpand**

In `handleExpand`, after getting sets at line 81, filter to completed only:

```typescript
const sets = (await getWorkoutSets(workoutId)).filter(s => s.is_completed);
```

**Step 2: Fix tag display in set rows**

Replace the set row rendering (lines 141-149) with:

```tsx
{group.sets.map((s) => {
  const tagLabel = s.tag === 'warmup' ? 'W' : s.tag === 'failure' ? 'F' : s.tag === 'drop' ? 'D' : null;
  const tagColor = s.tag === 'warmup' ? colors.warning : s.tag === 'failure' ? colors.error : s.tag === 'drop' ? colors.primary : undefined;
  return (
    <View key={s.id} style={styles.setRow}>
      <View style={[styles.setDot, { backgroundColor: colors.success }]} />
      <Text style={styles.setText}>
        Set {s.set_number}: {s.weight ?? 0}lb × {s.reps ?? 0}
      </Text>
      {tagLabel && (
        <View style={[styles.setTagBadge, { backgroundColor: tagColor }]}>
          <Text style={styles.setTagBadgeText}>{tagLabel}</Text>
        </View>
      )}
    </View>
  );
})}
```

**Step 3: Add tag badge styles**

Add to HistoryScreen styles:

```typescript
setTagBadge: {
  width: 20,
  height: 20,
  borderRadius: 10,
  alignItems: 'center' as any,
  justifyContent: 'center' as any,
  marginLeft: spacing.sm,
},
setTagBadgeText: {
  color: colors.white,
  fontSize: 9,
  fontWeight: fontWeight.bold,
},
```

Remove the old `setTag` style.

**Step 4: Commit**

```bash
git add src/screens/HistoryScreen.tsx
git commit -m "fix: filter incomplete sets from history, show colored tag badges"
```

---

### Task 4: Profile Stats Overhaul (Issue #4)

**Files:**
- Modify: `src/screens/ProfileScreen.tsx:20-26` (Stats interface)
- Modify: `src/screens/ProfileScreen.tsx:42-134` (stats computation)
- Modify: `src/screens/ProfileScreen.tsx:145-151` (statCards array)
- Modify: `src/services/database.ts` (add getPRsThisWeek function)

**Step 1: Add getPRsThisWeek to database.ts**

Add after `getExerciseHistory` function (~line 333):

```typescript
export async function getPRsThisWeek(): Promise<number> {
  const database = await getDb();
  const now = new Date();
  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = weekStart.toISOString();

  // Get all exercises done this week with their sets
  const weekSets = await database.getAllAsync<any>(
    `SELECT ws.exercise_id, ws.weight, ws.reps
     FROM workout_sets ws
     JOIN workouts w ON ws.workout_id = w.id
     WHERE w.finished_at IS NOT NULL
       AND w.started_at >= ?
       AND ws.is_completed = 1
       AND ws.weight IS NOT NULL
       AND ws.reps IS NOT NULL`,
    weekStartISO,
  );

  // Get unique exercises done this week
  const exerciseIds = [...new Set(weekSets.map((s: any) => s.exercise_id))];

  let prCount = 0;
  for (const exId of exerciseIds) {
    // Best 1RM this week for this exercise (Epley)
    const weekBest = weekSets
      .filter((s: any) => s.exercise_id === exId)
      .reduce((max: number, s: any) => {
        const e1rm = s.weight * (1 + s.reps / 30);
        return e1rm > max ? e1rm : max;
      }, 0);

    // Best 1RM before this week
    const priorSets = await database.getAllAsync<any>(
      `SELECT ws.weight, ws.reps
       FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE w.finished_at IS NOT NULL
         AND w.started_at < ?
         AND ws.exercise_id = ?
         AND ws.is_completed = 1
         AND ws.weight IS NOT NULL
         AND ws.reps IS NOT NULL`,
      weekStartISO, exId,
    );

    const priorBest = priorSets.reduce((max: number, s: any) => {
      const e1rm = s.weight * (1 + s.reps / 30);
      return e1rm > max ? e1rm : max;
    }, 0);

    if (weekBest > priorBest && priorBest > 0) {
      prCount++;
    }
  }

  return prCount;
}
```

**Step 2: Update ProfileScreen Stats interface and computation**

Replace Stats interface:

```typescript
interface Stats {
  totalWorkouts: number;
  thisMonth: number;
  prsThisWeek: number;
  streak: number;
}
```

Replace initial state:

```typescript
const [stats, setStats] = useState<Stats>({
  totalWorkouts: 0,
  thisMonth: 0,
  prsThisWeek: 0,
  streak: 0,
});
```

In the useFocusEffect async function, remove weekVolume and avgDuration computation. Add:

```typescript
import { getWorkoutHistory, getPRsThisWeek } from '../services/database';
```

Replace the stats computation to call `getPRsThisWeek()` and remove weekVolume/avgDuration logic. Remove unused `getWorkoutSets` import.

**Step 3: Update statCards array**

```typescript
const statCards: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { label: 'Total Workouts', value: `${stats.totalWorkouts}`, icon: 'fitness-outline', color: colors.primary },
  { label: 'This Month', value: `${stats.thisMonth}`, icon: 'calendar-outline', color: colors.success },
  { label: 'PRs This Week', value: `${stats.prsThisWeek}`, icon: 'trophy-outline', color: colors.warning },
  { label: 'Streak', value: stats.streak > 0 ? `${stats.streak} day${stats.streak > 1 ? 's' : ''}` : '—', icon: 'flame-outline', color: colors.error },
];
```

**Step 4: Remove unused imports**

Remove `formatVolume` import from ProfileScreen since it's no longer used.

**Step 5: Commit**

```bash
git add src/screens/ProfileScreen.tsx src/services/database.ts
git commit -m "feat: replace weekly volume and avg duration with PRs this week on profile"
```

---

### Task 5: Exercise Creation in Workout Add-Exercise Modal (Issue #5)

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx:866-905` (add exercise modal)
- Modify: `src/screens/WorkoutScreen.tsx` (add state + handler for create form)

**Step 1: Add create exercise state variables**

After line 99 (exerciseSearch state), add:

```typescript
const [showCreateInWorkout, setShowCreateInWorkout] = useState(false);
const [newExName, setNewExName] = useState('');
const [newExType, setNewExType] = useState<ExerciseType>('weighted');
const [newExMuscles, setNewExMuscles] = useState<string[]>([]);
const [newExDescription, setNewExDescription] = useState('');
const [newExValidation, setNewExValidation] = useState('');
```

Add imports for `createExercise` from database.ts (already imported via other functions — check, it's not imported, so add it).

Add `ExerciseType` to the type imports from `'../types/database'`.

**Step 2: Add handleCreateAndAdd function**

After `handleAddExerciseToWorkout`:

```typescript
async function handleCreateAndAddExercise() {
  if (!newExName.trim()) {
    setNewExValidation('Exercise name is required');
    return;
  }
  setNewExValidation('');
  const exercise = await createExercise({
    name: newExName.trim(),
    type: newExType,
    muscle_groups: newExMuscles,
    training_goal: 'hypertrophy',
    description: newExDescription.trim(),
  });
  // Reset form
  setNewExName('');
  setNewExType('weighted');
  setNewExMuscles([]);
  setNewExDescription('');
  setShowCreateInWorkout(false);
  // Add to workout
  await handleAddExerciseToWorkout(exercise);
}
```

**Step 3: Add create toggle + form inside the add exercise modal**

In the add exercise modal (after the search container, before the exercise ScrollView at line 886), add a create toggle button and form. Use the same MUSCLE_GROUPS and EXERCISE_TYPES constants — add them at the top of the file:

```typescript
const MUSCLE_GROUPS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Forearms',
];

const EXERCISE_TYPES: { value: ExerciseType; label: string }[] = [
  { value: 'weighted', label: 'Weighted' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
];
```

Insert between search bar and ScrollView in the modal:

```tsx
<TouchableOpacity
  style={styles.createToggleInModal}
  onPress={() => setShowCreateInWorkout(!showCreateInWorkout)}
>
  <Ionicons name={showCreateInWorkout ? 'chevron-up' : 'add-circle-outline'} size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
  <Text style={styles.createToggleText}>
    {showCreateInWorkout ? 'Hide Form' : 'Create New Exercise'}
  </Text>
</TouchableOpacity>

{showCreateInWorkout && (
  <ScrollView style={styles.createFormInModal} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
    <Text style={styles.createLabel}>Name</Text>
    <TextInput
      style={[styles.createInput, newExValidation ? { borderColor: colors.error } : null]}
      value={newExName}
      onChangeText={(v) => { setNewExName(v); setNewExValidation(''); }}
      placeholder='e.g. "Incline Dumbbell Press"'
      placeholderTextColor={colors.textMuted}
      testID="workout-exercise-name-input"
    />
    {newExValidation ? <Text style={styles.createErrorText}>{newExValidation}</Text> : null}

    <Text style={styles.createLabel}>Type</Text>
    <View style={styles.createChipRow}>
      {EXERCISE_TYPES.map((t) => (
        <TouchableOpacity
          key={t.value}
          style={[styles.createChip, newExType === t.value && styles.createChipSelected]}
          onPress={() => setNewExType(t.value)}
        >
          <Text style={[styles.createChipText, newExType === t.value && styles.createChipTextSelected]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>

    <Text style={styles.createLabel}>Muscle Groups</Text>
    <View style={styles.createChipRow}>
      {MUSCLE_GROUPS.map((mg) => {
        const sel = newExMuscles.includes(mg);
        return (
          <TouchableOpacity
            key={mg}
            style={[styles.createChip, sel && styles.createChipSelected]}
            onPress={() => setNewExMuscles((prev) => sel ? prev.filter(m => m !== mg) : [...prev, mg])}
          >
            <Text style={[styles.createChipText, sel && styles.createChipTextSelected]}>{mg}</Text>
          </TouchableOpacity>
        );
      })}
    </View>

    <Text style={styles.createLabel}>Description (optional)</Text>
    <TextInput
      style={[styles.createInput, { minHeight: 50, textAlignVertical: 'top' }]}
      value={newExDescription}
      onChangeText={setNewExDescription}
      placeholder="Form cues, setup notes..."
      placeholderTextColor={colors.textMuted}
      multiline
    />

    <TouchableOpacity style={styles.createSaveBtn} onPress={handleCreateAndAddExercise}>
      <Ionicons name="checkmark-circle" size={18} color={colors.white} style={{ marginRight: spacing.sm }} />
      <Text style={styles.createSaveBtnText}>Save & Add to Workout</Text>
    </TouchableOpacity>
  </ScrollView>
)}
```

**Step 4: Add styles for create form in modal**

Add these styles:

```typescript
createToggleInModal: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  padding: spacing.sm,
  marginVertical: spacing.sm,
},
createToggleText: {
  color: colors.primary,
  fontSize: fontSize.md,
  fontWeight: fontWeight.semibold,
},
createFormInModal: {
  maxHeight: 400,
  backgroundColor: colors.surface,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: borderRadius.lg,
  marginHorizontal: spacing.md,
  marginBottom: spacing.md,
  padding: spacing.md,
},
createLabel: {
  color: colors.textSecondary,
  fontSize: fontSize.sm,
  marginBottom: spacing.xs,
  marginTop: spacing.sm,
},
createInput: {
  backgroundColor: colors.background,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: borderRadius.md,
  padding: spacing.md,
  color: colors.text,
  fontSize: fontSize.md,
},
createErrorText: {
  color: colors.error,
  fontSize: fontSize.xs,
  marginTop: spacing.xs,
},
createChipRow: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: spacing.sm,
  marginTop: spacing.xs,
},
createChip: {
  backgroundColor: colors.background,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: borderRadius.full,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
},
createChipSelected: {
  backgroundColor: colors.primary,
  borderColor: colors.primary,
},
createChipText: {
  color: colors.textSecondary,
  fontSize: fontSize.sm,
  fontWeight: fontWeight.medium,
},
createChipTextSelected: {
  color: colors.white,
  fontWeight: fontWeight.semibold,
},
createSaveBtn: {
  backgroundColor: colors.primary,
  borderRadius: borderRadius.md,
  padding: spacing.md,
  alignItems: 'center',
  flexDirection: 'row',
  justifyContent: 'center',
  marginTop: spacing.lg,
},
createSaveBtnText: {
  color: colors.white,
  fontSize: fontSize.md,
  fontWeight: fontWeight.semibold,
},
```

**Step 5: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "feat: add create exercise form in workout add-exercise modal"
```

---

### Task 6: Per-Exercise Rest Timers in Templates (Issue #6)

**Files:**
- Modify: `src/services/database.ts` (schema migration, update queries)
- Modify: `src/types/database.ts` (add rest_seconds to TemplateExercise)
- Modify: `src/screens/TemplateDetailScreen.tsx` (rest timer UI)
- Modify: `src/screens/WorkoutScreen.tsx` (use per-exercise rest timer)

**Step 1: Add rest_seconds column migration**

In `database.ts`, after the existing migrations (line 114-115), add:

```typescript
await database.runAsync('ALTER TABLE template_exercises ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 150').catch(() => {});
```

**Step 2: Update TemplateExercise type**

In `src/types/database.ts`, add `rest_seconds` to TemplateExercise:

```typescript
export interface TemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  order: number;
  default_sets: number;
  rest_seconds: number;
  exercise?: Exercise;
}
```

**Step 3: Update getTemplateExercises query**

In `database.ts` `getTemplateExercises`, the SELECT already uses `te.*` so `rest_seconds` will be included. Update the mapping at line 187 to include it:

```typescript
rest_seconds: r.rest_seconds ?? 150,
```

**Step 4: Update addExerciseToTemplate**

Modify `addExerciseToTemplate` to accept and store `rest_seconds`:

```typescript
export async function addExerciseToTemplate(templateId: string, exerciseId: string, defaults?: { sets?: number; rest_seconds?: number }): Promise<TemplateExercise> {
  const database = await getDb();
  const id = uuid();
  const existing = await database.getAllAsync<any>('SELECT MAX(sort_order) as max_order FROM template_exercises WHERE template_id = ?', templateId);
  const order = (existing[0]?.max_order ?? -1) + 1;
  const restSec = defaults?.rest_seconds ?? 150;
  await database.runAsync(
    'INSERT INTO template_exercises (id, template_id, exercise_id, sort_order, default_sets, rest_seconds) VALUES (?, ?, ?, ?, ?, ?)',
    id, templateId, exerciseId, order, defaults?.sets ?? 3, restSec,
  );
  return { id, template_id: templateId, exercise_id: exerciseId, order, default_sets: defaults?.sets ?? 3, rest_seconds: restSec };
}
```

**Step 5: Update updateTemplateExerciseDefaults**

```typescript
export async function updateTemplateExerciseDefaults(id: string, defaults: { sets?: number; rest_seconds?: number }): Promise<void> {
  const database = await getDb();
  const parts: string[] = [];
  const values: any[] = [];
  if (defaults.sets !== undefined) { parts.push('default_sets = ?'); values.push(defaults.sets); }
  if (defaults.rest_seconds !== undefined) { parts.push('rest_seconds = ?'); values.push(defaults.rest_seconds); }
  if (parts.length === 0) return;
  values.push(id);
  await database.runAsync(`UPDATE template_exercises SET ${parts.join(', ')} WHERE id = ?`, ...values);
}
```

**Step 6: Add rest timer display to TemplateDetailScreen**

In TemplateDetailScreen `renderItem`, add a tappable rest timer next to the sets display. In the card body, after the defaults text:

```tsx
<TouchableOpacity onPress={() => handleEditRestTimer(item)} style={styles.restTimerPill}>
  <Ionicons name="timer-outline" size={12} color={colors.textSecondary} />
  <Text style={styles.restTimerText}>{item.rest_seconds}s rest</Text>
</TouchableOpacity>
```

Add `handleEditRestTimer`:

```typescript
const handleEditRestTimer = (item: TemplateExercise) => {
  if (Platform.OS === 'ios') {
    Alert.prompt(
      'Rest Timer',
      `Rest between sets (seconds)`,
      (input) => {
        if (!input) return;
        const secs = parseInt(input.trim(), 10);
        if (!isNaN(secs) && secs > 0) {
          updateTemplateExerciseDefaults(item.id, { rest_seconds: secs }).then(loadExercises);
        }
      },
      'plain-text',
      `${item.rest_seconds}`,
    );
  } else {
    // Reuse defaults modal pattern with rest timer
    setEditingItem(item);
    setDefaultsValue(`${item.rest_seconds}`);
    setShowDefaultsModal(true);
    // Will need to distinguish between sets and rest editing — simplest: add a flag
  }
};
```

Note: For Android, we need to distinguish the modal between "edit sets" and "edit rest". Add state `editingField: 'sets' | 'rest'` and use it in `handleDefaultsConfirm`.

Add styles:

```typescript
restTimerPill: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
  marginTop: spacing.xs,
},
restTimerText: {
  color: colors.textSecondary,
  fontSize: fontSize.xs,
},
```

**Step 7: Use per-exercise rest timer in WorkoutScreen**

In `handleStartFromTemplate`, store rest_seconds per exercise. Add to ExerciseBlock interface:

```typescript
interface ExerciseBlock {
  exercise: Exercise;
  sets: LocalSet[];
  lastTime: string | null;
  notesExpanded: boolean;
  notes: string;
  restSeconds: number;  // per-exercise rest timer
}
```

In `buildExerciseBlock`, accept optional `restSeconds` parameter and include in return.

In `handleToggleComplete`, use `block.restSeconds` instead of `REST_SECONDS[goal]`:

```typescript
if (newCompleted) {
  try { Vibration.vibrate(50); } catch {}
  const block = exerciseBlocks[blockIdx];
  startRestTimerWithSeconds(block.restSeconds ?? REST_SECONDS[block.exercise.training_goal], block.exercise.name);
}
```

Add `startRestTimerWithSeconds(seconds, exerciseName)` as a variant of `startRestTimer`.

**Step 8: Commit**

```bash
git add src/services/database.ts src/types/database.ts src/screens/TemplateDetailScreen.tsx src/screens/WorkoutScreen.tsx
git commit -m "feat: add per-exercise rest timers to templates and workout"
```

---

### Task 7: Allow Completing Sets Without Weight/Reps (Issue #7)

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx:457-476` (handleToggleComplete)

**Step 1: Remove any guard that prevents completing empty sets**

Looking at the current `handleToggleComplete` (line 457), there's actually no explicit guard preventing completion. The issue is likely in the checkbox rendering or somewhere else. Check if the checkbox has a disabled condition.

Looking at line 773-778, the checkbox `TouchableOpacity` has no `disabled` prop. The issue might be that the user can't complete because weight/reps validation happens elsewhere, or it's a UI confusion.

Actually re-reading the code, `handleToggleComplete` at lines 464-468 saves `weight: set.weight === '' ? null : Number(set.weight)` — this already handles empty values. The sets CAN be completed with empty weight/reps. This may be a perceived issue from the UI — the user might think they need to enter values first.

If there IS a guard we missed, remove it. Otherwise this task is already done. Verify by testing.

**Step 2: Commit (if changes needed)**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "fix: allow completing sets without weight or reps entered"
```

---

### Task 8: Remove Redundant Template Name Label (Issue #8)

**Files:**
- Modify: `src/screens/TemplateDetailScreen.tsx:143-149` (nameRow JSX)
- Modify: `src/screens/TemplateDetailScreen.tsx:248-253` (nameLabel style — remove)

**Step 1: Remove the "TEMPLATE NAME" label**

Replace lines 143-149:

```tsx
<TouchableOpacity style={styles.nameRow} onPress={handleEditName} activeOpacity={0.7}>
  <View style={styles.nameRowInner}>
    <Text style={styles.nameValue}>{templateName}</Text>
    <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
  </View>
</TouchableOpacity>
```

Remove the `nameLabel` style definition.

**Step 2: Commit**

```bash
git add src/screens/TemplateDetailScreen.tsx
git commit -m "fix: remove redundant template name label"
```

---

### Task 9: Exercise History Modal with Chart + PRs (Issue #9)

**Files:**
- Create: `src/components/ExerciseHistoryModal.tsx`
- Modify: `src/screens/HistoryScreen.tsx` (make exercise name tappable)
- Modify: `src/screens/WorkoutScreen.tsx` (make exercise name tappable)
- Modify: `package.json` (add react-native-chart-kit, react-native-svg)

**Step 1: Install chart dependency**

```bash
cd /Users/sachitgoyal/code/lift-ai && npx expo install react-native-chart-kit react-native-svg
```

**Step 2: Create ExerciseHistoryModal component**

Create `src/components/ExerciseHistoryModal.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LineChart } from 'react-native-chart-kit';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { getExerciseHistory } from '../services/database';
import type { Exercise, WorkoutSet, Workout } from '../types/database';

interface Props {
  visible: boolean;
  exercise: Exercise | null;
  onClose: () => void;
}

interface DataPoint {
  date: string;
  best1RM: number;
}

export default function ExerciseHistoryModal({ visible, exercise, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState<DataPoint[]>([]);
  const [prValue, setPrValue] = useState(0);
  const [prDate, setPrDate] = useState('');
  const [recentSessions, setRecentSessions] = useState<{ date: string; sets: WorkoutSet[] }[]>([]);

  useEffect(() => {
    if (!visible || !exercise) return;
    loadData();
  }, [visible, exercise]);

  async function loadData() {
    if (!exercise) return;
    setLoading(true);
    try {
      const history = await getExerciseHistory(exercise.id, 20);

      // Build chart data (oldest first)
      const points: DataPoint[] = history
        .map((h) => {
          const completedSets = h.sets.filter(s => s.is_completed && s.weight && s.reps);
          if (completedSets.length === 0) return null;
          const best = Math.max(...completedSets.map(s => (s.weight ?? 0) * (1 + (s.reps ?? 0) / 30)));
          const d = new Date(h.workout.started_at);
          return { date: `${d.getMonth() + 1}/${d.getDate()}`, best1RM: Math.round(best) };
        })
        .filter(Boolean)
        .reverse() as DataPoint[];

      setChartData(points);

      // PR
      if (points.length > 0) {
        let maxVal = 0;
        let maxDate = '';
        for (const p of points) {
          if (p.best1RM >= maxVal) {
            maxVal = p.best1RM;
            maxDate = p.date;
          }
        }
        setPrValue(maxVal);
        setPrDate(maxDate);
      }

      // Last 3 sessions
      const recent = history.slice(0, 3).map(h => ({
        date: new Date(h.workout.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        sets: h.sets.filter(s => s.is_completed),
      }));
      setRecentSessions(recent);
    } finally {
      setLoading(false);
    }
  }

  if (!exercise) return null;

  const screenWidth = Dimensions.get('window').width - spacing.lg * 2;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{exercise.name}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              {/* PR Banner */}
              {prValue > 0 && (
                <View style={styles.prBanner}>
                  <Ionicons name="trophy" size={20} color={colors.warning} />
                  <Text style={styles.prText}>PR: {prValue}lb est. 1RM — {prDate}</Text>
                </View>
              )}

              {/* Chart */}
              {chartData.length >= 2 ? (
                <View style={styles.chartContainer}>
                  <Text style={styles.sectionTitle}>Estimated 1RM Progression</Text>
                  <LineChart
                    data={{
                      labels: chartData.length <= 8 ? chartData.map(d => d.date) : chartData.filter((_, i) => i % Math.ceil(chartData.length / 6) === 0 || i === chartData.length - 1).map(d => d.date),
                      datasets: [{ data: chartData.map(d => d.best1RM) }],
                    }}
                    width={screenWidth - spacing.md * 2}
                    height={180}
                    chartConfig={{
                      backgroundColor: colors.surface,
                      backgroundGradientFrom: colors.surface,
                      backgroundGradientTo: colors.surface,
                      decimalCount: 0,
                      color: (opacity = 1) => `rgba(124, 92, 252, ${opacity})`,
                      labelColor: () => colors.textMuted,
                      propsForDots: { r: '4', strokeWidth: '2', stroke: colors.primaryLight },
                    }}
                    bezier
                    style={{ borderRadius: borderRadius.md }}
                  />
                </View>
              ) : (
                <Text style={styles.noData}>Not enough data for chart (need 2+ sessions)</Text>
              )}

              {/* Last 3 sessions */}
              {recentSessions.length > 0 && (
                <View style={styles.recentSection}>
                  <Text style={styles.sectionTitle}>Recent Performances</Text>
                  {recentSessions.map((session, i) => (
                    <View key={i} style={styles.sessionCard}>
                      <Text style={styles.sessionDate}>{session.date}</Text>
                      {session.sets.map((s) => (
                        <Text key={s.id} style={styles.sessionSet}>
                          Set {s.set_number}: {s.weight ?? 0}lb × {s.reps ?? 0}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '85%',
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.lg,
  },
  prBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  prText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  chartContainer: {
    marginTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    textTransform: 'uppercase' as any,
  },
  noData: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  recentSection: {
    marginTop: spacing.lg,
  },
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  sessionDate: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  sessionSet: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
    marginBottom: 2,
  },
});
```

**Step 3: Integrate into HistoryScreen**

Import the modal and add state:

```typescript
import ExerciseHistoryModal from '../components/ExerciseHistoryModal';
// Add state
const [historyModalExercise, setHistoryModalExercise] = useState<Exercise | null>(null);
```

Make exercise group names tappable (replace line 140):

```tsx
<TouchableOpacity onPress={() => {
  const ex = exerciseMap[order[gi]]; // need to pass exerciseId
  if (ex) setHistoryModalExercise(ex);
}}>
  <Text style={styles.exerciseGroupName}>{group.exerciseName}</Text>
</TouchableOpacity>
```

Note: Need to store exercise IDs alongside GroupedSets. Update `GroupedSets` interface:

```typescript
interface GroupedSets {
  exerciseId: string;
  exerciseName: string;
  sets: WorkoutSet[];
}
```

Update `handleExpand` to include `exerciseId`:

```typescript
setExpandedSets(
  order.map((eid) => ({
    exerciseId: eid,
    exerciseName: exerciseMap[eid]?.name ?? 'Unknown Exercise',
    sets: grouped[eid],
  })),
);
```

Add the modal at the bottom of the return JSX:

```tsx
<ExerciseHistoryModal
  visible={!!historyModalExercise}
  exercise={historyModalExercise}
  onClose={() => setHistoryModalExercise(null)}
/>
```

**Step 4: Integrate into WorkoutScreen**

Import the modal and add state:

```typescript
import ExerciseHistoryModal from '../components/ExerciseHistoryModal';
const [historyExercise, setHistoryExercise] = useState<Exercise | null>(null);
```

Make exercise name tappable in exercise blocks (line 703):

```tsx
<TouchableOpacity onPress={() => setHistoryExercise(block.exercise)}>
  <Text style={styles.exerciseName}>{block.exercise.name}</Text>
</TouchableOpacity>
```

Add modal before closing `</SafeAreaView>`:

```tsx
<ExerciseHistoryModal
  visible={!!historyExercise}
  exercise={historyExercise}
  onClose={() => setHistoryExercise(null)}
/>
```

**Step 5: Commit**

```bash
git add package.json package-lock.json src/components/ExerciseHistoryModal.tsx src/screens/HistoryScreen.tsx src/screens/WorkoutScreen.tsx
git commit -m "feat: add exercise history modal with 1RM chart and recent performances"
```

---

### Task 10: Remove Volume Display (Issue #10)

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx:649-667` (summary screen — remove Volume stat)
- Modify: `src/screens/WorkoutScreen.tsx:579-619` (confirmFinish — remove volume calc from summaryStats)
- Modify: `src/screens/HistoryScreen.tsx:122-133` (remove volume pill)
- Modify: `src/screens/HistoryScreen.tsx:18-21` (remove totalVolume from interface)
- Modify: `src/screens/HistoryScreen.tsx:50-62` (remove volume computation)

**Step 1: Remove volume from workout summary**

In the summary screen (line 649-667), remove the Volume SummaryStat line:

```tsx
<SummaryStat label="Volume" value={`${summaryStats.volume.toLocaleString()} lb`} icon="trending-up-outline" />
```

Remove `volume` from `summaryStats` state and `confirmFinish`.

**Step 2: Remove volume pill from HistoryScreen**

Remove the volume pill (lines 127-132):

```tsx
<View style={styles.pill}>
  <Ionicons name="barbell-outline" size={12} color={colors.success} />
  <Text style={styles.pillText}>
    {formatVolume(item.totalVolume)}
  </Text>
</View>
```

Remove `totalVolume` from `WorkoutWithVolume` interface. Remove the volume computation from the `enriched` mapping. Remove `formatVolume` import.

**Step 3: Commit**

```bash
git add src/screens/WorkoutScreen.tsx src/screens/HistoryScreen.tsx
git commit -m "fix: remove volume display from workout summary and history"
```
