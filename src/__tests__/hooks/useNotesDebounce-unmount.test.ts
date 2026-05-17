/**
 * Tests for Batch 2 Task 5: useNotesDebounce must flush pending writes
 * on unmount, not just cancel timers.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useNotesDebounce } from '../../hooks/useNotesDebounce';

jest.mock('../../services/database', () => ({
  updateExerciseMachineNotes: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/sync', () => ({
  fireAndForgetSync: jest.fn(),
}));

const db = require('../../services/database');

describe('Batch 2 Task 5: useNotesDebounce unmount flush', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists pending notes when the hook unmounts before the 500ms debounce fires', async () => {
    const { result, unmount } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'new note text');
    });

    // No write yet — still within debounce window
    expect(db.updateExerciseMachineNotes).not.toHaveBeenCalled();

    // Unmount BEFORE the timer fires
    unmount();
    await act(async () => { await Promise.resolve(); });

    // Write should have been flushed synchronously by the cleanup
    expect(db.updateExerciseMachineNotes).toHaveBeenCalledWith('ex-1', 'new note text');
  });

  it('does not double-fire on unmount if the timer already fired', async () => {
    const { result, unmount } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'note');
    });

    // Advance timers — the 500ms write fires
    act(() => { jest.advanceTimersByTime(600); });
    expect(db.updateExerciseMachineNotes).toHaveBeenCalledTimes(1);

    // Unmount after — should NOT re-fire
    unmount();
    await act(async () => { await Promise.resolve(); });
    expect(db.updateExerciseMachineNotes).toHaveBeenCalledTimes(1);
  });

  it('persists empty string as null', async () => {
    const { result, unmount } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', '');
    });

    unmount();
    await act(async () => { await Promise.resolve(); });

    expect(db.updateExerciseMachineNotes).toHaveBeenCalledWith('ex-1', null);
  });
});
