# workout-enhanced

Expo React Native workout tracking app with SQLite local storage and Supabase cloud sync.

## Architecture
- **Navigation**: RootNavigator (`src/navigation/RootNavigator.tsx`) conditionally renders AuthStack (Login/Signup) or TabNavigator based on session state. TabNavigator has bottom tabs with a native stack nested inside Templates tab for list -> detail -> exercise picker flow.
- **Authentication**: AuthContext (`src/contexts/AuthContext.tsx`) manages session via `supabase.auth.onAuthStateChange`. On `SIGNED_IN`, clears local SQLite and pulls upcoming workout from Supabase only when the user ID changes (not on token refresh), preventing accidental data loss.
- **Database**: expo-sqlite with async API in src/services/database.ts. Tables: exercises, templates, template_exercises, workouts, workout_sets, upcoming_workouts, upcoming_workout_exercises, upcoming_workout_sets. Indexes on workout_sets(workout_id, exercise_id), workouts(finished_at, started_at), template_exercises(template_id) for query performance. Key functions (getExerciseById, getAllExercises, createExercise, getWorkoutHistory) have try/catch with Sentry error reporting. Uses `safeJsonParse` helper for muscle_groups parsing to prevent crashes on malformed JSON.
- **Theme**: Dark theme constants in src/theme/index.ts (colors, spacing, fontSize, fontWeight, borderRadius).
- **Types**: All DB types in src/types/database.ts.
- **Observability**: Sentry crash reporting (`@sentry/react-native`) initialized in `App.tsx` with `Sentry.wrap()`. Includes `tracesSampleRate` (1.0 dev, 0.2 prod) and `debug: __DEV__`. Navigation breadcrumbs added via `onStateChange` callback. Errors in sync.ts are reported via `Sentry.captureException()` alongside `console.error()`. User context set/cleared on login/logout in AuthContext. Sentry org: `sachit-goyal`, project: `react-native`. Disabled when `EXPO_PUBLIC_SENTRY_DSN` is not set.
- **Error Handling**: `ErrorBoundary` class component (`src/components/ErrorBoundary.tsx`) wraps AuthProvider in App.tsx. Catches React errors via `getDerivedStateFromError`/`componentDidCatch`, reports to Sentry with componentStack, shows recovery UI with "Try Again" button. Uses theme colors for dark mode consistency.
- **Environment Config**: `app.config.ts` (dynamic Expo config, replaces app.json). `.env` (dev default), `.env.development`, `.env.production` for Supabase URL/key separation. All env files gitignored. Dev Supabase project: `workout-enhanced-dev` (ref: `gcpnqpqqwcwvyzoivolp`). Prod Supabase project: `lift.ai` (ref: `lgnkxjiqzsqiwrqrsxww`). Env switching: `npx expo start` → dev (loads `.env.development`), `npx expo start --no-dev` → prod (loads `.env.production`). Use `.env.local` (gitignored, highest priority) for temporary overrides.

## Screens
- **LoginScreen** (`src/screens/LoginScreen.tsx`): Email/password login + Google OAuth via expo-web-browser/expo-auth-session. Dark themed with barbell icon. Navigates to Signup.
- **SignupScreen** (`src/screens/SignupScreen.tsx`): Email/password registration with confirm password validation. Navigates to Login.
- **TemplatesScreen**: FlatList of templates, FAB to create, long-press to delete. Uses useFocusEffect to reload on focus. `renderItem` and `handleLongPress` wrapped in `useCallback`. Modal has `onRequestClose` for Android back button.
- **TemplateDetailScreen**: Edit template name, view/edit/remove exercises with default set count and per-exercise rest timer (default 150s), navigate to exercise picker. `renderItem` and handlers (`handleEditDefaults`, `handleEditRestTimer`, `handleRemove`) wrapped in `useCallback`. Both modals have `onRequestClose` for Android back button.
- **ExercisePickerScreen**: Search + browse all exercises (by name or muscle group), tap to add to template. Scrollable inline form to create new exercises with type chips (single-select) and muscle group chips (multi-select from: Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Calves, Abs, Forearms) and description field. Training goal defaults to hypertrophy (managed via MCP). `renderItem` and `handlePick` wrapped in `useCallback`. Filtered exercises array memoized with `useMemo`.

