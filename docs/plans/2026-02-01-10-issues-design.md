# 10 Issues Fix Design

## Issue 1: Can't Scroll During Workout
- Ensure ScrollView `contentContainerStyle` has `flexGrow: 1` and adequate `paddingBottom` to clear rest timer bar and bottom tabs.

## Issue 2: Header Too Cramped
- Split header into two rows:
  - Row 1: Cancel (X) | Template name (centered) | Finish button
  - Row 2: Timer (mm:ss) | Sets progress (X/Y sets) — centered, larger text, vertical padding

## Issue 3: History — Hide Incomplete Sets + Fix Tag Display
- Filter history queries to only show sets where `is_completed = 1`.
- Replace `(working)` / `(warmup)` etc text with short colored badges: W, D, F. Hide tag entirely for working sets (default).

## Issue 4: Profile Stats Overhaul
- Keep: Total Workouts, This Month, Streak
- Add: PRs This Week — count exercises where this week's best Epley 1RM (`weight × (1 + reps/30)`) exceeded all prior 1RMs
- Remove: Week Volume, Avg Duration

## Issue 5: Exercise Creation During Workout
- Add create exercise form (name, type chips, muscle group chips, description) as toggle inside workout's add-exercise modal. On save, create exercise and add to active workout.

## Issue 6: Per-Exercise Rest Timers in Templates
- Add `rest_seconds INTEGER DEFAULT 150` to `template_exercises` table.
- TemplateDetailScreen: each exercise card shows tappable "Rest: 150s" that opens input to edit.
- When starting workout from template, use per-exercise rest timer value.
- On set completion, rest timer uses that exercise's configured value.
- Editable by human and AI during: template edit, active workout, upcoming workout creation.

## Issue 7: Allow Completing Sets Without Weight/Reps
- Checkbox always tappable regardless of weight/reps values.
- Sets can be marked complete with null weight/reps.

## Issue 8: Remove Redundant Template Name Label
- Remove uppercase "TEMPLATE NAME" label in TemplateDetailScreen. Show editable name directly.

## Issue 9: Exercise History Modal
- Accessible from: history screen (tap exercise name), active workout (tap exercise name).
- Contents:
  - Header: exercise name
  - Line chart: estimated 1RM over time (Epley formula, one point per workout, x=date, y=best 1RM)
  - PR banner: all-time best est. 1RM with date
  - Last 3 performances: date + all completed sets (weight × reps)
- Chart library: react-native-chart-kit or similar lightweight option.

## Issue 10: Remove Volume Display
- Remove volume stat from finish workout summary screen.
- Remove volume pill from history screen workout cards.
