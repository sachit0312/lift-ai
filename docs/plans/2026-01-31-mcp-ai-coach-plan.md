# MCP AI Coach Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all in-app AI features with a standalone MCP server that connects to Claude Desktop. The phone app becomes a pure workout tracker syncing to Supabase. At night, chat with Claude to review workouts and create tomorrow's upcoming workout with per-set targets.

**Architecture:** Three components — phone app (Expo), Supabase (cloud DB), MCP server (Node.js on Mac). Phone app syncs to Supabase in real-time. MCP server reads/writes Supabase, exposes 12 tools to Claude Desktop. New `upcoming_workouts` tables store AI-planned workouts. App shows TARGET column during active workout.

**Tech Stack:** @modelcontextprotocol/sdk, @supabase/supabase-js, TypeScript, Node.js, Expo/React Native

---

### Task 1: Create Supabase Migration — New Tables + Column Drops

**Files:**
- Create: `supabase/migrations/002_upcoming_workouts.sql`

**Step 1: Write the migration SQL**

```sql
-- New tables for AI-planned upcoming workouts
CREATE TABLE upcoming_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  template_id UUID REFERENCES templates(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE upcoming_workout_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upcoming_workout_id UUID NOT NULL REFERENCES upcoming_workouts(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  rest_seconds INTEGER NOT NULL DEFAULT 90,
  notes TEXT
);

CREATE TABLE upcoming_workout_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upcoming_exercise_id UUID NOT NULL REFERENCES upcoming_workout_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  target_weight REAL NOT NULL,
  target_reps INTEGER NOT NULL
);

-- RLS
ALTER TABLE upcoming_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE upcoming_workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE upcoming_workout_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own upcoming workouts" ON upcoming_workouts
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own upcoming workout exercises" ON upcoming_workout_exercises
  FOR ALL USING (upcoming_workout_id IN (SELECT id FROM upcoming_workouts WHERE user_id = auth.uid()));
CREATE POLICY "Users manage own upcoming workout sets" ON upcoming_workout_sets
  FOR ALL USING (upcoming_exercise_id IN (SELECT id FROM upcoming_workout_exercises WHERE upcoming_workout_id IN (SELECT id FROM upcoming_workouts WHERE user_id = auth.uid())));

-- Drop unused columns from template_exercises
ALTER TABLE template_exercises DROP COLUMN IF EXISTS default_reps;
ALTER TABLE template_exercises DROP COLUMN IF EXISTS default_weight;
```

**Step 2: Deploy the migration to Supabase**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx supabase db push`

If not using Supabase CLI, apply the SQL directly via the Supabase dashboard SQL editor.

**Step 3: Commit**

```bash
git add supabase/migrations/002_upcoming_workouts.sql
git commit -m "feat: add upcoming_workouts tables, drop template default_reps/weight"
```

---

### Task 2: Scaffold MCP Server Project

**Files:**
- Create: `workout-mcp-server/package.json`
- Create: `workout-mcp-server/tsconfig.json`
- Create: `workout-mcp-server/src/index.ts` (entry point stub)
- Create: `workout-mcp-server/src/supabase.ts`
- Create: `workout-mcp-server/src/types.ts`
- Create: `workout-mcp-server/src/tools/read.ts` (stub)
- Create: `workout-mcp-server/src/tools/write.ts` (stub)
- Create: `workout-mcp-server/.env.example`

**Step 1: Create package.json**

```json
{
  "name": "workout-mcp-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@supabase/supabase-js": "^2.93.3"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"]
}
```

**Step 3: Create .env.example**

```
SUPABASE_URL=https://lgnkxjiqzsqiwrqrsxww.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

Note: The MCP server uses the **service role key** (not anon key) to bypass RLS. Get this from Supabase dashboard → Settings → API → service_role key.

**Step 4: Create src/supabase.ts**

```typescript
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

export const supabase = createClient(url, key);
```

**Step 5: Create src/types.ts**

```typescript
export interface Exercise {
  id: string;
  name: string;
  type: 'weighted' | 'bodyweight' | 'machine' | 'cable';
  muscle_groups: string[];
  description: string;
}

export interface Template {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  sort_order: number;
  default_sets: number;
  exercise?: Exercise;
}

export interface Workout {
  id: string;
  template_id: string | null;
  started_at: string;
  finished_at: string | null;
  ai_summary: string | null;
  notes: string | null;
}

export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  tag: string;
  is_completed: boolean;
}

export interface UpcomingWorkout {
  id: string;
  date: string;
  template_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface UpcomingWorkoutExercise {
  id: string;
  upcoming_workout_id: string;
  exercise_id: string;
  sort_order: number;
  rest_seconds: number;
  notes: string | null;
  exercise?: Exercise;
  sets?: UpcomingWorkoutSet[];
}

export interface UpcomingWorkoutSet {
  id: string;
  upcoming_exercise_id: string;
  set_number: number;
  target_weight: number;
  target_reps: number;
}
```

