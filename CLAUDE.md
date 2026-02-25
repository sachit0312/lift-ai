# lift-ai

Expo React Native workout tracking app with SQLite local storage and Supabase cloud sync.

## Quick Reference

| What | Command / Path |
|------|----------------|
| Dev build (device) | `npx expo run:ios --device` |
| Dev build (sim) | `npx expo run:ios` |
| Prod build (device) | `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device "iPhone" --configuration Release` |
| Type-check | `npx tsc --noEmit` |
| Unit tests | `npm test` |
| E2E tests | `maestro test maestro/<path>.yaml` |
| EAS prod build | `npm run build:prod` |
| Submit to App Store | `npm run submit:ios` |
| OTA update | `npm run update:prod` |
| Prebuild (native regen) | `npx expo prebuild --clean` |
| MCP server | `cd /Users/sachitgoyal/code/lift-ai-mcp && npm run build && npm start` |

## Architecture
- **Navigation**: RootNavigator (`src/navigation/RootNavigator.tsx`) renders AuthStack or TabNavigator based on session. TabNavigator has bottom tabs; Templates tab has a nested native stack (list -> detail -> exercise picker). Type params: `AuthStackParamList` in RootNavigator, `TemplatesStackParamList` in TabNavigator.
- **Auth** (`src/contexts/AuthContext.tsx`): Session via `supabase.auth.onAuthStateChange`. On `SIGNED_IN` with new user ID (not token refresh), sets `syncing=true`, clears local SQLite, pulls data from Supabase, sets `syncing=false`. RootNavigator gates on `syncing` to show spinner (prevents WorkoutScreen race). 30s timeout (`SYNC_TIMEOUT_MS`) prevents hung spinner. `useAuth()` returns `{ session, user, loading, syncing }`. Email/password + Google OAuth (expo-web-browser + expo-auth-session, scheme `liftai`). Session in expo-secure-store.
- **Database** (`src/services/database.ts`): expo-sqlite async API. Tables: exercises (with notes), templates, template_exercises, workouts (with `upcoming_workout_id`), workout_sets (with `target_weight`, `target_reps`, `target_rpe`), upcoming_workouts, upcoming_workout_exercises, upcoming_workout_sets. All queries use typed row interfaces (not `any`). Batch ops: `getBulkExercises()`, `addWorkoutSetsBatch()`, `getTemplateExerciseCountsBatch()`. All functions have try/catch with Sentry. Uses `safeJsonParse` for muscle_groups.
- **Theme**: Dark theme tokens in `src/theme/tokens.ts`, re-exported from `src/theme/index.ts` with `modalStyles` from `src/theme/sharedStyles.ts`. Tokens in separate file to avoid circular deps.
- **Types**: All DB types in `src/types/database.ts`. `SetTag` = warmup/working/failure/drop. `TemplateExercise` has `warmup_sets`. `UpcomingWorkoutSet` has optional `target_rpe` and `tag`. `Workout` has `upcoming_workout_id` (links to originating plan). `WorkoutSet` has optional `target_weight`, `target_reps`, `target_rpe` (persisted plan targets).
- **Constants**: `src/constants/exercise.ts` — MUSCLE_GROUPS, EXERCISE_TYPE_OPTIONS, REST_SECONDS, DEFAULT_REST_SECONDS.
- **Observability**: Sentry (`@sentry/react-native`) in App.tsx. Org: `sachit-goyal`, project: `react-native`. Disabled when `EXPO_PUBLIC_SENTRY_DSN` unset.
- **Error Handling**: `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) wraps AuthProvider. Reports to Sentry, shows recovery UI.
- **Live Activity** (`src/services/liveActivity.ts`): Persistent iOS Live Activity for entire workout. Unified widget view shows exercise name + set counter always, rest timer controls conditionally. All functions async (return `Promise<void>`), no-op on Android. Deep link: `liftai://workout`. Notifications are silent (vibration-only, no banner/alert). `cancelTimerEndNotification` is properly serialized (await before schedule). `updateWorkoutActivityForRest` takes `(exerciseName, totalSeconds, setNumber, totalSets)` — passes set info as subtitle for unified view. AppState listener resyncs JS timer on foreground return.
- **Interactive Lock Screen** (`plugins/withInteractiveLiveActivity/`): iOS 17+ interactive buttons. `UnifiedWorkoutView` replaces separate SetEntryView/RestTimerView — always shows exercise + set counter + Complete Set button (dimmed gray during rest, active purple when not resting). Rest state shown conditionally via `timerEndDateInMilliseconds > 0`. Timer `Text` and `ProgressView` use `.id(restEndTime)` to force SwiftUI recreation on +/-15s adjustments. Architecture: RN writes `WidgetState` to App Groups UserDefaults -> Swift App Intents enqueue actions -> RN polls every 500ms. **Key gotchas**: All 4 intents must be zero-parameter structs (parameterized `@Parameter` intents fail silently on Live Activity buttons). Plugin must run AFTER `expo-live-activity` in `app.config.ts`. `handleWidgetCompleteSet()` computes updated blocks inline to avoid stale `blocksRef` race.
- **Workout Bridge** (`src/services/workoutBridge.ts`): RN <-> iOS widget IPC via App Groups UserDefaults. `buildWidgetState()` uses `preferBlockIdx` + `lastActiveBlockRef` to track active exercise. All no-op on Android.
- **Shared UserDefaults** (`modules/shared-user-defaults/`): Local Expo module for App Groups read/write. Group ID: `group.com.sachitgoyal.liftai`.
- **Environment**: `app.config.ts` (dynamic Expo config). `.env.development` / `.env.production` for Supabase separation (gitignored). Dev Supabase: `lift-ai-dev` (ref: `gcpnqpqqwcwvyzoivolp`). Prod: `lift.ai` (ref: `lgnkxjiqzsqiwrqrsxww`). EAS builds use env vars inlined in `eas.json`.

