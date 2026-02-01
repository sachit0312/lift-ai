# workout-enhanced

Expo React Native workout tracking app with SQLite local storage and Supabase cloud sync.

## Architecture
- **Navigation**: Bottom tab navigator with a native stack navigator nested inside the Templates tab for list -> detail -> exercise picker flow.
- **Database**: expo-sqlite with async API in src/services/database.ts. Tables: exercises, templates, template_exercises, workouts, workout_sets, upcoming_workouts, upcoming_workout_exercises, upcoming_workout_sets.
- **Theme**: Dark theme constants in src/theme/index.ts (colors, spacing, fontSize, fontWeight, borderRadius).
- **Types**: All DB types in src/types/database.ts.

## Screens
- **TemplatesScreen**: FlatList of templates, FAB to create, long-press to delete. Uses useFocusEffect to reload on focus.
- **TemplateDetailScreen**: Edit template name, view/edit/remove exercises with default set count, navigate to exercise picker.
- **ExercisePickerScreen**: Search + browse all exercises (by name or muscle group), tap to add to template. Scrollable inline form to create new exercises with type/muscle groups pickers and description field. Training goal defaults to hypertrophy (managed via MCP).

## Navigation Types
TemplatesStackParamList is exported from src/navigation/TabNavigator.tsx for type-safe navigation within the Templates stack.

## Workout Screen
- **WorkoutScreen** (`src/screens/WorkoutScreen.tsx`) handles both idle and active states inline (no separate ActiveWorkoutScreen file).
- Idle state: "Start Empty Workout" button + template list from `getAllTemplates()`. Tap template to start workout from it.
- Active state: header with cancel (X) button + template name + elapsed timer (mm:ss) + sets progress counter (X/Y sets) + Finish button, ScrollView of exercise blocks. Cancel button shows Alert confirmation then deletes workout and returns to idle.
- Each exercise block: name, PREVIOUS column (per-set data from last workout), set rows with flex-based layout (set number, previous weight×reps, weight input with placeholder from previous, reps input with placeholder from previous, completion checkbox), "Add Set" button, collapsible notes.
- Tags: tap set number to cycle (working → warmup W → failure F → drop D). Tagged sets show colored badge instead of number.
- Long-press set number to delete set (except last set).
- Completed set rows get green-tinted background + green left border + haptic vibration feedback.
- Rest timer: auto-starts on set completion. Defaults by training_goal: strength=180s, hypertrophy=90s, endurance=60s. Shows exercise name that triggered it, progress bar, large countdown, +15s/-15s adjust buttons, Skip button. Vibrates when timer ends.
- Add Exercise mid-workout: full-screen modal with search to add any existing exercise.
- Finish: Modal confirmation dialog showing completed/total sets, then summary screen (duration, exercises, sets completed, total volume in lb) with celebration vibration. Triggers `syncToSupabase()` after finishing.
- Upcoming Workout: On idle screen, pulls upcoming workout from Supabase via `pullUpcomingWorkout()`, then loads from local DB via `getUpcomingWorkoutForToday()`. Shows a "Workout Ready" card with exercise count and notes. Starting from upcoming workout pre-populates exercise blocks and enables a TARGET column (weight x reps) per set from the upcoming workout plan.
- TARGET column: Shown in set header/rows only when workout was started from an upcoming workout. Displays target weight x reps per set in a muted primary color.
- All set changes persist to SQLite immediately via `updateWorkoutSet()`.
- Uses `useFocusEffect` to check for active workouts on tab focus.
- Keyboard dismisses on scroll (`keyboardDismissMode="on-drag"`).

## History & Profile
- **HistoryScreen**: FlatList of completed workouts (date, template name, duration, volume). Tap to expand sets grouped by exercise.
- **ProfileScreen**: Stats dashboard (total workouts, this month, week volume, avg duration, streak). No settings section.

## MCP AI Coach
Standalone MCP server at `/Users/sachitgoyal/code/workout-mcp-server/` connects to Claude Desktop for AI coaching.

**Architecture**: Phone app → Supabase ← MCP server → Claude Desktop
- **Gym**: Phone app logs sets in real-time, syncs to Supabase on workout finish
- **Night**: Chat with Claude Desktop to review workouts and create tomorrow's upcoming workout
- **Morning**: Phone app pulls upcoming workout from Supabase, shows TARGET column

**MCP Tools (12 total)**:
- Read: get_workout_history, get_workout_detail, get_exercise_list, get_all_templates, get_template, get_personal_records, get_exercise_history, get_upcoming_workout
- Write: create_exercise, add_exercise_to_template, remove_exercise_from_template, create_upcoming_workout

**Supabase Sync** (`src/services/sync.ts`):
- `syncToSupabase()` — pushes exercises, templates, finished workouts + sets to Supabase
- `pullUpcomingWorkout()` — pulls latest upcoming workout into local SQLite
- Sync runs on app startup (App.tsx) and on workout finish

## Layout
- All screens wrapped in SafeAreaView from react-native-safe-area-context (prevents content behind notch/home indicator).
- App.tsx wraps NavigationContainer in SafeAreaProvider.

## Tech Stack
- Expo (React Native) with TypeScript
- react-native-safe-area-context for safe area handling
- @react-navigation/bottom-tabs + @react-navigation/native-stack
- expo-sqlite for local-first data
- @supabase/supabase-js with sync service (src/services/sync.ts) for push/pull
- Supabase migrations in supabase/migrations/

## Building & Running
- `npx expo run:ios` — builds native iOS app and launches in simulator (bundle ID: `com.anonymous.workout-enhanced`)
- `npx expo start --ios` — starts Metro bundler + Expo Go
- `npx tsc --noEmit` — type-check without emitting
- MCP server: `cd /Users/sachitgoyal/code/workout-mcp-server && npm run build && npm start`
- iOS build uses Xcode DerivedData at default location

## Notes
- Alert.prompt is iOS-only; Android uses fallback Alert.alert patterns. Finish workout uses a custom Modal instead of Alert.alert for web compatibility.
- Exercise types color-coded: weighted=primary, bodyweight=success, machine=warning, cable=accent.
- Supabase URL/key configured via EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY env vars.
- Vibration used for set completion haptics, rest timer end, and workout completion celebration.
- Exercise search filters by name and muscle group.
- Per-set previous data shown (weight×reps from last workout's matching set number).
- Template cards show exercise count and last updated date.