## Navigation Types
- AuthStackParamList exported from `src/navigation/RootNavigator.tsx` (Login, Signup).
- TemplatesStackParamList exported from `src/navigation/TabNavigator.tsx` for type-safe navigation within the Templates stack.

## Workout Screen
- **WorkoutScreen** (`src/screens/WorkoutScreen.tsx`) handles both idle and active states inline (no separate ActiveWorkoutScreen file).
- Idle state: "Start Empty Workout" button + template list from `getAllTemplates()`. Tap template to start workout from it.
- Active state: header with cancel (X) button + template name + elapsed timer (mm:ss) + sets progress counter (X/Y sets) + Finish button, ScrollView of exercise blocks. Cancel button shows Alert confirmation then deletes workout and returns to idle.
- Each exercise block: name, PREVIOUS column (per-set data from last workout), set rows with flex-based layout (set number, previous weight×reps, weight input with placeholder from previous, reps input with placeholder from previous, completion checkbox), "Add Set" button, collapsible notes.
- Tags: tap set number to cycle (working → warmup W → failure F → drop D). Tagged sets show colored badge instead of number.
- Long-press set number to delete set (except last set).
- Completed set rows get green-tinted background + green left border + haptic vibration feedback.
- Rest timer: auto-starts on set completion. Per-exercise rest seconds from template (default 150s) override training_goal defaults (strength=180s, hypertrophy=90s, endurance=60s). Mid-workout added exercises use training_goal defaults. Shows exercise name that triggered it, progress bar, large countdown, +15s/-15s adjust buttons, Skip button. Vibrates when timer ends.
- Add Exercise mid-workout: full-screen modal with search to add any existing exercise.
- Finish: Modal confirmation dialog showing completed/total sets, then summary screen (duration, exercises, sets completed) with celebration vibration. Triggers `syncToSupabase()` after finishing.
- Upcoming Workout: On idle screen, pulls upcoming workout from Supabase via `pullUpcomingWorkout()` (with 5s timeout to prevent hanging), then loads from local DB via `getUpcomingWorkoutForToday()`. Shows a "Workout Ready" card with exercise count and notes. Starting from upcoming workout pre-populates exercise blocks and enables a TARGET column (weight x reps) per set from the upcoming workout plan.
- TARGET column: Shown in set header/rows only when workout was started from an upcoming workout. Displays target weight x reps per set in a muted primary color.
- Template name displayed in active workout header is stored in a separate `templateName` state variable (not mutated onto the Workout object) for type safety.
- All set changes persist to SQLite immediately via `updateWorkoutSet()`.
- Uses `useFocusEffect` to check for active workouts on tab focus.
- Keyboard dismisses on scroll (`keyboardDismissMode="on-drag"`).
- **Performance optimizations**: Set counts (`completedSetsCount`, `totalSetsCount`) memoized with `useMemo`. Sub-components (`NoActiveWorkout`, `TargetCell`, `SummaryStat`) wrapped with `React.memo`. Modal `onRequestClose` handlers added for proper Android back button support. `handleCloseHistoryModal` wrapped in `useCallback`.

## History & Profile
- **HistoryScreen**: FlatList of completed workouts (date, template name, duration). Tap to expand sets grouped by exercise. Tap exercise name in expanded view to open ExerciseHistoryModal. `renderWorkout` wrapped in `useCallback` for FlatList performance.
- **ProfileScreen**: Stats dashboard (total workouts, this month, PRs this week via Epley formula, streak). Shows user email. Logout button with confirmation alert. `statCards` array memoized with `useMemo`.