**Step 6: Create stub src/tools/read.ts and src/tools/write.ts**

read.ts:
```typescript
// Read tool handlers — implemented in Task 3
export {};
```

write.ts:
```typescript
// Write tool handlers — implemented in Task 4
export {};
```

**Step 7: Create src/index.ts entry point stub**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'workout-tracker',
  version: '1.0.0',
});

// Tools registered in Tasks 3 & 4

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

**Step 8: Install dependencies**

Run: `cd /Users/sachitgoyal/code/workout-mcp-server && npm install`

**Step 9: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-mcp-server && npx tsc`

**Step 10: Commit**

```bash
cd /Users/sachitgoyal/code/workout-mcp-server
git init
git add -A
git commit -m "feat: scaffold MCP server project"
```

---

### Task 3: Implement Read Tools (8 tools)

**Files:**
- Modify: `workout-mcp-server/src/tools/read.ts`
- Modify: `workout-mcp-server/src/index.ts` (register tools)

**Step 1: Implement all 8 read tool handlers in src/tools/read.ts**

```typescript
import { supabase } from '../supabase.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerReadTools(server: McpServer) {

  server.tool('get_workout_history', { limit: z.number().optional().default(10) }, async ({ limit }) => {
    const { data, error } = await supabase
      .from('workouts')
      .select('id, started_at, finished_at, ai_summary, notes, template_id, templates(name)')
      .not('finished_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }] };

    const workouts = (data ?? []).map((w: any) => {
      const start = new Date(w.started_at);
      const end = new Date(w.finished_at);
      const mins = Math.round((end.getTime() - start.getTime()) / 60000);
      return {
        id: w.id,
        date: w.started_at.split('T')[0],
        template_name: w.templates?.name ?? 'Free Workout',
        duration_minutes: mins,
        notes: w.notes,
      };
    });

    return { content: [{ type: 'text' as const, text: JSON.stringify(workouts, null, 2) }] };
  });

  server.tool('get_workout_detail', { workout_id: z.string() }, async ({ workout_id }) => {
    const { data: workout } = await supabase
      .from('workouts')
      .select('*, templates(name)')
      .eq('id', workout_id)
      .single();

    if (!workout) return { content: [{ type: 'text' as const, text: 'Workout not found' }] };

    const { data: sets } = await supabase
      .from('workout_sets')
      .select('*, exercises(name)')
      .eq('workout_id', workout_id)
      .order('exercise_id')
      .order('set_number');

    // Group sets by exercise
    const exerciseMap = new Map<string, any>();
    for (const s of sets ?? []) {
      const key = s.exercise_id;
      if (!exerciseMap.has(key)) {
        exerciseMap.set(key, { exercise: (s as any).exercises?.name ?? 'Unknown', sets: [] });
      }
      exerciseMap.get(key)!.sets.push({
        set: s.set_number,
        weight: s.weight,
        reps: s.reps,
        tag: s.tag,
        completed: s.is_completed,
      });
    }

    const result = {
      id: workout.id,
      date: workout.started_at,
      template: (workout as any).templates?.name ?? 'Free Workout',
      exercises: Array.from(exerciseMap.values()),
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('get_exercise_list', {}, async () => {
    const { data, error } = await supabase
      .from('exercises')
      .select('id, name, type, muscle_groups, description')
      .order('name');

    if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  server.tool('get_all_templates', {}, async () => {
    const { data, error } = await supabase
      .from('templates')
      .select('id, name, created_at, updated_at, template_exercises(count)')
      .order('updated_at', { ascending: false });

    if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }] };

    const templates = (data ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      exercise_count: t.template_exercises?.[0]?.count ?? 0,
    }));

    return { content: [{ type: 'text' as const, text: JSON.stringify(templates, null, 2) }] };
  });

  server.tool('get_template', { template_id: z.string() }, async ({ template_id }) => {
    const { data: template } = await supabase
      .from('templates')
      .select('*')
      .eq('id', template_id)
      .single();

    if (!template) return { content: [{ type: 'text' as const, text: 'Template not found' }] };

    const { data: exercises } = await supabase
      .from('template_exercises')
      .select('*, exercises(name, type, muscle_groups)')
      .eq('template_id', template_id)
      .order('sort_order');

    const result = {
      ...template,
      exercises: (exercises ?? []).map((te: any) => ({
        exercise_id: te.exercise_id,
        name: te.exercises?.name,
        type: te.exercises?.type,
        muscle_groups: te.exercises?.muscle_groups,
        default_sets: te.default_sets,
        order: te.sort_order,
      })),
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });

  server.tool('get_personal_records', { exercise_id: z.string().optional() }, async ({ exercise_id }) => {
    let query = supabase
      .from('workout_sets')
      .select('exercise_id, weight, exercises(name)')
      .eq('is_completed', true)
      .not('weight', 'is', null)
      .order('weight', { ascending: false });

    if (exercise_id) {
      query = query.eq('exercise_id', exercise_id);
    }

    const { data, error } = await query;
    if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }] };

    // Group by exercise, take max weight
    const prMap = new Map<string, { name: string; best_weight: number }>();
    for (const s of data ?? []) {
      const existing = prMap.get(s.exercise_id);
      if (!existing || (s.weight ?? 0) > existing.best_weight) {
        prMap.set(s.exercise_id, {
          name: (s as any).exercises?.name ?? 'Unknown',
          best_weight: s.weight ?? 0,
        });
      }
    }

    const prs = Array.from(prMap.entries()).map(([id, v]) => ({ exercise_id: id, ...v }));
    return { content: [{ type: 'text' as const, text: JSON.stringify(prs, null, 2) }] };
  });

  server.tool('get_exercise_history', { exercise_id: z.string(), limit: z.number().optional().default(5) }, async ({ exercise_id, limit }) => {
    // Get workouts containing this exercise
    const { data: sets } = await supabase
      .from('workout_sets')
      .select('*, workouts(id, started_at, finished_at)')
      .eq('exercise_id', exercise_id)
      .eq('is_completed', true)
      .not('workouts.finished_at', 'is', null)
      .order('set_number');

    if (!sets?.length) return { content: [{ type: 'text' as const, text: '[]' }] };

    // Group by workout
    const workoutMap = new Map<string, { date: string; sets: any[] }>();
    for (const s of sets) {
      const wid = (s as any).workouts?.id;
      if (!wid) continue;
      if (!workoutMap.has(wid)) {
        workoutMap.set(wid, { date: (s as any).workouts.started_at.split('T')[0], sets: [] });
      }
      workoutMap.get(wid)!.sets.push({ set: s.set_number, weight: s.weight, reps: s.reps, tag: s.tag });
    }

    // Sort by date desc, take limit
    const sessions = Array.from(workoutMap.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);

    return { content: [{ type: 'text' as const, text: JSON.stringify(sessions, null, 2) }] };
  });

  server.tool('get_upcoming_workout', {}, async () => {
    const { data: upcoming } = await supabase
      .from('upcoming_workouts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!upcoming) return { content: [{ type: 'text' as const, text: 'No upcoming workout' }] };

    const { data: exercises } = await supabase
      .from('upcoming_workout_exercises')
      .select('*, exercises(name, type, muscle_groups), upcoming_workout_sets(*)')
      .eq('upcoming_workout_id', upcoming.id)
      .order('sort_order');

    const result = {
      ...upcoming,
      exercises: (exercises ?? []).map((e: any) => ({
        exercise_id: e.exercise_id,
        name: e.exercises?.name,
        rest_seconds: e.rest_seconds,
        notes: e.notes,
        sets: (e.upcoming_workout_sets ?? [])
          .sort((a: any, b: any) => a.set_number - b.set_number)
          .map((s: any) => ({ set: s.set_number, weight: s.target_weight, reps: s.target_reps })),
      })),
    };

    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });
}
```

**Step 2: Add zod dependency**

Run: `cd /Users/sachitgoyal/code/workout-mcp-server && npm install zod`

**Step 3: Register read tools in src/index.ts**

Replace the stub with:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReadTools } from './tools/read.js';

const server = new McpServer({
  name: 'workout-tracker',
  version: '1.0.0',
});

registerReadTools(server);
// registerWriteTools(server); // Task 4

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

**Step 4: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-mcp-server && npx tsc`

