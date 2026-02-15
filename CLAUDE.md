# workout-enhanced

Expo React Native workout tracking app with SQLite local storage and Supabase cloud sync.

## Architecture
- **Navigation**: RootNavigator (`src/navigation/RootNavigator.tsx`) conditionally renders AuthStack (Login/Signup) or TabNavigator based on session state. TabNavigator has bottom tabs with a native stack nested inside Templates tab for list -> detail -> exercise picker flow.
- **Authentication**: AuthContext (`src/contexts/AuthContext.tsx`) manages session via `supabase.auth.onAuthStateChange`. On `SIGNED_IN`, clears local SQLite and pulls upcoming workout from Supabase only when the user ID changes (not on token refresh), preventing accidental data loss.
- **Database**: expo-sqlite with async API in src/services/database.ts. Tables: exercises (with notes column for sticky notes), templates, template_exercises, workouts, workout_sets, upcoming_workouts, upcoming_workout_exercises, upcoming_workout_sets. Indexes on workout_sets(workout_id, exercise_id), workouts(finished_at, started_at), template_exercises(template_id) for query performance. Key functions (getExerciseById, getAllExercises, createExercise, getWorkoutHistory, updateExerciseNotes) have try/catch with Sentry error reporting. Uses `safeJsonParse` helper for muscle_groups parsing to prevent crashes on malformed JSON. All `getAllAsync` calls use typed row interfaces (e.g. `ExerciseRow`, `WorkoutRow`, `WorkoutSetRow`, `TemplateExerciseJoinRow`, `CountRow`, `MaxOrderRow`, `ExerciseHistoryJoinRow`, `PRSetRow`, `UpcomingWorkoutRow`, `UpcomingExerciseJoinRow`) instead of `any` for type-safe SQLite query results. Sync service (`sync.ts`) similarly uses `SyncExerciseRow`, `SyncTemplateRow`, `SyncTemplateExerciseRow`, `SyncWorkoutRow`, `SyncWorkoutSetRow` for typed local queries before Supabase upsert.
- **Sticky Exercise Notes**: Exercise notes are stored in the exercises table (notes column) and persist across workouts. When adding an exercise to a workout, existing notes are auto-loaded. Notes changes are saved via `updateExerciseNotes()` with a 500ms debounce (`debouncedSaveNotes`) to avoid writes on every keystroke. On workout finish, `flushPendingNotes()` saves any pending debounced notes. On workout cancel, `clearPendingNotes()` discards pending notes without saving.
- **Theme**: Dark theme tokens (colors, spacing, fontSize, fontWeight, borderRadius) defined in `src/theme/tokens.ts`. Re-exported from `src/theme/index.ts` alongside `modalStyles` from `src/theme/sharedStyles.ts`. The tokens are in a separate file to avoid circular dependencies between `index.ts` and `sharedStyles.ts`.
- **Constants**: Shared constants in src/constants/exercise.ts (MUSCLE_GROUPS, EXERCISE_TYPE_OPTIONS, EXERCISE_TYPE_OPTIONS_WITH_ICONS, REST_SECONDS, DEFAULT_REST_SECONDS).
- **Types**: All DB types in src/types/database.ts.
- **Observability**: Sentry crash reporting (`@sentry/react-native`) initialized in `App.tsx` with `Sentry.wrap()`. Includes `tracesSampleRate` (1.0 dev, 0.2 prod) and `debug: __DEV__`. Navigation breadcrumbs added via `onStateChange` callback. Errors in sync.ts are reported via `Sentry.captureException()` alongside `console.error()`. User context set/cleared on login/logout in AuthContext. Sentry org: `sachit-goyal`, project: `react-native`. Disabled when `EXPO_PUBLIC_SENTRY_DSN` is not set.
- **Error Handling**: `ErrorBoundary` class component (`src/components/ErrorBoundary.tsx`) wraps AuthProvider in App.tsx. Catches React errors via `getDerivedStateFromError`/`componentDidCatch`, reports to Sentry with componentStack, shows recovery UI with "Try Again" button. Uses theme colors for dark mode consistency.
- **Environment Config**: `app.config.ts` (dynamic Expo config, replaces app.json). `.env` (dev default), `.env.development`, `.env.production` for Supabase URL/key separation. All env files gitignored. Dev Supabase project: `workout-enhanced-dev` (ref: `gcpnqpqqwcwvyzoivolp`). Prod Supabase project: `lift.ai` (ref: `lgnkxjiqzsqiwrqrsxww`). Env switching: `npx expo start` → dev (loads `.env.development`), `npx expo start --no-dev` → prod (loads `.env.production`). Use `.env.local` (gitignored, highest priority) for temporary overrides.

