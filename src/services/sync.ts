import * as Sentry from '@sentry/react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  getDb,
  clearLocalUpcomingWorkout,
  getCurrentUserGeneration,
  runInTransaction,
} from './database';

function handleSyncError(label: string, error: unknown): void {
  if (__DEV__) console.error(`Sync ${label} error:`, error);
  Sentry.captureException(error);
}

/**
 * Serialize a JSONB-shaped value into the TEXT representation SQLite expects.
 * Supabase returns JSONB columns as parsed JS (arrays/objects); naive binding
 * coerces them via toString to "[object Object]" or "a,b,c". This normalizes:
 *   - null/undefined → null
 *   - strings (already JSON) → unchanged
 *   - everything else → JSON.stringify(value)
 */
export function jsonbToText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Inverse of jsonbToText: parse a SQLite TEXT value into a JS value before
 * sending to Supabase, so the JSONB column receives a real object/array
 * (not a stringified blob). Returns null for null/empty/invalid input.
 */
export function textToJsonb(value: string | null): unknown {
  if (value == null) return null;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * PostgREST's default URL length cap is ~8KB. At 36 chars per UUID plus
 * encoding, ~50 IDs per .in() is a safe upper bound that leaves headroom
 * for other query params and headers.
 */
const IN_CHUNK_SIZE = 50;

/**
 * Deduplicates concurrent invocations of a pull: a second caller awaits the first instead of
 * starting a competing run.
 *
 * The sign-in flow races its pull chain against a 30s timeout, but Promise.race only settles the
 * outer promise — the inner pull keeps going. Auth reconciliation stays fail-closed and holds its
 * queue until that work quiesces; this dedupe also prevents background callers from starting a
 * competing pull for the same user while it remains in flight.
 */
const inFlightPulls = new Map<string, Promise<void>>();

async function dedupePull(key: string, run: () => Promise<void>): Promise<void> {
  // Key by session user, not just by pull name. The sign-in race above does not CANCEL the
  // timed-out chain — it keeps running under the old session. Without the user in the key, a
  // subsequent account switch would dedupe the new user's pull onto that stale promise, which
  // queries under the previous user_id, legitimately returns zero rows, and resolves
  // "successfully" having written nothing for the new user — with no error anywhere.
  //
  // The lookup is guarded: best-effort public pulls report failures and resolve, while strict
  // auth pulls reject. A failing getSession here must fall through to the wrapped run(), which
  // preserves whichever error contract its caller selected.
  let sessionUserId = 'anon';
  try {
    const { data: { session } } = await supabase.auth.getSession();
    sessionUserId = session?.user?.id ?? 'anon';
  } catch {
    // Leave 'anon'; run() surfaces the real failure.
  }
  const scopedKey = `${key}:${sessionUserId}`;

  const existing = inFlightPulls.get(scopedKey);
  if (existing) return existing;
  const started = run().finally(() => { inFlightPulls.delete(scopedKey); });
  inFlightPulls.set(scopedKey, started);
  return started;
}

/** Rows per page when pulling workout history, and a hard stop so a bad response can't spin. */
const PULL_PAGE_SIZE = 200;
const MAX_PULL_PAGES = 50;

/** Rows per local write transaction during a history import. Bounds how long any single
 *  transaction holds the SQLite write connection while still batching fsyncs. */
const WRITE_CHUNK_SIZE = 500;

/** Rows per upsert request when pushing. Keeps a single payload from growing unbounded
 *  with history — the full set corpus is re-pushed on every sync trigger. */
const UPSERT_CHUNK_SIZE = 500;

/** Upserts `rows` in fixed-size batches, reporting the first failure per batch. */
async function upsertInChunks<T>(
  table: string,
  rows: T[],
  onConflict: string,
  label: string,
  canContinue?: () => boolean,
): Promise<boolean> {
  let ok = true;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    if (canContinue && !canContinue()) return false;
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + UPSERT_CHUNK_SIZE), { onConflict });
    if (error) { handleSyncError(label, error); ok = false; }
  }
  return ok;
}

export function fireAndForgetSync(): void {
  syncToSupabase().catch(() => {});
}

// ─── Row Interfaces (raw SQLite rows for sync queries) ───

/** Exercise row for sync — subset of columns selected */
interface SyncExerciseRow {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  muscle_groups: string;
  training_goal: string;
  description: string;
}

/** User exercise notes row for sync */
interface SyncExerciseNotesRow {
  exercise_id: string;
  form_notes: string | null;
  machine_notes: string | null;
}

/** Template row for sync — subset of columns selected */
interface SyncTemplateRow {
  id: string;
  name: string;
}

/** Template exercise row for sync — subset of columns selected.
 *  sort_order intentionally excluded — pushed only by explicit reorder operations
 *  (drag-to-reorder, F5 template update) to prevent overwriting MCP changes. */
interface SyncTemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  default_sets: number;
  warmup_sets: number;
  rest_seconds: number;
}

/** Workout row for sync — subset of columns selected */
interface SyncWorkoutRow {
  id: string;
  template_id: string | null;
  upcoming_workout_id: string | null;
  started_at: string;
  finished_at: string | null;
  coach_notes: string | null;
  exercise_coach_notes: string | null;
  session_notes: string | null;
  planned_exercise_ids: string | null;
}