**Step 5: Commit**

```bash
git add src/tools/read.ts src/index.ts package.json package-lock.json
git commit -m "feat: implement 8 read tools for MCP server"
```

---

### Task 4: Implement Write Tools (4 tools)

**Files:**
- Modify: `workout-mcp-server/src/tools/write.ts`
- Modify: `workout-mcp-server/src/index.ts` (register write tools)

**Step 1: Implement all 4 write tool handlers in src/tools/write.ts**

```typescript
import { supabase } from '../supabase.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerWriteTools(server: McpServer) {

  server.tool('create_exercise', {
    name: z.string(),
    type: z.enum(['weighted', 'bodyweight', 'machine', 'cable']),
    muscle_groups: z.array(z.string()),
    description: z.string().optional().default(''),
  }, async ({ name, type, muscle_groups, description }) => {
    const { data, error } = await supabase
      .from('exercises')
      .insert({ name, type, muscle_groups, description })
      .select()
      .single();

    if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text' as const, text: `Created exercise "${data.name}" (${data.id})` }] };
  });

  server.tool('add_exercise_to_template', {
    template_id: z.string(),
    exercise_id: z.string(),
    default_sets: z.number().optional().default(3),
  }, async ({ template_id, exercise_id, default_sets }) => {
    // Get next sort order
    const { data: existing } = await supabase
      .from('template_exercises')
      .select('sort_order')
      .eq('template_id', template_id)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { error } = await supabase
      .from('template_exercises')
      .insert({ template_id, exercise_id, sort_order: nextOrder, default_sets });

    if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text' as const, text: `Added exercise to template at position ${nextOrder + 1}` }] };
  });

  server.tool('remove_exercise_from_template', {
    template_id: z.string(),
    exercise_id: z.string(),
  }, async ({ template_id, exercise_id }) => {
    const { error } = await supabase
      .from('template_exercises')
      .delete()
      .eq('template_id', template_id)
      .eq('exercise_id', exercise_id);

    if (error) return { content: [{ type: 'text' as const, text: `Error: ${error.message}` }] };
    return { content: [{ type: 'text' as const, text: 'Removed exercise from template' }] };
  });

  server.tool('create_upcoming_workout', {
    date: z.string(),
    template_id: z.string().optional(),
    notes: z.string().optional(),
    exercises: z.array(z.object({
      exercise_id: z.string(),
      rest_seconds: z.number().optional().default(90),
      notes: z.string().optional(),
      sets: z.array(z.object({
        weight: z.number(),
        reps: z.number(),
      })),
    })),
  }, async ({ date, template_id, notes, exercises }) => {
    // Delete any existing upcoming workout
    const { data: existing } = await supabase
      .from('upcoming_workouts')
      .select('id');

    if (existing?.length) {
      for (const uw of existing) {
        // Cascade deletes will handle exercises and sets
        await supabase.from('upcoming_workouts').delete().eq('id', uw.id);
      }
    }

    // Create the new upcoming workout
    const { data: workout, error: wError } = await supabase
      .from('upcoming_workouts')
      .insert({ date, template_id: template_id ?? null, notes: notes ?? null })
      .select()
      .single();

    if (wError) return { content: [{ type: 'text' as const, text: `Error creating workout: ${wError.message}` }] };

    // Insert exercises and sets
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      const { data: uwe, error: eError } = await supabase
        .from('upcoming_workout_exercises')
        .insert({
          upcoming_workout_id: workout.id,
          exercise_id: ex.exercise_id,
          sort_order: i,
          rest_seconds: ex.rest_seconds,
          notes: ex.notes ?? null,
        })
        .select()
        .single();

      if (eError) return { content: [{ type: 'text' as const, text: `Error adding exercise: ${eError.message}` }] };

      // Insert sets
      const setRows = ex.sets.map((s, j) => ({
        upcoming_exercise_id: uwe.id,
        set_number: j + 1,
        target_weight: s.weight,
        target_reps: s.reps,
      }));

      if (setRows.length) {
        const { error: sError } = await supabase
          .from('upcoming_workout_sets')
          .insert(setRows);

        if (sError) return { content: [{ type: 'text' as const, text: `Error adding sets: ${sError.message}` }] };
      }
    }

    const totalSets = exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
    return { content: [{ type: 'text' as const, text: `Created upcoming workout for ${date}: ${exercises.length} exercises, ${totalSets} sets` }] };
  });
}
```

