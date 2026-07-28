/**
 * pullWorkoutHistory pages through ALL finished workouts (see the comment in sync.ts: this used
 * to be a flat .limit(200), which meant history was silently truncated to the 200 most recent
 * sessions after any resetDatabase() — and PR detection then computed "all-time" bests over
 * that truncated corpus, so old PRs could reappear as beatable). These tests pin:
 *  - full pages keep paging, a short page stops it, and all rows across pages get merged
 *  - .range() bounds are correct per page
 *  - a run that hits MAX_PULL_PAGES reports via Sentry instead of silently truncating forever
 *  - .order('id', ...) is present — the unique tiebreaker that keeps range pagination stable
 *    (without it, two workouts finished in the same second can duplicate or vanish across pages)
 */
import * as Sentry from '@sentry/react-native';
import { pullWorkoutHistory } from '../../services/sync';
import { supabase } from '../../services/supabase';

jest.mock('../../services/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() }, from: jest.fn() },
}));

const runAsyncCalls: any[][] = [];

jest.mock('../../services/database', () => ({
  getDb: jest.fn().mockResolvedValue({
    runAsync: jest.fn().mockImplementation((...args: any[]) => {
      runAsyncCalls.push(args);
      return Promise.resolve(undefined);
    }),
    getAllAsync: jest.fn().mockResolvedValue([]),
    withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => cb()),
  }),
}));

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

const PULL_PAGE_SIZE = 200;
const MAX_PULL_PAGES = 50;

function workoutRow(id: string) {
  return {
    id, user_id: 'user-1', template_id: null, upcoming_workout_id: null,
    started_at: 'x', finished_at: 'y', coach_notes: null, exercise_coach_notes: null,
    session_notes: null, planned_exercise_ids: null,
  };
}

/** A `workouts` query chain whose terminal `.range(from, to)` is driven by `pageFn` (called
 *  once per page, 0-indexed) and logs (from, to) plus every `.order()` call for assertions. */
function buildPagingQuery(pageFn: (page: number) => any[], log: { ranges: [number, number][]; orders: any[][] }) {
  let page = 0;
  const builder: any = {};
  builder.select = jest.fn().mockReturnValue(builder);
  builder.eq = jest.fn().mockReturnValue(builder);
  builder.not = jest.fn().mockReturnValue(builder);
  builder.order = jest.fn((...args: any[]) => {
    log.orders.push(args);
    return builder;
  });
  builder.range = jest.fn((from: number, to: number) => {
    log.ranges.push([from, to]);
    const data = pageFn(page);
    page++;
    return Promise.resolve({ data, error: null });
  });
  return builder;
}

function emptySetsHandler() {
  return { select: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [], error: null }) }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  runAsyncCalls.length = 0;
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
});

describe('pullWorkoutHistory pagination', () => {
  it('pages two full pages then a short page, merging all rows with correct .range() bounds', async () => {
    const log = { ranges: [] as [number, number][], orders: [] as any[][] };
    const pages = [
      Array.from({ length: PULL_PAGE_SIZE }, (_, i) => workoutRow(`p0-${i}`)),
      Array.from({ length: PULL_PAGE_SIZE }, (_, i) => workoutRow(`p1-${i}`)),
      Array.from({ length: 37 }, (_, i) => workoutRow(`p2-${i}`)), // short page — must stop paging
    ];
    const workoutsBuilder = buildPagingQuery((page) => pages[page] ?? [], log);
    mockFrom.mockImplementation((table: string) => (table === 'workouts' ? workoutsBuilder : emptySetsHandler()));

    await pullWorkoutHistory();

    expect(log.ranges).toEqual([
      [0, PULL_PAGE_SIZE - 1],
      [PULL_PAGE_SIZE, 2 * PULL_PAGE_SIZE - 1],
      [2 * PULL_PAGE_SIZE, 3 * PULL_PAGE_SIZE - 1],
    ]);
    // Exactly 3 pages fetched — the short 3rd page must stop paging, not trigger a 4th fetch.
    expect(log.ranges).toHaveLength(3);

    const totalRows = PULL_PAGE_SIZE + PULL_PAGE_SIZE + 37;
    const workoutInserts = runAsyncCalls.filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO workouts'));
    expect(workoutInserts).toHaveLength(totalRows);
  });

  it('stops paging as soon as a page returns fewer than PULL_PAGE_SIZE rows', async () => {
    const log = { ranges: [] as [number, number][], orders: [] as any[][] };
    const workoutsBuilder = buildPagingQuery((page) => (page === 0 ? [workoutRow('only-one')] : []), log);
    mockFrom.mockImplementation((table: string) => (table === 'workouts' ? workoutsBuilder : emptySetsHandler()));

    await pullWorkoutHistory();

    expect(log.ranges).toHaveLength(1);
  });

  it('hits MAX_PULL_PAGES and reports the truncation via Sentry instead of paging forever', async () => {
    const log = { ranges: [] as [number, number][], orders: [] as any[][] };
    // Every page is full — pagination never naturally stops on page size, so the hard cap must
    // kick in. If MAX_PULL_PAGES regressed to a no-op, this test would time out.
    const workoutsBuilder = buildPagingQuery(
      (page) => Array.from({ length: PULL_PAGE_SIZE }, (_, i) => workoutRow(`p${page}-${i}`)),
      log,
    );
    mockFrom.mockImplementation((table: string) => (table === 'workouts' ? workoutsBuilder : emptySetsHandler()));

    await pullWorkoutHistory();

    expect(log.ranges).toHaveLength(MAX_PULL_PAGES);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/exceeds.*rows.*older sessions were not pulled/i) }),
    );
  });

  it('orders by id as a tiebreaker on top of finished_at (required for stable range pagination)', async () => {
    const log = { ranges: [] as [number, number][], orders: [] as any[][] };
    const workoutsBuilder = buildPagingQuery(() => [], log);
    mockFrom.mockImplementation((table: string) => (table === 'workouts' ? workoutsBuilder : emptySetsHandler()));

    await pullWorkoutHistory();

    expect(log.orders).toContainEqual(['id', { ascending: false }]);
    expect(log.orders).toContainEqual(['finished_at', { ascending: false }]);
  });
});
