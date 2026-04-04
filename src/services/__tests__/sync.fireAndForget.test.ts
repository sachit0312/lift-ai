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

import { fireAndForgetSync, syncToSupabase } from '../sync';

jest.mock('../sync', () => {
  const actual = jest.requireActual('../sync');
  return {
    ...actual,
    syncToSupabase: jest.fn(),
  };
});

const mockSyncToSupabase = syncToSupabase as jest.MockedFunction<typeof syncToSupabase>;
const mockCaptureException = Sentry.captureException as jest.MockedFunction<typeof Sentry.captureException>;
const mockAddBreadcrumb = Sentry.addBreadcrumb as jest.MockedFunction<typeof Sentry.addBreadcrumb>;

describe('fireAndForgetSync error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls Sentry.captureException when syncToSupabase rejects', async () => {
    const error = new Error('network failure');
    mockSyncToSupabase.mockRejectedValueOnce(error);

    fireAndForgetSync();

    // Let the promise rejection propagate
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });

  it('does NOT call Sentry.addBreadcrumb for sync failures', async () => {
    const error = new Error('sync failed');
    mockSyncToSupabase.mockRejectedValueOnce(error);

    fireAndForgetSync();

    await Promise.resolve();
    await Promise.resolve();

    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });

  it('does not throw when syncToSupabase rejects', () => {
    mockSyncToSupabase.mockRejectedValueOnce(new Error('rejected'));
    expect(() => fireAndForgetSync()).not.toThrow();
  });
});
