/**
 * Sweep test: handleCycleTag folds a pending debounced write instead of racing it.
 *
 * Bug this pins: handleSetChange queues a 300ms debounced updateWorkoutSet() write keyed by
 * set id. If the user types an RPE (arming that debounce) and then, within the 300ms window,
 * taps the set number to cycle the tag to 'warmup' (which clears RPE), the immediate tag write
 * used to race the still-pending RPE write. The stale write landed ~300ms later and persisted
 * a warmup set WITH an RPE value — which then synced to Supabase, reached the AI coach via MCP,
 * and fed e1RM/PR math on reload with data that should have been null (warmup sets hide RPE).
 *
 * The fix folds any in-flight pending write for that set id into the tag-change write: the tag
 * change wins on tag/rpe, but preserves whatever weight/reps the user had already typed. This
 * test asserts updateWorkoutSet is called exactly ONCE with the merged payload.
 */
import { renderHook, act } from '@testing-library/react-native';
import { useExerciseBlocks } from '../../hooks/useExerciseBlocks';
import type { ExerciseBlock } from '../../types/workout';
import { createMockExercise } from '../helpers/factories';

jest.mock('../../services/database', () => ({
  addWorkoutSet: jest.fn().mockResolvedValue({ id: 'new-set' }),
  updateWorkoutSet: jest.fn().mockResolvedValue(undefined),
  deleteWorkoutSet: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/exerciseHistory', () => ({
  getExerciseHistoryData: jest.fn().mockResolvedValue({ previousSets: [], lastTime: null }),
}));

const db = require('../../services/database');

function makeBlock(): ExerciseBlock {
  return {
    exercise: createMockExercise({ id: 'ex-1' }),
    sets: [
      { id: 's1', exercise_id: 'ex-1', set_number: 1, weight: '135', reps: '8', rpe: '', tag: 'working', is_completed: false, previous: null, exercise_order: 1 },
    ],
    lastTime: null,
    machineNotesExpanded: false,
    machineNotes: '',
    restSeconds: 90,
    restEnabled: true,
    bestE1RM: undefined,
  };
}

describe('handleCycleTag folds pending debounced write (sweep)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function setup() {
    const block = makeBlock();
    const blocksRef = { current: [block] };
    const { result } = renderHook(() =>
      useExerciseBlocks({
        workoutRef: { current: { id: 'w1' } as any },
        blocksRef,
        lastActiveBlockRef: { current: 0 },
        debouncedSaveNotes: jest.fn(),
      }),
    );
    act(() => { result.current.setExerciseBlocks([block]); });
    return { result };
  }

  it('merges the pending RPE write into a single updateWorkoutSet call when tag is cycled mid-debounce', () => {
    const { result } = setup();

    // Type an RPE — arms the 300ms debounce for set s1.
    act(() => {
      result.current.handleSetChange(0, 0, 'rpe', '8');
    });

    // No write yet — still inside the debounce window.
    expect(db.updateWorkoutSet).not.toHaveBeenCalled();

    // Within the window, cycle the tag: working -> warmup.
    act(() => {
      result.current.handleCycleTag(0, 0);
    });

    // The tag change must write IMMEDIATELY (not wait for a debounce) and fold the
    // pending RPE edit into the same call rather than leaving it to fire later.
    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(db.updateWorkoutSet).toHaveBeenCalledWith('s1', expect.objectContaining({
      tag: 'warmup',
      rpe: null, // tag change wins: warmup sets never carry an RPE
    }));

    // Advance past the original 300ms debounce window — the stale RPE write must NOT
    // fire a second time. This is the exact bug: a duplicate write 300ms later that
    // silently reinstated the RPE on a warmup set.
    act(() => { jest.advanceTimersByTime(500); });
    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
  });

  it('preserves weight/reps from the pending edit while the tag change sets tag/rpe', () => {
    const { result } = setup();

    // Type a weight change (arms debounce), then a reps change (coalesces into the same
    // pending entry), then cycle the tag before either fires.
    act(() => {
      result.current.handleSetChange(0, 0, 'weight', '145');
      result.current.handleSetChange(0, 0, 'reps', '6');
    });

    expect(db.updateWorkoutSet).not.toHaveBeenCalled();

    act(() => {
      result.current.handleCycleTag(0, 0);
    });

    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(db.updateWorkoutSet).toHaveBeenCalledWith('s1', {
      weight: 145,
      reps: 6,
      tag: 'warmup',
      rpe: null,
    });

    act(() => { jest.advanceTimersByTime(500); });
    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
  });

  it('performs a single immediate write with only tag/rpe when there is no pending edit to fold', () => {
    const { result } = setup();

    // No prior handleSetChange call — nothing pending.
    act(() => {
      result.current.handleCycleTag(0, 0);
    });

    expect(db.updateWorkoutSet).toHaveBeenCalledTimes(1);
    expect(db.updateWorkoutSet).toHaveBeenCalledWith('s1', { tag: 'warmup', rpe: null });
  });
});
