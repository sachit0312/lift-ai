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
});

describe('formatDate', () => {
  it('returns Today for current date', () => {
    const now = new Date().toISOString();
    expect(formatDate(now)).toBe('Today');
  });
});
