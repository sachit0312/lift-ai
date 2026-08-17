# lift-ai

Expo React Native workout tracker with SQLite local storage, Supabase cloud sync, and an iOS Live Activity.

## Working agreements

- Treat this file as the only repository-wide agent instruction source. Keep it current when architecture or operational constraints change.
- Be proactive: inspect the current implementation, run relevant commands, and verify results rather than stopping at proposals.
- Preserve user changes in a dirty worktree and avoid destructive Git commands.
- Use `rg`/`rg --files` for searches. Use `apply_patch` for manual file edits.
- Route every fire-and-forget database or native bridge write through a `.catch(...)` that reports to Sentry. `fireAndForgetSync` is the exception because `syncToSupabase` captures errors internally.
- Use the project skills in `.agents/skills/` when their descriptions match the task.

## Quick reference

| Task | Command / path |
|---|---|
| Type-check | `npx tsc --noEmit` |
| Unit tests | `npm test` |
| E2E test | `maestro test maestro/<path>.yaml` |
| Simulator build | `npx expo run:ios` |
| Device build | `npx expo run:ios --device` |
| Release device build | `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --device "iPhone" --configuration Release` |
| Native regeneration | `npx expo prebuild --clean` |
| EAS production build | `npm run build:prod` |
| App Store submission | `npm run submit:ios` |
| Production OTA | `npm run update:prod` |
| MCP server | `cd /Users/sachitgoyal/code/lift-ai-mcp && npm run build && npm start` |

## Architecture

### Navigation and authentication

- `src/navigation/RootNavigator.tsx` renders the auth or app navigator based on the Supabase session. `TabNavigator` contains a nested Templates stack.
- `src/contexts/AuthContext.tsx` keeps the Supabase callback synchronous, calls `setCurrentUserId()` on every auth event and initial rehydration, then runs serialized generation-checked reconciliation outside the auth lock.
- The durable `liftai-local-data-owner` Secure Store marker proves restored-session ownership. Pre-marker upgrades may bootstrap only from one unique matching authenticated owner across owner-bearing SQLite rows; unknown, ambiguous, or mismatched ownership resets SQLite before strict sequential pulls. Same-account resumes preserve healthy local data.
- On `SIGNED_OUT`, the database user becomes `local`. `authPhase` gates the root navigator until reconciliation succeeds; timeout or pull failure remains fail-closed, and only a reconciled generation may enable pushes or render app data.
- Email/password and Google OAuth use Supabase. Sessions persist in Expo Secure Store. The app scheme is `liftai`.

### SQLite and data ownership

- `src/services/database.ts` uses expo-sqlite async APIs with WAL and foreign keys enabled per connection. `DB_NAME` is `workout-enhanced.db`.
- All transactions must use `runInTransaction(db, fn)`, which serializes them through a process-wide promise chain. Never call `db.withTransactionAsync` directly.
- Nested transactions are rejected. If a caller is already inside a transaction, inline statements from helpers such as `clearLocalUpcomingWorkout`, `deleteWorkout`, or `deleteTemplate` instead of invoking the transactional helper.
- `resetDatabase()` joins the transaction chain before close/delete/reopen, rejects retained stale connections, and serializes initialization through `dbInitPromise`. A failed file deletion must complete a verified empty fallback wipe or reject. `clearAllLocalData()` intentionally remains non-transactional because concurrent sync flows call it.
- `currentUserId` is set by `AuthContext`. User-scoped note/exercise operations also call `resolveUserId()`, which falls back to `supabase.auth.getSession()` and repairs the module global. Use `local` only when no session exists.
- `exercises.user_id = NULL` means a shared global exercise; non-null means a custom exercise. Global exercise definitions cannot be edited by users.
- `user_exercise_notes` stores `form_notes` and `machine_notes` by `(user_id, exercise_id)`. Form notes are available to the MCP coach. Machine notes are private and must never be exposed through MCP.
- Keep typed row interfaces and centralized row mappers. Use `safeJsonParse` for JSON columns.

### Supabase sync

