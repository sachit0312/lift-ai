/**
 * dedupePull is the guard against the sign-in race documented in sync.ts: the sign-in flow
 * races a pull chain against a 30s timeout, but Promise.race only settles the OUTER promise —
 * the inner pull keeps running. If a second caller (e.g. WorkoutScreen's own focus-driven pull)
 * fires while that orphaned pull is still in flight, two overlapping withTransactionAsync calls
 * on the same SQLite connection produce "cannot start a transaction within a transaction".
 *
 * These tests pin:
 *  - same-session concurrent calls collapse into a single underlying fetch
 *  - different-session concurrent calls do NOT collapse (an account switch must not be starved
 *    by a stale in-flight promise keyed only by pull name, not by session user)
 *  - the map entry is cleared once the in-flight promise settles (success or an internally
 *    handled error) so a later call re-runs instead of being permanently deduped
 *  - a getSession() rejection inside dedupePull's own scoping lookup must not escape as a
 *    rejection — the documented contract is that pull functions never throw. This contract
 *    broke once already (see the comment above dedupePull in src/services/sync.ts).
 */
import * as Sentry from '@sentry/react-native';
import { pullWorkoutHistory } from '../../services/sync';
import { supabase } from '../../services/supabase';

jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn(),
  },
}));

jest.mock('../../services/database', () => ({
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn().mockResolvedValue(undefined),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
  }),
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

function session(userId: string) {
  return { data: { session: { user: { id: userId } } } };
}

/** Fresh `workouts` query-builder chain per call — records the `user_id` filter used and
 *  resolves at the terminal `.range()` call. Built anew each time so two concurrent chains
 *  (different sessions) don't clobber each other's captured filter value. */
function buildWorkoutsQuery(data: any[], error: any, onRangeCall: (userId: string) => void) {
  const builder: any = {};
  let capturedUserId: string | undefined;
  builder.select = jest.fn().mockReturnValue(builder);
  builder.eq = jest.fn((field: string, value: string) => {
    if (field === 'user_id') capturedUserId = value;
    return builder;
  });
  builder.not = jest.fn().mockReturnValue(builder);
  builder.order = jest.fn().mockReturnValue(builder);
  builder.range = jest.fn().mockImplementation(() => {
    onRangeCall(capturedUserId!);
    return Promise.resolve({ data, error });
  });
  return builder;
}

function emptySetsHandler() {
  return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [], error: null }) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dedupePull session scoping (exercised via pullWorkoutHistory)', () => {
  it('collapses two concurrent same-session calls into one underlying fetch', async () => {
    mockGetSession.mockResolvedValue(session('user-1'));

    const rangeCalls: string[] = [];
    mockFrom.mockImplementation((table: string) =>
      table === 'workouts' ? buildWorkoutsQuery([], null, (userId) => rangeCalls.push(userId)) : emptySetsHandler(),
    );

    const p1 = pullWorkoutHistory();
    const p2 = pullWorkoutHistory();
    await Promise.all([p1, p2]);

    // Only one actual network fetch happened, even though pullWorkoutHistory() was invoked
    // twice — the second call awaited the first's in-flight promise instead of racing it.
    expect(rangeCalls).toHaveLength(1);
    expect(rangeCalls[0]).toBe('user-1');
  });

  it('does NOT collapse concurrent calls for different session users', async () => {
    // dedupePull's own scoping getSession() call fires for both invocations before either
    // resolves (both invoked synchronously, back to back, with no await between). Since
    // mockResolvedValue-style promises are already settled, their .then continuations run in
    // call order: call #1 = A's scoping lookup, #2 = B's scoping lookup, #3 = A's internal
    // (pullWorkoutHistoryInner) lookup, #4 = B's internal lookup. Odd calls are always "A",
    // even calls are always "B", regardless of how many internal lookups follow.
    let call = 0;
    mockGetSession.mockImplementation(() => {
      call++;
      return Promise.resolve(call % 2 === 1 ? session('user-A') : session('user-B'));
    });

    const rangeCalls: string[] = [];
    mockFrom.mockImplementation((table: string) =>
      table === 'workouts' ? buildWorkoutsQuery([], null, (userId) => rangeCalls.push(userId)) : emptySetsHandler(),
    );

    const p1 = pullWorkoutHistory();
    const p2 = pullWorkoutHistory();
    await Promise.all([p1, p2]);

    // Two independent fetches — one per user — not deduped onto a shared in-flight promise.
    expect(rangeCalls).toHaveLength(2);
    expect(rangeCalls.slice().sort()).toEqual(['user-A', 'user-B']);
  });

  it('clears the in-flight entry after a successful pull so a later call re-runs', async () => {
    mockGetSession.mockResolvedValue(session('user-1'));

    const rangeCalls: string[] = [];
    mockFrom.mockImplementation((table: string) =>
      table === 'workouts' ? buildWorkoutsQuery([], null, (userId) => rangeCalls.push(userId)) : emptySetsHandler(),
    );

    await pullWorkoutHistory();
    await pullWorkoutHistory();

    // Two sequential (non-overlapping) calls must each perform their own fetch. If the map
    // entry were never cleared, the second call would either hang awaiting an already-settled
    // promise forever, or silently resolve without ever querying again.
    expect(rangeCalls).toHaveLength(2);
  });

  it('clears the in-flight entry even when the pull hits an internally-handled error', async () => {
    mockGetSession.mockResolvedValue(session('user-1'));

    let attempt = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'workouts') return emptySetsHandler();
      attempt++;
      const isFirstAttempt = attempt === 1;
      return buildWorkoutsQuery([], isFirstAttempt ? { message: 'boom' } : null, () => {});
    });

    await pullWorkoutHistory(); // first attempt: workouts query errors, handled internally
    expect(Sentry.captureException).toHaveBeenCalledWith({ message: 'boom' });

    await pullWorkoutHistory(); // must actually re-run against the network, not reuse a stale promise
    expect(attempt).toBe(2);
  });

  it('resolves (never throws) even when getSession() rejects', async () => {
    mockGetSession.mockRejectedValue(new Error('network down'));

    await expect(pullWorkoutHistory()).resolves.toBeUndefined();

    // The rejection is first swallowed by dedupePull's own try/catch around its scoping
    // lookup (falls through to run()), then by pullWorkoutHistoryInner's own outer try/catch
    // (which calls getSession() again and hits the same rejection) — reported via Sentry
    // instead of escaping as a promise rejection.
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
  });
});
