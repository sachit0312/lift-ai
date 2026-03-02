import { Platform } from 'react-native';
import {
  syncStateToWidget,
  pollForActions,
  startPolling,
  stopPolling,
  clearWidgetState,
  type WidgetState,
} from '../workoutBridge';
import { setItem, getItem, removeItem } from '../../../modules/shared-user-defaults';

// Mock the shared-user-defaults module
jest.mock('../../../modules/shared-user-defaults');

const mockSetItem = setItem as jest.MockedFunction<typeof setItem>;
const mockGetItem = getItem as jest.MockedFunction<typeof getItem>;
const mockRemoveItem = removeItem as jest.MockedFunction<typeof removeItem>;

const createMockWidgetState = (overrides?: Partial<WidgetState>): WidgetState => ({
  current: {
    exerciseName: 'Bench Press',
    exerciseBlockIndex: 0,
    setNumber: 1,
    totalSets: 4,
    restSeconds: 150,
    restEnabled: true,
  },
  isResting: false,
  restEndTime: 0,
  workoutActive: true,
  ...overrides,
});

describe('workoutBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Default to iOS
    (Platform as any).OS = 'ios';
  });

  afterEach(() => {
    stopPolling();
    jest.useRealTimers();
  });

  describe('syncStateToWidget', () => {
    it('writes serialized state to UserDefaults', () => {
      const state = createMockWidgetState();
      syncStateToWidget(state);

      expect(mockSetItem).toHaveBeenCalledWith(
        'liftai_workout_state',
        JSON.stringify(state),
      );
    });

    it('no-ops on Android', () => {
      (Platform as any).OS = 'android';
      syncStateToWidget(createMockWidgetState());
      expect(mockSetItem).not.toHaveBeenCalled();
    });

    it('handles write errors gracefully', () => {
      mockSetItem.mockImplementation(() => { throw new Error('write failed'); });
      // Should not throw
      expect(() => syncStateToWidget(createMockWidgetState())).not.toThrow();
    });
  });

  describe('pollForActions', () => {
    it('returns empty array when no actions', () => {
      mockGetItem.mockReturnValue(null);
      expect(pollForActions()).toEqual([]);
    });

    it('reads and clears action queue', () => {
      const actions = [
        { type: 'skipRest', ts: 1740000000 },
      ];
      mockGetItem.mockReturnValue(JSON.stringify(actions));

      const result = pollForActions();

      expect(result).toEqual(actions);
      expect(mockRemoveItem).toHaveBeenCalledWith('liftai_action_queue');
    });

    it('reads adjustRest action with delta', () => {
      const actions = [
        { type: 'adjustRest', delta: 15, ts: 1740000000 },
      ];
      mockGetItem.mockReturnValue(JSON.stringify(actions));

      const result = pollForActions();

      expect(result).toEqual(actions);
      expect(result[0]).toHaveProperty('delta', 15);
    });

    it('no-ops on Android', () => {
      (Platform as any).OS = 'android';
      expect(pollForActions()).toEqual([]);
      expect(mockGetItem).not.toHaveBeenCalled();
    });

    it('handles malformed JSON gracefully', () => {
      mockGetItem.mockReturnValue('not-json');
      expect(pollForActions()).toEqual([]);
    });

    it('handles read errors gracefully', () => {
      mockGetItem.mockImplementation(() => { throw new Error('read failed'); });
      expect(pollForActions()).toEqual([]);
    });
  });

  describe('startPolling / stopPolling', () => {
    it('calls callback with actions on interval', () => {
      const actions = [{ type: 'skipRest', ts: 1740000000 }];
      mockGetItem
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(JSON.stringify(actions));

      const callback = jest.fn();
      startPolling(callback);

      // First tick: no actions
      jest.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      // Second tick: actions available
      jest.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledWith(actions);
    });

    it('stops polling on stopPolling', () => {
      const callback = jest.fn();
      startPolling(callback);
      stopPolling();

      mockGetItem.mockReturnValue(JSON.stringify([{ type: 'skipRest', ts: 1 }]));
      jest.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('replaces previous polling interval', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      startPolling(callback1);
      startPolling(callback2);

      mockGetItem.mockReturnValue(JSON.stringify([{ type: 'skipRest', ts: 1 }]));
      jest.advanceTimersByTime(500);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('no-ops on Android', () => {
      (Platform as any).OS = 'android';
      const callback = jest.fn();
      startPolling(callback);
      jest.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clearWidgetState', () => {
    it('removes both state and action queue', () => {
      clearWidgetState();
      expect(mockRemoveItem).toHaveBeenCalledWith('liftai_workout_state');
      expect(mockRemoveItem).toHaveBeenCalledWith('liftai_action_queue');
    });

    it('no-ops on Android', () => {
      (Platform as any).OS = 'android';
      clearWidgetState();
      expect(mockRemoveItem).not.toHaveBeenCalled();
    });
  });
});