/** Workout set row for sync — is_completed is 0/1 integer in SQLite */
interface SyncWorkoutSetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  tag: string;
  rpe: number | null;
  is_completed: number;
  notes: string | null;
  target_weight: number | null;
  target_reps: number | null;
  target_rpe: number | null;
  exercise_order: number;
  programmed_order: number | null;
}

let inFlightPush: Promise<void> | null = null;
let pushRequested = false;

function authGeneration(): number {
  // Some narrowly mocked pull-only test modules do not provide the new optional signal.
  return getCurrentUserGeneration?.() ?? 0;
}

/**
 * Coalesces all callers onto one dirty drain. A call made after a pass has snapshotted local rows
 * leaves pushRequested set, so the drain takes one more snapshot before resolving every caller.
 */
export function syncToSupabase(): Promise<void> {
  pushRequested = true;
  if (!inFlightPush) {
    inFlightPush = drainPushes();
  }
  return inFlightPush;
}

async function drainPushes(): Promise<void> {
  // A caller can mark this drain dirty before AuthContext has reset SQLite for an account
  // switch. The entire drain therefore belongs to the generation that started it: it must
  // never turn that pre-reset request into a push of the next account's in-progress local rows.
  const expectedGeneration = authGeneration();
  try {
    while (pushRequested && authGeneration() === expectedGeneration) {
      pushRequested = false;
      try {
        await pushToSupabase(expectedGeneration);
      } catch (err) {
        // Sync is best-effort. Keep a request that arrived during this failed pass dirty so it
        // receives its own trailing snapshot, rather than clearing it in the drain cleanup.
        handleSyncError('syncToSupabase', err);
      }
    }
  } finally {
    // Requests made under a newer auth generation cannot safely run until AuthContext finishes
    // account isolation and issues a fresh sync request.
    if (authGeneration() !== expectedGeneration) {
      pushRequested = false;
    }
    // This executes synchronously when the final pass settles. A later caller sees null and
    // starts a fresh drain instead of setting a dirty bit on a promise that is about to resolve.
    inFlightPush = null;
  }
}

