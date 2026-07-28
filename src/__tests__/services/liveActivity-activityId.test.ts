/**
 * Tests for Live Activity id persistence in src/services/liveActivity.ts.
 *
 * iOS Live Activities outlive the app process, but currentActivityId is only module-level JS
 * state — so a force-quit mid-workout loses it from memory while the activity itself is still
 * alive on the lock screen. The id is persisted to App Group UserDefaults
 * (`liftai_live_activity_id`) precisely so a cold start can adopt the existing activity
 * instead of creating a second one and stacking an orphaned widget. These tests pin that
 * contract directly against the mock UserDefaults store (`src/__mocks__/shared-user-defaults.ts`),
 * not just the LiveActivity SDK call shape.
 *
 * Each test calls jest.resetModules() and re-requires liveActivity fresh, because the module
 * holds its activity state (currentActivityId etc.) as singleton closure state that would
 * otherwise leak between tests.
 */
import { Platform } from 'react-native';

const ACTIVITY_ID_KEY = 'liftai_live_activity_id';

function freshLiveActivity() {
  jest.resetModules();
  const { Platform: FreshPlatform } = require('react-native');
  Object.defineProperty(FreshPlatform, 'OS', { value: 'ios', writable: true });

  const sud = require('../../../modules/shared-user-defaults');
  const LiveActivitySdk = require('expo-live-activity');
  const liveActivity = require('../../services/liveActivity');
  return { sud, LiveActivitySdk, liveActivity };
}

describe('liveActivity: activity id persistence', () => {
  const originalPlatform = Platform.OS;

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalPlatform, writable: true });
  });

  it('starting an activity persists the id under liftai_live_activity_id', async () => {
    const { sud, liveActivity } = freshLiveActivity();
    sud.__resetStore();

    await liveActivity.startWorkoutActivity('Bench Press', 'Set 1/4');

    expect(sud.getItem(ACTIVITY_ID_KEY)).toBe('mock-activity-id');
  });

  it('cold start with a persisted id ADOPTS it — updates rather than creating a second activity', async () => {
    const { sud, LiveActivitySdk, liveActivity } = freshLiveActivity();
    sud.__resetStore();
    // Simulate a previous process having persisted an activity id before being force-quit.
    sud.setItem(ACTIVITY_ID_KEY, 'persisted-activity-from-previous-process');

    // Fresh module: currentActivityId is null in memory, but the persisted id should be read.
    await liveActivity.startWorkoutActivity('Bench Press', 'Set 1/4');

    expect(LiveActivitySdk.updateActivity).toHaveBeenCalledWith(
      'persisted-activity-from-previous-process',
      expect.objectContaining({ title: 'Bench Press', subtitle: 'Set 1/4' }),
    );
    expect(LiveActivitySdk.startActivity).not.toHaveBeenCalled();
    // No second widget: the persisted id key still points at the adopted activity.
    expect(sud.getItem(ACTIVITY_ID_KEY)).toBe('persisted-activity-from-previous-process');
  });

  it('stopping clears the persisted key even when the in-memory id is already null', async () => {
    const { sud, LiveActivitySdk, liveActivity } = freshLiveActivity();
    sud.__resetStore();
    // A persisted id exists (from a previous process) but this fresh module never adopted it
    // in memory (no startWorkoutActivity call yet) — currentActivityId is null.
    sud.setItem(ACTIVITY_ID_KEY, 'orphaned-activity-id');

    await liveActivity.stopWorkoutActivity();

    // stopActivity should not be invoked (nothing in memory to stop)...
    expect(LiveActivitySdk.stopActivity).not.toHaveBeenCalled();
    // ...but the persisted key must still be cleared, or a later cold start would try to
    // adopt an activity that was never actually stopped/torn down cleanly.
    expect(sud.getItem(ACTIVITY_ID_KEY)).toBeNull();
  });

  it('an "activity not found" error during adopt-update clears the persisted id', async () => {
    const { sud, LiveActivitySdk, liveActivity } = freshLiveActivity();
    sud.__resetStore();
    sud.setItem(ACTIVITY_ID_KEY, 'dead-activity-id');

    // The persisted activity was actually dismissed by iOS/user — update fails with "not found".
    (LiveActivitySdk.updateActivity as jest.Mock).mockImplementationOnce(() => {
      throw new Error('ActivityNotFoundException: Activity with ID not found');
    });

    await liveActivity.startWorkoutActivity('Squats', 'Set 1/3');

    // Falls through to creating a fresh activity...
    expect(LiveActivitySdk.startActivity).toHaveBeenCalledTimes(1);
    // ...and the dead id must no longer be in the persisted store — it's replaced by the
    // freshly created activity's id, not left pointing at a dead activity.
    expect(sud.getItem(ACTIVITY_ID_KEY)).toBe('mock-activity-id');
    expect(sud.getItem(ACTIVITY_ID_KEY)).not.toBe('dead-activity-id');
  });
});