## Screens
All screens in `src/screens/`. Key non-obvious behaviors:
- **WorkoutScreen**: Handles idle + active states inline (no separate file). `ExerciseBlockItem` is a `React.memo` sub-component for per-block re-render isolation. Tags: tap set number to cycle (working -> warmup W -> failure F -> drop D). Long-press or swipe-left to delete set. Rest timer auto-starts on set completion when enabled (per-exercise seconds from template, default 150s). Set completion requires weight + reps (red border validation). Finish requires 1+ completed sets. Upcoming workout targets shown as muted purple placeholders (`rgba(124, 92, 252, 0.45)`), previous data as muted gray (`rgba(107, 107, 114, 0.5)`). All set changes persist to SQLite immediately. **Planned vs Actual**: Starting from upcoming workout persists `upcoming_workout_id` on the workout and writes `target_weight`/`target_reps`/`target_rpe` to each workout set, so comparisons survive workout completion and sync. **Exercise notes** are permanent (persist on both finish and cancel), synced to Supabase via fire-and-forget after debounced save. **Coach tips**: collapsible purple-tinted section per exercise block, only shown when starting from upcoming workout with per-exercise notes from MCP.
- **TemplateDetailScreen**: Three inline steppers per exercise — warmup sets (±1), working sets (±1), rest timer (±15s). TestIDs: `warmup-value-{idx}`, `sets-value-{idx}`, `rest-value-{idx}` (plus `-increase-`/`-decrease-` variants).
- **ExercisesScreen**: Tap = history modal. Long-press = edit modal (name, type chips, muscle group chips, notes). Syncs to Supabase on save.
- **ExercisePickerScreen**: Search bar hidden when create form expanded. Muscle groups: Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Calves, Abs, Forearms.
- **ExerciseHistoryModal** (`src/components/ExerciseHistoryModal.tsx`): 1RM chart (purple) + volume chart (green). PR banner + plateau detection (5+ sessions). Requires 3+ sessions for charts. RPE-adjusted Epley formula.
- **ProfileScreen**: Stats, MCP token modal, delete account (Supabase Edge Function `delete-account`).

