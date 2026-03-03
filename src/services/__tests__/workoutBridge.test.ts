import { Platform } from 'react-native';
import {
  syncStateToWidget,
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
    // Default to iOS
    (Platform as any).OS = 'ios';
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

  describe('clearWidgetState', () => {
    it('removes workout state from UserDefaults', () => {
      clearWidgetState();
      expect(mockRemoveItem).toHaveBeenCalledWith('liftai_workout_state');
      expect(mockRemoveItem).toHaveBeenCalledTimes(1);
    });

    it('no-ops on Android', () => {
      (Platform as any).OS = 'android';
      clearWidgetState();
      expect(mockRemoveItem).not.toHaveBeenCalled();
    });
  });
});
