# workout-enhanced

Expo React Native workout tracking app with SQLite local storage.

## Architecture
- **Navigation**: Bottom tab navigator with a native stack navigator nested inside the Templates tab for list -> detail -> exercise picker flow.
- **Database**: expo-sqlite with async API in src/services/database.ts. Tables: exercises, templates, template_exercises, workouts, workout_sets.
- **Theme**: Dark theme constants in src/theme/index.ts (colors, spacing, fontSize, fontWeight, borderRadius).
- **Types**: All DB types in src/types/database.ts.

## Screens
- **TemplatesScreen**: FlatList of templates, FAB to create, long-press to delete. Uses useFocusEffect to reload on focus.
- **TemplateDetailScreen**: Edit template name, view/edit/remove exercises with default set count, navigate to exercise picker.
- **ExercisePickerScreen**: Search + browse all exercises (by name or muscle group), tap to add to template. Inline form to create new exercises with type/muscle groups/training goal pickers, description field, validation errors, radio-style training goal selector with descriptions.

## Navigation Types
TemplatesStackParamList is exported from src/navigation/TabNavigator.tsx for type-safe navigation within the Templates stack.

## Workout Screen
- **WorkoutScreen** (`src/screens/WorkoutScreen.tsx`) handles both idle and active states inline (no separate ActiveWorkoutScreen file).
- Idle state: "Start Empty Workout" button + template list from `getAllTemplates()`. Tap template to start workout from it.
- Active state: header with template name + elapsed timer (mm:ss) + sets progress counter (X/Y sets) + Finish button, ScrollView of exercise blocks.
- Each exercise block: name, PREVIOUS column (per-set data from last workout), set rows with flex-based layout (set number, previous weight×reps, weight input with placeholder from previous, reps input with placeholder from previous, completion checkbox), "Add Set" button, collapsible notes.
- Tags: tap set number to cycle (working → warmup W → failure F → drop D). Tagged sets show colored badge instead of number.
- Long-press set number to delete set (except last set).
- Completed set rows get green-tinted background + green left border + haptic vibration feedback.
- Rest timer: auto-starts on set completion. Defaults by training_goal: strength=180s, hypertrophy=90s, endurance=60s. Shows exercise name that triggered it, progress bar, large countdown, +15s/-15s adjust buttons, Skip button. Vibrates when timer ends.
- Add Exercise mid-workout: full-screen modal with search to add any existing exercise.
- Finish: Modal confirmation dialog showing completed/total sets, then summary screen (duration, exercises, sets completed, total volume in lb) with celebration vibration.
- All set changes persist to SQLite immediately via `updateWorkoutSet()`.
- Uses `useFocusEffect` to check for active workouts on tab focus.
- Keyboard dismisses on scroll (`keyboardDismissMode="on-drag"`).

## History & Profile
- **HistoryScreen**: FlatList of completed workouts (date, template name, duration, volume). Tap to expand sets grouped by exercise.
- **ProfileScreen**: Stats dashboard (total workouts, this month, week volume, avg duration, streak) + functional settings. Rest Timer Defaults setting opens modal with +/- 15s adjusters per training goal. Units setting (lb).

## Tech Stack
- Expo (React Native) with TypeScript
- @react-navigation/bottom-tabs + @react-navigation/native-stack
- expo-sqlite for local-first data
- @supabase/supabase-js (configured, pending credentials)
- Supabase migration in supabase/migrations/001_initial.sql

## Building & Running
- `npx expo run:ios` — builds native iOS app and launches in simulator (bundle ID: `com.anonymous.workout-enhanced`)
- `npx expo start --ios` — starts Metro bundler + Expo Go
- `npx tsc --noEmit` — type-check without emitting
- iOS build uses Xcode DerivedData at default location

## Notes
- Alert.prompt is iOS-only; Android uses fallback Alert.alert patterns. Finish workout uses a custom Modal instead of Alert.alert for web compatibility.
- Exercise types color-coded: weighted=primary, bodyweight=success, machine=warning, cable=accent.
- Supabase URL/key configured via EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY env vars.
- Vibration used for set completion haptics, rest timer end, and workout completion celebration.
- Exercise search filters by name and muscle group.
- Per-set previous data shown (weight×reps from last workout's matching set number).
- Template cards show exercise count and last updated date.
