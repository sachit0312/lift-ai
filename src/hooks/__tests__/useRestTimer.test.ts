import { renderHook, act } from '@testing-library/react-native';
import { AppState, Vibration } from 'react-native';
import { useRestTimer } from '../useRestTimer';

// ─── Mocks ───

jest.mock('../../services/liveActivity', () => ({
  adjustRestTimerActivity: jest.fn(),
  stopRestTimerActivity: jest.fn(),
  scheduleRestNotification: jest.fn(),
  isRestNotificationScheduled: jest.fn(() => true), // notification scheduled by default
  applyPendingWidgetActions: jest.fn(() => 0), // default: no actions
}));

const {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  scheduleRestNotification,
  isRestNotificationScheduled,
  applyPendingWidgetActions,
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
    expect(onRestUpdate).toHaveBeenCalledWith(true, expect.any(Number), 'Bench Press');
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
    // Always vibrate in foreground — don't rely on iOS notification vibration
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);
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
    // Always vibrate in foreground — don't rely on iOS notification vibration
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);

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

  // ─── BUG: Multiple vibrations on foreground return ───
  // When app returns to foreground after rest expired in background,
  // both the AppState listener AND the unfrozen interval tick can fire endRest.
  // The endingRef guard should prevent this, but verify edge cases.

  describe('foreground return vibration edge cases', () => {
    it('does not vibrate when timer expired while backgrounded and user returns', () => {
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(5, 'Bench');
      });

      // Go to background
      act(() => {
        appStateCallback?.('background');
      });

      // Time passes beyond rest end
      jest.setSystemTime(new Date(Date.now() + 10000));

      // Return to foreground
      act(() => {
        appStateCallback?.('active');
      });

      expect(onRestEnd).toHaveBeenCalledTimes(1);
      // Should NOT vibrate — notification already alerted user
      expect(Vibration.vibrate).not.toHaveBeenCalled();
    });

    it('endingRef prevents interval tick from vibrating after foreground resync already called endRest', () => {
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(2, 'Bench');
      });

      // Go to background
      act(() => {
        appStateCallback?.('background');
      });

      // Time passes beyond rest end
      jest.setSystemTime(new Date(Date.now() + 5000));

      // Foreground return calls endRest(false)
      act(() => {
        appStateCallback?.('active');
      });

      expect(onRestEnd).toHaveBeenCalledTimes(1);
      jest.clearAllMocks();

      // Now the frozen interval unfreezes and also fires
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Guard prevents second call
      expect(onRestEnd).not.toHaveBeenCalled();
      expect(Vibration.vibrate).not.toHaveBeenCalled();
    });

    it('vibrates when timer expires naturally in foreground (not backgrounded)', () => {
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(2, 'Bench');
      });

      // Timer expires naturally — app stayed in foreground
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(onRestEnd).toHaveBeenCalledTimes(1);
      expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);
    });

    it('applies widget action queue delta before computing remaining time', () => {
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(30, 'Bench');
      });

      act(() => {
        appStateCallback?.('background');
      });

      // Widget user tapped +15s while app was backgrounded
      (applyPendingWidgetActions as jest.Mock).mockReturnValueOnce(15);

      // 25 seconds pass — without the +15s, timer would have 5s left
      // With the +15s, timer should have 20s left
      jest.setSystemTime(new Date(Date.now() + 25000));

      act(() => {
        appStateCallback?.('active');
      });

      expect(result.current.isResting).toBe(true);
      expect(result.current.restSeconds).toBe(20);
    });

    it('applies widget skipRest action by ending rest', () => {
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(120, 'Bench');
      });

      act(() => {
        appStateCallback?.('background');
      });

      (applyPendingWidgetActions as jest.Mock).mockReturnValueOnce(-Infinity);

      act(() => {
        appStateCallback?.('active');
      });

      expect(result.current.isResting).toBe(false);
      expect(onRestEnd).toHaveBeenCalledTimes(1);
    });

    it('vibrates after 500ms foreground recovery if timer has remaining time then expires', () => {
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(5, 'Bench');
      });

      // Go to background
      act(() => {
        appStateCallback?.('background');
      });

      // Only 2s pass — timer still has 3s left
      jest.setSystemTime(new Date(Date.now() + 2000));

      // Return to foreground
      act(() => {
        appStateCallback?.('active');
      });

      expect(result.current.isResting).toBe(true);
      expect(result.current.restSeconds).toBe(3);

      // 500ms passes — wasBackgroundedRef clears
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Now timer expires naturally — should vibrate since we're back in foreground
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(onRestEnd).toHaveBeenCalledTimes(1);
      expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);
    });
  });

  // ─── BUG: Rapid timer restarts ───
  // When user completes sets quickly, startRestTimer is called multiple times.
  // Each call should cleanly replace the previous timer.

  describe('rapid timer restarts', () => {
    it('new startRestTimer clears previous interval — no double vibration', () => {
      const { result, onRestEnd } = setup();

      // Start first timer
      act(() => {
        result.current.startRestTimer(3, 'Bench');
      });

      // 1 second passes
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // User completes another set — new timer starts
      act(() => {
        result.current.startRestTimer(3, 'Squats');
      });

      // Advance past where the FIRST timer would have expired
      act(() => {
        jest.advanceTimersByTime(2500);
      });

      // Should NOT have called onRestEnd (old timer was replaced)
      expect(onRestEnd).not.toHaveBeenCalled();
      expect(result.current.restExerciseName).toBe('Squats');
      expect(result.current.isResting).toBe(true);

      // Now let the new timer expire
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(onRestEnd).toHaveBeenCalledTimes(1);
      expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    });

    it('each startRestTimer resets endingRef for new timer', () => {
      const { result, onRestEnd } = setup();

      // Start and let timer expire
      act(() => {
        result.current.startRestTimer(1, 'Bench');
      });
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(onRestEnd).toHaveBeenCalledTimes(1);
      jest.clearAllMocks();

      // Start another timer — endingRef should be reset
      act(() => {
        result.current.startRestTimer(1, 'Squats');
      });
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // Second timer should also fire properly
      expect(onRestEnd).toHaveBeenCalledTimes(1);
      expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    });
  });
});
