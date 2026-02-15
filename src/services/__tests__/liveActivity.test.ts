import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import * as Notifications from 'expo-notifications';

// Must import after mocks are set up via jest.config.js moduleNameMapper
import {
  startRestTimerActivity,
  adjustRestTimerActivity,
  stopRestTimerActivity,
  requestNotificationPermissions,
} from '../liveActivity';

// Helper to flush async microtasks (notification scheduling is async)
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('liveActivity service', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    // Reset module internal state by stopping any active activity
    Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
    stopRestTimerActivity();
    jest.clearAllMocks();
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatform, writable: true });
  });

  describe('startRestTimerActivity', () => {
    it('starts a Live Activity with correct title and countdown', () => {
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

    it('stops previous activity before starting new one', () => {
      startRestTimerActivity(60, 'First Exercise');
      startRestTimerActivity(90, 'Second Exercise');

      // stopActivity called for the first one, then startActivity for second
      expect(LiveActivity.stopActivity).toHaveBeenCalled();
      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(2);
    });
  });

  describe('adjustRestTimerActivity', () => {
    it('updates Live Activity with new countdown', () => {
      startRestTimerActivity(120, 'Bench Press');
      jest.clearAllMocks();

      adjustRestTimerActivity(15);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          progressBar: expect.objectContaining({
            date: expect.any(Number),
          }),
        }),
      );
    });

    it('reschedules notification with adjusted time', async () => {
      startRestTimerActivity(120, 'Bench Press');
      await flushPromises(); // wait for initial notification to be scheduled

      jest.clearAllMocks();

      adjustRestTimerActivity(15);

      await flushPromises();

      // Should cancel old and schedule new
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mock-notification-id');
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
    });

    it('no-ops when no activity is active', () => {
      adjustRestTimerActivity(15);

      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });
  });

  describe('stopRestTimerActivity', () => {
    it('stops the Live Activity and cancels notification', async () => {
      startRestTimerActivity(120, 'Bench Press');
      await flushPromises(); // wait for notification ID to be set

      jest.clearAllMocks();

      stopRestTimerActivity();

      expect(LiveActivity.stopActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Rest Complete',
        }),
      );
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mock-notification-id');
    });

    it('no-ops when no activity is active', () => {
      stopRestTimerActivity();

      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
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

      startRestTimerActivity(120, 'Bench Press');
      adjustRestTimerActivity(15);
      stopRestTimerActivity();
      await requestNotificationPermissions();

      expect(LiveActivity.startActivity).not.toHaveBeenCalled();
      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
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
      startRestTimerActivity(120, 'Bench Press');

      (LiveActivity.updateActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Activity not found');
      });

      expect(() => adjustRestTimerActivity(15)).not.toThrow();
    });

    it('does not throw when stopActivity fails', () => {
      startRestTimerActivity(120, 'Bench Press');

      (LiveActivity.stopActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Activity already stopped');
      });

      expect(() => stopRestTimerActivity()).not.toThrow();
    });
  });
});