## Screens
- **LoginScreen** (`src/screens/LoginScreen.tsx`): Email/password login + Google OAuth via expo-web-browser/expo-auth-session. Dark themed with barbell icon. Navigates to Signup.
- **SignupScreen** (`src/screens/SignupScreen.tsx`): Email/password registration with confirm password validation. Navigates to Login.
- **TemplatesScreen**: FlatList of templates, FAB to create, long-press to delete. Uses useFocusEffect to reload on focus. `renderItem` and `handleLongPress` wrapped in `useCallback`. Modal has `onRequestClose` for Android back button.
- **TemplateDetailScreen**: Edit template name, view/edit/remove exercises with inline stepper controls for sets (±1, barbell icon) and rest timer (±15s, timer icon). Steppers are tap-friendly with no text labels. Navigate to exercise picker. `renderItem` and stepper handlers wrapped in `useCallback`. Rename modal has `onRequestClose` for Android back button.
- **ExercisePickerScreen**: Search + browse all exercises (by name or muscle group), tap to add to template. Scrollable inline form to create new exercises with type chips (single-select) and muscle group chips (multi-select from: Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Calves, Abs, Forearms) and description field. Training goal defaults to hypertrophy (managed via MCP). `renderItem` and `handlePick` wrapped in `useCallback`. Filtered exercises array memoized with `useMemo`. Search bar is hidden when create form is expanded for cleaner UX.

## Navigation Types
- AuthStackParamList exported from `src/navigation/RootNavigator.tsx` (Login, Signup).
- TemplatesStackParamList exported from `src/navigation/TabNavigator.tsx` for type-safe navigation within the Templates stack.

## Workout Screen
- **WorkoutScreen** (`src/screens/WorkoutScreen.tsx`) handles both idle and active states inline (no separate ActiveWorkoutScreen file).
- Idle state: "Start Empty Workout" button + template list from `getAllTemplates()`. Tap template to start workout from it.
- Active state: header with cancel (X) button + template name + elapsed timer (mm:ss) + sets progress counter (X/Y sets) + Finish button, ScrollView of exercise blocks. Cancel button shows Alert confirmation then deletes workout and returns to idle.
- Each exercise block: header row with exercise name (left) and rest timer controls (right: − button, timer display, + button), set header, set rows with flex-based layout (set number, previous weight×reps, weight input with placeholder from previous, reps input with placeholder from previous, completion checkbox), action row ("Add Set" + "Notes" buttons with equal width).
- **Set Completion Validation**: Sets cannot be marked complete without entering both weight and reps. Red border appears on weight/reps inputs for 2 seconds when validation fails (no alert popup).
- **Finish Workout Validation**: Cannot finish workout with 0 completed sets. Alert shown prompting user to complete at least one set.
- Tags: tap set number to cycle (working → warmup W → failure F → drop D). Tagged sets show colored badge instead of number.
- Long-press set number to delete set (except last set). Alternatively, swipe left on a set row to delete immediately (uses react-native-gesture-handler Swipeable).
- Completed set rows get green-tinted background + green left border + haptic vibration feedback.
- Rest timer: auto-starts on set completion when enabled. Per-exercise rest seconds from template (default 150s) override training_goal defaults (strength=180s, hypertrophy=90s, endurance=60s). Mid-workout added exercises use training_goal defaults. Shows exercise name that triggered it, progress bar, large countdown, +15s/-15s adjust buttons, Skip button. Vibrates when timer ends.
- **Rest Timer Controls**: Timer controls are in the exercise header row (right side). Tap timer display to toggle on/off. − and + buttons adjust rest time by 15 seconds. Shows "1:30" format when enabled, "Off" when disabled. Disabled rest timers don't auto-start on set completion.
- Add Exercise mid-workout: full-screen modal with search to add any existing exercise.
- Finish: Modal confirmation dialog showing completed/total sets, then summary screen (duration, exercises, sets completed) with celebration vibration. Triggers `syncToSupabase()` after finishing.
- Upcoming Workout: Idle screen shows templates immediately; upcoming workout loads in background via `pullUpcomingWorkout()` (5s timeout) then `getUpcomingWorkoutForToday()` and animates in when ready. Shows a "Workout Ready" card with exercise count and notes. Starting from upcoming workout pre-populates exercise blocks and enables a TARGET column (weight x reps) per set from the upcoming workout plan. Template tap shows inline spinner on that card while loading.
- TARGET column: Shown in set header/rows only when workout was started from an upcoming workout. Displays target weight x reps per set in a muted primary color.
- Template name displayed in active workout header is stored in a separate `templateName` state variable (not mutated onto the Workout object) for type safety.
- All set changes persist to SQLite immediately via `updateWorkoutSet()`.
- Uses `useFocusEffect` to check for active workouts on tab focus.
- Keyboard dismisses on scroll (`keyboardDismissMode="on-drag"`).
- **Performance optimizations**: Set counts (`completedSetsCount`, `totalSetsCount`) memoized with `useMemo`. Sub-components (`NoActiveWorkout`, `TargetCell`, `SummaryStat`) wrapped with `React.memo`. Modal `onRequestClose` handlers added for proper Android back button support. `handleCloseHistoryModal` wrapped in `useCallback`.
- **Live Activity Rest Timer** (`src/services/liveActivity.ts`): iOS Live Activity shows rest timer countdown on lock screen + Dynamic Island. Uses `expo-live-activity` for the Live Activity (iOS-native countdown via `progressBar.date`) and `expo-notifications` for a local notification with vibration/sound when the timer ends. Service exports: `startRestTimerActivity(totalSeconds, exerciseName)`, `adjustRestTimerActivity(deltaSeconds)`, `stopRestTimerActivity()`, `requestNotificationPermissions()`. All functions no-op on Android. Module-level singleton state (one activity at a time). Tapping the Live Activity opens the app via `workout-enhanced://workout` deep link. Wired into WorkoutScreen's `startRestTimer`, `adjustRestTimer`, `dismissRest`, and timer completion. Deep link config in `App.tsx` via NavigationContainer `linking` prop.