**Step 2: Register write tools in src/index.ts**

Uncomment and add import:

```typescript
import { registerWriteTools } from './tools/write.js';
```

After `registerReadTools(server);` add:

```typescript
registerWriteTools(server);
```

**Step 3: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-mcp-server && npx tsc`

**Step 4: Commit**

```bash
git add src/tools/write.ts src/index.ts
git commit -m "feat: implement 4 write tools for MCP server"
```

---

### Task 5: Configure Claude Desktop + Test MCP Server

**Files:**
- Modify: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Step 1: Build the MCP server**

Run: `cd /Users/sachitgoyal/code/workout-mcp-server && npm run build`

**Step 2: Create .env with real credentials**

Create `workout-mcp-server/.env` with:
```
SUPABASE_URL=https://lgnkxjiqzsqiwrqrsxww.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<get from Supabase dashboard → Settings → API>
```

**Step 3: Add to Claude Desktop config**

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "workout-tracker": {
      "command": "node",
      "args": ["/Users/sachitgoyal/code/workout-mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://lgnkxjiqzsqiwrqrsxww.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<your-service-role-key>"
      }
    }
  }
}
```

**Step 4: Restart Claude Desktop and verify**

Open Claude Desktop. You should see the workout-tracker MCP server connected with 12 tools available.

