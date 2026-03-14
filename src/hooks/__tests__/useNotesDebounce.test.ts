import { renderHook, act } from '@testing-library/react-native';
import { useNotesDebounce } from '../useNotesDebounce';
import { updateExerciseMachineNotes } from '../../services/database';
import { fireAndForgetSync } from '../../services/sync';
import * as Sentry from '@sentry/react-native';

jest.mock('../../services/database', () => ({
  updateExerciseMachineNotes: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
  fireAndForgetSync: jest.fn(),
}));

const mockUpdateExerciseMachineNotes = updateExerciseMachineNotes as jest.MockedFunction<typeof updateExerciseMachineNotes>;
const mockFireAndForgetSync = fireAndForgetSync as jest.MockedFunction<typeof fireAndForgetSync>;
const mockCaptureException = Sentry.captureException as jest.MockedFunction<typeof Sentry.captureException>;

describe('useNotesDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces calls and saves after 500ms', () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'first');
    });

    // Should not have saved yet
    expect(mockUpdateExerciseMachineNotes).not.toHaveBeenCalled();

    act(() => {
      // Update before timer fires — should replace the pending value
      result.current.debouncedSaveNotes('ex-1', 'second');
    });

    // Still nothing saved
    expect(mockUpdateExerciseMachineNotes).not.toHaveBeenCalled();

    // Advance past the debounce interval
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Now the last value should have been saved
    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledTimes(1);
    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledWith('ex-1', 'second');
    expect(mockFireAndForgetSync).toHaveBeenCalledTimes(1);
  });

  it('passes null to updateExerciseMachineNotes when notes are empty', () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', '');
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledWith('ex-1', null);
  });

  it('flushPendingNotes saves all pending notes immediately', async () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes A');
      result.current.debouncedSaveNotes('ex-2', 'notes B');
    });

    // Nothing saved yet (timers haven't fired)
    expect(mockUpdateExerciseMachineNotes).not.toHaveBeenCalled();

    // Flush forces immediate save
    await act(async () => {
      await result.current.flushPendingNotes();
    });

    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledTimes(2);
    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledWith('ex-1', 'notes A');
    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledWith('ex-2', 'notes B');

    // Advancing timers should NOT fire again (timers were cleared by flush)
    jest.clearAllMocks();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockUpdateExerciseMachineNotes).not.toHaveBeenCalled();
  });

  it('flushPendingNotes catches errors via Sentry.captureException', async () => {
    const error = new Error('db write failed');
    mockUpdateExerciseMachineNotes.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes');
    });

    await act(async () => {
      await result.current.flushPendingNotes();
    });

    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });

  it('clearPendingNotes clears without saving', () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes A');
      result.current.debouncedSaveNotes('ex-2', 'notes B');
    });

    act(() => {
      result.current.clearPendingNotes();
    });

    // Advancing timers should not trigger saves
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockUpdateExerciseMachineNotes).not.toHaveBeenCalled();
    expect(mockFireAndForgetSync).not.toHaveBeenCalled();
  });

  it('clearPendingNotes followed by flush does nothing', async () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes A');
    });

    act(() => {
      result.current.clearPendingNotes();
    });

    await act(async () => {
      await result.current.flushPendingNotes();
    });

    expect(mockUpdateExerciseMachineNotes).not.toHaveBeenCalled();
  });

  it('tracks multiple exercises independently', () => {
    const { result } = renderHook(() => useNotesDebounce());

    // Schedule notes for two different exercises at different times
    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes for ex1');
    });

    // Advance halfway — ex-1 is still pending
    act(() => {
      jest.advanceTimersByTime(300);
    });

    act(() => {
      result.current.debouncedSaveNotes('ex-2', 'notes for ex2');
    });

    // Advance another 200ms — ex-1's 500ms has elapsed, but ex-2 still pending
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledTimes(1);
    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledWith('ex-1', 'notes for ex1');

    // Advance remaining 300ms — ex-2 should now fire
    jest.clearAllMocks();
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledTimes(1);
    expect(mockUpdateExerciseMachineNotes).toHaveBeenCalledWith('ex-2', 'notes for ex2');
  });

  it('cleans up timers on unmount', () => {
    const { result, unmount } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes');
    });

    // Unmount clears timers
    unmount();

    // Advance timers — should NOT trigger saves since cleanup ran
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockUpdateExerciseMachineNotes).not.toHaveBeenCalled();
  });
});