- `src/services/sync.ts` pushes custom exercises, exercise notes, templates, finished workouts, workout sets, and supported planning metadata. Global exercises are not pushed.
- `syncToSupabase()` coalesces callers with one in-flight promise and a generation-labelled dirty trailing pass. Pushes are disabled synchronously on account transition and enabled only after ownership is proven or reset plus strict pulls complete; unexpected errors are captured internally and the public promise remains nonthrowing.
- The push rescue step reassigns rows accidentally written as `local` to the authenticated user before session-filtered selects. It handles note primary-key collisions first and reports rescue failures without aborting the remaining push.
- Pulls fetch network data before entering SQLite transactions. Exported pulls are deduplicated by operation, strictness, and session user; auth reconciliation uses strict variants that reject missing, errored, or mismatched sessions and runs them sequentially.
- `pullExercisesAndTemplates()` handles global/custom exercises, user notes, templates, exercise ordering, warmups, rest values, and remote deletions. `pullWorkoutHistory()` converts Supabase booleans for SQLite. `pullUpcomingWorkout()` replaces the local upcoming plan.
- Schema changes referenced by sync or MCP must be migrated in both Supabase projects before code deployment: dev `gcpnqpqqwcwvyzoivolp`, prod `lgnkxjiqzsqiwrqrsxww`. Migration files live in `supabase/migrations/`.

### Workout implementation

- `src/screens/WorkoutScreen.tsx` orchestrates hooks and renders the workout. State and mutations live in `src/hooks/useExerciseBlocks.ts`, `useSetCompletion.ts`, `useWorkoutLifecycle.ts`, `useRestTimer.ts`, `useWidgetBridge.ts`, and `useNotesDebounce.ts`.
- Shared `workoutRef` and `blocksRef` are created by `WorkoutScreen` and passed into hooks. Lifecycle operations that must observe the latest edits read the refs, not stale render closures.
- Set input writes are debounced 300 ms per set ID, flushed on finish/unmount, and cleared on cancel. Checkbox completion persists immediately.
- Completing a set requires weight and reps. Empty values auto-fill from upcoming targets first, then the previous session. Target RPE may auto-fill; warmup and failure sets display no RPE.
- Set tags cycle `working -> warmup -> failure -> drop`. Long-press or swipe left deletes a set.
- The first completion on an out-of-position exercise may auto-reorder it. Persist reordered `exercise_order`; use exercise IDs, not stale block indexes, for post-reorder updates.
- PR detection uses `calculateE1RM()` and confidence-gated thresholds. `currentBestE1RMRef` stays synchronized during completion/uncompletion; `recomputeSessionBestE1RM()` prevents badge regressions after deleting or unchecking a PR set.
- Starting from a plan stores `upcoming_workout_id`, ordered `planned_exercise_ids`, and target weight/reps/RPE. Persist planned IDs before asynchronously building blocks. User-added exercises do not mutate the original plan.
- Every set in an exercise block shares its `exercise_order`. A newly added exercise uses `max(existing exercise_order) + 1`; a newly added set inherits the block order.
- At finish, deduplicate planned exercise IDs, insert ghost rows for planned-but-skipped exercises, stamp performed order, and compute template set/order changes before clearing blocks.
- Ghost rows use this sentinel: `programmed_order IS NOT NULL AND exercise_order = 0 AND is_completed = 0 AND reps = 0 AND weight = 0`. Do not identify them with `exercise_order IS NULL`.
- Session notes persist to `workouts.session_notes`. Machine-note editing uses the exercise-level notes table and must flush/cancel its debounce with the workout lifecycle.

### Live Activity

- `src/services/liveActivity.ts` owns the persistent iOS Live Activity. Most exports are async; `stopRestTimerActivity` and `resetRestProgressBaseline` are synchronous.
- Persist the activity ID in the App Group so a cold start adopts the existing activity. `startWorkoutActivity` must remain idempotent.
- Rest updates take an absolute epoch-millisecond deadline. Never reconstruct it from remaining seconds during incidental syncs; doing so re-anchors the countdown and defeats deduplication.
- While resting, incidental set/activity refreshes must preserve `currentEndTime`. `restingExerciseId` anchors both the displayed exercise name and set counter.
- `currentMaxRestSeconds` is the progress denominator: set at rest start, grow on `+15s`, do not shrink on `-15s`, and do not restore it from disk.
- Rest-completion notifications use the stable identifier `liftai-rest-complete`. Starting or adopting an activity after a dead JS process targets both the pending request and delivered card by that identifier, preserving unrelated app notifications. Notification operations are serialized, and cleanup rejections are reported to Sentry without skipping the other cleanup operation.
- Rest updates set ActivityKit `staleDate` to the deadline through `patches/expo-live-activity+0.4.2.patch`. The widget uses `context.isStale` to hide expired rest UI, but whether iOS repaints exactly at `staleDate` remains unverified.
- `plugins/withInteractiveLiveActivity/` overwrites upstream Swift files and merges App Group entitlement; it adds no Xcode project files. There are no AppIntents or interactive widget buttons.
- The subtitle carries `Set X/Y|D`; strip the denominator at every display site. The main lock-screen timer progress view uses explicit empty label closures to avoid duplicating the separately rendered countdown; the iOS 16 fallback uses the default progress label.
- The removed `workoutBridge`, `applyPendingWidgetActions`, and `liftai_action_queue` paths must not be reintroduced without a real reader/writer design.