## History & Profile
- **HistoryScreen**: FlatList of completed workouts (date, template name, duration). Tap to expand sets grouped by exercise. Tap exercise name in expanded view to open ExerciseHistoryModal. `renderWorkout` wrapped in `useCallback` for FlatList performance.
- **ProfileScreen**: Stats dashboard (total workouts, this month, PRs this week via Epley formula, streak). Shows user email. "Get MCP Token" button opens modal with copyable JWT for Claude Desktop configuration. Logout button with confirmation alert. `statCards` array memoized with `useMemo`.

## Components
- **ErrorBoundary** (`src/components/ErrorBoundary.tsx`): Class component error boundary wrapping app content. Catches React errors, reports to Sentry with componentStack, shows dark-themed recovery UI with "Try Again" button.
- **ExerciseHistoryModal** (`src/components/ExerciseHistoryModal.tsx`): Bottom-sheet modal showing exercise history with 1RM progression chart (react-native-chart-kit LineChart), structured PR banner (trophy icon, "Personal Record" label, large weight value, "1RM · date" subtext), and recent performances (last 3 sessions with best set displayed in side-by-side layout: date left, weight×reps right). Requires 3+ sessions to display PR banner and chart; shows progress message otherwise. Accessible from HistoryScreen (tap exercise name), WorkoutScreen (tap exercise name during active workout), and ExercisesScreen (tap exercise card). Uses Epley formula: weight * (1 + reps/30).

## MCP AI Coach
MCP server at `/Users/sachitgoyal/code/workout-mcp-server/` connects to Claude Desktop for AI coaching. Supports local stdio mode and remote HTTP mode via Cloudflare Workers.

**Architecture**: Phone app → Supabase ← MCP server → Claude Desktop
- **Gym**: Phone app logs sets in real-time, syncs to Supabase on workout finish
- **Night**: Chat with Claude Desktop to review workouts and create tomorrow's upcoming workout
- **Morning**: Phone app pulls upcoming workout from Supabase, shows TARGET column

**MCP Tools (12 total)**:
- Read: get_workout_history, get_workout_detail, get_exercise_list, get_all_templates, get_template, get_personal_records, get_exercise_history, get_upcoming_workout
- Write: create_exercise, add_exercise_to_template, remove_exercise_from_template, create_upcoming_workout

**Multi-User Support**: MCP server supports JWT authentication for multi-user access. Users get their JWT token from the "Get MCP Token" button in ProfileScreen. User-scoped tools filter by user_id; exercises are shared across users; `create_exercise` tracks creator via `user_id`.