Test by asking: "What exercises do I have?" — it should call `get_exercise_list`.

**Step 5: Commit**

```bash
cd /Users/sachitgoyal/code/workout-mcp-server
git add .env.example
git commit -m "feat: add Claude Desktop configuration instructions"
```

---

### Task 6: Phone App — Remove AI Service + OpenRouter References

**Files:**
- Delete: `src/services/ai.ts`
- Modify: `src/screens/WorkoutScreen.tsx` (remove AI tip imports/buttons/summary generation)
- Modify: `src/screens/ExercisePickerScreen.tsx` (remove AI parsing imports/logic)
- Modify: `.env` (remove `EXPO_PUBLIC_OPENROUTER_API_KEY`)

**Step 1: Delete src/services/ai.ts**

Run: `rm /Users/sachitgoyal/code/workout-enhanced/src/services/ai.ts`

**Step 2: Remove AI imports and usage from WorkoutScreen.tsx**

Search for all references to `ai.ts` imports in WorkoutScreen.tsx:
- Remove `import { getExerciseTip, generateWorkoutSummary } from '../services/ai';`
- Remove the AI tip button (search for "Tip" button with sparkle) and its handler function
- Remove `generateWorkoutSummary` call in the finish workout flow — just call `finishWorkout(id)` without summary
- Remove the tip modal/display component

**Step 3: Remove AI imports and usage from ExercisePickerScreen.tsx**

- Remove `import { parseExerciseFromText } from '../services/ai';`
- Remove the `handleAiParse` function and AI-related state
- Remove AI fill button and flash animation

**Step 4: Remove OpenRouter key from .env**

Remove the `EXPO_PUBLIC_OPENROUTER_API_KEY=...` line from `.env`.

**Step 5: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

Fix any remaining references to deleted imports.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove all AI service code and OpenRouter dependency"
```

---

### Task 7: Phone App — Remove default_reps/default_weight from SQLite + Types

**Files:**
- Modify: `src/services/database.ts`
- Modify: `src/types/database.ts`
- Modify: `src/screens/TemplateDetailScreen.tsx`

**Step 1: Update TemplateExercise type**

In `src/types/database.ts`, remove `default_reps` and `default_weight` from `TemplateExercise`:

```typescript
export interface TemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  order: number;
  default_sets: number;
  exercise?: Exercise;
}
```

**Step 2: Update database.ts — schema + functions**

In `initSchema()`, update the `template_exercises` CREATE TABLE to remove `default_reps` and `default_weight` columns.

Add a migration after the CREATE TABLE:

```typescript
await database.runAsync(`ALTER TABLE template_exercises DROP COLUMN default_reps`).catch(() => {});
await database.runAsync(`ALTER TABLE template_exercises DROP COLUMN default_weight`).catch(() => {});
```

Note: SQLite doesn't support DROP COLUMN before version 3.35.0. If this fails, the columns will just stay unused. The app code won't reference them.

Update `getTemplateExercises()` return mapping — remove `default_reps` and `default_weight`.

Update `addExerciseToTemplate()` — remove `reps` and `weight` from defaults parameter and INSERT statement.

Remove `updateTemplateExerciseDefaults()` or simplify it to only handle `sets`.

**Step 3: Update TemplateDetailScreen.tsx**

Remove any display of default reps/weight. Exercise items should show "3 sets" not "3×10 @ 135lb".

Search for `default_reps` and `default_weight` references and remove them.

**Step 4: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/types/database.ts src/services/database.ts src/screens/TemplateDetailScreen.tsx
git commit -m "feat: remove default_reps/weight from templates, keep only set count"
```

---

### Task 8: Phone App — Add Upcoming Workout SQLite Tables + Fetch

**Files:**
- Modify: `src/services/database.ts` (add upcoming tables + query functions)
- Modify: `src/types/database.ts` (add upcoming types)

**Step 1: Add upcoming workout types to src/types/database.ts**

