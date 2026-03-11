import { calculateStreak } from '../utils/streakCalculation';

// Fixed "now" for all tests: 2025-06-15T12:00:00Z
const NOW = new Date('2025-06-15T12:00:00Z');

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

function dateStr(daysAgo: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

describe('calculateStreak', () => {
  it('returns 0 for empty array', () => {
    expect(calculateStreak([])).toBe(0);
  });

  it('returns 1 for a single workout today', () => {
    expect(calculateStreak([dateStr(0)])).toBe(1);
  });

  it('returns 1 for a single workout yesterday', () => {
    expect(calculateStreak([dateStr(1)])).toBe(1);
  });

  it('returns 0 when most recent workout is 2 days ago', () => {
    expect(calculateStreak([dateStr(2)])).toBe(0);
  });

  it('returns 3 for 3 consecutive days ending today', () => {
    expect(calculateStreak([dateStr(0), dateStr(1), dateStr(2)])).toBe(3);
  });

  it('returns 3 for 3 consecutive days ending yesterday', () => {
    expect(calculateStreak([dateStr(1), dateStr(2), dateStr(3)])).toBe(3);
  });

  it('breaks streak at a gap', () => {
    // Workouts on today, yesterday, and 3 days ago (skipping 2 days ago)
    expect(calculateStreak([dateStr(0), dateStr(1), dateStr(3)])).toBe(2);
  });

  it('counts multiple workouts on the same day as 1', () => {
    const morning = new Date(NOW);
    morning.setHours(7, 0, 0, 0);
    const evening = new Date(NOW);
    evening.setHours(19, 0, 0, 0);
    expect(
      calculateStreak([morning.toISOString(), evening.toISOString()]),
    ).toBe(1);
  });

  it('returns 0 for workouts far in the past', () => {
    expect(calculateStreak([dateStr(30), dateStr(31), dateStr(32)])).toBe(0);
  });
});
