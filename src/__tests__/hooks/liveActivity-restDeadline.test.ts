/**
 * The rest countdown on the lock screen is driven by an ABSOLUTE deadline that only the rest
 * timer may set, plus a progress-bar denominator owned by the caller.
 *
 * Both invariants replace an earlier design where callers passed "remaining seconds", the
 * module rebuilt the deadline as Date.now() + seconds, and the denominator was mirrored to the
 * App Group and restored from there. The mirror had exactly one writer — this module — so the
 * round-trip could only ever resurrect the previous rest's value.
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

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

(Platform as any).OS = 'ios';

/** Advance past safeUpdateActivity's 500ms throttle so the next push is sent immediately. */
const THROTTLE_MS = 600;

describe('liveActivity rest deadline & progress denominator', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses the caller-supplied total as the progress denominator', async () => {
    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } =
      require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', Date.now() + 90_000, 1, 3, 90);

    expect(getCurrentMaxRestSeconds()).toBe(90);
  });

  it('never restores a denominator from the App Group mirror', async () => {
    const sud = require('../../../modules/shared-user-defaults');
    // A previous rest left 180 behind. It must not leak into this one.
    (sud.getItem as jest.Mock).mockImplementation((key: string) =>
      key === 'liftai_workout_state' ? JSON.stringify({ restMaxSeconds: 180 }) : null,
    );

    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } =
      require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', Date.now() + 60_000, 1, 3, 60);

    expect(getCurrentMaxRestSeconds()).toBe(60);
  });

  it('derives the denominator from the deadline when the caller omits it', async () => {
    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } =
      require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', Date.now() + 45_000, 1, 3);

    expect(getCurrentMaxRestSeconds()).toBe(45);
  });

  it('does not shrink the denominator on a re-sync', async () => {
    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } =
      require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', Date.now() + 90_000, 1, 3, 90);
    await updateWorkoutActivityForRest('Bench', Date.now() + 30_000, 1, 3, 30);

    expect(getCurrentMaxRestSeconds()).toBe(90);
  });

  it('resetRestProgressBaseline lets a shorter rest set its own denominator', async () => {
    const {
      startWorkoutActivity, updateWorkoutActivityForRest,
      resetRestProgressBaseline, getCurrentMaxRestSeconds,
    } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', Date.now() + 150_000, 1, 3, 150);
    expect(getCurrentMaxRestSeconds()).toBe(150);

    resetRestProgressBaseline();
    await updateWorkoutActivityForRest('Curls', Date.now() + 60_000, 1, 3, 60);

    expect(getCurrentMaxRestSeconds()).toBe(60);
  });

  it('sends the deadline through verbatim rather than rebuilding it from remaining time', async () => {
    const LiveActivity = require('expo-live-activity');
    const { startWorkoutActivity, updateWorkoutActivityForRest } =
      require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    jest.advanceTimersByTime(THROTTLE_MS);

    const deadline = Date.now() + 120_000;
    await updateWorkoutActivityForRest('Bench', deadline, 2, 3, 120);

    expect(LiveActivity.updateActivity).toHaveBeenLastCalledWith('activity-id', {
      title: 'Bench',
      subtitle: 'Set 2/3|120',
      progressBar: { date: deadline },
      // staleDate === the rest deadline: the only mechanism that can make the widget drop
      // the countdown when it expires while the phone is locked and JS is suspended.
      staleDate: deadline,
    });
  });

  describe('incidental syncs during rest', () => {
    it('updateWorkoutActivityForSet refreshes labels without disturbing the countdown', async () => {
      const LiveActivity = require('expo-live-activity');
      const {
        startWorkoutActivity, updateWorkoutActivityForRest, updateWorkoutActivityForSet,
      } = require('../../services/liveActivity');

      await startWorkoutActivity('Bench', 'Set 1/3');
      jest.advanceTimersByTime(THROTTLE_MS);

      const deadline = Date.now() + 120_000;
      await updateWorkoutActivityForRest('Bench', deadline, 2, 3, 120);
      jest.advanceTimersByTime(THROTTLE_MS);

      // This is the call that used to strip the timer off the lock screen ~500ms into
      // every rest, because isRestingRef had not flushed when syncWidgetState read it.
      await updateWorkoutActivityForSet('Bench', 3, 3);
      jest.advanceTimersByTime(THROTTLE_MS);

      expect(LiveActivity.updateActivity).toHaveBeenLastCalledWith('activity-id', {
        title: 'Bench',
        subtitle: 'Set 3/3|120',
        progressBar: { date: deadline },
        staleDate: deadline,
      });
    });

    it('drops a no-op refresh entirely so SwiftUI never recreates the timer views', async () => {
      const LiveActivity = require('expo-live-activity');
      const {
        startWorkoutActivity, updateWorkoutActivityForRest, updateWorkoutActivityForSet,
      } = require('../../services/liveActivity');

      await startWorkoutActivity('Bench', 'Set 1/3');
      jest.advanceTimersByTime(THROTTLE_MS);

      await updateWorkoutActivityForRest('Bench', Date.now() + 120_000, 2, 3, 120);
      jest.advanceTimersByTime(THROTTLE_MS);

      const callsAfterRestStart = LiveActivity.updateActivity.mock.calls.length;
      await updateWorkoutActivityForSet('Bench', 2, 3);
      jest.advanceTimersByTime(THROTTLE_MS);

      expect(LiveActivity.updateActivity.mock.calls.length).toBe(callsAfterRestStart);
    });

    it('removes only the orphaned rest notification when adopting an activity from a dead process', async () => {
      const sud = require('../../../modules/shared-user-defaults');
      const Notifications = require('expo-notifications');
      // A previous process force-quit mid-rest: the activity id survived in the App Group but
      // In-memory notification state did not. The stable identifier must still reach both a
      // pending request and a delivered "Rest Complete" notification without touching other
      // app notifications.
      (sud.getItem as jest.Mock).mockImplementation((key: string) =>
        key === 'liftai_live_activity_id' ? 'stale-activity-id' : null,
      );

      const { startWorkoutActivity } = require('../../services/liveActivity');
      await startWorkoutActivity('Bench', 'Set 1/3');
      await Promise.resolve();
      await Promise.resolve();

      expect(Notifications.cancelScheduledNotificationAsync)
        .toHaveBeenCalledWith('liftai-rest-complete');
      expect(Notifications.dismissNotificationAsync)
        .toHaveBeenCalledWith('liftai-rest-complete');
      expect(Notifications.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    });

    it('drops the persisted activity id when the activity is gone', async () => {
      const LiveActivity = require('expo-live-activity');
      const sud = require('../../../modules/shared-user-defaults');
      const { startWorkoutActivity, updateWorkoutActivityForSet } =
        require('../../services/liveActivity');

      await startWorkoutActivity('Bench', 'Set 1/3');
      jest.advanceTimersByTime(THROTTLE_MS);
      (sud.removeItem as jest.Mock).mockClear();

      LiveActivity.updateActivity.mockImplementationOnce(() => {
        throw new Error("Activity with ID 'activity-id' not found");
      });
      await updateWorkoutActivityForSet('Bench', 2, 3);

      // Without this, a cold start would adopt an activity iOS already dismissed.
      expect(sud.removeItem).toHaveBeenCalledWith('liftai_live_activity_id');
    });

    it('returns to the set view once the rest has been stopped', async () => {
      const LiveActivity = require('expo-live-activity');
      const {
        startWorkoutActivity, updateWorkoutActivityForRest,
        stopRestTimerActivity, updateWorkoutActivityForSet,
      } = require('../../services/liveActivity');

      await startWorkoutActivity('Bench', 'Set 1/3');
      jest.advanceTimersByTime(THROTTLE_MS);

      await updateWorkoutActivityForRest('Bench', Date.now() + 120_000, 2, 3, 120);
      jest.advanceTimersByTime(THROTTLE_MS);

      stopRestTimerActivity();
      jest.advanceTimersByTime(THROTTLE_MS);

      await updateWorkoutActivityForSet('Bench', 3, 3);
      jest.advanceTimersByTime(THROTTLE_MS);

      expect(LiveActivity.updateActivity).toHaveBeenLastCalledWith('activity-id', {
        title: 'Bench',
        subtitle: 'Set 3/3',
      });
    });
  });
});
