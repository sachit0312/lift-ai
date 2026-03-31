/**
 * Tests exposing Live Activity and notification duplication bugs.
 *
 * These tests document the actual failure modes reported:
 * - Multiple Live Activity widgets appearing on lock screen
 * - Multiple "Rest Complete" notification banners
 * - Wrong exercise name after auto-reorder
 * - Multiple vibrations on foreground return
 */
import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import * as Notifications from 'expo-notifications';

import {
  startWorkoutActivity,
  updateWorkoutActivityForSet,
  updateWorkoutActivityForRest,
  stopWorkoutActivity,
  stopRestTimerActivity,
  scheduleRestNotification,
  scheduleTimerEndNotification,
  cancelTimerEndNotification,
  adjustRestTimerActivity,
} from '../liveActivity';

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));
const flushNotificationChain = async () => {
  // Flush serialized notification queue — each op chains on Promise
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => process.nextTick(resolve));
  }
};

describe('Live Activity duplication bugs', () => {
  const originalPlatform = Platform.OS;

  beforeEach(async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', writable: true });
    await stopWorkoutActivity();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatform, writable: true });
  });

  // ─── BUG 1: Focus-triggered activity re-creation ───
  // Every tab switch calls loadState() → loadActiveWorkout() → startWorkoutActivity()
  // This creates a NEW Live Activity each time, stacking widgets on lock screen.

  describe('focus-triggered activity stacking', () => {
    it('calling startWorkoutActivity multiple times creates multiple startActivity calls', async () => {
      // Simulates: user starts workout, tabs away, tabs back (focus fires loadState again)
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await startWorkoutActivity('Bench Press', 'Set 2/4');
      await startWorkoutActivity('Bench Press', 'Set 3/4');

      // Each call creates a new activity — even though it tries to stop the old one first
      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(3);
    });

    it('stopActivity failure before new start leaves orphaned activity', async () => {
      // First activity
      await startWorkoutActivity('Bench Press', 'Set 1/4');

      // Simulate: stopActivity fails silently (activity already dismissed by iOS)
      (LiveActivity.stopActivity as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Activity not found');
      });

      // Second call — stop fails but start still creates a new one
      await startWorkoutActivity('Bench Press', 'Set 2/4');

      // TWO activities were started, but only one was (attempted to be) stopped
      // The first activity may still be alive on the lock screen
      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(2);
      expect(LiveActivity.stopActivity).toHaveBeenCalledTimes(1);
    });

    it('startActivity returning null/undefined leaves currentActivityId tracking broken', async () => {
      // Simulate: startActivity returns undefined (can happen on older iOS)
      (LiveActivity.startActivity as jest.Mock).mockReturnValueOnce(undefined);

      await startWorkoutActivity('Bench Press', 'Set 1/4');

      // Now try to update — should no-op because currentActivityId is null
      await updateWorkoutActivityForSet('Bench Press', 2, 4);

      // But the user sees a widget on screen (iOS created it) that's now orphaned
      expect(LiveActivity.updateActivity).not.toHaveBeenCalled();
    });
  });

  // ─── BUG 2: Notification stacking on rapid rest starts ───
  // If user completes sets rapidly, each startRestTimer schedules a new notification.
  // The serialized queue should cancel the old one first, but verify this works.

  describe('notification stacking', () => {
    it('scheduleRestNotification cancels previous before scheduling new', async () => {
      await startWorkoutActivity('Bench Press', 'Set 1/4');

      // First rest
      scheduleRestNotification(120);
      await flushNotificationChain();

      const firstNotifId = (Notifications.scheduleNotificationAsync as jest.Mock).mock.results[0]?.value;

      jest.clearAllMocks();

      // Second rest starts immediately (user completes another set fast)
      scheduleRestNotification(90);
      await flushNotificationChain();

      // Should have cancelled the first notification
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mock-notification-id');
      // And scheduled a new one
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    });

    it('stopRestTimerActivity cancels notification even without active activity', async () => {
      // Schedule a notification
      await scheduleTimerEndNotification(120);
      jest.clearAllMocks();

      // Stop rest — should cancel notification even if activity was dismissed
      stopRestTimerActivity();
      await flushNotificationChain();

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('mock-notification-id');
    });

    it('rapid adjust+stop does not leave orphaned notifications', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      await updateWorkoutActivityForRest('Bench Press', 120, 1, 4);
      scheduleRestNotification(120);

      // Rapid sequence: adjust +15, adjust +15, then stop
      jest.advanceTimersByTime(600); // past throttle
      await adjustRestTimerActivity(15);
      await adjustRestTimerActivity(15);
      stopRestTimerActivity();

      // Flush all queued operations
      jest.useRealTimers();
      await flushNotificationChain();

      // The final state should be: notification cancelled, no orphaned scheduled notifications
      const cancelCalls = (Notifications.cancelScheduledNotificationAsync as jest.Mock).mock.calls.length;
      const scheduleCalls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length;

      // Cancel should have been called at least as many times as schedule
      // (initial schedule + reschedules - final cancel)
      expect(cancelCalls).toBeGreaterThanOrEqual(scheduleCalls);

      jest.useFakeTimers();
      jest.useRealTimers();
    });
  });

  // ─── BUG 3: startWorkoutActivity called from multiple code paths ───
  // loadActiveWorkout (resume), activateWorkout (fresh start), and
  // handleAddExerciseToWorkout (first exercise added) ALL call startWorkoutActivity.
  // If these overlap or fire in sequence, we get stacked activities.

  describe('multiple start paths', () => {
    it('activateWorkout + loadActiveWorkout sequence creates two activities', async () => {
      // Simulates: user starts workout (activateWorkout) then immediately
      // tabs away and back (loadState → loadActiveWorkout)
      await startWorkoutActivity('Bench Press', 'Set 1/4'); // activateWorkout
      await startWorkoutActivity('Bench Press', 'Set 1/4'); // loadActiveWorkout (resume)

      expect(LiveActivity.startActivity).toHaveBeenCalledTimes(2);
    });
  });

  // ─── BUG 4: safeUpdateActivity dedup can cause missed updates ───
  // If exercise name changes but set info stays the same, the JSON comparison
  // might dedup a legitimate update.

  describe('dedup edge cases', () => {
    it('allows updates when only exercise name changes', async () => {
      jest.useFakeTimers();
      await startWorkoutActivity('Bench Press', 'Set 1/4');
      jest.clearAllMocks();

      await updateWorkoutActivityForSet('Bench Press', 2, 4);
      jest.advanceTimersByTime(600); // past throttle

      await updateWorkoutActivityForSet('Squats', 2, 4); // different exercise, same set info

      expect(LiveActivity.updateActivity).toHaveBeenCalledTimes(2);
      expect(LiveActivity.updateActivity).toHaveBeenLastCalledWith(
        'mock-activity-id',
        expect.objectContaining({ title: 'Squats' }),
      );

      jest.useRealTimers();
    });
  });
});
