# UI Redesign — Hevy/Strong-Inspired

## Design Direction
- Two-tone palette: **purple (#7c5cfc / #a78bfa) + white/gray** only
- Dark theme with subtle card borders (#1a1a1f on #131316 surfaces)
- Inter font, tight letter-spacing on headings, uppercase section labels
- Wireframes: `http://localhost:8787/wireframes.html` (run `python3 -m http.server 8787` from scratchpad dir)

## Screen-by-Screen Changes

### 1. Workout (Idle)
- "Start Empty Workout" primary purple button at top
- Template cards show: emoji icon, name, exercise count, **"Last done Monday"** (not "Updated 2d ago")
- "MY TEMPLATES" uppercase section header with "See All" link
- Bottom tab bar with solid background, no gradient

### 2. Workout (Active) — Major Rework
- Header: template name (22px bold), elapsed timer (purple), sets count, "Finish" button (purple)
- **Rest timer as compact inline bar** (not a modal):
  - Shows: countdown time (22px bold purple), "REST · Exercise Name", progress bar, -15/Skip/+15 buttons
  - Sits between header and exercise list, same width as content
- Exercise blocks: name + "AI Tip" button (purple tint), set table with columns: SET / PREV / LB / REPS / check
- Completed sets: purple-tinted background + purple check button (not green)
- "+ Add Set" dashed border button per exercise
- "+ Add Exercise" secondary button at bottom

### 3. Templates
- Search bar at top
- Same template card style as Workout Idle
- Purple FAB (bottom-right) for creating new template

### 4. Template Detail
- Back arrow + template name (editable via pencil icon)
- Exercise list items: purple dot, name, muscle groups, default sets x reps
- "+ Add Exercise" secondary button
- "Start Workout" primary button at bottom

### 5. Exercise Picker
- Search bar + filter chips (All / Weighted / Machine / Cable / Bodyweight)
- Exercise list: purple dot, name, muscle groups
- "+ Create New Exercise" primary button at bottom

### 6. Create Exercise — New Dedicated Screen
- Fields: **Name** (with AI Fill button), **Type** (chip selector), **Muscle Groups**, **Description** (optional)
- **No training goal field** — removed entirely
- Clean, minimal form layout

### 7. History
- Cards show: date, template name, duration, sets count, **PRs hit**
- **AI score badge** (e.g. "AI 9.2") with one-line AI assessment per workout
- No total weight/volume

### 8. Profile
- **2x2 stat grid** (uniform boxes):
  - Total Workouts (purple number)
  - PRs This Month
  - Current Streak
  - AI Score (purple number)
- Settings section below: Rest Timer Defaults, Weight Units, AI Coach (purple "Active"), Export Data

## Theme Constants (for implementation)
```
colors:
  background: #0c0c0f
  surface: #131316
  surfaceBorder: #1a1a1f
  inputBg: #141418
  inputBorder: #1e1e24
  primary: #7c5cfc
  primaryLight: #a78bfa
  primaryTint: #7c5cfc14  (for badges, tip buttons)
  primarySubtle: #7c5cfc18 (for completed sets)
  text: #e8e8eb
  textSecondary: #999
  textMuted: #555
  textDim: #444
  tabBarBg: #0c0c0f
  tabBarBorder: #161619

spacing: same as current (xxs=2 through xxl=48)
fontSize: same as current
borderRadius: sm=6 md=10 lg=12 xl=14 (slightly tighter than before)
```

## New Features Required
1. **Create Exercise screen** — standalone screen (not inline collapsible in ExercisePicker)
2. **PR tracking** — detect when a set exceeds previous best for that exercise
3. **AI workout score** — generate a 1-10 score per workout based on progression, volume, consistency
4. **"Last done" on templates** — query last workout date per template instead of updated_at
