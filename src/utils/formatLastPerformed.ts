export function formatLastPerformed(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();

  // Compare calendar days in local timezone
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const workoutDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - workoutDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
