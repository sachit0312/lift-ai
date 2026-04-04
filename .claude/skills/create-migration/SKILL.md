---
name: create-migration
description: "Create a new Supabase SQL migration file with auto-numbering. Use when adding/altering database tables or columns."
---

# Create Supabase Migration

## Steps

1. **Determine next migration number**: List `supabase/migrations/` and increment the highest `NNN_` prefix (zero-padded to 3 digits).

2. **Generate the migration file**: Create `supabase/migrations/{NNN}_{descriptive_name}.sql` with:
   - A comment header: `-- Migration: {NNN}_{name}`
   - The SQL statements (CREATE TABLE, ALTER TABLE, CREATE INDEX, RLS policies, etc.)
   - Use `IF NOT EXISTS` / `IF EXISTS` guards where appropriate

3. **Dual-environment reminder**: After creating the file, output this checklist:

```
## Migration Checklist

- [ ] Run on **dev** Supabase (ref: gcpnqpqqwcwvyzoivolp) via SQL Editor
- [ ] Run on **prod** Supabase (ref: lgnkxjiqzsqiwrqrsxww) via SQL Editor
- [ ] Update `src/services/database.ts` — table creation, new queries, row mappers
- [ ] Update `src/services/sync.ts` — push/pull for new columns
- [ ] Update `src/types/database.ts` — TypeScript types
- [ ] Update MCP server if the new data should be accessible to AI coach
- [ ] Update CLAUDE.md Architecture section with schema changes
```

4. **Sync code impact**: If the migration adds columns that are synced, remind about:
   - Adding the column to the relevant `syncToSupabase()` push
   - Adding the column to the relevant `pull*()` function
   - Handling the column in `upsert` statements (not overwriting with defaults)

## Naming Convention

Use lowercase snake_case: `012_add_workout_tags.sql`, `013_exercise_categories.sql`

## Important

- Never wrap concurrent pull operations in `withTransactionAsync` (see CLAUDE.md sync section)
- Global exercises (user_id=NULL) are NOT pushed to Supabase
- `user_exercise_notes` is the table for per-user exercise metadata (not the exercises table)
