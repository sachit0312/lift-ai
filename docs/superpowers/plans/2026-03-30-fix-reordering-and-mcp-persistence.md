# Fix Reordering & MCP Persistence Issues

**Date:** 2026-03-30
**Scope:** MCP write tools (lift-ai-mcp), app sync layer (lift-ai), template/upcoming workout ordering

## Problem Summary

Three categories of bugs affecting exercise ordering:

1. **MCP template updates silently fail** — write tools report success even when 0 rows are affected
2. **Sync race condition** — app push overwrites MCP-made sort_order changes in Supabase
3. **MCP read tools return unordered data** — missing explicit ORDER BY on template exercises and upcoming workouts

## Steps

### Step 1: MCP — Add row-count validation to all write tools

**Files:**
- `lift-ai-mcp/src/tools/write/templates.ts`

**Changes:**

1. **`reorder_template_exercises`** (lines 209-216): Pre-validate that all exercise_ids exist in the template before reordering. After updates, verify affected row count matches input length.
   ```typescript
   // Before reordering, fetch existing template_exercises
   const { data: existing } = await supabase
     .from('template_exercises')
     .select('exercise_id')
     .eq('template_id', template_id);
   const existingIds = new Set(existing?.map(e => e.exercise_id));
   const missing = exercise_ids.filter(id => !existingIds.has(id));
   if (missing.length > 0) {
     return err(`Exercises not found in template: ${missing.join(', ')}`);
   }
   ```
   For each update, use `.select('id')` and verify data is returned. Track affected count and report accurately.

2. **`update_template`** (lines 137-152): Same pattern — pre-validate exercise_ids exist, add `.select('id')` to each update, report actual vs requested update counts. Consolidate the two `updated_at` writes into a single one at the end.

3. **`update_template_exercise_rest`** (lines 183-188): Add `.select('id').single()` after update. Return error if no row matched.

4. **`add_exercise_to_template`** (lines 35-38): Add `.select('id').single()` after insert to verify row was created.

5. **`remove_exercise_from_template`** (lines 71-76): Already validates existence via `.single()` check before delete. OK as-is.

**Tests:** None needed for MCP (no test infra beyond schema validation).

---

### Step 2: MCP — Add row-count validation to upcoming workout and exercise write tools

**Files:**
- `lift-ai-mcp/src/tools/write/upcoming.ts`
- `lift-ai-mcp/src/tools/write/exercises.ts`

**Changes:**

1. **`create_upcoming_workout`** (upcoming.ts lines 40-110):
   - Pre-validate all exercise_ids exist in the exercises table before inserting.
   - After exercise insert, verify `insertedExercises.length === exerciseRows.length`.
   - After sets insert, verify affected count.
   - Change exercises insert `.select('id, sort_order')` to `.select('id, sort_order').order('sort_order')` to guarantee mapping order.

2. **`create_exercise`** (exercises.ts): Add `.select('id').single()` after exercise insert. Verify notes upsert with `.select('id')`.

3. **`update_exercise`** (exercises.ts): Add `.select('id')` validation after definition update and notes upsert. Return error message listing which operations failed vs succeeded.

---

### Step 3: MCP — Add explicit ORDER BY to all read tools returning ordered data

**Files:**
- `lift-ai-mcp/src/tools/read/templates.ts`
- `lift-ai-mcp/src/tools/read/upcoming.ts`

**Changes:**

1. **`get_template`** (templates.ts): The nested `template_exercises(...)` select needs explicit ordering. Use Supabase's nested ordering syntax:
   ```typescript
   .select('id, name, template_exercises(id, exercise_id, sort_order, ...)')
   .order('sort_order', { referencedTable: 'template_exercises' })
   ```

2. **`get_all_templates`** (templates.ts): Same nested ordering for template_exercises.

3. **`get_upcoming_workout`** (upcoming.ts): Add ordering for exercises by sort_order and sets by set_number:
   ```typescript
   .order('sort_order', { referencedTable: 'upcoming_workout_exercises' })
   .order('set_number', { referencedTable: 'upcoming_workout_sets' })
   ```

4. **`get_exercise_history`** and **`get_workout_detail`**: Verify these already have explicit ORDER BY for exercise_order and set_number. Fix if missing.

---

### Step 4: App — Add `updated_at` timestamp comparison to sync pull for template exercises

**Files:**
- `src/services/sync.ts`
- `src/services/database.ts`

**Changes:**

The core sync race condition: app pushes stale local sort_order, overwriting MCP-made changes in Supabase. Fix by making the push smarter about template_exercises:

1. **Add `updated_at` column to local `template_exercises` table** (database.ts `initSchema`):
   ```sql
   ALTER TABLE template_exercises ADD COLUMN updated_at TEXT;
   ```
   Migration file: `supabase/migrations/008_template_exercises_updated_at.sql`