```typescript
export interface UpcomingWorkout {
  id: string;
  date: string;
  template_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface UpcomingWorkoutExercise {
  id: string;
  upcoming_workout_id: string;
  exercise_id: string;
  order: number;
  rest_seconds: number;
  notes: string | null;
  exercise?: Exercise;
  sets?: UpcomingWorkoutSet[];
}

export interface UpcomingWorkoutSet {
  id: string;
  upcoming_exercise_id: string;
  set_number: number;
  target_weight: number;
  target_reps: number;
}
```

**Step 2: Add upcoming tables to initSchema() in database.ts**

```typescript
CREATE TABLE IF NOT EXISTS upcoming_workouts (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  template_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_id) REFERENCES templates(id)
);

CREATE TABLE IF NOT EXISTS upcoming_workout_exercises (
  id TEXT PRIMARY KEY,
  upcoming_workout_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  rest_seconds INTEGER NOT NULL DEFAULT 90,
  notes TEXT,
  FOREIGN KEY (upcoming_workout_id) REFERENCES upcoming_workouts(id) ON DELETE CASCADE,
  FOREIGN KEY (exercise_id) REFERENCES exercises(id)
);

CREATE TABLE IF NOT EXISTS upcoming_workout_sets (
  id TEXT PRIMARY KEY,
  upcoming_exercise_id TEXT NOT NULL,
  set_number INTEGER NOT NULL,
  target_weight REAL NOT NULL,
  target_reps INTEGER NOT NULL,
  FOREIGN KEY (upcoming_exercise_id) REFERENCES upcoming_workout_exercises(id) ON DELETE CASCADE
);
```

**Step 3: Add getUpcomingWorkout() function**

```typescript
export async function getUpcomingWorkoutForToday(): Promise<{
  workout: UpcomingWorkout;
  exercises: (UpcomingWorkoutExercise & { exercise: Exercise; sets: UpcomingWorkoutSet[] })[];
} | null> {
  const db = await getDb();
  const today = new Date().toISOString().split('T')[0];
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM upcoming_workouts WHERE date = ? ORDER BY created_at DESC LIMIT 1',
    today,
  );
  if (!rows.length) return null;
  const workout = rows[0];

  const exRows = await db.getAllAsync<any>(
    `SELECT ue.*, e.name as exercise_name, e.type as exercise_type, e.muscle_groups as exercise_muscle_groups, e.description as exercise_description, e.training_goal as exercise_training_goal, e.created_at as exercise_created_at
     FROM upcoming_workout_exercises ue
     JOIN exercises e ON ue.exercise_id = e.id
     WHERE ue.upcoming_workout_id = ?
     ORDER BY ue.sort_order`,
    workout.id,
  );

  const exercises = [];
  for (const ex of exRows) {
    const setRows = await db.getAllAsync<any>(
      'SELECT * FROM upcoming_workout_sets WHERE upcoming_exercise_id = ? ORDER BY set_number',
      ex.id,
    );
    exercises.push({
      id: ex.id,
      upcoming_workout_id: ex.upcoming_workout_id,
      exercise_id: ex.exercise_id,
      order: ex.sort_order,
      rest_seconds: ex.rest_seconds,
      notes: ex.notes,
      exercise: {
        id: ex.exercise_id,
        user_id: 'local',
        name: ex.exercise_name,
        type: ex.exercise_type,
        muscle_groups: JSON.parse(ex.exercise_muscle_groups || '[]'),
        training_goal: ex.exercise_training_goal,
        description: ex.exercise_description,
        created_at: ex.exercise_created_at,
      },
      sets: setRows.map((s: any) => ({
        id: s.id,
        upcoming_exercise_id: s.upcoming_exercise_id,
        set_number: s.set_number,
        target_weight: s.target_weight,
        target_reps: s.target_reps,
      })),
    });
  }

  return { workout, exercises };
}
```

**Step 4: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/types/database.ts src/services/database.ts
git commit -m "feat: add upcoming workout tables and query to SQLite"
```

---

### Task 9: Phone App — Supabase Sync Service

**Files:**
- Create: `src/services/sync.ts`

**Step 1: Create src/services/sync.ts**

This service syncs local SQLite data up to Supabase and pulls upcoming workouts down.

```typescript
import { supabase } from './supabase';
import { getDb } from './database';

