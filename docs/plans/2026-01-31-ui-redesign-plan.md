# UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Overhaul the app's visual design to a Hevy/Strong-inspired two-tone (purple + gray) aesthetic, add a dedicated Create Exercise screen, add PR tracking, and add AI workout scoring.

**Architecture:** Update theme constants first, then restyle each screen file in-place. Add a new `CreateExerciseScreen` to the Templates navigation stack. Add `getLastWorkoutDateForTemplate()` and `getPersonalRecords()` database queries. Extend `generateWorkoutSummary` to return a numeric AI score.

**Tech Stack:** React Native (Expo), TypeScript, expo-sqlite, @react-navigation/native-stack, OpenRouter AI

---

### Task 1: Update Theme Constants

**Files:**
- Modify: `src/theme/index.ts` (entire file, 55 lines)

**Step 1: Replace theme file with new two-tone palette**

```typescript
export const colors = {
  background: '#0c0c0f',
  surface: '#131316',
  surfaceBorder: '#1a1a1f',
  inputBg: '#141418',
  inputBorder: '#1e1e24',
  primary: '#7c5cfc',
  primaryLight: '#a78bfa',
  primaryTint: 'rgba(124, 92, 252, 0.08)',
  primarySubtle: 'rgba(124, 92, 252, 0.1)',
  text: '#e8e8eb',
  textSecondary: '#999999',
  textMuted: '#555555',
  textDim: '#444444',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  title: 34,
  hero: 42,
} as const;

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  heavy: '800' as const,
};

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 16,
  full: 9999,
} as const;
```

**Step 2: Verify no type errors**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

This will produce errors in screens referencing removed colors (`accent`, `success`, `warning`, `error`, `surfaceLight`, `primaryDim`, `textSecondary` → renamed). That's expected — we fix those in subsequent tasks.

**Step 3: Commit**

```bash
git add src/theme/index.ts
git commit -m "feat: update theme to two-tone purple+gray palette"
```

---

### Task 2: Update Navigation — Add CreateExercise Screen

**Files:**
- Modify: `src/navigation/TabNavigator.tsx` (94 lines)
- Create: `src/screens/CreateExerciseScreen.tsx` (placeholder)

**Step 1: Add CreateExercise to the navigation stack param list**

In `src/navigation/TabNavigator.tsx`, update `TemplatesStackParamList` (line 12-16):

```typescript
export type TemplatesStackParamList = {
  TemplatesList: undefined;
  TemplateDetail: { templateId: string; templateName: string };
  ExercisePicker: { templateId: string };
  CreateExercise: { templateId?: string };
};
```

**Step 2: Add the screen to the stack navigator**

After the ExercisePicker screen registration (around line 42), add:

```typescript
<Stack.Screen
  name="CreateExercise"
  component={CreateExerciseScreen}
  options={{ headerShown: false }}
/>
```

Add the import at the top:
```typescript
import CreateExerciseScreen from '../screens/CreateExerciseScreen';
```

**Step 3: Create placeholder CreateExerciseScreen**

Create `src/screens/CreateExerciseScreen.tsx`:

```typescript
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

export default function CreateExerciseScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Create Exercise — TODO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  text: { color: colors.text, fontSize: 16 },
});
```

