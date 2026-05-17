/**
 * Tests for Batch 3 Task 5: applyPendingWidgetActions uses atomic
 * getItemAndRemove so two concurrent foreground events can't drain
 * the same queue twice.
 */
import { Platform } from 'react-native';

jest.mock('../../../modules/shared-user-defaults', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  getItemAndRemove: jest.fn(),
}));

jest.mock('expo-live-activity', () => ({
  startActivity: jest.fn(),
  updateActivity: jest.fn(),
  stopActivity: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

(Platform as any).OS = 'ios';

describe('Batch 3 Task 5: applyPendingWidgetActions atomicity', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('reads via getItemAndRemove (not separate getItem + removeItem)', () => {
    const sud = require('../../../modules/shared-user-defaults');
    (sud.getItemAndRemove as jest.Mock).mockReturnValue(
      JSON.stringify([{ type: 'adjustRest', delta: 15, ts: 1 }]),
    );
    const { applyPendingWidgetActions } = require('../../services/liveActivity');
    const delta = applyPendingWidgetActions();
    expect(delta).toBe(15);
    expect(sud.getItemAndRemove).toHaveBeenCalledWith('liftai_action_queue');
    expect(sud.getItem).not.toHaveBeenCalled();
    expect(sud.removeItem).not.toHaveBeenCalled();
  });

  it('handles an empty queue (no actions present)', () => {
    const sud = require('../../../modules/shared-user-defaults');
    (sud.getItemAndRemove as jest.Mock).mockReturnValue(null);
    const { applyPendingWidgetActions } = require('../../services/liveActivity');
    expect(applyPendingWidgetActions()).toBe(0);
  });

  it('returns -Infinity when a skipRest action is present', () => {
    const sud = require('../../../modules/shared-user-defaults');
    (sud.getItemAndRemove as jest.Mock).mockReturnValue(
      JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: 1 },
        { type: 'skipRest', ts: 2 },
      ]),
    );
    const { applyPendingWidgetActions } = require('../../services/liveActivity');
    expect(applyPendingWidgetActions()).toBe(-Infinity);
  });

  it('sums multiple adjustRest deltas', () => {
    const sud = require('../../../modules/shared-user-defaults');
    (sud.getItemAndRemove as jest.Mock).mockReturnValue(
      JSON.stringify([
        { type: 'adjustRest', delta: 15, ts: 1 },
        { type: 'adjustRest', delta: -15, ts: 2 },
        { type: 'adjustRest', delta: 15, ts: 3 },
      ]),
    );
    const { applyPendingWidgetActions } = require('../../services/liveActivity');
    expect(applyPendingWidgetActions()).toBe(15);
  });
});