export async function syncToSupabase() {
  const db = await getDb();

  // Sync exercises
  const exercises = await db.getAllAsync<any>('SELECT * FROM exercises');
  for (const e of exercises) {
    await supabase.from('exercises').upsert({
      id: e.id,
      name: e.name,
      type: e.type,
      muscle_groups: JSON.parse(e.muscle_groups || '[]'),
      training_goal: e.training_goal,
      description: e.description,
    }, { onConflict: 'id' });
  }

  // Sync templates
  const templates = await db.getAllAsync<any>('SELECT * FROM templates');
  for (const t of templates) {
    await supabase.from('templates').upsert({
      id: t.id,
      name: t.name,
    }, { onConflict: 'id' });
  }

  // Sync template_exercises
  const templateExercises = await db.getAllAsync<any>('SELECT * FROM template_exercises');
  for (const te of templateExercises) {
    await supabase.from('template_exercises').upsert({
      id: te.id,
      template_id: te.template_id,
      exercise_id: te.exercise_id,
      sort_order: te.sort_order,
      default_sets: te.default_sets,
    }, { onConflict: 'id' });
  }

  // Sync workouts
  const workouts = await db.getAllAsync<any>('SELECT * FROM workouts WHERE finished_at IS NOT NULL');
  for (const w of workouts) {
    await supabase.from('workouts').upsert({
      id: w.id,
      template_id: w.template_id,
      started_at: w.started_at,
      finished_at: w.finished_at,
      ai_summary: w.ai_summary,
      notes: w.notes,
    }, { onConflict: 'id' });
  }

  // Sync workout_sets
  const sets = await db.getAllAsync<any>('SELECT * FROM workout_sets');
  for (const s of sets) {
    await supabase.from('workout_sets').upsert({
      id: s.id,
      workout_id: s.workout_id,
      exercise_id: s.exercise_id,
      set_number: s.set_number,
      reps: s.reps,
      weight: s.weight,
      tag: s.tag,
      rpe: s.rpe,
      is_completed: !!s.is_completed,
      notes: s.notes,
    }, { onConflict: 'id' });
  }
}