### Types, theme, and observability

- Database types live in `src/types/database.ts`; workout UI types live in `src/types/workout.ts`.
- `Workout` planning fields include `upcoming_workout_id`, `coach_notes`, `exercise_coach_notes`, and `planned_exercise_ids`. `WorkoutSet` includes target values, `exercise_order`, and nullable `programmed_order`.
- Theme tokens live in `src/theme/tokens.ts` and are re-exported from `src/theme/index.ts`. Avoid magic values when an existing spacing, layout, font, radius, or color token fits.
- `App.tsx` initializes Sentry when `EXPO_PUBLIC_SENTRY_DSN` is present. `ErrorBoundary` wraps `AuthProvider`.

## MCP AI coach

- The server is `/Users/sachitgoyal/code/lift-ai-mcp/`: phone app -> Supabase <- MCP server -> Codex Desktop.
- MCP access is JWT-authenticated and user-scoped. The token is exposed from the Profile screen.
- MCP can read/write `form_notes` through `user_exercise_notes`; it must never expose `machine_notes`.
- Global exercise definitions are read-only, but each user may attach their own notes to any exercise.
- Workout detail/history responses include planning order, targets, skipped exercises, reorder state, and persisted coach notes so planned-versus-actual analysis survives sync.
- When adding or changing MCP tools, update the sibling server and deploy/verify it with the repository's `deploy-mcp` skill.

## UI conventions

- Minimum touch targets are 44x44 via `layout.touchMin`. Primary and secondary button heights use `layout.buttonHeight` and `layout.buttonHeightSm`.
- Use `layout.screenPaddingH` for screen padding and 100 bottom padding where tab-bar clearance is required.
- Text on colored buttons uses `colors.white`. Exercise type colors are weighted=primary, bodyweight=success, machine=warning, cable=accent.
- Workout set rows have five columns: SET, LBS, REPS, RPE, checkbox. Previous values are gray placeholders; upcoming targets are purple placeholders.
- Template detail uses optimistic inline steppers for warmup sets, working sets, and rest seconds, with rollback on persistence failure.

## Build and deployment

- Test Live Activity changes through a native physical-iPhone build, not Expo Go.
- Never build to a device from a Git worktree. Worktrees lack gitignored environment files and Expo device/Metro discovery is unreliable from those paths. Merge to the main checkout before device builds.
- Changes under `plugins/withInteractiveLiveActivity/swift/` require `npx expo prebuild --clean`; `expo run:ios` alone does not recopy plugin sources into an existing `ios/` directory.
- When switching dev/prod environments, clear Metro with `npx expo start --clear` and use `npx expo run:ios --device --no-build-cache` when Xcode state is stale.
- Display name: `lift.ai`; bundle ID: `com.sachitgoyal.liftai`; scheme: `liftai://`; slug: `lift-ai`.
- EAS profiles live in `eas.json`. Cloud builds require environment variables to be inlined. OTA updates may contain only JavaScript/assets; native changes require a new EAS build.

## Testing

- Jest uses `jest.config.js`, `jest.setup.js`, and native-service mocks in `src/__mocks__/`.
- Run focused tests during iteration, then `npx tsc --noEmit` and the relevant complete suite before claiming completion.
- From a worktree, do not pass a Jest ignore pattern matching `.worktrees/`; it also matches the worktree's own path and excludes every test.
- Maestro flows live under `maestro/` and compose setup flows with `runFlow`. Checkbox completion is covered through React Native Testing Library because Maestro has an iOS TouchableOpacity-in-ScrollView limitation.

## Operational gotchas

- If WAL corruption occurs after an interrupted workout, same-account sign-in runs `isDatabaseHealthy()` and resets only when the probe fails. Account switches always reset. Finished data recovers from Supabase; in-progress unsynced workouts do not.
- `getWorkoutSets()` orders by `exercise_order, set_number`; every new insertion path must stamp `exercise_order` or default-zero rows will sort incorrectly.
- Machine notes persist independently of workout cancellation. Canceling clears pending writes; it must not overwrite the stored note with discarded UI state.
- `Alert.prompt` is iOS-only. Use `Modal` or `Alert.alert` for cross-platform flows.
- `metro.config.js` adds COOP/COEP headers for expo-sqlite OPFS on web.

## Documentation

- `README.md` is the public project overview. Keep secrets and machine-specific operational details out of it.
