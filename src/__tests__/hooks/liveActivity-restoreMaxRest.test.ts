/**
 * Tests for Batch 3 Task 2: liveActivity module restores currentMaxRestSeconds
 * from the persisted WorkoutState so first-rest-after-resume has the correct
 * progress bar denominator.
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
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

(Platform as any).OS = 'ios';

describe('Batch 3 Task 2: restore currentMaxRestSeconds on rest update', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('seeds currentMaxRestSeconds from persisted WorkoutState if module was just loaded', async () => {
    const sud = require('../../../modules/shared-user-defaults');
    // Simulate persisted state from a previous session with restMaxSeconds=180
    (sud.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'liftai_workout_state') {
        return JSON.stringify({
          current: { exerciseName: 'Bench', exerciseBlockIndex: 0, setNumber: 2, totalSets: 3, restSeconds: 90, restEnabled: true },
          isResting: true,
          restEndTime: Date.now() + 60000,
          restMaxSeconds: 180,
          workoutActive: true,
        });
      }
      return null;
    });

    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 2/3');
    // Pre-restore the module sees 0; updateWorkoutActivityForRest should
    // restore from persisted state instead of overwriting with the passed
    // remaining-seconds total.
    await updateWorkoutActivityForRest('Bench', 60 /* remaining */, 2, 3);

    expect(getCurrentMaxRestSeconds()).toBe(180);
  });

  it('falls back to totalSeconds if no persisted state has restMaxSeconds', async () => {
    const sud = require('../../../modules/shared-user-defaults');
    (sud.getItem as jest.Mock).mockReturnValue(null);
    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', 90, 1, 3);

    expect(getCurrentMaxRestSeconds()).toBe(90);
  });

  it('does not overwrite an already-set value (subsequent re-syncs do not shrink)', async () => {
    const sud = require('../../../modules/shared-user-defaults');
    (sud.getItem as jest.Mock).mockReturnValue(null);
    const { startWorkoutActivity, updateWorkoutActivityForRest, getCurrentMaxRestSeconds } = require('../../services/liveActivity');

    await startWorkoutActivity('Bench', 'Set 1/3');
    await updateWorkoutActivityForRest('Bench', 90, 1, 3);
    // Re-sync passes a smaller "remaining" — must not shrink the denominator
    await updateWorkoutActivityForRest('Bench', 30, 1, 3);

    expect(getCurrentMaxRestSeconds()).toBe(90);
  });
});
