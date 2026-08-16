import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';

// Must import after mocks are set up via jest.config.js moduleNameMapper
import {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  requestNotificationPermissions,
  startWorkoutActivity,
  updateWorkoutActivityForSet,
  updateWorkoutActivityForRest,
  stopWorkoutActivity,
  scheduleRestNotification,
  scheduleTimerEndNotification,
  cancelTimerEndNotification,
  resetRestProgressBaseline,
} from '../liveActivity';
import { readRestTimerSnapshot } from '../restTimerSnapshot';

const foregroundNotificationHandler = (
  Notifications.setNotificationHandler as jest.Mock
).mock.calls[0][0] as {
  handleNotification: () => Promise<Record<string, boolean>>;
};

// Helper to flush async microtasks (notification scheduling is async)
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));
const flushNotificationQueue = async () => {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => process.nextTick(resolve));
  }
};

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

  describe('foreground notification presentation', () => {
    it('does not add a foreground rest completion to Notification Center', async () => {
      await expect(foregroundNotificationHandler.handleNotification()).resolves.toEqual(
        expect.objectContaining({
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
        }),
      );
    });
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

    it('reuses existing activity on second call instead of creating new', async () => {
      await startWorkoutActivity('First', 'Set 1/3');
      await startWorkoutActivity('Second', 'Set 1/4');

      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(1);
      expect(LiveActivity.updateActivity).toHaveBeenCalledTimes(1);
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
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
    it('writes the absolute deadline and progress denominator to shared rest state', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      resetRestProgressBaseline();
      const deadline = Date.now() + 120 * 1000;

      await updateWorkoutActivityForRest('Bench Press', deadline, 2, 4, 120);

      expect(readRestTimerSnapshot()).toMatchObject({
        version: 1,
        activityId: 'mock-activity-id',
        exerciseName: 'Bench Press',
        setNumber: 2,
        totalSets: 4,
        endTimeMs: deadline,
        maxRestSeconds: 120,
        isActive: true,
        writer: 'javascript',
      });
    });

    it('updates activity with timer countdown and set info subtitle', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      await updateWorkoutActivityForRest('Bench Press', Date.now() + 90 * 1000, 2, 4, 90);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: 'Set 2/4|90',
          progressBar: expect.objectContaining({
            date: expect.any(Number),
          }),
        }),
      );
    });

    it('does NOT schedule notifications (managed by dedicated timer functions)', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      await updateWorkoutActivityForRest('Bench Press', Date.now() + 90 * 1000, 2, 4, 90);
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

  describe('scheduleTimerEndNotification', () => {
    it('schedules one replaceable banner notification with the expected alert content', async () => {
      await scheduleTimerEndNotification(90);

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'liftai-rest-complete',
          content: expect.objectContaining({
            sound: 'default',
            interruptionLevel: 'timeSensitive',
          }),
          trigger: expect.objectContaining({
            seconds: 90,
          }),
        }),
      );
      const callArg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
      expect(callArg.content.title).toBe('Rest Complete');
      expect(callArg.content.body).toBe('Time for your next set');
    });

    it.each([
      ['pending cancellation', Notifications.cancelScheduledNotificationAsync],
      ['delivered dismissal', Notifications.dismissNotificationAsync],
    ])('continues scheduling when %s fails', async (_operationName, cleanupOperation) => {
      const cleanupError = new Error('notification cleanup failed');
      (cleanupOperation as jest.Mock).mockRejectedValueOnce(cleanupError);

      scheduleRestNotification(90);
      await flushNotificationQueue();

      expect(Notifications.cancelScheduledNotificationAsync)
        .toHaveBeenCalledWith('liftai-rest-complete');
      expect(Notifications.dismissNotificationAsync)
        .toHaveBeenCalledWith('liftai-rest-complete');
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'liftai-rest-complete' }),
      );
      expect(Sentry.captureException).toHaveBeenCalledWith(cleanupError);
    });
  });

  describe('adjustRestTimerActivity', () => {
    it('updates the shared deadline and only grows the denominator for positive adjustments', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      resetRestProgressBaseline();
      const deadline = Date.now() + 120 * 1000;
      await updateWorkoutActivityForRest('Bench Press', deadline, 1, 4, 120);

      await adjustRestTimerActivity(15);
      expect(readRestTimerSnapshot()).toMatchObject({
        endTimeMs: deadline + 15_000,
        maxRestSeconds: 135,
      });

      await adjustRestTimerActivity(-15);
      expect(readRestTimerSnapshot()).toMatchObject({
        endTimeMs: deadline,
        maxRestSeconds: 135,
      });
      jest.useRealTimers();
    });

    it('updates Live Activity with new countdown and preserves exercise name', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await updateWorkoutActivityForRest('Bench Press', Date.now() + 120 * 1000, 1, 4, 120);
      jest.clearAllMocks();

      // Advance past throttle window so adjust update fires immediately
      jest.advanceTimersByTime(600);

      await adjustRestTimerActivity(15);

      expect(LiveActivity.updateActivity).toHaveBeenCalledWith(
        'mock-activity-id',
        expect.objectContaining({
          title: 'Bench Press',
          subtitle: expect.stringMatching(/^Set 1\/4\|\d+$/),
          progressBar: expect.objectContaining({
            date: expect.any(Number),
          }),
        }),
      );
      jest.useRealTimers();
    });

    it('schedules new notification on adjust', async () => {
      jest.useRealTimers(); // ensure no fake timer interference
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await updateWorkoutActivityForRest('Bench Press', Date.now() + 120 * 1000, 1, 4, 120);
      // Schedule a notification to simulate what useRestTimer does
      await scheduleTimerEndNotification(120);

      jest.clearAllMocks();

      await adjustRestTimerActivity(15);
      // Wait past the 300ms notification debounce window
      await new Promise(resolve => setTimeout(resolve, 350));
      // Flush serialized notification chain — use process.nextTick (never faked)
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => process.nextTick(resolve));
      }

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
    });

    it('no-ops when no activity is active', async () => {
      await adjustRestTimerActivity(15);

      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });
  });

  describe('stopRestTimerActivity', () => {
    it('clears shared rest state', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      resetRestProgressBaseline();
      await updateWorkoutActivityForRest(
        'Bench Press', Date.now() + 120 * 1000, 2, 4, 120,
      );
      expect(readRestTimerSnapshot()).not.toBeNull();

      stopRestTimerActivity();

      expect(readRestTimerSnapshot()).toBeNull();
    });

    it('transitions activity back to set entry view with parseable Set subtitle', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.advanceTimersByTime(600);
      // updateWorkoutActivityForRest stores currentSetNumber/currentTotalSets
      await updateWorkoutActivityForRest('Bench Press', Date.now() + 120 * 1000, 2, 4, 120);
      jest.clearAllMocks();

      // Advance past throttle window so stop update fires immediately
      jest.advanceTimersByTime(600);

      stopRestTimerActivity();

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

    it('removes pending and delivered notifications when rest is stopped', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      // Schedule a notification so we can verify it gets cancelled
      await scheduleTimerEndNotification(120);
      await new Promise(resolve => setImmediate(resolve));

      jest.clearAllMocks();

      stopRestTimerActivity();
      // Serialized notification ops chain on microtask queue — flush them
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('liftai-rest-complete');
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('liftai-rest-complete');
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

      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await updateWorkoutActivityForSet('Bench Press', 2, 4);
      await updateWorkoutActivityForRest('Bench Press', Date.now() + 90 * 1000, 2, 4, 90);
      await adjustRestTimerActivity(15);
      stopRestTimerActivity();
      await stopWorkoutActivity();
      await requestNotificationPermissions();

      expect(LiveActivity.startActivity).not.toHaveBeenCalled();
      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
      expect(LiveActivity.stopActivity).not.toHaveBeenCalled();
      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('does not throw when startActivity fails', async () => {
      (LiveActivity.startActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Live Activity not available');
      });

      await expect(startWorkoutActivity('Bench Press', 'Set 1/4')).resolves.not.toThrow();
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
      await updateWorkoutActivityForRest('Bench Press', Date.now() + 90 * 1000, 3, 4, 90);
      await adjustRestTimerActivity(15);
      stopRestTimerActivity();

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