async function pushToSupabase(expectedGeneration: number): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const canContinue = () => authGeneration() === expectedGeneration;
    if (!session || !canContinue()) return;

    const db = await getDb();
    if (!canContinue()) return;

    // Self-healing rescue: any rows written under the default 'local' user
    // (e.g., during a race with AuthContext propagation) get rewritten to the
    // real session user id so they're picked up by the push queries below.
    try {
      // user_exercise_notes has PRIMARY KEY (user_id, exercise_id), so a 'local' row
      // can collide with an existing real-user row on the same exercise.
      //
      // These are MERGED per-column, not replaced wholesale. upsertExerciseNote writes
      // one field at a time, so a 'local' row usually carries a value in exactly one of
      // form_notes/machine_notes and NULL in the other. Deleting the real-user row and
      // promoting the local one in its place therefore destroyed whatever the user had
      // in the sibling column — and pushed that null on to Supabase. COALESCE keeps the
      // local value where it has one and falls back to the existing value otherwise.
      //
      // Wrapped in a transaction so the merge and the cleanup delete cannot half-apply
      // and strand rows under 'local' or lose the real-user row entirely.
      await runInTransaction(db, async () => {
        await db.runAsync(
          `INSERT INTO user_exercise_notes (user_id, exercise_id, form_notes, machine_notes)
           SELECT ?, exercise_id, form_notes, machine_notes
             FROM user_exercise_notes WHERE user_id = 'local'
           ON CONFLICT(user_id, exercise_id) DO UPDATE SET
             form_notes = COALESCE(excluded.form_notes, user_exercise_notes.form_notes),
             machine_notes = COALESCE(excluded.machine_notes, user_exercise_notes.machine_notes)`,
          session.user.id,
        );
        await db.runAsync(`DELETE FROM user_exercise_notes WHERE user_id = 'local'`);
        // exercises.id is the sole primary key, so user_id can be rewritten freely.
        await db.runAsync(
          `UPDATE exercises SET user_id = ? WHERE user_id = 'local'`,
          session.user.id,
        );
      });
    } catch (err) {
      handleSyncError('rescue local rows', err);
    }
    if (!canContinue()) return;

    // Each sync step runs independently — one step's failure must not block others.
    // Exercises — only push custom exercises (global exercises have user_id = NULL)
    const exercises = await db.getAllAsync<SyncExerciseRow>(
      'SELECT id, user_id, name, type, muscle_groups, training_goal, description FROM exercises WHERE user_id IS NOT NULL'
    );
    if (!canContinue()) return;
    if (exercises.length > 0) {
      const parsed = exercises.map((e: SyncExerciseRow) => ({
        id: e.id,
        user_id: session.user.id,
        name: e.name,
        type: e.type,
        muscle_groups: JSON.parse(e.muscle_groups || '[]'),
        training_goal: e.training_goal,
        description: e.description,
      }));
      const { error } = await supabase.from('exercises').upsert(parsed, { onConflict: 'id' });
      if (error) handleSyncError('exercises', error);
    }
    if (!canContinue()) return;

    // User exercise notes — push all (use session.user.id, not getCurrentUserId(), to avoid stale 'local' on token refresh)
    const noteRows = await db.getAllAsync<SyncExerciseNotesRow>(
      'SELECT exercise_id, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ?',
      session.user.id,
    );
    if (!canContinue()) return;
    if (noteRows.length > 0) {
      const mappedNotes = noteRows.map(n => ({
        user_id: session.user.id,
        exercise_id: n.exercise_id,
        form_notes: n.form_notes,
        machine_notes: n.machine_notes,
      }));
      const { error: notesErr } = await supabase.from('user_exercise_notes').upsert(mappedNotes, { onConflict: 'user_id,exercise_id' });
      if (notesErr) handleSyncError('user_exercise_notes', notesErr);
    }
    if (!canContinue()) return;

    // Templates — select specific columns
    const templates = await db.getAllAsync<SyncTemplateRow>('SELECT id, name FROM templates');
    if (!canContinue()) return;
    if (templates.length > 0) {
      const mapped = templates.map((t: SyncTemplateRow) => ({ ...t, user_id: session.user.id }));
      const { error } = await supabase.from('templates').upsert(mapped, { onConflict: 'id' });
      if (error) handleSyncError('templates', error);
    }
    if (!canContinue()) return;

    // Template exercises — select specific columns (sort_order excluded — pushed only by explicit reorder ops)
    const templateExercises = await db.getAllAsync<SyncTemplateExerciseRow>('SELECT id, template_id, exercise_id, default_sets, warmup_sets, rest_seconds FROM template_exercises');
    if (!canContinue()) return;
    if (templateExercises.length > 0) {
      const { error } = await supabase.from('template_exercises').upsert(templateExercises, { onConflict: 'id' });
      if (error) handleSyncError('template_exercises', error);
    }
    if (!canContinue()) return;

    // Workouts (only finished) — select specific columns
    let workoutsOk = true;
    const workouts = await db.getAllAsync<SyncWorkoutRow>('SELECT id, template_id, upcoming_workout_id, started_at, finished_at, coach_notes, exercise_coach_notes, session_notes, planned_exercise_ids FROM workouts WHERE finished_at IS NOT NULL');
    if (!canContinue()) return;
    if (workouts.length > 0) {
      const mappedWorkouts = workouts.map((w: SyncWorkoutRow) => ({
        ...w,
        user_id: session.user.id,
        // Nullify upcoming_workout_id — the referenced upcoming_workout is ephemeral
        // and may have been deleted by create_upcoming_workout before this sync runs,
        // which would cause an FK constraint violation on insert.
        upcoming_workout_id: null,
        // JSONB columns must be sent as JS values, not stringified text, so
        // Supabase stores structured data (not a quoted blob).
        exercise_coach_notes: textToJsonb(w.exercise_coach_notes),
        planned_exercise_ids: textToJsonb(w.planned_exercise_ids),
      }));
      workoutsOk = await upsertInChunks('workouts', mappedWorkouts, 'id', 'workouts', canContinue);
    }
    if (!canContinue()) return;

    // Workout sets — only attempt if workouts upsert succeeded (FK dependency on workout_id)
    if (workoutsOk) {
      const workoutSets = await db.getAllAsync<SyncWorkoutSetRow>(
        `SELECT ws.id, ws.workout_id, ws.exercise_id, ws.set_number, ws.reps, ws.weight, ws.tag, ws.rpe, ws.notes, ws.is_completed, ws.target_weight, ws.target_reps, ws.target_rpe, ws.exercise_order, ws.programmed_order
         FROM workout_sets ws
         JOIN workouts w ON ws.workout_id = w.id
         WHERE w.finished_at IS NOT NULL`
      );
      if (!canContinue()) return;
      if (workoutSets.length > 0) {
        const mapped = workoutSets.map((s: SyncWorkoutSetRow) => ({
          ...s,
          is_completed: !!s.is_completed,
        }));
        await upsertInChunks('workout_sets', mapped, 'id', 'workout_sets', canContinue);
      }
    }

    if (__DEV__) console.log('Sync to Supabase complete');
  } catch (err) {
    throw err;
  }
}

/**
 * Push exactly the rows needed for one newly-added template exercise, in FK order.
 *
 * Callers need this durable BEFORE they navigate away, because pullTemplates deletes any local
 * template_exercise whose id is absent from Supabase — so an unpushed row is indistinguishable
 * from one MCP deleted, and the next WorkoutScreen focus silently removes it.
 *
 * Deliberately NOT syncToSupabase(): that pushes the user's entire finished-workout corpus
 * (every workout and every set, with no dirty tracking), which is seconds of upload on a slow
 * connection to persist a single row, blocking a tap the whole time.
 *
 * Returns false if the push could not be completed, so the caller can decide whether to warn.
 */
