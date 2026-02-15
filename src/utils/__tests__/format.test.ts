import { formatDuration, formatDate } from '../format';

describe('formatDuration', () => {
  it('returns -- for null finishedAt', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', null)).toBe('--');
  });

  it('formats minutes for under 1 hour', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T10:45:00Z')).toBe('45m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T11:30:00Z')).toBe('1h 30m');
  });

  it('returns 0m when start and finish are the same', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z')).toBe('0m');
  });

  it('returns exactly 1h 0m for 60 minutes', () => {
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z')).toBe('1h 0m');
  });

  it('formats very large durations correctly', () => {
    // 5 hours and 15 minutes
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T15:15:00Z')).toBe('5h 15m');
  });

  it('formats multi-day durations', () => {
    // 25 hours = 25h 0m
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-02T11:00:00Z')).toBe('25h 0m');
  });

  it('rounds to nearest minute', () => {
    // 30 seconds rounds to 1m
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T10:00:30Z')).toBe('1m');
    // 29 seconds rounds to 0m
    expect(formatDuration('2026-01-01T10:00:00Z', '2026-01-01T10:00:29Z')).toBe('0m');
  });
});

describe('formatDate', () => {
  it('returns Today for current date', () => {
    const now = new Date().toISOString();
    expect(formatDate(now)).toBe('Today');
  });

  it('returns Yesterday for a date 1 day ago', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatDate(yesterday.toISOString())).toBe('Yesterday');
  });

  it('returns weekday name for dates 2-6 days ago', () => {
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const expectedDay = weekdays[threeDaysAgo.getDay()];
    expect(formatDate(threeDaysAgo.toISOString())).toBe(expectedDay);
  });

  it('returns formatted date (month day) for dates 7+ days ago in the same year', () => {
    const now = new Date();
    // Use a date safely in the past within the same year
    // Go back 30 days to be safe
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);

    // If going back 30 days crosses into a different year, adjust
    if (oldDate.getFullYear() !== now.getFullYear()) {
      // Use Jan 15 of the current year instead
      oldDate.setFullYear(now.getFullYear());
      oldDate.setMonth(0);
      oldDate.setDate(15);
    }

    const result = formatDate(oldDate.toISOString());
    // Should be something like "Jan 8" (no year since same year)
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });

  it('includes year for dates from a different year', () => {
    const oldDate = new Date('2023-06-15T12:00:00Z');
    const result = formatDate(oldDate.toISOString());
    // Should be something like "Jun 15, 2023"
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 2023$/);
  });

  it('returns weekday name for a date exactly 6 days ago', () => {
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
    const expectedDay = weekdays[sixDaysAgo.getDay()];
    expect(formatDate(sixDaysAgo.toISOString())).toBe(expectedDay);
  });
});

