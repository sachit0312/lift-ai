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
- **Database** (`src/services/database.ts`): expo-sqlite async API. Tables: exercises (with notes), templates, template_exercises, workouts (with `upcoming_workout_id`, `session_notes`), workout_sets (with `target_weight`, `target_reps`, `target_rpe`, `exercise_order`), upcoming_workouts, upcoming_workout_exercises, upcoming_workout_sets. All queries use typed row interfaces (not `any`). Centralized row mappers: `parseExercise` (ExerciseRow), `mapWorkoutSetRow` (WorkoutSetRow — tag cast, bool conversion, order default), `parseExerciseFromJoin` (e_-prefixed join columns), `parseExerciseFromTemplateJoin` (exercise_-prefixed join columns), `mapUpcomingWorkoutSetRow` (tag default + cast). Batch ops: `getBulkExercises()`, `addWorkoutSetsBatch()`, `getTemplateExerciseCountsBatch()`. `stampExerciseOrder()` persists exercise sequence at finish time. All functions have try/catch with Sentry. Uses `safeJsonParse` for muscle_groups.
- **Theme**: Dark theme tokens in `src/theme/tokens.ts`, re-exported from `src/theme/index.ts` with `modalStyles` from `src/theme/sharedStyles.ts`. Tokens in separate file to avoid circular deps. `colors.info` (#4A9EFF) for informational badges (e.g., RPE in history).
- **Types**: All DB types in `src/types/database.ts`. `SetTag` = warmup/working/failure/drop. `TemplateExercise` has `warmup_sets`. `UpcomingWorkoutSet` has optional `target_rpe` and `tag`. `Workout` has `upcoming_workout_id` (links to originating plan), `session_notes` (free-form user notes during workout). `WorkoutSet` has optional `target_weight`, `target_reps`, `target_rpe` (persisted plan targets), `exercise_order` (0=unknown/historical, 1+=sequence position).
- **Constants**: `src/constants/exercise.ts` — MUSCLE_GROUPS, EXERCISE_TYPE_OPTIONS, REST_SECONDS, DEFAULT_REST_SECONDS.
- **Observability**: Sentry (`@sentry/react-native`) in App.tsx. Org: `sachit-goyal`, project: `react-native`. Disabled when `EXPO_PUBLIC_SENTRY_DSN` unset.
- **Error Handling**: `ErrorBoundary` (`src/components/ErrorBoundary.tsx`) wraps AuthProvider. Reports to Sentry, shows recovery UI.
- **Live Activity** (`src/services/liveActivity.ts`): Persistent iOS Live Activity for entire workout. Read-only widget shows exercise name + set counter always, rest timer (countdown + progress bar) conditionally. All functions async (return `Promise<void>`), no-op on Android. Deep link: `liftai://workout`. Rest timer end notification shows banner with "Rest Complete" title and plays sound (`timeSensitive` interruption level). All notification ops are serialized via `serializedNotificationOp` to prevent cancel/schedule races. `updateWorkoutActivityForRest` takes `(exerciseName, totalSeconds, setNumber, totalSets)` — encodes rest duration in subtitle as `"Set X/Y|D"` where D = max rest seconds (parsed by Swift widget for progress bar proportional display). `stopRestTimerActivity` cancels notification above the `!currentActivityId` guard so it always runs. Module-level `currentMaxRestSeconds` tracks the progress bar denominator (increases on +15s, never decreases on -15s).
- **Lock Screen Widget** (`plugins/withInteractiveLiveActivity/`): iOS 17+ read-only Live Activity. `UnifiedWorkoutView` shows exercise name + set counter header (identical in both states), large countdown timer + purple progress bar during rest. No interactive buttons. `ParsedSetState` parses `"Set X/Y|D"` pipe-format subtitle to extract `totalRestSeconds` for progress bar proportional display. Rest state shown conditionally via `timerEndDateInMilliseconds > 0`. Timer `Text` and `ProgressView` use `.id(restEndTime)` to force SwiftUI recreation on adjustments. Plugin must run AFTER `expo-live-activity` in `app.config.ts`. `NEW_SWIFT_FILES = []` — `WorkoutIntents.swift` and `WorkoutUserDefaultsHelper.swift` exist on disk but are excluded from widget target.
- **Workout Bridge** (`src/services/workoutBridge.ts`): RN -> iOS widget state sync via App Groups UserDefaults. `syncStateToWidget` writes `WidgetState`, `clearWidgetState` removes it. All no-op on Android. No polling — widget is read-only.
- **Hooks** (`src/hooks/`): Extracted from WorkoutScreen for testability and separation of concerns. `useRestTimer` — manages rest countdown interval, AppState foreground resync, vibration, and Live Activity updates; exposes `isResting`/`currentEndTime`/`startRestTimer`/`adjustRestTimer`/`dismissRest`; takes `onRestEnd`/`onRestUpdate` callbacks for widget sync; `endingRef` prevents re-entrant endRest calls (fixes multiple vibrations); foreground resync uses `endRest(false)` (no vibrate — notification already alerted user). `useWidgetBridge` — builds widget state from exercise blocks (with `preferBlockIdx` + `lastActiveBlockRef` for active exercise tracking), syncs to UserDefaults + Live Activity. Exports `LocalSet` and `ExerciseBlock` types used by WorkoutScreen. `useNotesDebounce` — debounced exercise notes persistence. `useExerciseBlocks` — owns `exerciseBlocks` state, `blocksRef`, `originalBestE1RMRef`, `currentBestE1RMRef` (always-in-sync PR comparison ref), `prSetIdsRef`, `pendingSetWritesRef` (debounced DB writes, 300ms per set ID, flushed on finish/unmount, cleared on cancel), and all block-mutation handlers (`handleSetChange`, `handleCycleTag`, `handleAddSet`, `handleDeleteSet`, `handleToggleNotes`, `handleToggleRestTimer`, `handleAdjustExerciseRest`, `handleNotesChange`, `handleRemoveExercise`); uses internal `updateBlock`/`updateBlockSets` helpers to eliminate repeated immutable-update boilerplate. `useSetCompletion` — owns `handleToggleComplete` with single coalesced `setExerciseBlocks` call (completion + auto-reorder + PR bestE1RM in one updater — was 3 separate calls), `validationErrors` state, and `reorderToast` state; pre-computes reorder decision and PR result before the single state update; reads bestE1RM from `currentBestE1RMRef` (always in sync, unlike `blocksRef` which lags by one render). `useWorkoutLifecycle` — owns all lifecycle state (loading, activeWorkout, templateName, templates, upcoming workout, finish modal, summary, add-exercise modal state, history modal) and handlers (loadState, start/finish/cancel workout, add exercise, template preview, session notes). `getExerciseHistoryData` extracted to `src/utils/exerciseHistory.ts` as a standalone utility used by both `useExerciseBlocks` and `useWorkoutLifecycle`. Shared refs (`workoutRef`, `blocksRef`) created at WorkoutScreen component level and passed to hooks to avoid circular dependencies.
- **Shared UserDefaults** (`modules/shared-user-defaults/`): Local Expo module for App Groups read/write. Group ID: `group.com.sachitgoyal.liftai`.
- **1RM Estimation Engine** (`src/utils/oneRepMax.ts`): Two-path engine for estimated 1RM. **Path A** (RPE provided): Tuchscherer-style percentage table lookup (`src/data/rpeTable.ts`, 12 rows x 9 RPE columns with bilinear interpolation). **Path B** (no RPE): Rep-range-weighted ensemble of Epley + Brzycki + Wathen formulas. Types in `src/types/oneRepMax.ts`. Exports: `calculateE1RM()` (returns `E1RMResult` with confidence tier), `calculateEstimated1RM()` (backwards-compat number), `getPRGatingMargin()`, `FRESHNESS_HALF_LIFE_DAYS` (42 days). **Confidence tiers**: HIGH (1 rep, or 1-5 reps with RPE >= 7, margin 0-3%), MEDIUM (6-10 reps, margin 6%), LOW (11+ reps, margin 12%). **PR gating**: WorkoutScreen uses confidence-gated thresholds — HIGH: any improvement counts, MEDIUM: must beat by 1%, LOW: must beat by 3%. Database: `getBestE1RM()` (all-time), `getCurrentE1RM()` (freshness-weighted decay), `getE1RMWithConfidence()` (with confidence tier).
- **Utilities** (`src/utils/`): `exerciseSearch.ts` — `filterExercises()` by name/muscle group. `streakCalculation.ts` — `calculateStreak()` counts consecutive workout days. `setTagUtils.ts` — `getSetTagLabel()`/`getSetTagColor()` for tag display. `exerciseTypeColor.ts` — `exerciseTypeColor()` maps ExerciseType to theme color. `format.ts` — `formatDuration()`/`formatDate()`. `uuid.ts` — UUID generation.
- **Environment**: `app.config.ts` (dynamic Expo config). `.env.development` / `.env.production` for Supabase separation (gitignored). Dev Supabase: `lift-ai-dev` (ref: `gcpnqpqqwcwvyzoivolp`). Prod: `lift.ai` (ref: `lgnkxjiqzsqiwrqrsxww`). EAS builds use env vars inlined in `eas.json`.

## Screens
All screens in `src/screens/`. Key non-obvious behaviors:

### WorkoutScreen (~500 lines)
Orchestrates hooks and renders UI. Logic in `useExerciseBlocks`, `useSetCompletion`, `useWorkoutLifecycle`. UI in `ExerciseBlockItem`, `WorkoutTimers` (`RestTimerBar`/`ElapsedTimer`), `WorkoutIdleScreen` (`NoActiveWorkout`), `WorkoutSummary`. Styles in `WorkoutScreen.styles.ts`.

- **Set row layout**: 5 columns (SET, LBS, REPS, RPE, Checkbox) — no dedicated PREV column. Previous data as gray placeholders (`rgba(107, 107, 114, 0.5)`), upcoming targets as purple placeholders (`rgba(124, 92, 252, 0.45)`). Inputs are borderless background pills (surfaceLight on surface).
- **Debounced writes**: Set input changes (weight/reps/RPE) debounced 300ms per set ID to SQLite, flushed on finish/unmount, cleared on cancel. Checkbox toggling persists immediately.
- **Auto-fill on completion**: Fills empty weight/reps from upcoming targets (priority 1) or previous session (priority 2). RPE from targets only. User-entered values preserved.
- **RPE rules**: Warmup sets hide RPE (empty). Failure sets hide RPE (inherently RPE 10, stored as null).
- **Tags**: Tap set number to cycle (working -> warmup W -> failure F -> drop D). Long-press or swipe-left to delete set.
- **Warmup styling**: Uncompleted warmup sets have amber tint (`colors.warningBg`); completed green overrides.
- **Validation**: Completion requires weight + reps (red background). Finish requires 1+ completed sets.
- **Rest timer**: Auto-starts on set completion when enabled (per-exercise seconds from template, default 150s).
- **PR detection**: On set completion, if e1RM beats all-time best (cached as `bestE1RM` on `ExerciseBlock`) past confidence-gated threshold (HIGH: 0%, MEDIUM: 1%, LOW: 3%), shows "PR" badge + double-tap haptic. Uses `calculateE1RM()` + `getPRGatingMargin()`. `originalBestE1RMRef` + `currentBestE1RMRef` caches avoid re-fetching on uncheck/recheck.
- **Auto-reorder**: First set completion for out-of-position exercise moves it to top of incomplete blocks (below completed) with `LayoutAnimation`. Only when `prevCompletedCount === 0`. Un-completing doesn't trigger. PR update uses exercise ID lookup (not blockIdx) for post-reorder safety.
- **Exercise notes**: Permanent (persist on finish and cancel). Synced via fire-and-forget after debounced save.
- **Coach tips**: Collapsible purple-tinted section per block, shown when starting from upcoming workout with MCP per-exercise notes.
- **Session notes**: Free-form multiline below "Add Exercise". Stored in `workouts.session_notes`. 500ms debounced save via `updateWorkoutSessionNotes()`. Visible to MCP AI coach. Distinct from exercise-level notes (permanent) and coach tips (MCP-generated).
- **Planned vs Actual**: Starting from upcoming workout persists `upcoming_workout_id` and writes `target_weight`/`target_reps`/`target_rpe` per set, so comparisons survive completion and sync.
- **Template update (F5)**: On finish with template-based workout and modified set counts (F3) or exercise order (F2), summary shows "Template Changes Detected" + "Update Template" button. `buildTemplateUpdatePlan()`/`computeOrderDiff()` in `setDiff.ts`. Plan computed eagerly in `confirmFinish()` before blocks cleared. `applyWorkoutChangesToTemplate()` applies atomically.
- **Live set tracking (F3)**: `ExerciseBlock` has `originalWarmupSets`/`originalWorkingSets` stamped at start. `computeSetDiffs()`/`hasSetChanges()` in `setDiff.ts` compare current vs originals for F5 prompt. Counts restored on resume via template lookup.
- **Last performed badge**: Template cards on idle screen show relative date ("Today"/"3 days ago") via `getLastPerformedByTemplate()` + `formatLastPerformed()`.
- **Performance**: Single coalesced `setExerciseBlocks` in `handleToggleComplete`. Self-contained `React.memo` timer components (own intervals, no parent re-render). Lazy-mounted modals. `FlatList` for add-exercise. Pre-computed `targetMap`/`errorSet` via `useMemo`. Custom `areEqual` on `ExerciseBlockItem`. Parallelized DB queries via `Promise.all`. Module-level constant objects. `prSetIds` via ref (not state).

### Other Screens
- **TemplatesScreen**: Lists templates with exercise counts. Create (modal) / delete (swipe). Uses `getTemplateExerciseCountsBatch()`. Navigates to TemplateDetailScreen.
- **TemplateDetailScreen**: Drag-to-reorder exercises (long-press drag handle, `react-native-draggable-flatlist`). Three inline steppers per exercise — warmup sets (±1), working sets (±1), rest timer (±15s). TestIDs: `drag-handle-{idx}`, `warmup-value-{idx}`, `sets-value-{idx}`, `rest-value-{idx}` (plus `-increase-`/`-decrease-` variants). Reorder persists to SQLite (`updateTemplateExerciseOrder`) + fire-and-forget sync. Optimistic UI with rollback on failure.
- **ExercisesScreen**: Tap = history modal. Long-press = edit modal (name, type chips, muscle group chips, notes). Syncs to Supabase on save.
- **ExercisePickerScreen**: Search bar hidden when create form expanded. Muscle groups: Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Calves, Abs, Forearms.
- **HistoryScreen**: FlatList of past workouts with expandable set details. Pull-to-refresh. Tap exercise name opens ExerciseHistoryModal. Uses `getWorkoutHistory()` + `getWorkoutSets()`. Groups sets by exercise with tag labels/colors.
- **LoginScreen** / **SignupScreen**: Email/password auth forms. LoginScreen also has Google OAuth via `expo-web-browser`. Both use `AuthStackParamList` navigation.
- **ProfileScreen**: Stats, MCP token modal, delete account (Supabase Edge Function `delete-account`).
- **ExerciseHistoryModal** (`src/components/ExerciseHistoryModal.tsx`): 1RM chart (purple) + volume chart (green). PR banner shows "Current" (freshness-weighted, 42-day half-life decay) alongside "All-time" e1RM when current < all-time. Plateau detection (5+ sessions). Requires 3+ sessions for charts. Uses new two-path e1RM engine.
- **WorkoutSummary** (`src/components/WorkoutSummary.tsx`): Extracted from WorkoutScreen. Renders the "Workout Complete!" summary screen with duration/exercises/sets stats, optional template update section (F5), and Done button. Contains `SummaryStat` sub-component. Props: `summaryStats`, `templateUpdatePlan`, `templateChangeDescriptions`, `onUpdateTemplate`, `onDismiss`.

## MCP AI Coach
MCP server at `/Users/sachitgoyal/code/lift-ai-mcp/`. Phone app -> Supabase <- MCP server -> Claude Desktop.

**Tools (18)**: get_workout_history, get_workout_detail, get_exercise_list (includes notes), search_exercises (includes notes), get_all_templates, get_template, get_personal_records, get_exercise_history (returns exercise_notes + sessions), get_upcoming_workout, create_exercise (supports notes), update_exercise (name/type/muscle_groups/description/training_goal/notes, ownership-checked), add_exercise_to_template (rest_seconds default 150, warmup_sets default 0), remove_exercise_from_template, create_template, update_template (batch updates: sort_order, default_sets, rest_seconds, warmup_sets), update_template_exercise_rest, reorder_template_exercises (accepts exercise_ids in desired order), create_upcoming_workout (supports per-exercise `notes` for coach tips, `rpe` -> `target_rpe`, `tag` -> SetTag).

**Multi-User**: JWT auth. Token from ProfileScreen "Get MCP Token". User-scoped tools; exercises shared.

**Deploy**: Local `npm start` (stdio + WORKOUT_USER_ID) | Remote `npm run deploy` (Cloudflare Workers + JWT).

## Supabase Sync (`src/services/sync.ts`)
- `syncToSupabase()` — push exercises (including notes), templates, workouts + sets to Supabase (auth-guarded, adds user_id). Includes `upcoming_workout_id` and `session_notes` on workouts and `target_weight`/`target_reps`/`target_rpe` on workout sets.
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
- TestIDs: login-email, login-password, login-btn, logout-btn, start-empty-workout, start-upcoming-workout, add-exercise-btn, finish-workout-btn, create-template-fab, create-exercise-toggle, exercise-name-input, exercise-search, save-exercise-btn, weight-{ex}-{set}, reps-{ex}-{set}, rpe-{blockIdx}-{setIdx}, check-{ex}-{set}, muscle-{name}, exercise-type-picker, sets-progress, rest-timer-toggle-{blockIdx}, exercise-notes-{blockIdx}, set-tag-{blockIdx}-{setIdx}, cancel-workout-btn, session-notes-input.

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
- Exercise notes are permanent and synced: `flushPendingNotes()` on finish, `clearPendingNotes()` on cancel (discard doesn't overwrite stored notes). 500ms debounce via `debouncedSaveNotes`. Fire-and-forget `syncToSupabase()` after each debounced save. Notes debouncing logic extracted to `src/hooks/useNotesDebounce.ts` hook (with cleanup on unmount).
- **Do NOT build to device from git worktrees.** Worktrees lack `.env.*` files (gitignored), and Expo CLI has Metro URL/device discovery issues with non-standard paths. Always merge to main and build from `/Users/sachitgoyal/code/lift-ai/`.
- **Plugin Swift edits require clean prebuild.** When editing Swift files in `plugins/withInteractiveLiveActivity/swift/`, you must run `npx expo prebuild --clean` before building — `expo run:ios` won't re-copy plugin files if `ios/` already exists.

## Documentation
- **README.md**: Public-facing project overview with features, architecture, tech stack, and setup instructions. No secrets or internal details.

## Working Style
- Be proactive: run commands, check results, and take action without waiting for the user to tell you each step.
