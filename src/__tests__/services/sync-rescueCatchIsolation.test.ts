/**
 * Verifies the rescue block's catch isolation: if the rescue SQL fails,
 * downstream Supabase pushes must still proceed (the rescue is best-effort).
 */

const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn((_table: string) => ({
  upsert: mockUpsert,
}));

jest.mock('../../services/supabase', () => ({
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

import { __mockDb } from '../../__mocks__/expo-sqlite';
import { syncToSupabase } from '../../services/sync';
import * as Sentry from '@sentry/react-native';

describe('Batch 8: sync rescue catch isolation', () => {
  beforeEach(() => {
    __mockDb.runAsync.mockReset();
    __mockDb.getAllAsync.mockReset();
    __mockDb.execAsync.mockResolvedValue(undefined);
    __mockDb.getFirstAsync.mockResolvedValue(null);
    mockUpsert.mockClear();
    mockFrom.mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it('downstream push still runs when the rescue UPDATE throws', async () => {
    // Set up: rescue DELETE/UPDATE calls reject; everything else resolves
    __mockDb.runAsync.mockImplementation((sql: string) => {
      // Match the rescue statements (DELETE FROM user_exercise_notes WHERE user_id = 'local'
      // and UPDATE ... SET user_id = ? WHERE user_id = 'local')
      if (/user_id\s*=\s*['"]local['"]/i.test(sql)) {
        return Promise.reject(new Error('rescue failure (simulated)'));
      }
      return Promise.resolve({ changes: 0 });
    });

    // Push-side reads return empty arrays — function still progresses past the rescue block.
    __mockDb.getAllAsync.mockResolvedValue([]);

    const getAllAsyncCallsBefore = __mockDb.getAllAsync.mock.calls.length;
    await syncToSupabase();
    const getAllAsyncCallsAfter = __mockDb.getAllAsync.mock.calls.length;

    // Sentry should have captured the rescue error
    expect(Sentry.captureException).toHaveBeenCalled();

    // Push-side reads (custom exercises, notes, templates, template_exercises, workouts) should have fired
    expect(getAllAsyncCallsAfter - getAllAsyncCallsBefore).toBeGreaterThanOrEqual(5);
  });

  it('happy-path rescue does not log to Sentry', async () => {
    __mockDb.runAsync.mockResolvedValue({ changes: 0 });
    __mockDb.getAllAsync.mockResolvedValue([]);

    await syncToSupabase();

    // No Sentry capture from rescue branch in happy path
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
