import { renderHook, act } from '@testing-library/react-native';
import { AppState, Vibration } from 'react-native';
import { useRestTimer } from '../useRestTimer';

// ─── Mocks ───

jest.mock('../../services/liveActivity', () => ({
  adjustRestTimerActivity: jest.fn(),
  stopRestTimerActivity: jest.fn(),
  scheduleRestNotification: jest.fn(),
  resetRestProgressBaseline: jest.fn(() => 'session-1'),
}));

jest.mock('../../services/restTimerSnapshot', () => ({
  readRestTimerSnapshot: jest.fn(),
}));

const {
  adjustRestTimerActivity,
  stopRestTimerActivity,
  scheduleRestNotification,
} = require('../../services/liveActivity');
const { resetRestProgressBaseline } = require('../../services/liveActivity');
const { readRestTimerSnapshot } = require('../../services/restTimerSnapshot');

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
    resetRestProgressBaseline.mockReturnValue('session-1');
    readRestTimerSnapshot.mockReturnValue(null);
    appStateCallback = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns correct initial state', () => {
    const { result } = setup();

    expect(result.current.restTotal).toBe(0);
    expect(result.current.restExerciseName).toBe('');
    expect(result.current.isResting).toBe(false);
    expect(result.current.currentEndTime).toBe(0);
  });

  it('startRestTimer sets correct state and returns the deadline', () => {
    const { result, onRestUpdate } = setup();

    let returned = 0;
    act(() => {
      returned = result.current.startRestTimer(120, 'Bench Press', 'ex-1');
    });

    expect(result.current.restTotal).toBe(120);
    expect(result.current.restExerciseName).toBe('Bench Press');
    expect(result.current.restExerciseId).toBe('ex-1');
    expect(result.current.isResting).toBe(true);
    expect(result.current.currentEndTime).toBeGreaterThan(0);

    // The deadline is RETURNED, not pushed through onRestUpdate. The caller owns the widget
    // sync because only it holds the post-completion block list; syncing from both places
    // showed the just-completed set on the lock screen before the correct one replaced it.
    expect(onRestUpdate).not.toHaveBeenCalled();
    expect(returned).toBe(result.current.currentEndTime);
    expect(returned).toBeGreaterThanOrEqual(Date.now() + 119 * 1000);
  });

  it('clears restExerciseId when the rest ends', () => {
    const { result } = setup();

    act(() => { result.current.startRestTimer(120, 'Bench Press', 'ex-1'); });
    expect(result.current.restExerciseId).toBe('ex-1');

    act(() => { result.current.dismissRest(); });
    expect(result.current.restExerciseId).toBe('');
  });

  it('startRestTimer schedules notification', () => {
    const { result } = setup();

    act(() => {
      result.current.startRestTimer(90, 'Squats', 'ex-1');
    });

    expect(scheduleRestNotification).toHaveBeenCalledWith(90);
  });

  it('timer counts down and calls onRestEnd at 0', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(3, 'Squats', 'ex-1');
    });

    expect(result.current.isResting).toBe(true);

    // Advance 1 second
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.isResting).toBe(true);

    // Advance 1 more second
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.isResting).toBe(true);

    // Advance 1 more second - should hit 0
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.isResting).toBe(false);

    expect(onRestEnd).toHaveBeenCalledTimes(1);
    expect(stopRestTimerActivity).toHaveBeenCalledTimes(1);
    // Always vibrate in foreground — don't rely on iOS notification vibration
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);
  });

  it('endRest re-entrancy guard prevents multiple vibrations', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(1, 'Bench', 'ex-1');
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
      result.current.startRestTimer(60, 'Deadlift', 'ex-1');
    });
    onRestUpdate.mockClear();

    // Adjust +15
    act(() => {
      result.current.adjustRestTimer(15);
    });

    expect(result.current.restTotal).toBe(75);
    expect(adjustRestTimerActivity).toHaveBeenCalledWith(15);
    // The resting exercise and the grown denominator ride along. Omitting them made the widget
    // fall back to "first incomplete set" and retitle the lock screen to a different exercise.
    expect(onRestUpdate).toHaveBeenCalledWith(true, expect.any(Number), 'ex-1', 75);

    onRestUpdate.mockClear();
    const beforeEndTime = result.current.currentEndTime;

    // Adjust -30
    act(() => {
      result.current.adjustRestTimer(-30);
    });

    expect(result.current.restTotal).toBe(75); // restTotal never decreases (matches lock screen widget)
    expect(adjustRestTimerActivity).toHaveBeenCalledWith(-30);
    // Denominator stays at 75 — it only ever grows, so the bar can't jump backwards on -15s.
    expect(onRestUpdate).toHaveBeenCalledWith(true, expect.any(Number), 'ex-1', 75);
    // Verify currentEndTime actually moved backward by 30s
    expect(result.current.currentEndTime).toBe(beforeEndTime - 30000);
  });

  it('adjustRestTimer to zero ends rest properly', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(10, 'Curls', 'ex-1');
    });
    jest.clearAllMocks();

    // Adjust by -15 (more than remaining) — should end rest
    act(() => {
      result.current.adjustRestTimer(-15);
    });

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
      result.current.startRestTimer(90, 'OHP', 'ex-1');
    });

    expect(result.current.isResting).toBe(true);

    act(() => {
      result.current.dismissRest();
    });

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
      result.current.startRestTimer(60, 'Bench Press', 'ex-1');
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.isResting).toBe(true);

    // Start a new timer
    act(() => {
      result.current.startRestTimer(90, 'Squats', 'ex-1');
    });

    expect(result.current.restTotal).toBe(90);
    expect(result.current.restExerciseName).toBe('Squats');
    expect(result.current.isResting).toBe(true);
  });

  it('resyncs on foreground return with remaining time', () => {
    const { result } = setup();

    act(() => {
      result.current.startRestTimer(120, 'Rows', 'ex-1');
    });

    // Simulate backgrounding: advance Date.now by 75s without firing interval
    jest.setSystemTime(new Date(Date.now() + 75000));

    // Simulate foreground return — resync should keep timer active with ~45s remaining
    act(() => {
      appStateCallback?.('active');
    });

    const remaining = Math.max(0, Math.round((result.current.currentEndTime - Date.now()) / 1000));
    expect(remaining).toBe(45);
    expect(result.current.isResting).toBe(true);
  });

  it('adopts an intent-written deadline and denominator on foreground return', () => {
    const { result } = setup();
    act(() => {
      result.current.startRestTimer(120, 'Rows', 'ex-1');
    });
    const originalDeadline = result.current.currentEndTime;
    jest.clearAllMocks();
    readRestTimerSnapshot.mockReturnValue({
      version: 1,
      sessionId: 'session-1',
      activityId: 'activity-1',
      exerciseName: 'Rows',
      setNumber: 2,
      totalSets: 4,
      endTimeMs: originalDeadline + 15_000,
      maxRestSeconds: 135,
      isActive: true,
      updatedAtMs: Date.now(),
      writer: 'intent',
    });

    act(() => {
      appStateCallback?.('active');
    });

    expect(result.current.currentEndTime).toBe(originalDeadline + 15_000);
    expect(result.current.restTotal).toBe(135);
    expect(adjustRestTimerActivity).not.toHaveBeenCalled();
    expect(scheduleRestNotification).not.toHaveBeenCalled();
  });

  it('ends an active hook rest when its intent-written snapshot is inactive', () => {
    const { result, onRestEnd } = setup();
    act(() => {
      result.current.startRestTimer(10, 'Rows', 'ex-1');
    });
    jest.clearAllMocks();
    readRestTimerSnapshot.mockReturnValue({
      version: 1,
      sessionId: 'session-1',
      activityId: 'activity-1',
      exerciseName: 'Rows',
      setNumber: 2,
      totalSets: 4,
      endTimeMs: 0,
      maxRestSeconds: 10,
      isActive: false,
      updatedAtMs: Date.now(),
      writer: 'intent',
    });

    act(() => {
      appStateCallback?.('active');
    });

    expect(result.current.isResting).toBe(false);
    expect(onRestEnd).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  it('ignores a snapshot from another rest session', () => {
    const { result } = setup();
    act(() => {
      result.current.startRestTimer(120, 'Rows', 'ex-1');
    });
    const originalDeadline = result.current.currentEndTime;
    readRestTimerSnapshot.mockReturnValue({
      version: 1,
      sessionId: 'old-session',
      activityId: 'activity-1',
      exerciseName: 'Rows',
      setNumber: 1,
      totalSets: 4,
      endTimeMs: originalDeadline + 60_000,
      maxRestSeconds: 180,
      isActive: true,
      updatedAtMs: Date.now(),
      writer: 'intent',
    });

    act(() => {
      appStateCallback?.('active');
    });

    expect(result.current.currentEndTime).toBe(originalDeadline);
    expect(result.current.restTotal).toBe(120);
  });

  it('resyncs on foreground return when timer expired — no vibration', () => {
    const { result, onRestEnd } = setup();

    act(() => {
      result.current.startRestTimer(120, 'Rows', 'ex-1');
    });

    // Simulate backgrounding: advance Date.now past end time
    jest.setSystemTime(new Date(Date.now() + 130000));

    act(() => {
      appStateCallback?.('active');
    });

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

    expect(result.current.isResting).toBe(false);
    expect(onRestEnd).not.toHaveBeenCalled();
  });

  it('cleans up interval on unmount', () => {
    const { result, unmount } = setup();

    act(() => {
      result.current.startRestTimer(60, 'Bench', 'ex-1');
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
        result.current.startRestTimer(5, 'Bench', 'ex-1');
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
        result.current.startRestTimer(2, 'Bench', 'ex-1');
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
        result.current.startRestTimer(2, 'Bench', 'ex-1');
      });

      // Timer expires naturally — app stayed in foreground
      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(onRestEnd).toHaveBeenCalledTimes(1);
      expect(Vibration.vibrate).toHaveBeenCalledWith([0, 200, 100, 200]);
    });

    // Removed: the two widget-action-queue tests. The widget ships no AppIntent buttons, so
    // nothing ever wrote liftai_action_queue and applyPendingWidgetActions has been deleted.

    it('vibrates after 500ms foreground recovery if timer has remaining time then expires', () => {
      const { result, onRestEnd } = setup();

      act(() => {
        result.current.startRestTimer(5, 'Bench', 'ex-1');
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
      const remaining = Math.max(0, Math.round((result.current.currentEndTime - Date.now()) / 1000));
      expect(remaining).toBe(3);

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

    it('does not vibrate when re-backgrounded inside the 500ms recovery window', () => {
      const { result, onRestEnd } = setup();

      act(() => { result.current.startRestTimer(5, 'Bench', 'ex-1'); });
      act(() => { appStateCallback?.('background'); });

      jest.setSystemTime(new Date(Date.now() + 2000));

      // Foreground return arms the 500ms wasBackgrounded reset...
      act(() => { appStateCallback?.('active'); });
      // ...but the user locks the phone again 200ms later, well inside that window.
      act(() => { jest.advanceTimersByTime(200); });
      act(() => { appStateCallback?.('background'); });

      // The stale reset timeout must have been cancelled. If it fires here it clears
      // wasBackgroundedRef, and the expiry below vibrates on top of the notification that
      // already alerted the user — the exact double-alert the flag exists to prevent.
      act(() => { jest.advanceTimersByTime(400); });
      jest.setSystemTime(new Date(Date.now() + 4000));
      act(() => { jest.advanceTimersByTime(4000); });

      expect(onRestEnd).toHaveBeenCalledTimes(1);
      expect(Vibration.vibrate).not.toHaveBeenCalledWith([0, 200, 100, 200]);
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
        result.current.startRestTimer(3, 'Bench', 'ex-1');
      });

      // 1 second passes
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      // User completes another set — new timer starts
      act(() => {
        result.current.startRestTimer(3, 'Squats', 'ex-1');
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
        result.current.startRestTimer(1, 'Bench', 'ex-1');
      });
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(onRestEnd).toHaveBeenCalledTimes(1);
      jest.clearAllMocks();

      // Start another timer — endingRef should be reset
      act(() => {
        result.current.startRestTimer(1, 'Squats', 'ex-1');
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
