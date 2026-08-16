import { setItem } from '../../../modules/shared-user-defaults';
import {
  clearRestTimerSnapshot,
  createRestTimerSessionId,
  createRestTimerSnapshot,
  readRestTimerSnapshot,
  writeRestTimerSnapshot,
  type RestTimerSnapshot,
} from '../restTimerSnapshot';

const { __resetStore } = require('modules/shared-user-defaults') as {
  __resetStore: () => void;
};

function validSnapshot(overrides: Partial<RestTimerSnapshot> = {}): RestTimerSnapshot {
  return {
    version: 1,
    sessionId: 'session-1',
    activityId: 'activity-1',
    exerciseName: 'Bench Press',
    setNumber: 2,
    totalSets: 4,
    endTimeMs: 1_800_000,
    maxRestSeconds: 120,
    isActive: true,
    updatedAtMs: 1_700_000,
    writer: 'javascript',
    ...overrides,
  };
}

describe('restTimerSnapshot', () => {
  beforeEach(() => {
    __resetStore();
    jest.clearAllMocks();
  });

  it('creates unique session identifiers', () => {
    const first = createRestTimerSessionId();
    const second = createRestTimerSessionId();

    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it('round-trips a valid active rest snapshot', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000);
    const snapshot = createRestTimerSnapshot({
      sessionId: 'session-1',
      activityId: 'activity-1',
      exerciseName: 'Bench Press',
      setNumber: 2,
      totalSets: 4,
      endTimeMs: 1_800_000,
      maxRestSeconds: 120,
    });

    writeRestTimerSnapshot(snapshot);

    expect(readRestTimerSnapshot()).toEqual(snapshot);
  });

  it.each([
    ['unsupported version', { version: 99 }],
    ['missing session ID', { sessionId: '' }],
    ['missing activity ID', { activityId: '' }],
    ['missing exercise name', { exerciseName: '' }],
    ['non-positive set number', { setNumber: 0 }],
    ['set number above total', { setNumber: 5 }],
    ['non-finite deadline', { endTimeMs: Number.POSITIVE_INFINITY }],
    ['negative denominator', { maxRestSeconds: -1 }],
    ['unknown writer', { writer: 'widget' }],
  ])('rejects a snapshot with %s', (_label, override) => {
    setItem('liftai_rest_timer_snapshot', JSON.stringify(validSnapshot(override as Partial<RestTimerSnapshot>)));

    expect(readRestTimerSnapshot()).toBeNull();
  });

  it('rejects malformed JSON', () => {
    setItem('liftai_rest_timer_snapshot', '{not-json');

    expect(readRestTimerSnapshot()).toBeNull();
  });

  it('clears the snapshot', () => {
    writeRestTimerSnapshot(validSnapshot());

    clearRestTimerSnapshot();

    expect(readRestTimerSnapshot()).toBeNull();
  });
});
