import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import * as Notifications from 'expo-notifications';

// Must import after mocks are set up via jest.config.js moduleNameMapper
import {
  startRestTimerActivity,
  adjustRestTimerActivity,
  stopRestTimerActivity,
  requestNotificationPermissions,
  getRestTimerRemainingSeconds,
  startWorkoutActivity,
  updateWorkoutActivityForSet,
  updateWorkoutActivityForRest,
  stopWorkoutActivity,
} from '../liveActivity';

// Helper to flush async microtasks (notification scheduling is async)
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('liveActivity service', () => {
  const originalPlatform = Platform.OS;

  beforeEach(async () => {
    // Reset module internal state by stopping the workout activity
    Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
    await stopWorkoutActivity();
    jest.clearAllMocks();
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatform, writable: true });
  });

  describe('startWorkoutActivity', () => {
    it('starts a persistent Live Activity with exercise name', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');

      expect(LiveActivity.startActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Set 1/4',
        }),
        expect.objectContaining({
          deepLinkUrl: '/workout',
        }),
      );
    });

    it('stops previous activity before starting new one', async () => {
      await startWorkoutActivity('First', 'Set 1/3');
      await startWorkoutActivity('Second', 'Set 1/4');

      expect(LiveActivity.stopActivity).toHaveBeenCalled();
      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateWorkoutActivityForSet', () => {
    it('updates activity with set info', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      await updateWorkoutActivityForSet('Bench Press', 2, 4);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Set 2/4',
        }),
      );
    });

    it('no-ops when no activity is active', async () => {
      await updateWorkoutActivityForSet('Bench Press', 1, 4);
      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });
  });

  describe('updateWorkoutActivityForRest', () => {
    it('updates activity with timer countdown and set info subtitle', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      await updateWorkoutActivityForRest('Bench Press', 90, 2, 4);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Set 2/4',
          progressBar: expect.objectContaining({
            date: expect.any(Number),
          }),
        }),
      );
    });

    it('does NOT schedule notifications (managed by dedicated timer functions)', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      await updateWorkoutActivityForRest('Bench Press', 90, 2, 4);
      await flushPromises();

      expect(Notifications.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });
  });

  describe('stopWorkoutActivity', () => {
    it('stops the persistent Live Activity', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      await stopWorkoutActivity();

      expect(LiveActivity.stopActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Workout Complete',
        }),
      );
    });

    it('no-ops when no activity is active', async () => {
      await stopWorkoutActivity();
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
    });
  });

  describe('startRestTimerActivity', () => {
    it('updates existing activity to show rest timer', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      await startRestTimerActivity(150, 'Bench Press');

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Rest Timer',
          progressBar: expect.objectContaining({
            date: expect.any(Number),
          }),
        }),
      );
    });

    it('starts new activity as fallback when none exists', async () => {
      await startRestTimerActivity(150, 'Bench Press');

      expect(LiveActivity.startActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Rest Timer',
          progressBar: expect.objectContaining({
            date: expect.any(Number),
          }),
        }),
        expect.objectContaining({
          timerType: 'circular',
          deepLinkUrl: '/workout',
        }),
      );
    });

    it('schedules banner notification with title, body, and matching seconds', async () => {
      await startRestTimerActivity(90, 'Squats');

      await flushPromises();

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            sound: 'default',
            interruptionLevel: 'timeSensitive',
          }),
          trigger: expect.objectContaining({
            seconds: 90,
          }),
        }),
      );
      // Verify title and body for visible banner notification
      const callArg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
      expect(callArg.content.title).toBe('Rest Complete');
      expect(callArg.content.body).toBe('Time for your next set');
    });
  });

  describe('adjustRestTimerActivity', () => {
    it('updates Live Activity with new countdown and preserves exercise name', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await startRestTimerActivity(120, 'Bench Press');
      jest.clearAllMocks();

      // Advance past throttle window so adjust update fires immediately
      jest.advanceTimersByTime(600);

      await adjustRestTimerActivity(15);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Set 1/1',
          progressBar: expect.objectContaining({
            date: expect.any(Number),
          }),
        }),
      );
      jest.useRealTimers();
    });

    it('awaits cancel before scheduling new notification', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await startRestTimerActivity(120, 'Bench Press');
      await flushPromises();

      jest.clearAllMocks();

      await adjustRestTimerActivity(15);

      await flushPromises();

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mock-notification-id');
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
    });

    it('no-ops when no activity is active', async () => {
      await adjustRestTimerActivity(15);

      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });
  });

  describe('stopRestTimerActivity', () => {
    it('transitions activity back to set entry view with parseable Set subtitle', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.advanceTimersByTime(600);
      // updateWorkoutActivityForSet stores currentSetNumber/currentTotalSets
      await updateWorkoutActivityForSet('Bench Press', 2, 4);
      jest.advanceTimersByTime(600);
      await startRestTimerActivity(120, 'Bench Press');
      jest.clearAllMocks();

      // Advance past throttle window so stop update fires immediately
      jest.advanceTimersByTime(600);

      await stopRestTimerActivity();

      // Should update with "Set X/Y" subtitle (parseable by widget), not stop the activity
      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Set 2/4',
        }),
      );
      // Should NOT stop the activity
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('cancels notification when rest is stopped', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await startRestTimerActivity(120, 'Bench Press');
      await flushPromises();

      jest.clearAllMocks();

      await stopRestTimerActivity();

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mock-notification-id');
    });

    it('no-ops when no activity is active', async () => {
      await stopRestTimerActivity();

      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });
  });

  describe('requestNotificationPermissions', () => {
    it('requests permissions on iOS', async () => {
      await requestNotificationPermissions();

      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    });

    it('no-ops on Android', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', writable: true });

      await requestNotificationPermissions();

      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });
  });

  describe('platform guard', () => {
    it('all functions no-op on Android', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', writable: true });

      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await updateWorkoutActivityForSet('Bench Press', 2, 4);
      await updateWorkoutActivityForRest('Bench Press', 90, 2, 4);
      await startRestTimerActivity(120, 'Bench Press');
      await adjustRestTimerActivity(15);
      await stopRestTimerActivity();
      await stopWorkoutActivity();
      await requestNotificationPermissions();

      expect(LiveActivity.startActivity).not.toHaveBeenCalled();
      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });
  });

  describe('getRestTimerRemainingSeconds', () => {
    it('returns null when no timer is active', () => {
      expect(getRestTimerRemainingSeconds()).toBeNull();
    });

    it('returns remaining seconds when timer is active', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await startRestTimerActivity(120, 'Bench Press');

      const remaining = getRestTimerRemainingSeconds();
      expect(remaining).not.toBeNull();
      expect(remaining).toBeGreaterThanOrEqual(118);
      expect(remaining).toBeLessThanOrEqual(120);
    });

    it('returns remaining seconds for a short-duration timer', async () => {
      await startRestTimerActivity(1, 'Squats');
      const remaining = getRestTimerRemainingSeconds();
      expect(remaining).not.toBeNull();
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(remaining).toBeLessThanOrEqual(1);
    });

    it('returns null after workout activity is stopped', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await startRestTimerActivity(120, 'Bench Press');
      await stopWorkoutActivity();

      expect(getRestTimerRemainingSeconds()).toBeNull();
    });
  });

  describe('error handling', () => {
    it('does not throw when startActivity fails', async () => {
      (LiveActivity.startActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Live Activity not available');
      });

      await expect(startRestTimerActivity(120, 'Bench Press')).resolves.not.toThrow();
    });

    it('does not throw when updateActivity fails', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');

      (LiveActivity.updateActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Activity not found');
      });

      await expect(adjustRestTimerActivity(15)).resolves.not.toThrow();
    });

    it('does not throw when stopActivity fails', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');

      (LiveActivity.stopActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Activity already stopped');
      });

      await expect(stopWorkoutActivity()).resolves.not.toThrow();
    });
  });

  describe('dismissed activity recovery', () => {
    it('nulls out activity ID after "not found" error, subsequent calls no-op', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');

      // Simulate the activity being dismissed by user/iOS
      (LiveActivity.updateActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('ActivityNotFoundException: Activity with ID not found');
      });

      // First call after dismiss — should catch and null out the ID
      await updateWorkoutActivityForSet('Bench Press', 2, 4);
      jest.clearAllMocks();

      // Subsequent calls should no-op (not call updateActivity or throw)
      await updateWorkoutActivityForSet('Bench Press', 3, 4);
      await updateWorkoutActivityForRest('Bench Press', 90, 3, 4);
      await adjustRestTimerActivity(15);
      await stopRestTimerActivity();

      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });

    it('transient error preserves activity ID, subsequent calls still work', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');

      // Simulate a transient/rate-limit error (no "not found" in message)
      (LiveActivity.updateActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Rate limit exceeded');
      });

      // This call hits the error but should NOT null out activity ID
      await updateWorkoutActivityForSet('Bench Press', 2, 4);
      jest.clearAllMocks();

      // Advance past throttle window
      jest.advanceTimersByTime(600);

      // Subsequent call should still invoke updateActivity
      await updateWorkoutActivityForSet('Bench Press', 3, 4);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Set 3/4',
        }),
      );

      jest.useRealTimers();
    });
  });

  describe('deduplication', () => {
    it('prevents duplicate updates with identical content state', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      // First call should go through
      await updateWorkoutActivityForSet('Bench Press', 2, 4);
      // Advance past throttle window
      jest.advanceTimersByTime(600);
      // Second call with identical state should be deduped
      await updateWorkoutActivityForSet('Bench Press', 2, 4);

      expect(LiveActivity.updateActivity).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });

  describe('throttle', () => {
    it('coalesces rapid updates, only first and last fire', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      // First update — goes through immediately
      await updateWorkoutActivityForSet('Bench Press', 2, 4);
      // Rapid updates within throttle window — should be coalesced
      await updateWorkoutActivityForSet('Bench Press', 3, 4);
      await updateWorkoutActivityForSet('Bench Press', 4, 4);

      // Only the first should have fired so far
      expect(LiveActivity.updateActivity).toHaveBeenCalledTimes(1);
      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({ subtitle: 'Set 2/4' }),
      );

      // Advance past throttle window — the last pending update should fire
      jest.advanceTimersByTime(600);

      expect(LiveActivity.updateActivity).toHaveBeenCalledTimes(2);
      expect(LiveActivity.updateActivity).toHaveBeenLastCalledWith(
        'mock-activity-id',
        expect.objectContaining({ subtitle: 'Set 4/4' }),
      );

      jest.useRealTimers();
    });
  });
});
