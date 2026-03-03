import { renderHook, act } from '@testing-library/react-native';
import { AppState, Vibration } from 'react-native';
import { useRestTimer } from '../useRestTimer';

// ─── Mocks ───

jest.mock('../../services/liveActivity', () => ({
  adjustRestTimerActivity: jest.fn(),
  stopRestTimerActivity: jest.fn(),
  scheduleRestNotification: jest.fn(),
  isRestNotificationScheduled: jest.fn(() => true), // notification scheduled by default
}));

const {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  scheduleRestNotification,
  isRestNotificationScheduled,
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

  it('startRestTimer schedules notification', () => {
    const { result } = setup();

    act(() => {
      result.current.startRestTimer(90, 'Squats');
    });

    expect(scheduleRestNotification).toHaveBeenCalledWith(90);
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
    // No in-app vibration — notification already alerted user
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  it('endRest re-entrancy guard prevents multiple vibrations', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(1, 'Bench');
    });

    // Timer expires — first endRest call
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(onRestEnd).toHaveBeenCalledTimes(1);
    // No in-app vibration — notification handles it
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    // Simulate foreground resync also trying to call endRest
    jest.clearAllMocks();
    act(() => {
      appStateCallback?.('active');
    });

    // Second call should be a no-op (endingRef guard)
    expect(onRestEnd).not.toHaveBeenCalled();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
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
    expect(result.current.restTotal).toBe(75); // restTotal never decreases (matches lock screen widget)
    expect(adjustRestTimerActivity).toHaveBeenCalledWith(-30);
    expect(onRestUpdate).toHaveBeenCalledWith(true, expect.any(Number));
  });

  it('adjustRestTimer to zero ends rest properly', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(10, 'Curls');
    });
    jest.clearAllMocks();

    // Adjust by -15 (more than remaining) — should end rest
    act(() => {
      result.current.adjustRestTimer(-15);
    });

    expect(result.current.restSeconds).toBe(0);
    expect(result.current.isResting).toBe(false);
    expect(stopRestTimerActivity).toHaveBeenCalled();
    expect(onRestEnd).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);
    // Should NOT call adjustRestTimerActivity since rest ended
    expect(adjustRestTimerActivity).not.toHaveBeenCalled();
  });

  it('dismissRest clears timer, resets state, and calls onRestEnd', () => {
    const { result, onRestEnd } = setup();

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
    expect(onRestEnd).toHaveBeenCalledTimes(1);
    // Dismiss should NOT vibrate
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  it('starting a new rest timer replaces the previous one', () => {
    const { result } = setup();

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

    // Simulate backgrounding: advance Date.now by 75s without firing interval
    jest.setSystemTime(new Date(Date.now() + 75000));

    // Simulate foreground return — resync should compute 45s remaining
    act(() => {
      appStateCallback?.('active');
    });

    expect(result.current.restSeconds).toBe(45);
    expect(result.current.isResting).toBe(true);
  });

  it('resyncs on foreground return when timer expired — no vibration', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(120, 'Rows');
    });

    // Simulate backgrounding: advance Date.now past end time
    jest.setSystemTime(new Date(Date.now() + 130000));

    act(() => {
      appStateCallback?.('active');
    });

    expect(result.current.restSeconds).toBe(0);
    expect(result.current.isResting).toBe(false);
    expect(onRestEnd).toHaveBeenCalledTimes(1);
    expect(stopRestTimerActivity).toHaveBeenCalled();
    // No vibration — notification already alerted the user while backgrounded
    expect(Vibration.vibrate).not.toHaveBeenCalled();
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