**Deployment Options**:
- Local: `npm start` uses stdio transport with WORKOUT_USER_ID env var
- Remote: Deploy to Cloudflare Workers via `npm run deploy`, uses Streamable HTTP transport with JWT auth

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
- App.tsx wraps NavigationContainer in AuthProvider inside ErrorBoundary inside SafeAreaProvider. Uses `LogBox.ignoreLogs()` in DEV mode to suppress sync error messages from showing in Metro overlay.

## Tech Stack
- Expo (React Native) with TypeScript
- react-native-safe-area-context for safe area handling
- @react-navigation/bottom-tabs + @react-navigation/native-stack
- react-native-gesture-handler for swipe gestures
- expo-sqlite for local-first data
- @supabase/supabase-js with sync service (src/services/sync.ts) for push/pull
- expo-web-browser + expo-auth-session for Google OAuth
- expo-live-activity for iOS Live Activity (lock screen + Dynamic Island rest timer countdown)
- expo-notifications for local notifications (rest timer end vibration/sound)
- Supabase migrations in supabase/migrations/

## Building & Running
- `npx expo run:ios --device` — builds native iOS app and installs directly on physical iPhone (PREFERRED for testing)
- `npx expo run:ios` — builds native iOS app and launches in simulator (bundle ID: `com.anonymous.workout-enhanced`)
- `npx expo start --ios` — starts Metro bundler + Expo Go (NOT used for testing)
- `npx tsc --noEmit` — type-check without emitting
- MCP server: `cd /Users/sachitgoyal/code/workout-mcp-server && npm run build && npm start`
- iOS build uses Xcode DerivedData at default location
- `npx expo prebuild --clean` — regenerates native projects (needed after adding plugins like expo-live-activity)
- **Important**: Always test via native build on physical iPhone, not Expo Go. Live Activity requires a native build (not Expo Go).

