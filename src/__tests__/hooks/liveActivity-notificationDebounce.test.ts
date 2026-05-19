/**
 * Tests for Batch 3 Task 6: adjustRestTimerActivity coalesces rapid taps
 * into a single notification reschedule.
 */
import { Platform } from 'react-native';

jest.mock('../../../modules/shared-user-defaults', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getItemAndRemove: jest.fn(),
}));

jest.mock('expo-live-activity', () => ({
  startActivity: jest.fn(() => 'activity-id'),
  updateActivity: jest.fn(),
  stopActivity: jest.fn(),
}));

const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockSchedule = jest.fn().mockResolvedValue('notif-id');

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: mockSchedule,
  cancelScheduledNotificationAsync: mockCancel,
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

(Platform as any).OS = 'ios';

describe('Batch 3 Task 6: adjust debounces notification reschedules', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces 5 rapid +15s taps into a single cancel+schedule', async () => {
    const { startWorkoutActivity, updateWorkoutActivityForRest, adjustRestTimerActivity, scheduleRestNotification } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', 60, 1, 3);

    // Schedule a notification so cancelTimerEndNotification's guard is satisfied
    // on the subsequent debounced reschedule (deviation from plan: production
    // only calls cancelScheduledNotificationAsync when currentNotificationId is set).
    scheduleRestNotification(60);
    await Promise.resolve();
    await Promise.resolve();

    // Drain the initial scheduleRestNotification call (if any) by running pending microtasks
    await Promise.resolve();
    mockSchedule.mockClear();
    mockCancel.mockClear();

    // Five rapid +15s adjustments
    for (let i = 0; i < 5; i++) {
      await adjustRestTimerActivity(15);
    }

    // Before the debounce window elapses, no notification ops should have fired
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();

    // After the 300ms debounce window, exactly one cancel + one schedule
    await jest.advanceTimersByTimeAsync(350);
    await Promise.resolve();

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a notification if the final remaining time is <= 0', async () => {
    const { startWorkoutActivity, updateWorkoutActivityForRest, adjustRestTimerActivity, scheduleRestNotification } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', 30, 1, 3);

    // Schedule a notification so cancelTimerEndNotification's guard is satisfied
    scheduleRestNotification(30);
    await Promise.resolve();
    await Promise.resolve();

    await Promise.resolve();
    mockSchedule.mockClear();
    mockCancel.mockClear();

    // -45s puts the timer past zero
    await adjustRestTimerActivity(-45);

    await jest.advanceTimersByTimeAsync(350);
    await Promise.resolve();

    // Cancel always runs; schedule must NOT run when remaining <= 0
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