export async function pushTemplateExercise(templateExerciseId: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;

    const db = await getDb();

    const row = await db.getFirstAsync<{
      id: string;
      template_id: string;
      exercise_id: string;
      default_sets: number;
      warmup_sets: number;
      rest_seconds: number;
      sort_order: number;
      template_name: string;
      exercise_user_id: string | null;
    }>(
      `SELECT te.id, te.template_id, te.exercise_id, te.default_sets, te.warmup_sets,
              te.rest_seconds, te.sort_order,
              t.name AS template_name, e.user_id AS exercise_user_id
         FROM template_exercises te
         JOIN templates t ON te.template_id = t.id
         JOIN exercises e ON te.exercise_id = e.id
        WHERE te.id = ?`,
      templateExerciseId,
    );
    if (!row) return false;

    // 1. Custom exercise first — template_exercises.exercise_id references it. Global
    //    exercises (user_id IS NULL) already exist remotely and are never pushed.
    if (row.exercise_user_id !== null) {
      const ex = await db.getFirstAsync<SyncExerciseRow>(
        'SELECT id, user_id, name, type, muscle_groups, training_goal, description FROM exercises WHERE id = ?',
        row.exercise_id,
      );
      if (ex) {
        const { error } = await supabase.from('exercises').upsert({
          id: ex.id,
          user_id: session.user.id,
          name: ex.name,
          type: ex.type,
          muscle_groups: JSON.parse(ex.muscle_groups || '[]'),
          training_goal: ex.training_goal,
          description: ex.description,
        }, { onConflict: 'id' });
        if (error) { handleSyncError('pushTemplateExercise: exercise', error); return false; }
      }

      // Notes live in a separate table and are only present if the user wrote any.
      const note = await db.getFirstAsync<SyncExerciseNotesRow>(
        'SELECT exercise_id, form_notes, machine_notes FROM user_exercise_notes WHERE user_id = ? AND exercise_id = ?',
        session.user.id, row.exercise_id,
      );
      if (note) {
        const { error } = await supabase.from('user_exercise_notes').upsert({
          user_id: session.user.id,
          exercise_id: note.exercise_id,
          form_notes: note.form_notes,
          machine_notes: note.machine_notes,
        }, { onConflict: 'user_id,exercise_id' });
        if (error) handleSyncError('pushTemplateExercise: notes', error);
      }
    }

    // 2. Template — may itself be local-only if it was just created.
    const { error: tErr } = await supabase.from('templates').upsert({
      id: row.template_id,
      user_id: session.user.id,
      name: row.template_name,
    }, { onConflict: 'id' });
    if (tErr) { handleSyncError('pushTemplateExercise: template', tErr); return false; }

    // 3. The link row itself. sort_order IS included here (unlike the bulk push, which omits
    //    it to avoid clobbering MCP reorders) because this row is brand new — its local
    //    sort_order is the only value that exists.
    const { error: teErr } = await supabase.from('template_exercises').upsert({
      id: row.id,
      template_id: row.template_id,
      exercise_id: row.exercise_id,
      sort_order: row.sort_order,
      default_sets: row.default_sets,
      warmup_sets: row.warmup_sets,
      rest_seconds: row.rest_seconds,
    }, { onConflict: 'id' });
    if (teErr) { handleSyncError('pushTemplateExercise: template_exercise', teErr); return false; }

    return true;
  } catch (err) {
    handleSyncError('pushTemplateExercise', err);
    return false;
  }
}

/** Push sort_order for a specific template to Supabase.
 *  Called after explicit reorder operations (drag-to-reorder, F5 template update).
 *  Separated from general sync to prevent stale sort_order from overwriting MCP changes. */
export async function pushTemplateOrderToSupabase(templateId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const db = await getDb();
    const rows = await db.getAllAsync<{ id: string; sort_order: number }>(
      'SELECT id, sort_order FROM template_exercises WHERE template_id = ?', templateId
    );
    if (rows.length === 0) return;
    // Individual updates — only sort_order should change; other columns are managed by general sync
    const results = await Promise.all(rows.map(row =>
      supabase.from('template_exercises').update({ sort_order: row.sort_order }).eq('id', row.id)
    ));
    for (const { error } of results) {
      if (error) {
        if (__DEV__) console.error('pushTemplateOrderToSupabase row error:', error);
        Sentry.captureException(error);
      }
    }
  } catch (e) {
    if (__DEV__) console.error('pushTemplateOrderToSupabase error:', e);
    Sentry.captureException(e);
  }
}

export async function deleteTemplateFromSupabase(templateId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', templateId)
      .eq('user_id', session.user.id);

    if (error) { handleSyncError('deleteTemplate', error); }
  } catch (err) {
    handleSyncError('deleteTemplateFromSupabase', err);
  }
}

export async function deleteTemplateExerciseFromSupabase(templateExerciseId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from('template_exercises')
      .delete()
      .eq('id', templateExerciseId);

    if (error) { handleSyncError('deleteTemplateExercise', error); }
  } catch (err) {
    handleSyncError('deleteTemplateExerciseFromSupabase', err);
  }
}

export async function deleteUpcomingWorkoutFromSupabase(upcomingWorkoutId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { error } = await supabase
      .from('upcoming_workouts')
      .delete()
      .eq('id', upcomingWorkoutId)
      .eq('user_id', session.user.id);

    if (error) { handleSyncError('deleteUpcomingWorkout', error); }
  } catch (err) {
    handleSyncError('deleteUpcomingWorkoutFromSupabase', err);
  }
}