## Components
- **ErrorBoundary** (`src/components/ErrorBoundary.tsx`): Class component error boundary wrapping app content. Catches React errors, reports to Sentry with componentStack, shows dark-themed recovery UI with "Try Again" button.
- **ExerciseHistoryModal** (`src/components/ExerciseHistoryModal.tsx`): Bottom-sheet modal showing exercise history with estimated 1RM progression chart (react-native-chart-kit LineChart), PR banner (best estimated 1RM with date), and recent performances (last 3 sessions with completed sets). Accessible from HistoryScreen (tap exercise name) and WorkoutScreen (tap exercise name during active workout). Uses Epley formula: weight * (1 + reps/30).

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
- `syncToSupabase()` — pushes exercises, templates, finished workouts + sets to Supabase (auth-guarded, adds user_id)
- `pullUpcomingWorkout()` — pulls latest upcoming workout into local SQLite (auth-guarded)
- `clearAllLocalData()` in database.ts — deletes all rows from all tables in dependency order
- Sync runs on login (via AuthContext SIGNED_IN event) and on workout finish

## Auth
- `src/contexts/AuthContext.tsx` — AuthProvider with session management via Supabase. Exposes `useAuth()` hook returning `{ session, user, loading }`. On `SIGNED_IN`, clears local data and pulls upcoming workout.
- Email/password auth via `supabase.auth.signInWithPassword` / `supabase.auth.signUp`
- Google OAuth via expo-web-browser + expo-auth-session (extracts tokens from redirect URL fragment)
- Session persisted in expo-secure-store, auto-refreshed
- **Google OAuth setup required**: Enable Google provider in Supabase dashboard, set Client ID/Secret from Google Cloud Console, add Expo redirect URI to allowed URLs. App uses `scheme: "workout-enhanced"` in app.json for deep linking; `makeRedirectUri({ scheme: 'workout-enhanced' })` generates the correct redirect URI for Expo Go on physical devices.

## Layout
- All screens wrapped in SafeAreaView from react-native-safe-area-context (prevents content behind notch/home indicator).
- App.tsx wraps NavigationContainer in AuthProvider inside ErrorBoundary inside SafeAreaProvider.

## Tech Stack
- Expo (React Native) with TypeScript
- react-native-safe-area-context for safe area handling
- @react-navigation/bottom-tabs + @react-navigation/native-stack
- expo-sqlite for local-first data
- @supabase/supabase-js with sync service (src/services/sync.ts) for push/pull
- expo-web-browser + expo-auth-session for Google OAuth
- Supabase migrations in supabase/migrations/

## Building & Running
- `npx expo run:ios` — builds native iOS app and launches in simulator (bundle ID: `com.anonymous.workout-enhanced`)
- `npx expo start --ios` — starts Metro bundler + Expo Go
- `npx tsc --noEmit` — type-check without emitting
- MCP server: `cd /Users/sachitgoyal/code/workout-mcp-server && npm run build && npm start`
- iOS build uses Xcode DerivedData at default location

