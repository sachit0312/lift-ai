/**
 * Calendar-day difference in the LOCAL timezone, robust to DST boundaries.
 *
 * Uses `new Date(year, month, day)` to normalize both timestamps to local midnight,
 * then converts the difference to days via 86400000 ms. Because both endpoints are
 * normalized to the same time-of-day in local time, DST shifts cancel out across
 * any single day boundary and do not affect the integer result.
 *
 * Returns a non-negative integer. Future timestamps return 0.
 */
export function daysAgo(iso: string): number {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.max(0, Math.round((today.getTime() - dateDay.getTime()) / 86400000));
}