// ─── Pull Row Interfaces (Supabase → local SQLite) ───

/** Exercise row from Supabase (muscle_groups is JSONB array) */
interface PullExerciseRow {
  id: string;
  user_id: string | null;
  name: string;
  type: string;
  muscle_groups: string[];
  training_goal: string;
  description: string;
  created_at: string;
}

/** Template row from Supabase */
interface PullTemplateRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** Template exercise row from Supabase (includes rest_seconds, warmup_sets) */
interface PullTemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  sort_order: number;
  default_sets: number;
  warmup_sets: number;
  rest_seconds: number;
}

// ─── Pull Exercises & Templates from Supabase ───

async function pullExercises(strict: boolean, expectedUserId?: string): Promise<void> {
  const session = sessionForPull(
    await supabase.auth.getSession(),
    strict,
    expectedUserId,
  );
  if (!session) return;

  const db = await getDb();

  const { data: exercises, error } = await supabase
    .from('exercises')
    .select('id, user_id, name, type, muscle_groups, training_goal, description, created_at');

  if (error) {
    if (strict) throw error;
    handleSyncError('pull exercises', error);
    return;
  }
  if (!exercises || exercises.length === 0) return;

  // One commit for the whole batch instead of a per-row fsync, matching pullWorkoutHistory.
  // Safe because the pull functions run sequentially (see pullExercisesAndTemplates and both
  // call sites) — there is no concurrent transaction on this connection. The network fetch
  // above is deliberately outside the transaction so we never hold the write lock over IO.
  await runInTransaction(db, async () => {
    for (const ex of exercises as PullExerciseRow[]) {
      await db.runAsync(
        `INSERT INTO exercises (id, user_id, name, type, muscle_groups, training_goal, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           user_id=excluded.user_id, name=excluded.name, type=excluded.type,
           muscle_groups=excluded.muscle_groups, training_goal=excluded.training_goal,
           description=excluded.description, created_at=excluded.created_at`,
        ex.id, ex.user_id, ex.name, ex.type,
        JSON.stringify(ex.muscle_groups ?? []),
        ex.training_goal, ex.description, ex.created_at,
      );
    }
  });

  // Pull user's exercise notes
  const { data: notes, error: notesErr } = await supabase
    .from('user_exercise_notes')
    .select('exercise_id, form_notes, machine_notes')
    .eq('user_id', session.user.id);

  if (notesErr) {
    if (strict) throw notesErr;
    handleSyncError('pull exercise notes', notesErr);
  } else if (notes && notes.length > 0) {
    await runInTransaction(db, async () => {
      for (const n of notes) {
        await db.runAsync(
          `INSERT INTO user_exercise_notes (user_id, exercise_id, form_notes, machine_notes)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, exercise_id) DO UPDATE SET
             form_notes=excluded.form_notes, machine_notes=excluded.machine_notes`,
          session.user.id, n.exercise_id, n.form_notes ?? null, n.machine_notes ?? null,
        );
      }
    });
  }

  if (__DEV__) console.log('Pull exercises complete');
}

async function pullTemplates(strict: boolean, expectedUserId?: string): Promise<void> {
  const session = sessionForPull(
    await supabase.auth.getSession(),
    strict,
    expectedUserId,
  );
  if (!session) return;

  const db = await getDb();

  const { data: templates, error: tErr } = await supabase
    .from('templates')
    .select('*')
    .eq('user_id', session.user.id);

  if (tErr) {
    if (strict) throw tErr;
    handleSyncError('pull templates', tErr);
    return;
  }
  if (!templates || templates.length === 0) return;

  const templateList = templates as PullTemplateRow[];
  const templateIds = templateList.map(t => t.id);

  // Upsert all templates — single commit (see the note in pullExercises).
  await runInTransaction(db, async () => {
    for (const t of templateList) {
      await db.runAsync(
        `INSERT INTO templates (id, user_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, name=excluded.name, updated_at=excluded.updated_at`,
        t.id, t.user_id, t.name, t.created_at, t.updated_at,
      );
    }
  });

  // Fetch all template_exercises in one query instead of per-template
  const { data: allTemplateExercises, error: teErr } = await supabase
    .from('template_exercises')
    .select('*')
    .in('template_id', templateIds)
    .order('sort_order');

  if (teErr) {
    if (strict) throw teErr;
    handleSyncError('pull template_exercises', teErr);
  } else {
    // Group by template_id
    const teByTemplate = new Map<string, PullTemplateExerciseRow[]>();
    for (const te of (allTemplateExercises ?? []) as PullTemplateExerciseRow[]) {
      if (!teByTemplate.has(te.template_id)) teByTemplate.set(te.template_id, []);
      teByTemplate.get(te.template_id)!.push(te);
    }

    await runInTransaction(db, async () => {
      for (const t of templateList) {
        const teList = teByTemplate.get(t.id) ?? [];

        // Delete template_exercises removed by MCP.
        //
        // This is destructive to rows that exist only locally, so every path that inserts a
        // template_exercise MUST push before a pull can run (see ExercisePickerScreen, which
        // fires a sync after addExerciseToTemplate for exactly this reason). A locally-added
        // row that has not reached Supabase yet is indistinguishable from one MCP deleted.
        if (teList.length > 0) {
          const placeholders = teList.map(() => '?').join(', ');
          await db.runAsync(
            `DELETE FROM template_exercises WHERE template_id = ? AND id NOT IN (${placeholders})`,
            t.id, ...teList.map(te => te.id),
          );
        } else {
          await db.runAsync('DELETE FROM template_exercises WHERE template_id = ?', t.id);
        }

        // Upsert each template_exercise, using Supabase rest_seconds + warmup_sets (MCP-editable)
        for (const te of teList) {
          await db.runAsync(
            `INSERT INTO template_exercises (id, template_id, exercise_id, sort_order, default_sets, warmup_sets, rest_seconds)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET sort_order=excluded.sort_order, default_sets=excluded.default_sets, warmup_sets=excluded.warmup_sets, rest_seconds=excluded.rest_seconds`,
            te.id, te.template_id, te.exercise_id, te.sort_order, te.default_sets, te.warmup_sets ?? 0, te.rest_seconds ?? 150,
          );
        }
      }
    });
  }

  if (__DEV__) console.log('Pull templates complete');
}