## MCP AI Coach
MCP server at `/Users/sachitgoyal/code/lift-ai-mcp/`. Phone app -> Supabase <- MCP server -> Claude Desktop.

**Tools (17)**: get_workout_history, get_workout_detail, get_exercise_list (includes notes), search_exercises (includes notes), get_all_templates, get_template, get_personal_records, get_exercise_history (returns exercise_notes + sessions), get_upcoming_workout, create_exercise (supports notes), update_exercise (name/type/muscle_groups/description/training_goal/notes, ownership-checked), add_exercise_to_template (rest_seconds default 150, warmup_sets default 0), remove_exercise_from_template, create_template, update_template (batch updates: sort_order, default_sets, rest_seconds, warmup_sets), update_template_exercise_rest, create_upcoming_workout (supports per-exercise `notes` for coach tips, `rpe` -> `target_rpe`, `tag` -> SetTag).

**Multi-User**: JWT auth. Token from ProfileScreen "Get MCP Token". User-scoped tools; exercises shared.

**Deploy**: Local `npm start` (stdio + WORKOUT_USER_ID) | Remote `npm run deploy` (Cloudflare Workers + JWT).

## Supabase Sync (`src/services/sync.ts`)
- `syncToSupabase()` — push exercises (including notes), templates, workouts + sets to Supabase (auth-guarded, adds user_id). Includes `upcoming_workout_id` on workouts and `target_weight`/`target_reps`/`target_rpe` on workout sets.
- `deleteTemplateFromSupabase(id)` / `deleteTemplateExerciseFromSupabase(id)` — fire-and-forget deletes, never throw, errors to Sentry
- `pullExercisesAndTemplates()` — upserts exercises with last-write-wins for notes (Supabase value overwrites local). Syncs rest_seconds/warmup_sets bidirectionally. Deletes remotely-removed template_exercises. Batch-fetches with `.in()`.
- `pullWorkoutHistory()` — upserts finished workouts + sets. Converts `is_completed` bool->int for SQLite.
- `pullUpcomingWorkout()` — pulls latest upcoming workout + exercises + sets
- **Important**: Do NOT wrap sync pull loops in `withTransactionAsync` — they run concurrently via Promise.all, SQLite can't handle concurrent transactions
- **Sync triggers**: login (clear -> pull all), workout finish (push), WorkoutScreen focus (pull all sequentially), template/exercise delete (fire-and-forget push), template exercise stepper edits (fire-and-forget push), exercise notes edit (fire-and-forget push after debounce)
- All console.log/error are `__DEV__`-guarded (prod uses Sentry only)

## Building & Running
- Always test via native build on physical iPhone, not Expo Go (Live Activity requires native build)
- **Cache clearing** (dev <-> prod): Metro/Expo cache stale env vars. When switching environments:
  - `npx expo start --clear` — clears Metro cache
  - `npx expo run:ios --device --no-build-cache` — forces Xcode rebuild
  - Nuclear: `watchman watch-del-all && rm -rf /tmp/metro-* && npx expo run:ios --device`
- **App icon**: Replace `assets/icon.png` (1024x1024 PNG, no alpha, full-bleed). Also copy to `ios/.../AppIcon.appiconset/` for dev builds (or `npx expo prebuild --clean`).

