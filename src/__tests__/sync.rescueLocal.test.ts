// --- Mocks (must be before imports) ---

const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn((_table: string) => ({
  upsert: mockUpsert,
}));

jest.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({
        data: { session: { user: { id: 'real-user' } } },
      })),
    },
    from: (table: string) => mockFrom(table),
  },
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { DatabaseSync } from 'node:sqlite';
import { __mockDb } from '../__mocks__/expo-sqlite';
import { syncToSupabase } from '../services/sync';

describe('syncToSupabase — rescue local rows', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockClear().mockResolvedValue({ changes: 0 });
    __mockDb.getAllAsync.mockReset();
    mockUpsert.mockClear();
    mockFrom.mockClear();

    // Stub all the SELECTs syncToSupabase makes. Only user_exercise_notes
    // is relevant — return one row after the rescue UPDATE runs.
    __mockDb.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM exercises')) return [];
      if (sql.includes('FROM user_exercise_notes')) {
        return [{ exercise_id: 'e1', form_notes: null, machine_notes: 'pin 4' }];
      }
      if (sql.includes('FROM templates')) return [];
      if (sql.includes('FROM template_exercises')) return [];
      if (sql.includes('FROM workouts')) return [];
      return [];
    });
  });

  it('migrates user_exercise_notes rows from user_id="local" to session.user.id before pushing', async () => {
    await syncToSupabase();

    // The rescue is an INSERT ... SELECT with a COALESCE merge, followed by a DELETE of the
    // 'local' rows. It is deliberately NOT a plain UPDATE of user_id — see the merge test below.
    const rescueCall = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('INSERT INTO user_exercise_notes') &&
      call[0].includes("WHERE user_id = 'local'"),
    );
    expect(rescueCall).toBeDefined();
    expect(rescueCall![1]).toBe('real-user');

    const cleanupCall = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('DELETE FROM user_exercise_notes') &&
      call[0].includes("user_id = 'local'"),
    );
    expect(cleanupCall).toBeDefined();

    // And the upsert to Supabase must use the real user id
    expect(mockFrom).toHaveBeenCalledWith('user_exercise_notes');
    const notesUpsertCall = mockUpsert.mock.calls.find((call: any[]) =>
      Array.isArray(call[0]) && call[0][0]?.user_id === 'real-user',
    );
    expect(notesUpsertCall).toBeDefined();
  });

  it('rewrites exercises rows from user_id="local" to session.user.id before the push filter', async () => {
    await syncToSupabase();

    const exerciseRescue = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('UPDATE exercises') &&
      call[0].includes("user_id = 'local'"),
    );
    expect(exerciseRescue).toBeDefined();
    expect(exerciseRescue![1]).toBe('real-user');
  });

  it('merges a (local, exerciseX) row onto (real-user, exerciseX) without destroying the sibling note column', async () => {
    // Replay the emitted rescue statements against a real SQLite engine.
    //
    // The previous implementation deleted the ENTIRE real-user row and promoted the local one.
    // upsertExerciseNote writes one column at a time, so the local row usually has a value in
    // only one of form_notes/machine_notes — the other column was silently wiped, and the
    // resulting nulls were then pushed to Supabase.
    const sqlCalls: Array<[string, unknown[]]> = [];
    __mockDb.runAsync.mockImplementation(async (sql: string, ...args: any[]) => {
      sqlCalls.push([sql, args]);
      return { changes: 0 };
    });

    await syncToSupabase();

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
    // Real-user row holds machine notes only; the 'local' row holds form notes only.
    real.exec(`INSERT INTO user_exercise_notes VALUES ('real-user','e1',NULL,'seat 4, pin 6')`);
    real.exec(`INSERT INTO user_exercise_notes VALUES ('local','e1','brace core',NULL)`);
    // A local-only row with no real-user counterpart must also survive the migration.
    real.exec(`INSERT INTO user_exercise_notes VALUES ('local','e2','high bar',NULL)`);

    for (const [sql, args] of sqlCalls) {
      if (sql.includes('user_exercise_notes') && (sql.includes('INSERT INTO') || sql.includes('DELETE FROM'))) {
        real.prepare(sql).run(...(args as any[]));
      }
    }

    const rows = real
      .prepare('SELECT user_id, exercise_id, form_notes, machine_notes FROM user_exercise_notes ORDER BY exercise_id')
      .all();

    expect(rows).toEqual([
      { user_id: 'real-user', exercise_id: 'e1', form_notes: 'brace core', machine_notes: 'seat 4, pin 6' },
      { user_id: 'real-user', exercise_id: 'e2', form_notes: 'high bar', machine_notes: null },
    ]);
  });

  it('does nothing when no session', async () => {
    // Temporarily override the session mock to return null
    const supa = jest.requireMock('../services/supabase').supabase;
    (supa.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: null } });

    await syncToSupabase();

    const rescueCall = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes("user_id = 'local'"),
    );
    expect(rescueCall).toBeUndefined();
  });
});