**Step 4: Verify app compiles**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/navigation/TabNavigator.tsx src/screens/CreateExerciseScreen.tsx
git commit -m "feat: add CreateExercise screen to navigation stack"
```

---

### Task 3: Add Database Queries — Last Workout Date, PR Detection, AI Score

**Files:**
- Modify: `src/services/database.ts` (lines 306-312 area, add new functions at end)
- Modify: `src/types/database.ts` (add ai_score field to Workout)

**Step 1: Add `ai_score` column to Workout type**

In `src/types/database.ts`, add to the Workout interface:
```typescript
export interface Workout {
  id: string;
  user_id: string;
  template_id: string | null;
  started_at: string;
  finished_at: string | null;
  ai_summary: string | null;
  ai_score: number | null;  // NEW
  notes: string | null;
  template_name?: string;
}
```

**Step 2: Add ai_score column to schema init**

In `src/services/database.ts`, in `initSchema()`, after the workouts table CREATE, add a migration:

```typescript
await database.runAsync(`ALTER TABLE workouts ADD COLUMN ai_score REAL`).catch(() => {});
```

**Step 3: Add `getLastWorkoutDateForTemplate()`**

Add to end of `src/services/database.ts`:

```typescript
export async function getLastWorkoutDateForTemplate(templateId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ finished_at: string }>(
    `SELECT finished_at FROM workouts WHERE template_id = ? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`,
    [templateId]
  );
  return row?.finished_at ?? null;
}
```

**Step 4: Add `getPersonalRecords()` for a workout**

```typescript
export async function countPRsInWorkout(workoutId: string): Promise<number> {
  const db = await getDb();
  const sets = await getWorkoutSets(workoutId);
  const completedSets = sets.filter(s => s.is_completed && s.weight && s.reps);
  let prCount = 0;

  for (const set of completedSets) {
    const prev = await db.getFirstAsync<{ max_weight: number }>(
      `SELECT MAX(ws.weight) as max_weight FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE ws.exercise_id = ? AND ws.is_completed = 1 AND w.id != ? AND w.finished_at IS NOT NULL`,
      [set.exercise_id, workoutId]
    );
    if (prev && set.weight! > (prev.max_weight || 0)) {
      prCount++;
      break; // Count one PR per exercise max, continue to next exercise
    }
  }
  // De-duplicate: count unique exercises with PRs
  const exercisesWithPRs = new Set<string>();
  for (const set of completedSets) {
    const prev = await db.getFirstAsync<{ max_weight: number }>(
      `SELECT MAX(ws.weight) as max_weight FROM workout_sets ws
       JOIN workouts w ON ws.workout_id = w.id
       WHERE ws.exercise_id = ? AND ws.is_completed = 1 AND w.id != ? AND w.finished_at IS NOT NULL`,
      [set.exercise_id, workoutId]
    );
    if (!prev || set.weight! > (prev.max_weight || 0)) {
      exercisesWithPRs.add(set.exercise_id);
    }
  }
  return exercisesWithPRs.size;
}
```

**Step 5: Update `finishWorkout` to accept ai_score**

In `src/services/database.ts`, update `finishWorkout` (line 216):

```typescript
export async function finishWorkout(id: string, summary?: string, notes?: string, aiScore?: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE workouts SET finished_at = ?, ai_summary = ?, notes = ?, ai_score = ? WHERE id = ?`,
    [new Date().toISOString(), summary ?? null, notes ?? null, aiScore ?? null, id]
  );
}
```

**Step 6: Verify types compile**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 7: Commit**

```bash
git add src/types/database.ts src/services/database.ts
git commit -m "feat: add PR tracking, last workout date, AI score DB support"
```

---

### Task 4: Update AI Service — Add Score Generation

**Files:**
- Modify: `src/services/ai.ts` (add function at end)

**Step 1: Add `generateWorkoutScore()` function**

Add to end of `src/services/ai.ts`:

```typescript
export async function generateWorkoutScore(input: WorkoutSummaryInput & { prCount: number }): Promise<{ score: number; summary: string }> {
  const exerciseDetails = input.exercises
    .map(e => `${e.name}: ${e.sets.map(s => `${s.weight}×${s.reps}`).join(', ')}`)
    .join('\n');

  const result = await callClaude(
    `You are a fitness coach AI. Rate this workout on a scale of 1.0 to 10.0 based on: effort, progression (PRs hit), volume, and consistency. Return ONLY valid JSON: {"score": 8.5, "summary": "one sentence assessment"}`,
    `Workout: ${input.templateName || 'Custom'}\nDuration: ${input.duration}\nPRs hit: ${input.prCount}\n\nExercises:\n${exerciseDetails}`
  );

  try {
    const parsed = JSON.parse(result);
    return { score: Math.min(10, Math.max(1, Number(parsed.score) || 7)), summary: parsed.summary || 'Solid workout.' };
  } catch {
    return { score: 7.0, summary: 'Workout completed.' };
  }
}
```

**Step 2: Commit**

```bash
git add src/services/ai.ts
git commit -m "feat: add AI workout scoring function"
```

---

### Task 5: Restyle WorkoutScreen (Idle State)

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx` (focus on idle state rendering + styles)

This is the largest file (1578 lines). Changes needed:

**Step 1: Fix all color references**

Search and replace throughout the file:
- `colors.accent` → `colors.primary`
- `colors.success` → `colors.primary`
- `colors.warning` → `colors.primaryLight`
- `colors.error` → `colors.primary`
- `colors.surfaceLight` → `colors.surface`
- `colors.textSecondary` → `colors.textSecondary` (same name, new value)
- `colors.textMuted` → `colors.textMuted` (same name, new value)
- `colors.border` → `colors.surfaceBorder`
- `colors.surfaceBorder` → `colors.surfaceBorder`
- `colors.primaryDim` → `colors.primary`
- `colors.primaryLight` → `colors.primaryLight`
- `'#52c77c'` or any green hardcoded → `colors.primary`

**Step 2: Update idle template cards to show "Last done" instead of "Updated"**

The idle state renders templates. Find where template cards render (search for `template.updated_at` or date display in the template list). Replace the "Updated X ago" text with a call to fetch last workout date. Import `getLastWorkoutDateForTemplate` from database service.

Add state for last-done dates:
```typescript
const [lastDone, setLastDone] = useState<Record<string, string | null>>({});
```

In the template loading effect, after fetching templates, load last-done dates:
```typescript
const dates: Record<string, string | null> = {};
for (const t of templateList) {
  dates[t.id] = await getLastWorkoutDateForTemplate(t.id);
}
setLastDone(dates);
```

Display as relative date: "Last done Monday" / "Last done Jan 20" / "Never".

**Step 3: Update styles for idle state**

Update the StyleSheet to match wireframe:
- Container: `backgroundColor: colors.background`
- Header title: 30px, fontWeight 800, letterSpacing -0.8
- Primary button: `backgroundColor: colors.primary`, borderRadius 14, padding 16
- Template cards: `backgroundColor: colors.surface`, border `colors.surfaceBorder`, borderRadius 14
- Section title: uppercase, fontSize 12, letterSpacing 0.8, `color: colors.textMuted`
- Bottom tab bar: solid `colors.background` background, borderTopColor `colors.surfaceBorder`

**Step 4: Update styles for active workout state**

- Rest timer: replace the large modal overlay with a compact inline bar component
  - Render between header and ScrollView (not as absolute-positioned overlay)
  - Layout: row with time (22px bold purple), label + progress bar, -15/Skip/+15 buttons
  - Background: `colors.inputBg`, border `colors.inputBorder`, borderRadius 12
- Completed set row: background `colors.primarySubtle` (not green), check button background `colors.primary`
- Remove green border-left on completed rows, just use purple tint
- Set number on completed rows: background `colors.primaryTint`, color `colors.primaryLight`
- All accent colors in set tags (warmup W, failure F, drop D): use `colors.primaryLight` variants instead of orange/red

**Step 5: Verify app compiles and renders**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 6: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "feat: restyle WorkoutScreen with two-tone theme + compact rest timer"
```

---

### Task 6: Restyle TemplatesScreen

**Files:**
- Modify: `src/screens/TemplatesScreen.tsx` (283 lines)

**Step 1: Fix color references and update styles**

- Container: `colors.background`
- Header: 30px, fontWeight 800
- Search bar: add search bar above template list (`colors.surface` bg, `colors.surfaceBorder` border, borderRadius 12)
- Template cards: same treatment as Task 5 idle cards (surface bg, surfaceBorder, borderRadius 14, emoji icon in gray square)
- FAB: `colors.primary`, borderRadius 16, box-shadow via `elevation` and `shadowColor`
- Remove any green/orange/blue color references

**Step 2: Commit**

```bash
git add src/screens/TemplatesScreen.tsx
git commit -m "feat: restyle TemplatesScreen with two-tone theme"
```

---

### Task 7: Restyle TemplateDetailScreen

**Files:**
- Modify: `src/screens/TemplateDetailScreen.tsx` (425 lines)

**Step 1: Fix color references and update styles**

- Exercise items: purple dot for all types (not color-coded per type), name, muscle groups in `textMuted`
- Remove type badges from exercise items (just show muscle groups text)
- Sets display: "3×10" in `textMuted` on right side
- Back arrow: `colors.textMuted`
- "Start Workout" button at bottom: `colors.primary`, borderRadius 14
- "Add Exercise" secondary button: surface bg, primaryLight text

**Step 2: Commit**

```bash
git add src/screens/TemplateDetailScreen.tsx
git commit -m "feat: restyle TemplateDetailScreen with two-tone theme"
```

---

### Task 8: Restyle ExercisePickerScreen + Remove Inline Create Form

**Files:**
- Modify: `src/screens/ExercisePickerScreen.tsx` (617 lines)

**Step 1: Remove the entire inline create exercise form**

Remove:
- Form state variables (lines 49-57): `newName`, `newType`, `newMuscles`, `newGoal`, `newDescription`, `aiParsing`, `aiParsed`, `validationError`, `aiFlash`
- Form handler functions: `handleCreate` (91-110), `handleAiParse` (112-138), `resetForm` (81-89)
- All form JSX (lines 167-281 approximately)
- The "Create New Exercise" toggle button and its state

**Step 2: Add "Create New Exercise" button that navigates to CreateExerciseScreen**

Replace the removed form toggle with a button at the bottom:

```typescript
<TouchableOpacity
  style={styles.createBtn}
  onPress={() => navigation.navigate('CreateExercise', { templateId })}
>
  <Text style={styles.createBtnText}>+ Create New Exercise</Text>
</TouchableOpacity>
```

**Step 3: Add filter chips**

Above the exercise list, add type filter chips:
```typescript
const [typeFilter, setTypeFilter] = useState<ExerciseType | 'all'>('all');
```

Render chips: All, Weighted, Machine, Cable, Bodyweight. Selected chip gets `colors.primaryTint` bg + `colors.primaryLight` text.

Filter `filteredExercises` by type when not 'all'.

**Step 4: Update styles to match wireframe**

- Exercise items: all purple dots, name + muscle groups, no type badges
- Search bar: same style as templates
- borderRadius 12 on all cards

**Step 5: Commit**

```bash
git add src/screens/ExercisePickerScreen.tsx
git commit -m "feat: restyle ExercisePicker, remove inline form, add filter chips"
```

---

### Task 9: Build CreateExerciseScreen

**Files:**
- Modify: `src/screens/CreateExerciseScreen.tsx` (replace placeholder)

**Step 1: Implement the full create exercise screen**

Replace the placeholder with the full screen per the wireframe:

```typescript
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { createExercise } from '../services/database';
import { parseExerciseFromText } from '../services/ai';
import type { ExerciseType } from '../types/database';
import type { TemplatesStackParamList } from '../navigation/TabNavigator';

type Nav = NativeStackNavigationProp<TemplatesStackParamList, 'CreateExercise'>;
type Route = RouteProp<TemplatesStackParamList, 'CreateExercise'>;

const TYPES: { key: ExerciseType; label: string }[] = [
  { key: 'weighted', label: 'Weighted' },
  { key: 'bodyweight', label: 'Bodyweight' },
  { key: 'machine', label: 'Machine' },
  { key: 'cable', label: 'Cable' },
];

export default function CreateExerciseScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();

  const [name, setName] = useState('');
  const [type, setType] = useState<ExerciseType>('weighted');
  const [muscles, setMuscles] = useState('');
  const [description, setDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAiFill = async () => {
    if (!name.trim()) { setError('Enter a name first'); return; }
    setAiLoading(true);
    setError('');
    try {
      const parsed = await parseExerciseFromText(name.trim());
      if (parsed.name) setName(parsed.name);
      if (parsed.type) setType(parsed.type);
      if (parsed.muscle_groups?.length) setMuscles(parsed.muscle_groups.join(', '));
      if (parsed.description) setDescription(parsed.description);
    } catch { setError('AI fill failed'); }
    setAiLoading(false);
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    const muscleList = muscles.split(',').map(m => m.trim()).filter(Boolean);
    await createExercise({
      name: name.trim(),
      type,
      muscle_groups: muscleList,
      training_goal: 'hypertrophy', // default since we removed the selector
      description: description.trim(),
    });
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>New Exercise</Text>
        </View>
        <ScrollView style={styles.content} keyboardDismissMode="on-drag">
          {/* Name */}
          <Text style={styles.label}>NAME</Text>
          <View style={styles.nameRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="e.g. Incline Dumbbell Press"
              placeholderTextColor={colors.textDim}
              value={name}
              onChangeText={t => { setName(t); setError(''); }}
            />
            <TouchableOpacity style={styles.aiBtn} onPress={handleAiFill} disabled={aiLoading}>
              <Text style={styles.aiBtnText}>{aiLoading ? '...' : 'AI Fill'}</Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* Type */}
          <Text style={styles.label}>TYPE</Text>
          <View style={styles.chips}>
            {TYPES.map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.chip, type === t.key && styles.chipSelected]}
                onPress={() => setType(t.key)}
              >
                <Text style={[styles.chipText, type === t.key && styles.chipTextSelected]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Muscle Groups */}
          <Text style={styles.label}>MUSCLE GROUPS</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Chest, Shoulders"
            placeholderTextColor={colors.textDim}
            value={muscles}
            onChangeText={setMuscles}
          />

          {/* Description */}
          <Text style={styles.label}>DESCRIPTION <Text style={{ color: colors.textDim }}>(optional)</Text></Text>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            placeholder="How to perform..."
            placeholderTextColor={colors.textDim}
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <TouchableOpacity style={styles.createBtn} onPress={handleCreate}>
            <Text style={styles.createBtnText}>Create Exercise</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingTop: 4, paddingBottom: 14 },
  back: { color: colors.textMuted, fontSize: 18 },
  title: { fontSize: 22, fontWeight: fontWeight.heavy, color: colors.white },
  content: { flex: 1, paddingHorizontal: 20 },
  label: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.textMuted, letterSpacing: 0.6, marginBottom: 8, marginTop: 18 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: borderRadius.lg, padding: 14, color: colors.text, fontSize: 14, fontFamily: undefined },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiBtn: { backgroundColor: colors.primaryTint, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  aiBtnText: { color: colors.primaryLight, fontSize: 11, fontWeight: fontWeight.semibold },
  error: { color: colors.primary, fontSize: 12, marginTop: 4 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder },
  chipSelected: { backgroundColor: colors.primaryTint, borderColor: 'rgba(124,92,252,0.2)' },
  chipText: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.textMuted },
  chipTextSelected: { color: colors.primaryLight },
  createBtn: { backgroundColor: colors.primary, borderRadius: borderRadius.xl, paddingVertical: 16, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  createBtnText: { color: colors.white, fontSize: 15, fontWeight: fontWeight.bold },
});
```

**Step 2: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/screens/CreateExerciseScreen.tsx
git commit -m "feat: implement dedicated CreateExercise screen"
```

---

### Task 10: Restyle HistoryScreen — PRs + AI Score

**Files:**
- Modify: `src/screens/HistoryScreen.tsx` (387 lines)

**Step 1: Import new functions and update data loading**

Add imports:
```typescript
import { countPRsInWorkout } from '../services/database';
```

Add state for PR counts and scores:
```typescript
const [prCounts, setPrCounts] = useState<Record<string, number>>({});
```

After loading workout history, compute PRs per workout:
```typescript
const prs: Record<string, number> = {};
for (const w of workouts) {
  prs[w.id] = await countPRsInWorkout(w.id);
}
setPrCounts(prs);
```

**Step 2: Update card rendering**

Replace total volume stat with PRs and AI score:

```typescript
<View style={styles.stats}>
  <Text style={styles.stat}>⏱ {duration}</Text>
  <Text style={styles.stat}>📊 {setCount} sets</Text>
  <Text style={styles.stat}>🏆 {prCounts[workout.id] || 0} PRs</Text>
</View>
{workout.ai_score != null && (
  <View style={styles.aiRow}>
    <View style={styles.aiScoreBadge}>
      <Text style={styles.aiScoreText}>AI {workout.ai_score.toFixed(1)}</Text>
    </View>
    <Text style={styles.aiSummary} numberOfLines={2}>{workout.ai_summary}</Text>
  </View>
)}
```

**Step 3: Update styles to two-tone palette**

- Cards: `colors.surface`, `colors.surfaceBorder`, borderRadius 14
- Date text: `colors.textMuted`, fontSize 11
- Name: `colors.text`, fontSize 15, fontWeight 700
- Stats: `colors.textMuted`, vals in `colors.textSecondary`
- AI score badge: `colors.primaryTint` bg, `colors.primaryLight` text, borderRadius 8
- AI summary: `colors.textMuted`, fontSize 11
- Separator line: `colors.surfaceBorder`

**Step 4: Commit**

```bash
git add src/screens/HistoryScreen.tsx
git commit -m "feat: restyle HistoryScreen with PRs and AI score"
```

---

### Task 11: Restyle ProfileScreen — 2x2 Stat Grid

**Files:**
- Modify: `src/screens/ProfileScreen.tsx` (468 lines)

**Step 1: Add new stat queries**

Import:
```typescript
import { countPRsInWorkout, getWorkoutHistory } from '../services/database';
```

Add state and compute:
- `prsThisMonth`: count PRs across all workouts finished this month
- `currentStreak`: count consecutive days with a workout (existing logic may be reusable)
- `aiScore`: average `ai_score` from workouts this week

**Step 2: Replace stats grid with 2x2 layout**

```typescript
<View style={styles.statsGrid}>
  <View style={styles.statCard}>
    <Text style={styles.statValue}>{totalWorkouts}</Text>
    <Text style={styles.statLabel}>TOTAL WORKOUTS</Text>
  </View>
  <View style={styles.statCard}>
    <Text style={styles.statValue}>{prsThisMonth}</Text>
    <Text style={styles.statLabel}>PRS THIS MONTH</Text>
  </View>
  <View style={styles.statCard}>
    <Text style={styles.statValue}>{currentStreak}</Text>
    <Text style={styles.statLabel}>CURRENT STREAK</Text>
  </View>
  <View style={styles.statCard}>
    <Text style={[styles.statValue, { color: colors.primaryLight }]}>{aiScore.toFixed(1)}</Text>
    <Text style={styles.statLabel}>AI SCORE</Text>
  </View>
</View>
```

**Step 3: Update styles**

- statsGrid: 2-column grid using flexWrap
- statCard: `colors.surface`, `colors.surfaceBorder`, borderRadius 14, padding 20, center aligned
- statValue: fontSize 30, fontWeight 800, letterSpacing -1, `colors.white` (purple for total workouts + AI score)
- statLabel: fontSize 11, `colors.textMuted`, uppercase, letterSpacing 0.3
- Settings items: `colors.surface`, borderRadius 12, `colors.surfaceBorder`
- Remove week volume, avg duration stats
- Remove streak emoji/wide card — just use the 2x2 grid

**Step 4: Commit**

```bash
git add src/screens/ProfileScreen.tsx
git commit -m "feat: restyle ProfileScreen with 2x2 stat grid"
```

---

### Task 12: Update Bottom Tab Bar Styling

**Files:**
- Modify: `src/navigation/TabNavigator.tsx`

**Step 1: Update tab bar options**

In the Tab.Navigator screenOptions (around line 64):

```typescript
screenOptions={{
  tabBarStyle: {
    backgroundColor: colors.background,
    borderTopColor: colors.surfaceBorder,
    borderTopWidth: 1,
    height: 82,
    paddingTop: 10,
  },
  tabBarActiveTintColor: colors.primaryLight,
  tabBarInactiveTintColor: colors.textDim,
  tabBarLabelStyle: {
    fontSize: 10,
    fontWeight: '500',
  },
  headerShown: false,
}}
```

**Step 2: Commit**

```bash
git add src/navigation/TabNavigator.tsx
git commit -m "feat: update tab bar to two-tone styling"
```

---

### Task 13: Wire AI Score into Workout Completion

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx` (in the finish workout handler)

**Step 1: Update finish workout flow**

Find the finish workout handler (search for `finishWorkout` call). After generating the summary, also generate the score:

```typescript
import { generateWorkoutScore } from '../services/ai';
import { countPRsInWorkout } from '../services/database';
```

In the finish handler, after building the summary input:
```typescript
const prCount = await countPRsInWorkout(workoutRef.current!.id);
const { score, summary } = await generateWorkoutScore({ ...summaryInput, prCount });
await finishWorkout(workoutRef.current!.id, summary, undefined, score);
```

**Step 2: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "feat: generate AI score on workout completion"
```

---

### Task 14: Final Type Check + Visual QA

**Files:**
- All modified files

**Step 1: Run full type check**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

Fix any remaining type errors.

**Step 2: Run the app in simulator**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx expo start --ios`

Walk through every screen and verify:
- Two-tone palette (no stray green/orange/blue)
- Workout idle: "Last done" dates on template cards
- Workout active: compact rest timer bar, purple checkmarks
- Templates: search bar, FAB
- Template detail: purple dots, no type badges
- Exercise picker: filter chips, no inline form
- Create exercise: dedicated screen with AI Fill
- History: PRs + AI score per workout
- Profile: 2x2 stat grid

**Step 3: Fix any visual issues found**

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete UI redesign - two-tone purple+gray theme"
```

---

### Task 15: Update CLAUDE.md

**Files:**
- Modify: `/Users/sachitgoyal/code/workout-enhanced/CLAUDE.md`

**Step 1: Update documentation to reflect new design**

Add/update sections:
- Theme: two-tone purple + gray palette (no multi-color accents)
- New screen: CreateExerciseScreen in Templates stack
- New DB fields: ai_score on workouts
- New DB functions: getLastWorkoutDateForTemplate, countPRsInWorkout
- New AI function: generateWorkoutScore
- Profile stats: Total Workouts, PRs This Month, Current Streak, AI Score
- History cards: duration, sets, PRs, AI score + summary
- Rest timer: compact inline bar (not modal)

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for UI redesign"
```
