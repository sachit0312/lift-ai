import * as Sentry from '@sentry/react-native';

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
    from: jest.fn(),
  },
}));

// Partially mock database module to avoid real SQLite init
jest.mock('../database', () => ({
  ...jest.requireActual('../database'),
  getCurrentUserId: jest.fn().mockReturnValue('local'),
}));

import { fireAndForgetSync } from '../sync';
import { supabase } from '../supabase';

const mockGetSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;
const mockCaptureException = Sentry.captureException as jest.MockedFunction<typeof Sentry.captureException>;
const mockAddBreadcrumb = Sentry.addBreadcrumb as jest.MockedFunction<typeof Sentry.addBreadcrumb>;

describe('fireAndForgetSync error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls Sentry.captureException when syncToSupabase rejects', async () => {
    const error = new Error('network failure');
    // syncToSupabase's first await is supabase.auth.getSession() — make it reject
    // so syncToSupabase's internal catch fires Sentry.captureException(error)
    mockGetSession.mockRejectedValueOnce(error);

    fireAndForgetSync();

    // Let the promise chain resolve
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });

  it('does NOT call Sentry.addBreadcrumb for sync failures', async () => {
    const error = new Error('sync failed');
    mockGetSession.mockRejectedValueOnce(error);

    fireAndForgetSync();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it('does not throw when syncToSupabase rejects', () => {
    mockGetSession.mockRejectedValueOnce(new Error('rejected'));
    expect(() => fireAndForgetSync()).not.toThrow();
  });
});