interface PullOptions {
  strict?: boolean;
  expectedUserId?: string;
}

function sessionForPull(
  result: { data: { session: Session | null }; error?: unknown | null },
  strict: boolean,
  expectedUserId?: string,
): Session | null {
  const { data: { session }, error } = result;
  if (!strict) return session;
  if (error) throw error;
  if (!session) throw new Error('Strict pull requires an authenticated session');
  if (!expectedUserId) throw new Error('Strict pull requires an expected user ID');
  if (session.user.id !== expectedUserId) {
    throw new Error('Strict pull session does not match expected user');
  }
  return session;
}

export function pullExercisesAndTemplates(options: PullOptions = {}): Promise<void> {
  const strict = options.strict ?? false;
  // A strict reconciliation must never inherit a best-effort pull that reported and swallowed
  // an error. Keep their in-flight contracts separate even though both are user-scoped.
  return dedupePull(`exercisesAndTemplates:${strict ? 'strict' : 'best-effort'}`, async () => {
    try {
      await pullExercises(strict, options.expectedUserId);   // exercises first (FK dependency)
      await pullTemplates(strict, options.expectedUserId);
    } catch (err) {
      if (strict) throw err;
      handleSyncError('pullExercisesAndTemplates', err);
    }
  });
}

/** Auth reconciliation needs a rejected promise whenever a pull fails. */
export function pullExercisesAndTemplatesStrict(expectedUserId: string): Promise<void> {
  return pullExercisesAndTemplates({ strict: true, expectedUserId });
}

// ─── Pull Workout History from Supabase ───

/** Finished workout row from Supabase */
interface PullWorkoutRow {
  id: string;
  user_id: string;
  template_id: string | null;
  upcoming_workout_id: string | null;
  started_at: string;
  finished_at: string;
  coach_notes: string | null;
  exercise_coach_notes: unknown; // Supabase JSONB → parsed JS object | null
  session_notes: string | null;
  planned_exercise_ids: unknown; // Supabase JSONB → parsed JS array | null
}

/** Workout set row from Supabase (is_completed is boolean in Supabase) */
/** Upcoming-workout set row from Supabase */
interface PullUpcomingSetRow {
  id: string;
  upcoming_exercise_id: string;
  set_number: number;
  target_weight: number | null;
  target_reps: number | null;
  target_rpe: number | null;
  tag: string | null;
}

interface PullWorkoutSetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  tag: string;
  rpe: number | null;
  is_completed: boolean;
  notes: string | null;
  target_weight: number | null;
  target_reps: number | null;
  target_rpe: number | null;
  exercise_order: number;
  programmed_order: number | null;
}

export function pullWorkoutHistory(options: PullOptions = {}): Promise<void> {
  const strict = options.strict ?? false;
  return dedupePull(
    `workoutHistory:${strict ? 'strict' : 'best-effort'}`,
    () => pullWorkoutHistoryInner(strict, options.expectedUserId),
  );
}

/** Auth reconciliation needs a rejected promise whenever a pull fails. */
export function pullWorkoutHistoryStrict(expectedUserId: string): Promise<void> {
  return pullWorkoutHistory({ strict: true, expectedUserId });
}

