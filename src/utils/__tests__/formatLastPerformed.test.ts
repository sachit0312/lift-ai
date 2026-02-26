import { formatLastPerformed } from '../formatLastPerformed';

/** Create a date N calendar days ago at a specific hour */
function daysAgo(days: number, hour = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe('formatLastPerformed', () => {
  it('returns "Today" for a workout earlier today', () => {
    expect(formatLastPerformed(daysAgo(0, 6).toISOString())).toBe('Today');
  });

  it('returns "Today" for a workout just now', () => {
    expect(formatLastPerformed(new Date().toISOString())).toBe('Today');
  });

  it('returns "Yesterday" for a workout done yesterday', () => {
    expect(formatLastPerformed(daysAgo(1, 23).toISOString())).toBe('Yesterday');
  });

  it('returns "Yesterday" even when less than 24 hours if different calendar day', () => {
    // Workout at 11 PM yesterday — less than 24h ago but still yesterday
    const yesterday11pm = daysAgo(1, 23);
    expect(formatLastPerformed(yesterday11pm.toISOString())).toBe('Yesterday');
  });

  it('returns "N days ago" for dates 2-6 days ago', () => {
    expect(formatLastPerformed(daysAgo(3).toISOString())).toBe('3 days ago');
    expect(formatLastPerformed(daysAgo(6).toISOString())).toBe('6 days ago');
  });

  it('returns "1 week ago" for a date 7-13 days ago', () => {
    expect(formatLastPerformed(daysAgo(10).toISOString())).toBe('1 week ago');
  });

  it('returns "N weeks ago" for dates 2-3 weeks ago', () => {
    expect(formatLastPerformed(daysAgo(17).toISOString())).toBe('2 weeks ago');
  });

  it('returns formatted date for dates over 4 weeks ago', () => {
    const oldDate = new Date('2025-01-15T10:00:00Z');
    const result = formatLastPerformed(oldDate.toISOString());
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });
});
