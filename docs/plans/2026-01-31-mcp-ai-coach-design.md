# MCP AI Coach — Design

## Overview

Replace all in-app AI features with a standalone MCP server that connects to Claude Desktop. The phone app becomes a pure workout tracker with no AI. At night, you chat with Claude on your desktop to review workouts and plan tomorrow's session. Claude reads your history and writes an upcoming workout with per-set targets.

## Architecture

Three components:

1. **Phone app (Expo/React Native)** — Pure workout tracker. Logs sets, manages templates, views history. Syncs to Supabase.
2. **Supabase (cloud database)** — Source of truth. Phone app and MCP server both read/write here.
3. **MCP Server (Node.js, runs on Mac)** — Connects to Supabase. Exposes tools to Claude Desktop. You chat with Claude at night.

### Data Flow

- **Gym:** Phone app → Supabase (log sets in real-time)
- **Night:** Claude Desktop → MCP Server → Supabase (read history, write upcoming workout)
- **Next morning:** Phone app ← Supabase (load upcoming workout targets)

## What Gets Removed From App

- `src/services/ai.ts` — entire file
- OpenRouter API key / `EXPO_PUBLIC_OPENROUTER_API_KEY` env var
- AI tip buttons on workout screen
- AI exercise parsing (in ExercisePickerScreen)
- AI workout summaries
- AI score generation (from the UI redesign plan)
- `default_reps` and `default_weight` from `template_exercises` table

## New Database Tables

### `upcoming_workouts`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| date | text | ISO date (YYYY-MM-DD) |
| template_id | uuid nullable | What template it's based on |
| notes | text nullable | Overall workout notes from Claude |
| created_at | text | ISO timestamp |

### `upcoming_workout_exercises`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| upcoming_workout_id | uuid | FK to upcoming_workouts |
| exercise_id | uuid | FK to exercises |
| order | integer | Exercise order |
| rest_seconds | integer | Rest timer for this exercise |
| notes | text nullable | Per-exercise notes (e.g. "slow eccentric") |

### `upcoming_workout_sets`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| upcoming_exercise_id | uuid | FK to upcoming_workout_exercises |
| set_number | integer | 1-indexed |
| target_weight | real | AI-suggested weight |
| target_reps | integer | AI-suggested reps |

## Modified Table: `template_exercises`

Keep: `id`, `template_id`, `exercise_id`, `order`, `default_sets`
Remove: `default_reps`, `default_weight`

Templates define which exercises and how many sets. The upcoming workout defines specific targets.

## MCP Server Tools

### Read Tools (8)

| Tool | Input | Returns |
|---|---|---|
| `get_workout_history` | `limit?: number` | Last N workouts: date, template name, duration, set count |
| `get_workout_detail` | `workout_id: string` | Full workout: every exercise with all sets (weight/reps/tags) |
| `get_exercise_list` | none | All exercises: name, type, muscle groups |
| `get_all_templates` | none | All templates with exercise count |
| `get_template` | `template_id: string` | Template with exercises + default set counts |
| `get_personal_records` | `exercise_id?: string` | Best weight per exercise (all or one specific) |
| `get_exercise_history` | `exercise_id: string, limit?: number` | Last N sessions: date, sets with weights/reps |
| `get_upcoming_workout` | none | Current upcoming workout with all targets |

### Write Tools (4)

| Tool | Input | What it does |
|---|---|---|
| `create_exercise` | `name, type, muscle_groups, description` | Adds new exercise |
| `add_exercise_to_template` | `template_id, exercise_id, default_sets` | Adds exercise to template |
| `remove_exercise_from_template` | `template_id, exercise_id` | Removes exercise from template |
| `create_upcoming_workout` | `date, template_id?, exercises[], notes?` | Creates/replaces upcoming workout |

### `create_upcoming_workout` Input Shape

```json
{
  "date": "2026-02-01",
  "template_id": "optional-uuid",
  "notes": "Push day — focus on bench progression",
  "exercises": [
    {
      "exercise_id": "uuid",
      "rest_seconds": 180,
      "notes": "Slow eccentric on last set",
      "sets": [
        { "weight": 145, "reps": 10 },
        { "weight": 150, "reps": 8 },
        { "weight": 155, "reps": 6 }
      ]
    }
  ]
}
```

Overwrites any existing upcoming workout (deletes old, inserts new).

## Phone App UI Changes

### Active Workout — Set Row

```
SET | PREV    | TARGET  | LB    | REPS  | ✓
1   | 135×10  | 145×10  | [   ] | [   ] | [ ]
```

- PREV: last workout's data (existing)
- TARGET: from upcoming workout, shown in dim purple text
- LB/REPS: empty inputs where you log what you actually did
- Target column only shows if an upcoming workout exists for this exercise

### Workout Idle Screen

If an upcoming workout exists for today, show a prominent card:
```
┌─────────────────────────────┐
│  Workout Ready              │
│  Push Day · 5 exercises     │
│  [Start Workout]            │
└─────────────────────────────┘
```

Tapping "Start Workout" loads the upcoming workout with all targets pre-loaded into the TARGET column.

### Template Detail Screen

- Shows exercise list with set count only (no reps/weight defaults)
- "3 sets" not "3×10 @ 135lb"

## MCP Server Project Structure

```
workout-mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── supabase.ts       # Supabase client
│   ├── tools/
│   │   ├── read.ts       # All read tool handlers
│   │   └── write.ts      # All write tool handlers
│   └── types.ts          # Shared types
└── README.md             # Setup instructions
```

Separate repo/directory from the phone app. Uses `@modelcontextprotocol/sdk` and `@supabase/supabase-js`.

## Typical Evening Session

```
You: How was my push day today?
Claude: [calls get_workout_history, get_workout_detail]
  Your push day was 48 minutes, 15 sets. Bench press: 145×10, 145×9, 140×8.
  That's up from last week's 135×10. Solid progression.

You: Set me up for pull day tomorrow, I want to push deadlifts harder
Claude: [calls get_template, get_exercise_history, get_personal_records]
  Based on your history, your deadlift has been at 225×5 for 3 weeks.
  I'll program 230×5 for your first two sets, then a back-off at 215×8.
  [calls create_upcoming_workout]
  Done — tomorrow's pull day is ready with 6 exercises. Deadlift targets:
  Set 1: 230×5, Set 2: 230×5, Set 3: 215×8. Rest: 3 min between sets.

You: My left shoulder was bugging me, swap out barbell rows for cable rows
Claude: [calls create_upcoming_workout — updated version]
  Swapped barbell rows for cable rows at 60lb×12 for 3 sets. Everything else stays.
```