async function pullWorkoutHistoryInner(strict: boolean, expectedUserId?: string): Promise<void> {
  try {
    const session = sessionForPull(
      await supabase.auth.getSession(),
      strict,
      expectedUserId,
    );
    if (!session) return;

    const db = await getDb();

    // ── Network phase: fetch everything first, then commit in one transaction ──

    // Page through ALL finished workouts. This used to be a flat .limit(200), which meant
    // that after any resetDatabase() (sign-out/in, corruption recovery) the device held only
    // the 200 most recent sessions — and getBestE1RM / PR detection silently computed
    // "all-time" bests over that truncated corpus, so old PRs could reappear as beatable.
    const workouts: PullWorkoutRow[] = [];
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const from = page * PULL_PAGE_SIZE;
      const { data, error: wErr } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', session.user.id)
        .not('finished_at', 'is', null)
        .order('finished_at', { ascending: false })
        // `id` is a unique tiebreaker. Range pagination is only stable when the sort key is
        // unique — two workouts finished in the same second could otherwise be returned on
        // both pages or on neither, silently over- or under-importing history.
        .order('id', { ascending: false })
        .range(from, from + PULL_PAGE_SIZE - 1);

      if (wErr) {
        if (strict) throw wErr;
        handleSyncError('pull workouts', wErr);
        return;
      }
      if (!data || data.length === 0) break;
      workouts.push(...(data as PullWorkoutRow[]));
      if (data.length < PULL_PAGE_SIZE) break;

      if (page === MAX_PULL_PAGES - 1) {
        // Loud rather than silently truncating, which is the failure mode this replaced.
        const error = new Error(`Workout history exceeds ${MAX_PULL_PAGES * PULL_PAGE_SIZE} rows; older sessions were not pulled`);
        if (strict) throw error;
        handleSyncError('pull workouts', error);
      }
    }

    if (workouts.length === 0) return;

    // Fetch workout_sets for those workouts in chunks to stay under PostgREST's
    // URL length cap (~8KB; 200 UUIDs at 36 chars each can exceed it).
    const workoutIds = workouts.map(w => w.id);
    const allSets: PullWorkoutSetRow[] = [];
    for (let i = 0; i < workoutIds.length; i += IN_CHUNK_SIZE) {
      const chunk = workoutIds.slice(i, i + IN_CHUNK_SIZE);
      const { data: chunkSets, error: chunkErr } = await supabase
        .from('workout_sets')
        .select('*')
        .in('workout_id', chunk);

      if (chunkErr) {
        if (strict) throw chunkErr;
        handleSyncError('pull workout_sets', chunkErr);
        return;
      }
      if (chunkSets) allSets.push(...(chunkSets as PullWorkoutSetRow[]));
    }

    // Drop sets referencing an exercise that isn't present locally. foreign_keys = ON, and
    // the whole import shares one transaction — so a single orphan row (reachable when
    // pullExercises bailed early and the wrapper swallowed the error) would roll back every
    // workout and leave the History tab empty with no user-visible explanation.
    const localExerciseRows = await db.getAllAsync<{ id: string }>('SELECT id FROM exercises');
    const localExerciseIds = new Set(localExerciseRows.map(r => r.id));
    const importableSets = allSets.filter(s => localExerciseIds.has(s.exercise_id));
    if (importableSets.length !== allSets.length) {
      const error = new Error(`Skipped ${allSets.length - importableSets.length} set(s) referencing exercises missing locally`);
      if (strict) throw error;
      handleSyncError('pull workout_sets', error);
    }

    // ── Write phase ──
    //
    // Committed in chunks rather than as one giant transaction. Batching still collapses
    // per-row fsyncs (the reason for transactions here), but a single transaction spanning a
    // full history import — up to MAX_PULL_PAGES × PULL_PAGE_SIZE workouts plus all their
    // sets — holds the one SQLite write connection through tens of thousands of sequential
    // inserts, blocking every other read/write on the app for that whole window.
    //
    // Workouts are written before sets so the FK from workout_sets.workout_id is satisfied
    // across chunk boundaries. Every statement is an idempotent upsert, so a failure
    // partway leaves a partial-but-valid import that the next pull completes.
    for (let i = 0; i < workouts.length; i += WRITE_CHUNK_SIZE) {
      const chunk = workouts.slice(i, i + WRITE_CHUNK_SIZE);
      await runInTransaction(db, async () => {
        for (const w of chunk) {
          await db.runAsync(
          `INSERT INTO workouts (id, user_id, template_id, upcoming_workout_id, started_at, finished_at, coach_notes, exercise_coach_notes, session_notes, planned_exercise_ids)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             user_id=excluded.user_id, template_id=excluded.template_id,
             upcoming_workout_id=excluded.upcoming_workout_id,
             started_at=excluded.started_at, finished_at=excluded.finished_at,
             coach_notes=excluded.coach_notes, exercise_coach_notes=excluded.exercise_coach_notes, session_notes=excluded.session_notes,
             planned_exercise_ids=excluded.planned_exercise_ids`,
            w.id, w.user_id, w.template_id, w.upcoming_workout_id ?? null, w.started_at, w.finished_at, w.coach_notes, jsonbToText(w.exercise_coach_notes), w.session_notes, jsonbToText(w.planned_exercise_ids),
          );
        }
      });
    }

    for (let i = 0; i < importableSets.length; i += WRITE_CHUNK_SIZE) {
      const chunk = importableSets.slice(i, i + WRITE_CHUNK_SIZE);
      await runInTransaction(db, async () => {
        for (const s of chunk) {
          await db.runAsync(
            `INSERT INTO workout_sets (id, workout_id, exercise_id, set_number, reps, weight, tag, rpe, is_completed, notes, target_weight, target_reps, target_rpe, exercise_order, programmed_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               workout_id=excluded.workout_id, exercise_id=excluded.exercise_id,
               set_number=excluded.set_number, reps=excluded.reps, weight=excluded.weight,
               tag=excluded.tag, rpe=excluded.rpe, is_completed=excluded.is_completed, notes=excluded.notes,
               target_weight=excluded.target_weight, target_reps=excluded.target_reps, target_rpe=excluded.target_rpe,
               exercise_order=excluded.exercise_order, programmed_order=excluded.programmed_order`,
            s.id, s.workout_id, s.exercise_id, s.set_number, s.reps, s.weight, s.tag, s.rpe, s.is_completed ? 1 : 0, s.notes,
            s.target_weight ?? null, s.target_reps ?? null, s.target_rpe ?? null, s.exercise_order ?? 0, s.programmed_order ?? null,
          );
        }
      });
    }

    if (__DEV__) console.log('Pull workout history complete');
  } catch (err) {
    if (strict) throw err;
    handleSyncError('pullWorkoutHistory', err);
  }
}

