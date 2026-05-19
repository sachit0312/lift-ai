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

  it('returns 1 across a DST spring-forward boundary (where naive ms math would give 0)', () => {
    // US spring forward 2026: 2am Sunday March 8 → 3am.
    // Pick midnight March 9 as "now" and 11pm March 8 as "yesterday at 11pm" — local time.
    // Naive ms math: (March 9 00:00 local - March 8 23:00 local) in UTC = 0 hours
    // because the clock skipped 2-3am. Calendar math = 1 day.
    const realDate = Date;
    const fakeNow = new realDate(2026, 2, 9, 0, 0, 0); // Mar 9 00:00 local
    const inputDate = new realDate(2026, 2, 8, 23, 0, 0); // Mar 8 23:00 local

    global.Date = class extends realDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fakeNow);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          super(...(args as [any]));
        }
      }
      static now() { return fakeNow.getTime(); }
    } as DateConstructor;

    try {
      expect(daysAgo(inputDate.toISOString())).toBe(1);
    } finally {
      global.Date = realDate;
    }
  });

  it('clamps future timestamps to 0 (does not return a negative number)', () => {
    const future = new Date(Date.now() + 86400000 * 2); // 2 days in the future
    expect(daysAgo(future.toISOString())).toBe(0);
  });
});
