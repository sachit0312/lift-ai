export const scheduleNotificationAsync = jest.fn().mockResolvedValue('mock-notification-id');
export const cancelScheduledNotificationAsync = jest.fn().mockResolvedValue(undefined);
export const cancelAllScheduledNotificationsAsync = jest.fn().mockResolvedValue(undefined);
export const requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const setNotificationHandler = jest.fn();

export const SchedulableTriggerInputTypes = {
  TIME_INTERVAL: 'timeInterval',
  DATE: 'date',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  CALENDAR: 'calendar',
} as const;
