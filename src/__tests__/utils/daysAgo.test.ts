/**
 * Tests for Batch 7 Task 3: daysAgo computes calendar-day diff in local
 * timezone — robust to DST boundaries.
 */
import { daysAgo } from '../../utils/daysAgo';

describe('Batch 7 Task 3: daysAgo', () => {
  it('returns 0 for a timestamp earlier today', () => {
    const earlierToday = new Date();
    earlierToday.setHours(earlierToday.getHours() - 1);
    expect(daysAgo(earlierToday.toISOString())).toBe(0);
  });

  it('returns 1 for a timestamp on the previous calendar day', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 0, 0);
    expect(daysAgo(yesterday.toISOString())).toBe(1);
  });

  it('returns 7 for a timestamp one week ago', () => {
    const now = new Date();
    const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 12, 0, 0);
    expect(daysAgo(weekAgo.toISOString())).toBe(7);
  });

  it('handles month boundary correctly', () => {
    const now = new Date(2026, 2, 1, 0, 0, 0); // 1 March 2026
    const lastMonth = new Date(2026, 1, 28, 23, 0, 0); // 28 Feb 2026
    // Mock the system clock for this test
    const realDate = Date;
    global.Date = class extends realDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(now);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          super(...(args as [any]));
        }
      }
      static now() { return now.getTime(); }
    } as DateConstructor;

    try {
      expect(daysAgo(lastMonth.toISOString())).toBe(1);
    } finally {
      global.Date = realDate;
    }
  });
});
