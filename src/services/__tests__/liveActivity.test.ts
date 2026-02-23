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

  beforeEach(() => {
    // Reset module internal state by stopping the workout activity
    Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
    stopWorkoutActivity();
    jest.clearAllMocks();
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatform, writable: true });
  });

  describe('startWorkoutActivity', () => {
    it('starts a persistent Live Activity with exercise name', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');

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

    it('stops previous activity before starting new one', () => {
      startWorkoutActivity('First', 'Set 1/3');
      startWorkoutActivity('Second', 'Set 1/4');

      expect(LiveActivity.stopActivity).toHaveBeenCalled();
      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateWorkoutActivityForSet', () => {
    it('updates activity with set info', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      updateWorkoutActivityForSet('Bench Press', 2, 4);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Set 2/4',
        }),
      );
    });

    it('no-ops when no activity is active', () => {
      updateWorkoutActivityForSet('Bench Press', 1, 4);
      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });
  });

  describe('updateWorkoutActivityForRest', () => {
    it('updates activity with timer countdown', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      updateWorkoutActivityForRest('Bench Press', 90);

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
  });

  describe('stopWorkoutActivity', () => {
    it('stops the persistent Live Activity', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      stopWorkoutActivity();

      expect(LiveActivity.stopActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Workout Complete',
        }),
      );
    });

    it('no-ops when no activity is active', () => {
      stopWorkoutActivity();
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
    });
  });

  describe('startRestTimerActivity', () => {
    it('updates existing activity to show rest timer', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      startRestTimerActivity(150, 'Bench Press');

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

    it('starts new activity as fallback when none exists', () => {
      startRestTimerActivity(150, 'Bench Press');

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

    it('schedules a notification with matching seconds', async () => {
      startRestTimerActivity(90, 'Squats');

      await flushPromises();

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            title: 'Rest Timer Done',
            body: 'Time for your next set of Squats',
          }),
          trigger: expect.objectContaining({
            seconds: 90,
          }),
        }),
      );
    });
  });

  describe('adjustRestTimerActivity', () => {
    it('updates Live Activity with new countdown and preserves exercise name', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      startRestTimerActivity(120, 'Bench Press');
      jest.clearAllMocks();

      adjustRestTimerActivity(15);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          progressBar: expect.objectContaining({
            date: expect.any(Number),
          }),
        }),
      );
    });

    it('reschedules notification with adjusted time', async () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      startRestTimerActivity(120, 'Bench Press');
      await flushPromises();

      jest.clearAllMocks();

      adjustRestTimerActivity(15);

      await flushPromises();

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mock-notification-id');
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
    });

    it('no-ops when no activity is active', () => {
      adjustRestTimerActivity(15);

      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });
  });

  describe('stopRestTimerActivity', () => {
    it('transitions activity back to set entry view', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      startRestTimerActivity(120, 'Bench Press');
      jest.clearAllMocks();

      stopRestTimerActivity();

      // Should update to "Next Set" view, not stop the activity
      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Next Set',
        }),
      );
      // Should NOT stop the activity
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
    });

    it('cancels notification when rest is stopped', async () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      startRestTimerActivity(120, 'Bench Press');
      await flushPromises();

      jest.clearAllMocks();

      stopRestTimerActivity();

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mock-notification-id');
    });

    it('no-ops when no activity is active', () => {
      stopRestTimerActivity();

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

      startWorkoutActivity('Bench Press', 'Set 1/4');
      updateWorkoutActivityForSet('Bench Press', 2, 4);
      updateWorkoutActivityForRest('Bench Press', 90);
      startRestTimerActivity(120, 'Bench Press');
      adjustRestTimerActivity(15);
      stopRestTimerActivity();
      stopWorkoutActivity();
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

    it('returns remaining seconds when timer is active', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      startRestTimerActivity(120, 'Bench Press');

      const remaining = getRestTimerRemainingSeconds();
      expect(remaining).not.toBeNull();
      expect(remaining).toBeGreaterThanOrEqual(118);
      expect(remaining).toBeLessThanOrEqual(120);
    });

    it('returns remaining seconds for a short-duration timer', () => {
      startRestTimerActivity(1, 'Squats');
      const remaining = getRestTimerRemainingSeconds();
      expect(remaining).not.toBeNull();
      expect(remaining).toBeGreaterThanOrEqual(0);
      expect(remaining).toBeLessThanOrEqual(1);
    });

    it('returns null after workout activity is stopped', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');
      startRestTimerActivity(120, 'Bench Press');
      stopWorkoutActivity();

      expect(getRestTimerRemainingSeconds()).toBeNull();
    });
  });

  describe('error handling', () => {
    it('does not throw when startActivity fails', () => {
      (LiveActivity.startActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Live Activity not available');
      });

      expect(() => startRestTimerActivity(120, 'Bench Press')).not.toThrow();
    });

    it('does not throw when updateActivity fails', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');

      (LiveActivity.updateActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Activity not found');
      });

      expect(() => adjustRestTimerActivity(15)).not.toThrow();
    });

    it('does not throw when stopActivity fails', () => {
      startWorkoutActivity('Bench Press', 'Set 1/4');

      (LiveActivity.stopActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Activity already stopped');
      });

      expect(() => stopWorkoutActivity()).not.toThrow();
    });
  });
});
