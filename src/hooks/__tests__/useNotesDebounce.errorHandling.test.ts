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
const mockCaptureException = Sentry.captureException as jest.MockedFunction<typeof Sentry.captureException>;

describe('useNotesDebounce — debounced timer error handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls Sentry.captureException when updateExerciseMachineNotes rejects in the debounced timer', async () => {
    const error = new Error('sqlite failure');
    mockUpdateExerciseMachineNotes.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useNotesDebounce());

    act(() => {
      result.current.debouncedSaveNotes('ex-1', 'some notes');
    });

    // Advance past the 500ms debounce — triggers the write
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Allow the promise rejection to propagate
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });

  it('does not throw when updateExerciseMachineNotes rejects in the debounced timer', async () => {
    mockUpdateExerciseMachineNotes.mockRejectedValueOnce(new Error('db error'));

    const { result } = renderHook(() => useNotesDebounce());

    // Should not throw
    await expect(async () => {
      act(() => {
        result.current.debouncedSaveNotes('ex-1', 'notes');
      });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      await act(async () => {
        await Promise.resolve();
      });
    }).not.toThrow();
  });
});
