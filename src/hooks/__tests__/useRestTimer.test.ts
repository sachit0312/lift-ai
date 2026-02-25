import { renderHook, act } from '@testing-library/react-native';
import { AppState, Vibration } from 'react-native';
import { useRestTimer } from '../useRestTimer';

// ─── Mocks ───

jest.mock('../../services/liveActivity', () => ({
  adjustRestTimerActivity: jest.fn(),
  stopRestTimerActivity: jest.fn(),
  getRestTimerRemainingSeconds: jest.fn(),
}));

const {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  getRestTimerRemainingSeconds,
} = require('../../services/liveActivity');

// Capture the AppState listener so tests can simulate foreground return
let appStateCallback: ((state: string) => void) | null = null;
const mockRemove = jest.fn();
jest.spyOn(AppState, 'addEventListener').mockImplementation((type: string, cb: any) => {
  if (type === 'change') {
    appStateCallback = cb;
  }
  return { remove: mockRemove } as any;
});

jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});

// ─── Helpers ───

function setup(overrides?: Partial<{ onRestEnd: jest.Mock; onRestUpdate: jest.Mock }>) {
  const onRestEnd = overrides?.onRestEnd ?? jest.fn();
  const onRestUpdate = overrides?.onRestUpdate ?? jest.fn();
  const hook = renderHook(() => useRestTimer({ onRestEnd, onRestUpdate }));
  return { ...hook, onRestEnd, onRestUpdate };
}

// ─── Tests ───

describe('useRestTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateCallback = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns correct initial state', () => {
    const { result } = setup();

    expect(result.current.restSeconds).toBe(0);
    expect(result.current.restTotal).toBe(0);
    expect(result.current.restExerciseName).toBe('');
    expect(result.current.isResting).toBe(false);
    expect(result.current.currentEndTime).toBe(0);
  });

  it('startRestTimer sets correct state and calls onRestUpdate', () => {
    const { result, onRestUpdate } = setup();

    act(() => {
      result.current.startRestTimer(120, 'Bench Press');
    });

    expect(result.current.restSeconds).toBe(120);
    expect(result.current.restTotal).toBe(120);
    expect(result.current.restExerciseName).toBe('Bench Press');
    expect(result.current.isResting).toBe(true);
    expect(result.current.currentEndTime).toBeGreaterThan(0);

    expect(onRestUpdate).toHaveBeenCalledTimes(1);
    expect(onRestUpdate).toHaveBeenCalledWith(true, expect.any(Number));
    // End time should be roughly now + 120s
    const endTime = onRestUpdate.mock.calls[0][1];
    expect(endTime).toBeGreaterThanOrEqual(Date.now() + 119 * 1000);
  });

  it('timer counts down and calls onRestEnd at 0', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(3, 'Squats');
    });

    expect(result.current.restSeconds).toBe(3);

    // Advance 1 second
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.restSeconds).toBe(2);

    // Advance 1 more second
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.restSeconds).toBe(1);

    // Advance 1 more second - should hit 0
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.restSeconds).toBe(0);
    expect(result.current.isResting).toBe(false);

    expect(onRestEnd).toHaveBeenCalledTimes(1);
    expect(stopRestTimerActivity).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);
  });

  it('adjustRestTimer modifies remaining time and calls onRestUpdate', () => {
    const { result, onRestUpdate } = setup();

    act(() => {
      result.current.startRestTimer(60, 'Deadlift');
    });
    onRestUpdate.mockClear();

    // Adjust +15
    act(() => {
      result.current.adjustRestTimer(15);
    });

    expect(result.current.restSeconds).toBe(75);
    expect(result.current.restTotal).toBe(75);
    expect(adjustRestTimerActivity).toHaveBeenCalledWith(15);
    expect(onRestUpdate).toHaveBeenCalledWith(true, expect.any(Number));

    onRestUpdate.mockClear();

    // Adjust -30
    act(() => {
      result.current.adjustRestTimer(-30);
    });

    expect(result.current.restSeconds).toBe(45);
    expect(result.current.restTotal).toBe(45);
    expect(adjustRestTimerActivity).toHaveBeenCalledWith(-30);
    expect(onRestUpdate).toHaveBeenCalledWith(true, expect.any(Number));
  });

  it('adjustRestTimer clears interval when reaching 0', () => {
    const { result } = setup();

    act(() => {
      result.current.startRestTimer(10, 'Curls');
    });

    // Adjust by -15 (more than remaining) — clamped to 0
    act(() => {
      result.current.adjustRestTimer(-15);
    });

    expect(result.current.restSeconds).toBe(0);
    expect(result.current.isResting).toBe(false);
  });

  it('dismissRest clears timer and resets state', () => {
    const { result } = setup();

    act(() => {
      result.current.startRestTimer(90, 'OHP');
    });

    expect(result.current.isResting).toBe(true);

    act(() => {
      result.current.dismissRest();
    });

    expect(result.current.restSeconds).toBe(0);
    expect(result.current.isResting).toBe(false);
    expect(result.current.currentEndTime).toBe(0);
    expect(stopRestTimerActivity).toHaveBeenCalled();
  });

  it('starting a new rest timer replaces the previous one', () => {
    const { result, onRestUpdate } = setup();

    act(() => {
      result.current.startRestTimer(60, 'Bench Press');
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.restSeconds).toBe(58);

    // Start a new timer
    act(() => {
      result.current.startRestTimer(90, 'Squats');
    });

    expect(result.current.restSeconds).toBe(90);
    expect(result.current.restExerciseName).toBe('Squats');
    expect(result.current.isResting).toBe(true);
  });

  it('resyncs on foreground return with remaining time', () => {
    const { result } = setup();

    act(() => {
      result.current.startRestTimer(120, 'Rows');
    });

    // Simulate foreground return with 45s remaining
    getRestTimerRemainingSeconds.mockReturnValue(45);
    act(() => {
      appStateCallback?.('active');
    });

    expect(result.current.restSeconds).toBe(45);
    expect(result.current.isResting).toBe(true);
  });

  it('resyncs on foreground return when timer expired', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(120, 'Rows');
    });

    // Simulate foreground return with expired timer
    getRestTimerRemainingSeconds.mockReturnValue(0);
    act(() => {
      appStateCallback?.('active');
    });

    expect(result.current.restSeconds).toBe(0);
    expect(result.current.isResting).toBe(false);
    expect(onRestEnd).toHaveBeenCalledTimes(1);
    expect(stopRestTimerActivity).toHaveBeenCalled();
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);
  });

  it('foreground return does nothing when not resting', () => {
    const { result, onRestEnd } = setup();

    // Not resting — foreground return should be a no-op
    act(() => {
      appStateCallback?.('active');
    });

    expect(result.current.restSeconds).toBe(0);
    expect(onRestEnd).not.toHaveBeenCalled();
  });

  it('cleans up interval on unmount', () => {
    const { result, unmount } = setup();

    act(() => {
      result.current.startRestTimer(60, 'Bench');
    });

    expect(result.current.isResting).toBe(true);

    unmount();

    // Advancing timers should not cause errors (interval was cleaned up)
    act(() => {
      jest.advanceTimersByTime(5000);
    });
  });

  it('removes AppState listener on unmount', () => {
    const { unmount } = setup();
    unmount();
    expect(mockRemove).toHaveBeenCalled();
  });
});
