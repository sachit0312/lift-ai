// --- Mocks (must be before imports) ---

let mockSession: any = null;
jest.mock('../services/supabase', () => ({
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

import * as db from '../services/database';
import { __mockDb } from '../__mocks__/expo-sqlite';

describe('database.upsertExerciseNote — user id resolution', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockClear();
    __mockDb.getFirstAsync.mockReset().mockResolvedValue(null);
    __mockDb.getAllAsync.mockReset().mockResolvedValue([]);
    db.setCurrentUserId('local');
    mockSession = null;
  });

  it('falls back to supabase session user id when currentUserId is "local"', async () => {
    mockSession = { user: { id: 'user-from-session' } };

    await db.upsertExerciseNote('exercise-1', 'machine_notes', 'pin 4, seat 3');

    const upsertCall = __mockDb.runAsync.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO user_exercise_notes'),
    );
    expect(upsertCall).toBeDefined();
    // First bound arg after the SQL should be the resolved user id
    expect(upsertCall![1]).toBe('user-from-session');
    // The module global should now be updated
    expect(db.getCurrentUserId()).toBe('user-from-session');
  });

  it('uses currentUserId when it is already a real id', async () => {
    db.setCurrentUserId('already-set-user');
    mockSession = { user: { id: 'should-not-be-used' } };

    await db.upsertExerciseNote('exercise-2', 'machine_notes', 'notes');

    const upsertCall = __mockDb.runAsync.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO user_exercise_notes'),
    );
    expect(upsertCall![1]).toBe('already-set-user');
  });

  it('falls through to "local" when no session and no prior id', async () => {
    mockSession = null;
    db.setCurrentUserId('local');

    await db.upsertExerciseNote('exercise-3', 'machine_notes', 'offline note');

    const upsertCall = __mockDb.runAsync.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO user_exercise_notes'),
    );
    expect(upsertCall![1]).toBe('local');
  });
});
