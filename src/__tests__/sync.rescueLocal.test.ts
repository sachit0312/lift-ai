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

  it('rewrites user_exercise_notes rows from user_id="local" to session.user.id before pushing', async () => {
    await syncToSupabase();

    // Rescue UPDATE must run BEFORE the notes push SELECT
    const rescueCall = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('UPDATE user_exercise_notes') &&
      call[0].includes("user_id = 'local'"),
    );
    expect(rescueCall).toBeDefined();
    expect(rescueCall![1]).toBe('real-user');

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

  it('resolves (local, exerciseX) vs (real-user, exerciseX) collision by deleting the real-user row first', async () => {
    // Track the SQL sequence to verify DELETE runs before UPDATE
    const sqlCalls: string[] = [];
    __mockDb.runAsync.mockImplementation(async (sql: string, ..._args: any[]) => {
      sqlCalls.push(sql);
      return { changes: 0 };
    });

    await syncToSupabase();

    const deleteIdx = sqlCalls.findIndex(s => s.includes('DELETE FROM user_exercise_notes') && s.includes("user_id = 'local'"));
    const updateIdx = sqlCalls.findIndex(s => s.includes('UPDATE user_exercise_notes') && s.includes("user_id = 'local'"));

    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(updateIdx);

    // The DELETE must bind the real user id (not 'local')
    const deleteCall = __mockDb.runAsync.mock.calls.find((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('DELETE FROM user_exercise_notes'),
    );
    expect(deleteCall![1]).toBe('real-user');
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
