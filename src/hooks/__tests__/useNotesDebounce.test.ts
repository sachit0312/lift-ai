import { renderHook, act } from '@testing-library/react-native';
import { useNotesDebounce } from '../useNotesDebounce';
import { updateExerciseNotes, updateWorkoutSet } from '../../services/database';
import { syncToSupabase } from '../../services/sync';
import * as Sentry from '@sentry/react-native';

jest.mock('../../services/database', () => ({
  updateExerciseNotes: jest.fn().mockResolvedValue(undefined),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/sync', () => ({
  syncToSupabase: jest.fn().mockResolvedValue(undefined),
}));

const mockUpdateExerciseNotes = updateExerciseNotes as jest.MockedFunction<typeof updateExerciseNotes>;
const mockUpdateWorkoutSet = updateWorkoutSet as jest.MockedFunction<typeof updateWorkoutSet>;
const mockSyncToSupabase = syncToSupabase as jest.MockedFunction<typeof syncToSupabase>;
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
      result.current.debouncedSaveNotes('ex-1', 'first', 'set-1');
    });

    // Should not have saved yet
    expect(mockUpdateExerciseNotes).not.toHaveBeenCalled();
    expect(mockUpdateWorkoutSet).not.toHaveBeenCalled();

    act(() => {
      // Update before timer fires — should replace the pending value
      result.current.debouncedSaveNotes('ex-1', 'second', 'set-1');
    });

    // Still nothing saved
    expect(mockUpdateExerciseNotes).not.toHaveBeenCalled();

    // Advance past the debounce interval
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Now the last value should have been saved
    expect(mockUpdateExerciseNotes).toHaveBeenCalledTimes(1);
    expect(mockUpdateExerciseNotes).toHaveBeenCalledWith('ex-1', 'second');
    expect(mockUpdateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateWorkoutSet).toHaveBeenCalledWith('set-1', { notes: 'second' });
    expect(mockSyncToSupabase).toHaveBeenCalledTimes(1);
  });

  it('passes null to updateExerciseNotes when notes are empty', () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', '', 'set-1');
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(mockUpdateExerciseNotes).toHaveBeenCalledWith('ex-1', null);
  });

  it('does not call updateWorkoutSet when setId is null', () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'some notes', null);
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(mockUpdateExerciseNotes).toHaveBeenCalledTimes(1);
    expect(mockUpdateWorkoutSet).not.toHaveBeenCalled();
    expect(mockSyncToSupabase).toHaveBeenCalledTimes(1);
  });

  it('flushPendingNotes saves all pending notes immediately', async () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes A', 'set-1');
      result.current.debouncedSaveNotes('ex-2', 'notes B', 'set-2');
    });

    // Nothing saved yet (timers haven't fired)
    expect(mockUpdateExerciseNotes).not.toHaveBeenCalled();

    // Flush forces immediate save
    await act(async () => {
      await result.current.flushPendingNotes();
    });

    expect(mockUpdateExerciseNotes).toHaveBeenCalledTimes(2);
    expect(mockUpdateExerciseNotes).toHaveBeenCalledWith('ex-1', 'notes A');
    expect(mockUpdateExerciseNotes).toHaveBeenCalledWith('ex-2', 'notes B');
    expect(mockUpdateWorkoutSet).toHaveBeenCalledTimes(2);
    expect(mockUpdateWorkoutSet).toHaveBeenCalledWith('set-1', { notes: 'notes A' });
    expect(mockUpdateWorkoutSet).toHaveBeenCalledWith('set-2', { notes: 'notes B' });

    // Advancing timers should NOT fire again (timers were cleared by flush)
    jest.clearAllMocks();
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockUpdateExerciseNotes).not.toHaveBeenCalled();
  });

  it('flushPendingNotes catches errors via Sentry.captureException', async () => {
    const error = new Error('db write failed');
    mockUpdateExerciseNotes.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes', null);
    });

    await act(async () => {
      await result.current.flushPendingNotes();
    });

    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });

  it('clearPendingNotes clears without saving', () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes A', 'set-1');
      result.current.debouncedSaveNotes('ex-2', 'notes B', 'set-2');
    });

    act(() => {
      result.current.clearPendingNotes();
    });

    // Advancing timers should not trigger saves
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockUpdateExerciseNotes).not.toHaveBeenCalled();
    expect(mockUpdateWorkoutSet).not.toHaveBeenCalled();
    expect(mockSyncToSupabase).not.toHaveBeenCalled();
  });

  it('clearPendingNotes followed by flush does nothing', async () => {
    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes A', 'set-1');
    });

    act(() => {
      result.current.clearPendingNotes();
    });

    await act(async () => {
      await result.current.flushPendingNotes();
    });

    expect(mockUpdateExerciseNotes).not.toHaveBeenCalled();
    expect(mockUpdateWorkoutSet).not.toHaveBeenCalled();
  });

  it('tracks multiple exercises independently', () => {
    const { result } = renderHook(() => useNotesDebounce());

    // Schedule notes for two different exercises at different times
    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes for ex1', 'set-1');
    });

    // Advance halfway — ex-1 is still pending
    act(() => {
      jest.advanceTimersByTime(300);
    });

    act(() => {
      result.current.debouncedSaveNotes('ex-2', 'notes for ex2', 'set-2');
    });

    // Advance another 200ms — ex-1's 500ms has elapsed, but ex-2 still pending
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(mockUpdateExerciseNotes).toHaveBeenCalledTimes(1);
    expect(mockUpdateExerciseNotes).toHaveBeenCalledWith('ex-1', 'notes for ex1');
    expect(mockUpdateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateWorkoutSet).toHaveBeenCalledWith('set-1', { notes: 'notes for ex1' });

    // Advance remaining 300ms — ex-2 should now fire
    jest.clearAllMocks();
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockUpdateExerciseNotes).toHaveBeenCalledTimes(1);
    expect(mockUpdateExerciseNotes).toHaveBeenCalledWith('ex-2', 'notes for ex2');
    expect(mockUpdateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateWorkoutSet).toHaveBeenCalledWith('set-2', { notes: 'notes for ex2' });
  });

  it('cleans up timers on unmount', () => {
    const { result, unmount } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'notes', 'set-1');
    });

    // Unmount clears timers
    unmount();

    // Advance timers — should NOT trigger saves since cleanup ran
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockUpdateExerciseNotes).not.toHaveBeenCalled();
    expect(mockUpdateWorkoutSet).not.toHaveBeenCalled();
  });
});