## Testing
- Jest with jest-expo preset. Run: `npm test` or `npx jest`
- Config in `jest.config.js` — includes `clearMocks: true` (auto-clears mocks between tests), `setupFilesAfterEnv` pointing to `jest.setup.js`.
- Shared test setup at `jest.setup.js` — mocks `@expo/vector-icons` (Ionicons), `react-native-chart-kit` (LineChart), and silences console.error for React warnings.
- expo-sqlite mock at `src/__mocks__/expo-sqlite.ts` — provides `openDatabaseAsync` returning a mock db with `getAllAsync`, `getFirstAsync`, `runAsync`, `execAsync`. Mapped via `moduleNameMapper` in `jest.config.js`.
- expo-live-activity mock at `src/__mocks__/expo-live-activity.ts` — mocks `startActivity`, `updateActivity`, `stopActivity`. Mapped via `moduleNameMapper`.
- expo-notifications mock at `src/__mocks__/expo-notifications.ts` — mocks `scheduleNotificationAsync`, `cancelScheduledNotificationAsync`, `requestPermissionsAsync`, `setNotificationHandler`, `SchedulableTriggerInputTypes`. Mapped via `moduleNameMapper`.
- Database service tests at `src/services/__tests__/database.test.ts` — tests createExercise, getAllExercises, createTemplate, startWorkout, updateWorkoutSet, getPRsThisWeek, updateExerciseNotes (correct SQL + null clearing), getExerciseById (parsed result + not found).
- Database resilience tests at `src/services/__tests__/database.resilience.test.ts` — DB query failure handling (getAllExercises/getExerciseById/createExercise/getWorkoutHistory throw + report to Sentry), malformed data handling (invalid JSON/null/empty string muscle_groups via safeJsonParse), getDb singleton behavior (same instance, schema initialized once), clearAllLocalData dependency order (8 tables deleted in correct FK order).
- Live Activity service tests at `src/services/__tests__/liveActivity.test.ts` — tests startRestTimerActivity (correct title/countdown, notification scheduling, stops previous activity), adjustRestTimerActivity (updates countdown, reschedules notification, no-ops when inactive), stopRestTimerActivity (stops activity + cancels notification, no-ops when inactive), requestNotificationPermissions (iOS only), platform guard (all no-op on Android), error handling (doesn't throw on failures).
- Sync service tests at `src/services/__tests__/sync.test.ts` — tests syncToSupabase (session guard, exercise/template/workout/set upsert with user_id, muscle_groups JSON parsing, is_completed boolean conversion, empty array skip, error handling per table with early return, full sync), pullUpcomingWorkout (session guard, no upcoming workout, clears local tables in order, inserts workout/exercises/sets, Supabase error handling, continues on set fetch error, null data handling).
- Sync resilience tests at `src/services/__tests__/sync.resilience.test.ts` — 14 tests covering network failure scenarios. syncToSupabase: network offline (getSession throw + upsert error), Supabase timeout (PGRST301), RLS violation (42501), partial failure early return, empty database no-op, malformed session. pullUpcomingWorkout: network offline, Supabase query error, null data, exercise query failure after workout fetch, sets query failure with continue, SQLite write failure, empty workout with no exercises.
- UUID utility tests at `src/utils/__tests__/uuid.test.ts` — uniqueness and v4 format.
- Format utility tests at `src/utils/__tests__/format.test.ts` — formatDuration (null finishedAt, under 1h, hours+minutes, 0 duration, exactly 60min, large durations, multi-day, rounding) and formatDate (Today, Yesterday, weekday for 2-6 days ago, month+day for 7+ days same year, year included for different year, boundary at 6 days).
- One rep max utility tests at `src/utils/__tests__/oneRepMax.test.ts` — Epley formula calculation, zero reps/weight, decimal weights, large values.
- Exercise search utility tests at `src/utils/__tests__/exerciseSearch.test.ts` — name match, muscle group match, case insensitivity, partial match, empty search returns all, no match returns empty.
- Exercise type color utility tests at `src/utils/__tests__/exerciseTypeColor.test.ts` — all 4 exercise types map to correct theme colors, undefined defaults to textMuted.
- Set tag utility tests at `src/utils/__tests__/setTagUtils.test.ts` — getSetTagLabel (W/F/D/null) and getSetTagColor (warning/error/primary/undefined) for all tag types.
- ExercisePickerScreen component tests at `src/screens/__tests__/ExercisePickerScreen.test.tsx` — renders search bar, muscle group chip toggle, validation error for empty name, search filtering, hides search bar when create form expanded. Uses @testing-library/react-native with mocked database, sync, navigation, and @expo/vector-icons.
- WorkoutScreen component tests at `src/screens/__tests__/WorkoutScreen.test.tsx` — idle state rendering, starting empty workout, adding exercise + toggling checkbox completion (covers Maestro gap), finish modal (requires completed set), 0 sets validation (blocks finish), create exercise form in add-exercise modal, header two-row layout with timer and sets progress, empty set completion validation (blocks when weight/reps empty), rest timer toggle visibility, swipeable set rows, remove exercise button. Nested describes: Live Activity integration (notification permissions on mount, starts on rest timer, stops on dismiss, adjusts on +15s), set tag cycling (warmup tap, full cycle, badge text), rest timer auto-start (shows bar after set completion, no bar when toggled off), exercise notes (toggle on/off, debounced updateExerciseNotes call, debounces multiple keystrokes, flushes pending notes on finish, clears pending notes on cancel, pre-expand with sticky notes), cancel workout (alert on X, discard confirms deleteWorkout, keep going preserves state), long-press set to delete (deletes with 2+ sets, blocks last set), template card starts workout, previous set data (PREV column shows weight×reps, dash when no data, placeholders from previous), upcoming workout TARGET column (TARGET header when started from upcoming, no TARGET for regular, target weight×reps display).
- LoginScreen component tests at `src/screens/__tests__/LoginScreen.test.tsx` — renders inputs, validation error for empty fields, calls signInWithPassword, navigates to Signup.
- TemplatesScreen component tests at `src/screens/__tests__/TemplatesScreen.test.tsx` — empty state, template list rendering, FAB button.
- ProfileScreen component tests at `src/screens/__tests__/ProfileScreen.test.tsx` — renders title/email, stat cards, logout button, PRs This Week card, absence of Week Volume/Avg Duration.
- ExerciseHistoryModal component tests at `src/components/__tests__/ExerciseHistoryModal.test.tsx` — null exercise, dynamic no-data messages (0/1/2 sessions), PR banner hidden with <3 sessions, PR banner + chart with 3+ sessions, recent session best set data (by 1RM), close button.
- ExercisesScreen component tests at `src/screens/__tests__/ExercisesScreen.test.tsx` — renders exercise list with search, empty state, search filtering by name and muscle group, opening history modal on tap.
- HistoryScreen component tests at `src/screens/__tests__/HistoryScreen.test.tsx` — empty state, workout card rendering (no volume pill), expand to show completed sets with tag badges (filters incomplete), exercise name tap opens history modal.
- TemplateDetailScreen component tests at `src/screens/__tests__/TemplateDetailScreen.test.tsx` — renders template name (no label), exercise card with sets and rest timer pill, empty state, add exercise button.
- SignupScreen component tests at `src/screens/__tests__/SignupScreen.test.tsx` — renders inputs, password match validation, password length validation, calls signUp, navigates to Login.
- ErrorBoundary component tests at `src/components/__tests__/ErrorBoundary.test.tsx` — renders children, shows error UI on throw, reports to Sentry, recovery on Try Again.
- AuthContext tests at `src/contexts/__tests__/AuthContext.test.tsx` — renders children, useAuth throws outside provider, loading lifecycle (true->false), initial session/user from getSession, SIGNED_IN updates session, SIGNED_OUT clears session, Sentry user set on login (initial + event), Sentry user cleared on logout, clearAllLocalData + pullUpcomingWorkout on new user sign-in, skips sync on token refresh (same user ID), sync errors reported to Sentry, getSession errors reported to Sentry, loading false even on getSession failure, unsubscribes on unmount, tracks user ID across sign-in/out, edge case with null user on SIGNED_IN.
- RootNavigator component tests at `src/navigation/__tests__/RootNavigator.test.tsx` — shows ActivityIndicator when loading, shows Login screen when no session, shows TabNavigator when session exists, auth stack hidden when logged in. Mocks screens and TabNavigator as lightweight Text placeholders.
- TabNavigator component tests at `src/navigation/__tests__/TabNavigator.test.tsx` — renders all 5 tab labels (Workout, Templates, Exercises, History, Profile), default tab is Workout, tab switching to each tab renders correct content. Mocks all screen components as lightweight Text placeholders to avoid database/sync/supabase dependencies.
- Deep link tests at `src/__tests__/deepLinks.test.tsx` — deep link `workout-enhanced://workout` navigates to Workout tab, unknown deep link path does not crash, null getInitialURL does not crash, Sentry.addBreadcrumb called on tab navigation with correct category/level/message, breadcrumb includes destination route name. Renders full App component with mocked screens, AuthContext (logged-in session), services, and SafeAreaInsetsContext.
- Shared test helpers at `src/__tests__/helpers/renderWithProviders.tsx` — wraps components in NavigationContainer.
- Shared test mocks at `src/__tests__/helpers/mocks.ts` — mockNavigation, mockRoute, mockUseFocusEffect.
- Test data factories at `src/__tests__/helpers/factories.ts` — createMockExercise, createMockWorkoutSet, createMockWorkout, createMockSession, createMockUpcomingWorkout (with nested exercises and sets).

## E2E Testing (Maestro)
- Maestro YAML flows in `maestro/` directory. Run: `maestro test maestro/<path>.yaml`
- Flows: `setup/seed-exercises.yaml`, `templates/create-exercise.yaml`, `templates/view-template-detail.yaml`, `workout/start-empty.yaml`, `workout/start-and-finish.yaml`, `workout/exercise-notes.yaml`, `workout/rest-timer.yaml`, `workout/set-tag-cycling.yaml`, `workout/remove-exercise.yaml`, `history/view-history.yaml`, `exercises/view-exercises.yaml`.
- Flows use `runFlow` for composition (e.g. start-and-finish runs start-empty).
- Checkbox completion is tested via RNTL (Maestro has a known issue with TouchableOpacity tap inside ScrollView on iOS).
- TestIDs used: login-email, login-password, login-btn, logout-btn, start-empty-workout, start-upcoming-workout, add-exercise-btn, finish-workout-btn, create-template-fab, create-exercise-toggle, exercise-name-input, exercise-search, save-exercise-btn, weight-{ex}-{set}, reps-{ex}-{set}, check-{ex}-{set}, muscle-{name}, exercise-type-picker, sets-progress, rest-timer-toggle-{blockIdx}, exercise-notes-{blockIdx}, set-tag-{blockIdx}-{setIdx}, cancel-workout-btn.

## Utils
- `src/utils/uuid.ts` — UUID v4 generator.
- `src/utils/format.ts` — formatDuration, formatDate.
- `src/utils/exerciseTypeColor.ts` — exercise type → color mapping.
- `src/utils/setTagUtils.ts` — getSetTagLabel, getSetTagColor for set tags (warmup/failure/drop).
- `src/utils/exerciseSearch.ts` — filterExercises for search by name and muscle group.
- `src/utils/oneRepMax.ts` — calculateEstimated1RM (Epley formula: weight * (1 + reps/30)).

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