export function pullUpcomingWorkout(options: PullOptions = {}): Promise<void> {
  const strict = options.strict ?? false;
  return dedupePull(
    `upcomingWorkout:${strict ? 'strict' : 'best-effort'}`,
    () => pullUpcomingWorkoutInner(strict, options.expectedUserId),
  );
}

/** Auth reconciliation needs a rejected promise whenever a pull fails. */
export function pullUpcomingWorkoutStrict(expectedUserId: string): Promise<void> {
  return pullUpcomingWorkout({ strict: true, expectedUserId });
}

async function pullUpcomingWorkoutInner(strict: boolean, expectedUserId?: string): Promise<void> {
  try {
    const session = sessionForPull(
      await supabase.auth.getSession(),
      strict,
      expectedUserId,
    );
    if (!session) return;

    const db = await getDb();

    // Fetch latest upcoming workout from Supabase
    const { data: workouts, error: wErr } = await supabase
      .from('upcoming_workouts')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (wErr) {
      if (strict) throw wErr;
      handleSyncError('pull upcoming_workouts', wErr);
      return;
    }

    // Fetch EVERYTHING before touching local state. Clearing first and then fetching meant
    // any failure mid-way left an upcoming_workouts row with zero exercises (or exercises
    // with zero sets), which getUpcomingWorkoutForToday still advertises — so the user could
    // start an AI-planned workout that opens completely empty.
    if (!workouts || workouts.length === 0) {
      await clearLocalUpcomingWorkout();
      return;
    }

    const workout = workouts[0];

    const { data: exercises, error: eErr } = await supabase
      .from('upcoming_workout_exercises')
      .select('*')
      .eq('upcoming_workout_id', workout.id)
      .order('sort_order');

    if (eErr) {
      if (strict) throw eErr;
      handleSyncError('pull upcoming_workout_exercises', eErr);
      return;
    }

    const exerciseList = exercises ?? [];

    let setList: PullUpcomingSetRow[] = [];
    if (exerciseList.length > 0) {
      const exerciseIds = exerciseList.map(ex => ex.id);
      const { data: allSets, error: sErr } = await supabase
        .from('upcoming_workout_sets')
        .select('*')
        .in('upcoming_exercise_id', exerciseIds)
        .order('set_number');

      if (sErr) {
        if (strict) throw sErr;
        handleSyncError('pull upcoming_workout_sets', sErr);
        return;
      }
      setList = (allSets ?? []) as PullUpcomingSetRow[];
    }

    // Every fetch succeeded — now swap local state atomically.
    await runInTransaction(db, async () => {
      // Deletes are inlined rather than calling clearLocalUpcomingWorkout(): that helper
      // opens its own withTransactionAsync, and SQLite rejects a nested transaction.
      await db.runAsync('DELETE FROM upcoming_workout_sets');
      await db.runAsync('DELETE FROM upcoming_workout_exercises');
      await db.runAsync('DELETE FROM upcoming_workouts');

      await db.runAsync(
        'INSERT INTO upcoming_workouts (id, date, template_id, notes, created_at) VALUES (?, ?, ?, ?, ?)',
        workout.id, workout.date, workout.template_id, workout.notes, workout.created_at,
      );

      for (const ex of exerciseList) {
        await db.runAsync(
          'INSERT INTO upcoming_workout_exercises (id, upcoming_workout_id, exercise_id, sort_order, rest_seconds, notes) VALUES (?, ?, ?, ?, ?, ?)',
          ex.id, ex.upcoming_workout_id, ex.exercise_id, ex.sort_order, ex.rest_seconds, ex.notes,
        );
      }

      for (const s of setList) {
        await db.runAsync(
          'INSERT INTO upcoming_workout_sets (id, upcoming_exercise_id, set_number, target_weight, target_reps, target_rpe, tag) VALUES (?, ?, ?, ?, ?, ?, ?)',
          s.id, s.upcoming_exercise_id, s.set_number, s.target_weight, s.target_reps, s.target_rpe ?? null, s.tag ?? 'working',
        );
      }
    });

    if (__DEV__) console.log('Pull upcoming workout complete');
  } catch (err) {
    if (strict) throw err;
    handleSyncError('pullUpcomingWorkout', err);
  }
}
