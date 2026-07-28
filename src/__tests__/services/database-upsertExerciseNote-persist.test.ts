// Regression test for the note-loss bug: upsertExerciseNote bound the note value only
// into the ON CONFLICT ... DO UPDATE arm. On the FIRST write for an exercise there is no
// conflict, so DO UPDATE never ran and the row was inserted as (user, exercise, NULL, NULL) —
// the note was silently discarded. Every subsequent write hit the conflict path and worked,
// which is why the bug survived.
//
// The expo-sqlite mock is a bare jest.fn() with no SQL engine, so asserting on bind
// arguments (as the pre-existing tests do) cannot catch this class of defect. Instead we
// capture the statement the module actually emits and replay it against a real SQLite
// engine, then assert on the stored row.

let mockSession: any = null;
jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: mockSession } })),
    },
  },
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { DatabaseSync } from 'node:sqlite';
import * as db from '../../services/database';
import { __mockDb } from '../../__mocks__/expo-sqlite';

/** Replays every captured `INSERT INTO user_exercise_notes` statement against real SQLite. */
function replayNoteWrites(): DatabaseSync {
  const real = new DatabaseSync(':memory:');
  real.exec(`
    CREATE TABLE user_exercise_notes (
      user_id TEXT NOT NULL,
      exercise_id TEXT NOT NULL,
      form_notes TEXT,
      machine_notes TEXT,
      PRIMARY KEY (user_id, exercise_id)
    )
  `);

  for (const call of __mockDb.runAsync.mock.calls) {
    const [sql, ...args] = call as [string, ...unknown[]];
    if (typeof sql === 'string' && sql.includes('INSERT INTO user_exercise_notes')) {
      real.prepare(sql).run(...(args as any[]));
    }
  }
  return real;
}

function readRow(real: DatabaseSync) {
  return real.prepare('SELECT form_notes, machine_notes FROM user_exercise_notes').get() as
    | { form_notes: string | null; machine_notes: string | null }
    | undefined;
}

describe('upsertExerciseNote — value actually persists', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockClear();
    __mockDb.getFirstAsync.mockReset().mockResolvedValue(null);
    __mockDb.getAllAsync.mockReset().mockResolvedValue([]);
    db.setCurrentUserId('user-1');
    mockSession = null;
  });

  it('persists form_notes on the FIRST write for an exercise', async () => {
    await db.upsertExerciseNote('ex-1', 'form_notes', 'brace core');

    expect(readRow(replayNoteWrites())).toEqual({
      form_notes: 'brace core',
      machine_notes: null,
    });
  });

  it('persists machine_notes on the FIRST write for an exercise', async () => {
    await db.upsertExerciseNote('ex-1', 'machine_notes', 'seat 4, pin 6');

    expect(readRow(replayNoteWrites())).toEqual({
      form_notes: null,
      machine_notes: 'seat 4, pin 6',
    });
  });

  it('writing one note field does not clobber the other', async () => {
    await db.upsertExerciseNote('ex-1', 'form_notes', 'brace core');
    await db.upsertExerciseNote('ex-1', 'machine_notes', 'seat 4, pin 6');

    expect(readRow(replayNoteWrites())).toEqual({
      form_notes: 'brace core',
      machine_notes: 'seat 4, pin 6',
    });
  });

  it('updates an existing note without disturbing the sibling field', async () => {
    await db.upsertExerciseNote('ex-1', 'form_notes', 'brace core');
    await db.upsertExerciseNote('ex-1', 'machine_notes', 'seat 4, pin 6');
    await db.upsertExerciseNote('ex-1', 'form_notes', 'elbows tucked');

    expect(readRow(replayNoteWrites())).toEqual({
      form_notes: 'elbows tucked',
      machine_notes: 'seat 4, pin 6',
    });
  });

  it('clears a note to null without disturbing the sibling field', async () => {
    await db.upsertExerciseNote('ex-1', 'machine_notes', 'seat 4, pin 6');
    await db.upsertExerciseNote('ex-1', 'form_notes', 'brace core');
    await db.upsertExerciseNote('ex-1', 'form_notes', null);

    expect(readRow(replayNoteWrites())).toEqual({
      form_notes: null,
      machine_notes: 'seat 4, pin 6',
    });
  });

  it('rejects a field name that is not an allowed note column', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.upsertExerciseNote('ex-1', 'exercise_id' as any, 'nope'),
    ).rejects.toThrow(/Invalid note field/);
  });
});
