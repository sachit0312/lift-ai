# Comprehensive App Review — Unified Synthesis

**Date:** Feb 15, 2026
**Reviewed by:** 6 specialist agents (strong-expert, hevy-expert, feature-reviewer, ux-reviewer, perf-reviewer, test-reviewer)

---

## Executive Summary

The app has a **solid foundation** — 9 screens, 305 tests, Supabase sync, Live Activity, and a unique AI coaching workflow via MCP. But 6 parallel reviews surfaced clear patterns:

1. **Reliability gap**: 16 of 20 database functions lack try/catch + Sentry. A SQLite error mid-workout would crash the app silently.
2. **Performance N+1s**: Loading a 5-exercise workout runs 11 DB queries instead of 2. Trivially fixable with batch fetching.
3. **Silent failures everywhere**: User-initiated actions (start workout, create template, sync) fail silently with just `console.error`.
4. **Feature parity gaps**: Plate calculator, body measurements, Apple Health, CSV export are table-stakes features in Strong/Hevy that we lack.
5. **UX discoverability**: Powerful features (long-press delete, tag cycling, swipe-to-delete) have zero visual hints.

---

## Prioritized Roadmap

### P0 — Fix Before Next Feature (Reliability & Correctness)

| # | Item | Source | File(s) | Effort |
|---|------|--------|---------|--------|
| 1 | **Standardize Sentry error handling** — Add try/catch + `Sentry.captureException()` to all 22 unprotected database functions | feature-reviewer, test-reviewer | `database.ts` | 2h |
| 2 | **Fix N+1 in loadActiveWorkout** — Batch fetch exercises with `SELECT ... WHERE id IN (?)` | perf-reviewer (C1) | `WorkoutScreen.tsx:236`, `database.ts` (new `getBulkExercises`) | 1h |
| 3 | **Fix N+1 in buildExerciseBlock** — Pass pre-fetched exercise map when starting workouts from templates/upcoming | perf-reviewer (C2) | `WorkoutScreen.tsx:414-437` | 1h |
| 4 | **Add user-facing error alerts** — User-initiated actions that fail silently need Alert.alert feedback | ux-reviewer (Critical #1) | `WorkoutScreen.tsx`, `TemplatesScreen.tsx`, `TemplateDetailScreen.tsx`, `ExercisePickerScreen.tsx` | 1h |
| 5 | **Handle loadActiveWorkout failure** — Users get stuck with phantom workout they can't see or cancel | ux-reviewer (Critical #2) | `WorkoutScreen.tsx:161-165` | 30m |
| 6 | **Fix unbounded getPRsThisWeek** — Scans ALL workout_sets without date filter (10K+ rows after 1 year) | perf-reviewer (H3) | `database.ts:581-601` | 30m |
| 7 | **Add LIMIT to getWorkoutHistory** — Fetches ALL workouts unbounded | perf-reviewer (H2, H6) | `database.ts:400`, `sync.ts:208` | 30m |

**Total P0 effort: ~6.5 hours**

---

### P1 — Important UX & Quality (Next Sprint)

| # | Item | Source | File(s) | Effort |
|---|------|--------|---------|--------|
| 8 | **Forgot Password flow** | ux-reviewer (#4) | `LoginScreen.tsx` | 1h |
| 9 | **Signup success feedback** (email verification message) | ux-reviewer (#5) | `SignupScreen.tsx` | 30m |
| 10 | **Template deletion discoverability** — Add swipe-to-delete or visible trash icon | ux-reviewer (#6) | `TemplatesScreen.tsx` | 1h |
| 11 | **Wrap ExerciseBlock in React.memo** — Every set change re-renders all exercise blocks | perf-reviewer (H1) | `WorkoutScreen.tsx` | 1h |
| 12 | **Parallelize sync operations** — exercises+templates can run parallel with workouts+sets | perf-reviewer (H5) | `sync.ts` | 30m |
| 13 | **Add missing index** on `template_exercises.exercise_id` | perf-reviewer (C3) | `database.ts`, new Supabase migration | 15m |
| 14 | **Fix Live Activity empty title** on adjust | feature-reviewer (#6) | `liveActivity.ts:79` | 15m |
| 15 | **Remove unused import** `DEFAULT_REST_SECONDS` | feature-reviewer (#1) | `WorkoutScreen.tsx:26` | 5m |
| 16 | **Add ExercisesScreen empty state** + "Create Exercise" button | ux-reviewer (#3, #10) | `ExercisesScreen.tsx` | 1h |
| 17 | **Change finish button from red to green/purple** — Finishing is positive, not destructive | ux-reviewer (#12) | `WorkoutScreen.tsx:1390` | 5m |
| 18 | **Add pull-to-refresh** to HistoryScreen and ExercisesScreen | ux-reviewer (#13) | `HistoryScreen.tsx`, `ExercisesScreen.tsx` | 30m |

**Total P1 effort: ~6 hours**

---

### P2 — New Features (Competitor Parity)

| # | Item | Sources | Effort | Notes |
|---|------|---------|--------|-------|
| 19 | **Plate Calculator** | strong (#1) | 4h | Huge QoL, used dozens of times per workout |
| 20 | **Warm-up Calculator** | strong (#2) | 4h | Percentage pyramids for compound lifts |
| 21 | **Body Measurements Tracking** | strong (#4), hevy (#7) | 8h | New table, chart UI, critical for cut/bulk |
| 22 | **CSV Export** | strong (#5) | 4h | Data portability, builds trust |
| 23 | **Apple Health Sync** | strong (#6), hevy (#9) | 6h | Expected for iOS fitness apps |
| 24 | **RPE Tracking** | strong (#7) | 2h | Per-set field, important for autoregulation |
| 25 | **Detailed Analytics/Graphs** | hevy (#4) | 12h | Volume progression, muscle group distribution, monthly summaries |
| 26 | **Pre-built Workout Programs** | hevy (#1) | 8h | Biggest onboarding gap |
| 27 | **Superset Support** | hevy (#3) | 6h | Exercise pairing/grouping |
| 28 | **Cardio Exercise Support** | strong (#8) | 4h | Duration/distance metrics |

**Priority order for features:** 19 → 20 → 24 → 22 → 21 → 25 → 23 → 26 → 27 → 28

---

### P3 — Testing Gaps to Close

| # | Item | Source | File(s) | Effort |
|---|------|--------|---------|--------|
| 29 | **Add Google OAuth unit test** | test-reviewer (#2) | `LoginScreen.test.tsx` | 1h |
| 30 | **Add `pullWorkoutHistory` resilience tests** | test-reviewer (#4) | `sync.resilience.test.ts` | 1h |
| 31 | **Add `getUpcomingWorkoutForToday` tests** | test-reviewer (#5) | `database.test.ts` | 1h |
| 32 | **Add template deletion test** (long-press) | test-reviewer (#6) | `TemplatesScreen.test.tsx` | 30m |
| 33 | **Test `getActiveWorkout` returning active workout** | test-reviewer (#7) | `WorkoutScreen.test.tsx` | 30m |
| 34 | **Add finish-to-summary flow test** | test-reviewer (#9) | `WorkoutScreen.test.tsx` | 30m |
| 35 | **Test ProfileScreen logout confirmation** | test-reviewer (#8) | `ProfileScreen.test.tsx` | 30m |

**Total P3 effort: ~5 hours**

---

### P4 — Polish & Nice-to-Have

| # | Item | Source |
|---|------|--------|
| 36 | MCP Token modal: show copyable JSON config snippet | ux-reviewer (#14) |
| 37 | Add accessibility labels to interactive elements | ux-reviewer (#15) |
| 38 | Standardize title sections across tab screens | ux-reviewer (#9) |
| 39 | KeyboardAvoidingView in add-exercise modal | ux-reviewer (#16) |
| 40 | Cache exercises in React Context | perf-reviewer (H4) |
| 41 | HistoryScreen FlatList virtualization | perf-reviewer (M1) |
| 42 | Memoize chart data in ExerciseHistoryModal | perf-reviewer (M2) |
| 43 | MCP `get_workout_history` limit parameter | perf-reviewer (M3) |
| 44 | Debounce exercise search input | perf-reviewer (L1) |
| 45 | Apple Watch app | strong (#3) |
| 46 | Exercise instruction videos | hevy (#5) |
| 47 | Social features | hevy (#2) — Skip for now |
| 48 | Update stale CLAUDE.md references (TargetCell, description field) | feature-reviewer |

---

## Key Insights

**Our unique advantage** is the MCP/AI coach workflow — no competitor has this. But we need feature parity on fundamentals before users will stay long enough to discover it.

**Biggest bang-for-buck items:**
1. Sentry error handling (2h) — prevents silent data loss
2. N+1 fix (2h) — 83% faster workout loading
3. Plate calculator (4h) — used dozens of times per workout
4. Error alerts (1h) — users currently see nothing when things fail
5. RPE tracking (2h) — simple field addition, high value for serious lifters

**What to skip:**
- Social features (high investment, doesn't fit solo+AI architecture)
- Exercise videos (content sourcing problem)
- Apple Watch (big effort, defer until core is rock solid)

---

## CLAUDE.md Updates Needed

1. Remove `TargetCell` from memoized components list (doesn't exist)
2. Change "description field" to "notes field" for ExercisePickerScreen
3. Add note about template cards in WorkoutScreen being compact (no exercise count/date)