## Testing
- Jest with jest-expo preset. Run: `npm test` or `npx jest`
- Config in `jest.config.js` — includes `clearMocks: true` (auto-clears mocks between tests), `setupFilesAfterEnv` pointing to `jest.setup.js`.
- Shared test setup at `jest.setup.js` — mocks `@expo/vector-icons` (Ionicons), `react-native-chart-kit` (LineChart), and silences console.error for React warnings.
- expo-sqlite mock at `src/__mocks__/expo-sqlite.ts` — provides `openDatabaseAsync` returning a mock db with `getAllAsync`, `getFirstAsync`, `runAsync`, `execAsync`. Mapped via `moduleNameMapper` in `jest.config.js`.
- Database service tests at `src/services/__tests__/database.test.ts` — tests createExercise, getAllExercises, createTemplate, startWorkout, updateWorkoutSet, getPRsThisWeek.
- UUID utility tests at `src/utils/__tests__/uuid.test.ts` — uniqueness and v4 format.
- Format utility tests at `src/utils/__tests__/format.test.ts` — formatDuration and formatDate.
- ExercisePickerScreen component tests at `src/screens/__tests__/ExercisePickerScreen.test.tsx` — renders search bar, muscle group chip toggle, validation error for empty name, search filtering. Uses @testing-library/react-native with mocked database, sync, navigation, and @expo/vector-icons.
- WorkoutScreen component tests at `src/screens/__tests__/WorkoutScreen.test.tsx` — idle state rendering, starting empty workout, adding exercise + toggling checkbox completion (covers Maestro gap), finish modal, create exercise form in add-exercise modal, header two-row layout with timer and sets progress.
- LoginScreen component tests at `src/screens/__tests__/LoginScreen.test.tsx` — renders inputs, validation error for empty fields, calls signInWithPassword, navigates to Signup.
- TemplatesScreen component tests at `src/screens/__tests__/TemplatesScreen.test.tsx` — empty state, template list rendering, FAB button.
- ProfileScreen component tests at `src/screens/__tests__/ProfileScreen.test.tsx` — renders title/email, stat cards, logout button, PRs This Week card, absence of Week Volume/Avg Duration.
- ExerciseHistoryModal component tests at `src/components/__tests__/ExerciseHistoryModal.test.tsx` — null exercise, no-data message, PR banner + chart with sufficient data, recent session set data, close button.
- HistoryScreen component tests at `src/screens/__tests__/HistoryScreen.test.tsx` — empty state, workout card rendering (no volume pill), expand to show completed sets with tag badges (filters incomplete), exercise name tap opens history modal.
- TemplateDetailScreen component tests at `src/screens/__tests__/TemplateDetailScreen.test.tsx` — renders template name (no label), exercise card with sets and rest timer pill, empty state, add exercise button.
- Shared test helper at `src/__tests__/helpers/renderWithProviders.tsx` — wraps components in NavigationContainer.

## E2E Testing (Maestro)
- Maestro YAML flows in `maestro/` directory. Run: `maestro test maestro/<path>.yaml`
- Flows: `setup/seed-exercises.yaml`, `templates/create-exercise.yaml`, `templates/view-template-detail.yaml`, `workout/start-empty.yaml`, `workout/start-and-finish.yaml`, `history/view-history.yaml`.
- Flows use `runFlow` for composition (e.g. start-and-finish runs start-empty).
- Checkbox completion is tested via RNTL (Maestro has a known issue with TouchableOpacity tap inside ScrollView on iOS).
- TestIDs used: login-email, login-password, login-btn, logout-btn, start-empty-workout, add-exercise-btn, finish-workout-btn, create-template-fab, create-exercise-toggle, exercise-name-input, exercise-search, save-exercise-btn, weight-{ex}-{set}, reps-{ex}-{set}, check-{ex}-{set}, muscle-{name}, exercise-type-picker, sets-progress.

## Utils
- `src/utils/uuid.ts` — UUID v4 generator.
- `src/utils/format.ts` — `formatDuration(startedAt, finishedAt)`, `formatVolume(volume)`, and `formatDate(iso)`.
- `src/utils/exerciseTypeColor.ts` — shared exercise type → color mapping (used by TemplateDetailScreen, ExercisePickerScreen).

## Working Style
- Be proactive: run commands, check results, and take action without waiting for the user to tell you each step.

## Notes
- Alert.prompt is iOS-only; Android uses fallback Alert.alert patterns. Finish workout uses a custom Modal instead of Alert.alert for web compatibility.
- Exercise types color-coded: weighted=primary, bodyweight=success, machine=warning, cable=accent.
- Supabase URL/key configured via EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY env vars.
- Vibration used for set completion haptics, rest timer end, and workout completion celebration.
- Exercise search filters by name and muscle group.
- Per-set previous data shown (weight×reps from last workout's matching set number).
- Template cards show exercise count and last updated date.
- metro.config.js adds COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) for SharedArrayBuffer support required by expo-sqlite OPFS VFS on web.