## Deployment (EAS + App Store + OTA)
- **Identity**: Display `lift.ai`, bundle `com.sachitgoyal.liftai`, scheme `liftai://`, slug `lift-ai`
- **EAS**: `eas.json` with development/preview/production profiles. Env vars inlined (cloud can't read `.env`). Project ID: `405310db-a7c7-4d03-9f82-81a752ede55d`. Apple Team: `574YNGX64S`.
- **OTA**: `expo-updates` with `fingerprint` runtime version. Only JS+assets — native changes need full `eas build`.
- **Auth**: `export EXPO_TOKEN=...` for non-interactive EAS CLI.

## Testing
- `npm test` — Jest with jest-expo preset. Config: `jest.config.js` + `jest.setup.js`.
- Mocks in `src/__mocks__/`: expo-sqlite, expo-live-activity, expo-notifications, expo-updates, shared-user-defaults. Mapped via `moduleNameMapper`.
- Test helpers: `src/__tests__/helpers/` — renderWithProviders, mockNavigation/mockRoute/mockUseFocusEffect, factories (createMockExercise, createMockWorkoutSet, createMockWorkout, createMockSession, createMockUpcomingWorkout).
- **Worktree gotcha**: Do NOT run `npx jest --testPathIgnorePatterns='.worktrees/'` from inside a worktree — the path itself contains `.worktrees/` so all tests get excluded.

## E2E Testing (Maestro)
- `maestro test maestro/<path>.yaml`. Flows use `runFlow` for composition.
- Flows: `setup/seed-exercises`, `templates/create-exercise`, `templates/view-template-detail`, `workout/start-empty`, `workout/start-and-finish`, `workout/exercise-notes`, `workout/rest-timer`, `workout/set-tag-cycling`, `workout/remove-exercise`, `history/view-history`, `exercises/view-exercises`.
- Checkbox completion tested via RNTL (Maestro has TouchableOpacity-in-ScrollView issue on iOS).
- TestIDs: login-email, login-password, login-btn, logout-btn, start-empty-workout, start-upcoming-workout, add-exercise-btn, finish-workout-btn, create-template-fab, create-exercise-toggle, exercise-name-input, exercise-search, save-exercise-btn, weight-{ex}-{set}, reps-{ex}-{set}, rpe-{blockIdx}-{setIdx}, check-{ex}-{set}, muscle-{name}, exercise-type-picker, sets-progress, rest-timer-toggle-{blockIdx}, exercise-notes-{blockIdx}, set-tag-{blockIdx}-{setIdx}, cancel-workout-btn.

## UI Conventions
- Touch targets: `minWidth/minHeight: 44` via `layout.touchMin`. Button heights: primary `layout.buttonHeight` (50), secondary `layout.buttonHeightSm` (40).
- List padding: `paddingBottom: 100` for tab bar clearance. Screen padding: `layout.screenPaddingH` (20).
- No magic numbers — use `spacing.*`, `layout.*`, `fontSize.*`, `borderRadius.*` from `src/theme/tokens.ts`.
- Button text on colored backgrounds: `colors.white`, not `colors.text`. Empty state icons: `size={48}`.
- Exercise types: weighted=primary, bodyweight=success, machine=warning, cable=accent.

## Gotchas
- **Supabase migrations**: When adding columns referenced by sync or MCP, run the migration on both dev (`gcpnqpqqwcwvyzoivolp`) and prod (`lgnkxjiqzsqiwrqrsxww`) via SQL Editor before deploying code. Migration files go in `supabase/migrations/`.
- Alert.prompt is iOS-only; use Modal or Alert.alert for cross-platform.
- metro.config.js adds COOP/COEP headers for expo-sqlite OPFS VFS on web.
- `withInteractiveLiveActivity` plugin must run AFTER `expo-live-activity` in plugins array.
- Exercise notes are permanent and synced: `flushPendingNotes()` on finish, `clearPendingNotes()` on cancel (discard doesn't overwrite stored notes). 500ms debounce via `debouncedSaveNotes`. Fire-and-forget `syncToSupabase()` after each debounced save.
- **Do NOT build to device from git worktrees.** Worktrees lack `.env.*` files (gitignored), and Expo CLI has Metro URL/device discovery issues with non-standard paths. Always merge to main and build from `/Users/sachitgoyal/code/lift-ai/`.

## Working Style
- Be proactive: run commands, check results, and take action without waiting for the user to tell you each step.