2. **During sync push** (sync.ts `syncToSupabase`): For template_exercises, instead of blind upsert, use Supabase's `ON CONFLICT` with `updated_at` comparison. Only update if local `updated_at` >= remote `updated_at`. This prevents stale local data from overwriting newer MCP changes.

   Alternatively (simpler approach): **Pull before push for template_exercises.** In `syncToSupabase()`, pull template_exercises first, merge locally (remote wins on sort_order if remote `updated_at` is newer), then push the merged result.

3. **MCP write tools** (already in Step 1): Ensure `updated_at` is set on the `templates` table when exercises are modified. Already done.

4. **During sync pull** (sync.ts `pullExercisesAndTemplates`): Already handles `sort_order` via upsert. No changes needed for pull.

**Simpler alternative for Step 4 (recommended):** Skip the `updated_at` column. Instead, **change sync push to NOT push `sort_order` for template_exercises**. The MCP is the authority for template order. The app's drag-to-reorder already does a fire-and-forget push immediately after the drag. The sync push shouldn't overwrite it again.

Concretely: In `syncToSupabase()`, exclude `sort_order` from the template_exercises upsert columns. The sort_order column will only be written by:
- Drag-to-reorder (immediate push with new sort_order)
- MCP tools (direct Supabase writes)
- App pull (upserts remote sort_order locally)

This eliminates the race where a bulk sync push reverts MCP changes.

---

### Step 5: App — Fix `remove_exercise_from_template` sort_order gap compaction

**Files:**
- `src/services/database.ts`

**Changes:**

After removing a template exercise, re-compact sort_order to eliminate gaps:

```typescript
// In deleteTemplateExercise (or wherever removal happens):
// After DELETE, re-compact:
const remaining = await database.getAllAsync<{ id: string }>(
  'SELECT id FROM template_exercises WHERE template_id = ? ORDER BY sort_order', templateId
);
await database.withTransactionAsync(async () => {
  for (let i = 0; i < remaining.length; i++) {
    await database.runAsync(
      'UPDATE template_exercises SET sort_order = ? WHERE id = ?', i, remaining[i].id
    );
  }
});
```

Also do the same in the MCP `remove_exercise_from_template` tool.

---

### Step 6: MCP — Re-compact sort_order after exercise removal

**Files:**
- `lift-ai-mcp/src/tools/write/templates.ts`

**Changes:**

In `remove_exercise_from_template`, after deleting the row, re-compact sort_order for remaining exercises:

```typescript
// After successful delete:
const { data: remaining } = await supabase
  .from('template_exercises')
  .select('id, sort_order')
  .eq('template_id', template_id)
  .order('sort_order');

if (remaining && remaining.length > 0) {
  await Promise.all(remaining.map((row, i) =>
    supabase.from('template_exercises').update({ sort_order: i }).eq('id', row.id)
  ));
}
```

---

### Step 7: Verify all changes with existing tests + manual smoke test

**Files:** Test files

**Changes:**

1. Run existing `setDiff.test.ts` tests to ensure template update plan logic still works.
2. Run existing `sync.test.ts` tests to ensure sync changes don't break.
3. Run the new `useSetCompletion.test.ts` tests (22 tests) to confirm auto-reorder behavior documented.
4. Run full test suite: `npx jest --testPathIgnorePatterns='/node_modules/' --testPathIgnorePatterns='src/__tests__/helpers/' --forceExit`

## Verification

- MCP `reorder_template_exercises` with invalid exercise_id returns error (not success)
- MCP `update_template` with nonexistent exercise_id returns error listing failures
- MCP `get_template` returns exercises in sort_order sequence
- App sync push does NOT overwrite sort_order set by MCP
- After removing an exercise from template, sort_order is contiguous (0, 1, 2, ...)
- All 22 useSetCompletion auto-reorder tests pass
- Full test suite passes

## File Change Summary

| File | Changes |
|------|---------|
| `lift-ai-mcp/src/tools/write/templates.ts` | Steps 1, 6: row validation + sort_order compaction |
| `lift-ai-mcp/src/tools/write/upcoming.ts` | Step 2: row validation + ordered select |
| `lift-ai-mcp/src/tools/write/exercises.ts` | Step 2: row validation |
| `lift-ai-mcp/src/tools/read/templates.ts` | Step 3: explicit ORDER BY |
| `lift-ai-mcp/src/tools/read/upcoming.ts` | Step 3: explicit ORDER BY |
| `src/services/sync.ts` | Step 4: exclude sort_order from push |
| `src/services/database.ts` | Step 5: sort_order compaction on remove |
| `supabase/migrations/008_...sql` | Step 4: (only if timestamp approach chosen) |