export async function pullUpcomingWorkout() {
  const db = await getDb();

  // Get latest upcoming workout from Supabase
  const { data: upcoming } = await supabase
    .from('upcoming_workouts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!upcoming) return;

  // Clear local upcoming workouts
  await db.runAsync('DELETE FROM upcoming_workout_sets');
  await db.runAsync('DELETE FROM upcoming_workout_exercises');
  await db.runAsync('DELETE FROM upcoming_workouts');

  // Insert the upcoming workout
  await db.runAsync(
    'INSERT INTO upcoming_workouts (id, date, template_id, notes, created_at) VALUES (?, ?, ?, ?, ?)',
    upcoming.id, upcoming.date, upcoming.template_id, upcoming.notes, upcoming.created_at,
  );

  // Fetch and insert exercises
  const { data: exercises } = await supabase
    .from('upcoming_workout_exercises')
    .select('*')
    .eq('upcoming_workout_id', upcoming.id)
    .order('sort_order');

  for (const ex of exercises ?? []) {
    await db.runAsync(
      'INSERT INTO upcoming_workout_exercises (id, upcoming_workout_id, exercise_id, sort_order, rest_seconds, notes) VALUES (?, ?, ?, ?, ?, ?)',
      ex.id, ex.upcoming_workout_id, ex.exercise_id, ex.sort_order, ex.rest_seconds, ex.notes,
    );

    // Fetch and insert sets
    const { data: sets } = await supabase
      .from('upcoming_workout_sets')
      .select('*')
      .eq('upcoming_exercise_id', ex.id)
      .order('set_number');

    for (const s of sets ?? []) {
      await db.runAsync(
        'INSERT INTO upcoming_workout_sets (id, upcoming_exercise_id, set_number, target_weight, target_reps) VALUES (?, ?, ?, ?, ?)',
        s.id, s.upcoming_exercise_id, s.set_number, s.target_weight, s.target_reps,
      );
    }
  }
}
```

**Step 2: Trigger sync on app startup and workout finish**

This will be wired in Task 10 (WorkoutScreen changes). For now, just export the functions.

**Step 3: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/services/sync.ts
git commit -m "feat: add Supabase sync service for push/pull"
```

---

### Task 10: Phone App — Wire Sync + Upcoming Workout into WorkoutScreen

**Files:**
- Modify: `src/screens/WorkoutScreen.tsx`

**Step 1: Add sync on app focus**

Import sync functions:
```typescript
import { syncToSupabase, pullUpcomingWorkout } from '../services/sync';
import { getUpcomingWorkoutForToday } from '../services/database';
```

In the `useFocusEffect` that runs on tab focus, add:
```typescript
// Pull upcoming workout from Supabase
pullUpcomingWorkout().then(() => {
  getUpcomingWorkoutForToday().then(setUpcomingWorkout);
}).catch(console.error);
```

Add state:
```typescript
const [upcomingWorkout, setUpcomingWorkout] = useState<Awaited<ReturnType<typeof getUpcomingWorkoutForToday>>>(null);
```

**Step 2: Add "Workout Ready" card to idle state**

When `upcomingWorkout` exists, show a prominent card above the template list:

```typescript
{upcomingWorkout && (
  <TouchableOpacity style={styles.upcomingCard} onPress={() => startFromUpcoming()}>
    <Text style={styles.upcomingTitle}>Workout Ready</Text>
    <Text style={styles.upcomingSubtitle}>
      {upcomingWorkout.exercises.length} exercises
      {upcomingWorkout.workout.notes ? ` · ${upcomingWorkout.workout.notes}` : ''}
    </Text>
    <Text style={styles.upcomingBtn}>Start Workout</Text>
  </TouchableOpacity>
)}
```

**Step 3: Implement startFromUpcoming()**

This function starts a workout from the upcoming workout data, pre-loading exercise blocks with target data:

```typescript
const startFromUpcoming = async () => {
  if (!upcomingWorkout) return;
  const workout = await startWorkout(upcomingWorkout.workout.template_id);
  // Set up exercise blocks with targets from upcoming workout
  // Store targets in a ref/state so the TARGET column can display them
  setActiveWorkout(workout);
  setUpcomingTargets(upcomingWorkout.exercises);
};
```

**Step 4: Add TARGET column to set rows**

In the active workout set row rendering, add a TARGET column between PREV and LB:

```typescript
// Find target for this exercise/set
const target = upcomingTargets
  ?.find(e => e.exercise_id === exercise.id)
  ?.sets?.find(s => s.set_number === set.set_number);

// In the row JSX, add after PREV column:
{target && (
  <Text style={styles.targetText}>
    {target.target_weight}×{target.target_reps}
  </Text>
)}
```

Style `targetText`: `color: colors.primaryLight`, `opacity: 0.5`, `fontSize: 12`.

**Step 5: Sync completed workout to Supabase on finish**

In the finish workout handler, after saving locally:

```typescript
syncToSupabase().catch(console.error);
```

**Step 6: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 7: Commit**

```bash
git add src/screens/WorkoutScreen.tsx
git commit -m "feat: add upcoming workout card + TARGET column + Supabase sync"
```

---

### Task 11: Phone App — Add Sync on Workout Finish + App Entry

**Files:**
- Modify: `App.tsx` or main entry file

**Step 1: Add background sync on app start**

In the main App component or root layout, add an effect:

```typescript
import { syncToSupabase, pullUpcomingWorkout } from './src/services/sync';

useEffect(() => {
  // Push local data to Supabase, then pull upcoming workout
  syncToSupabase()
    .then(() => pullUpcomingWorkout())
    .catch(console.error);
}, []);
```

**Step 2: Verify it compiles**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add App.tsx
git commit -m "feat: trigger Supabase sync on app startup"
```

---

### Task 12: Full Type Check + Integration Test

**Files:**
- All modified files

**Step 1: Run full type check on phone app**

Run: `cd /Users/sachitgoyal/code/workout-enhanced && npx tsc --noEmit`

Fix any remaining type errors.

**Step 2: Run full type check on MCP server**

Run: `cd /Users/sachitgoyal/code/workout-mcp-server && npx tsc`

Fix any remaining type errors.

**Step 3: Test MCP server manually**

1. Open Claude Desktop
2. Ask: "What exercises do I have?" → should call `get_exercise_list`
3. Ask: "Show me my last 5 workouts" → should call `get_workout_history`
4. Ask: "Create an upcoming workout for tomorrow with bench press 3×145lb" → should call `create_upcoming_workout`
5. Open phone app → should see "Workout Ready" card

**Step 4: Final commit**

```bash
cd /Users/sachitgoyal/code/workout-enhanced
git add -A
git commit -m "feat: complete MCP AI Coach integration"
```

---

### Task 13: Update CLAUDE.md

**Files:**
- Modify: `/Users/sachitgoyal/code/workout-enhanced/CLAUDE.md`

**Step 1: Update documentation**

Add/update these sections:
- Remove AI Integration section (no more OpenRouter/ai.ts)
- Add MCP AI Coach section: explain the architecture (phone → Supabase ← MCP server → Claude Desktop)
- Add Supabase Sync section: describe sync.ts push/pull
- Add Upcoming Workouts section: describe the 3 new tables and getUpcomingWorkoutForToday()
- Update Templates section: no more default_reps/default_weight
- Update Workout Screen section: mention TARGET column, upcoming workout card
- Update Building & Running: mention MCP server location and build steps

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for MCP AI Coach architecture"
```
