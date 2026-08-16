import { getItem, removeItem, setItem } from '../../modules/shared-user-defaults';
import uuid from '../utils/uuid';

const REST_TIMER_SNAPSHOT_KEY = 'liftai_rest_timer_snapshot';

export interface RestTimerSnapshot {
  version: 1;
  sessionId: string;
  activityId: string;
  exerciseName: string;
  setNumber: number;
  totalSets: number;
  endTimeMs: number;
  maxRestSeconds: number;
  isActive: boolean;
  updatedAtMs: number;
  writer: 'javascript' | 'intent';
}

export type CreateRestTimerSnapshotInput = Pick<
  RestTimerSnapshot,
  | 'sessionId'
  | 'activityId'
  | 'exerciseName'
  | 'setNumber'
  | 'totalSets'
  | 'endTimeMs'
  | 'maxRestSeconds'
>;

export function createRestTimerSessionId(): string {
  return uuid();
}

export function createRestTimerSnapshot(
  input: CreateRestTimerSnapshotInput,
): RestTimerSnapshot {
  return {
    version: 1,
    ...input,
    isActive: true,
    updatedAtMs: Date.now(),
    writer: 'javascript',
  };
}

export function writeRestTimerSnapshot(snapshot: RestTimerSnapshot): void {
  setItem(REST_TIMER_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function readRestTimerSnapshot(): RestTimerSnapshot | null {
  const raw = getItem(REST_TIMER_SNAPSHOT_KEY);
  if (!raw) return null;

  try {
    const candidate: unknown = JSON.parse(raw);
    return isRestTimerSnapshot(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function clearRestTimerSnapshot(): void {
  removeItem(REST_TIMER_SNAPSHOT_KEY);
}

function isRestTimerSnapshot(value: unknown): value is RestTimerSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;

  const setNumber = snapshot.setNumber;
  const totalSets = snapshot.totalSets;
  const endTimeMs = snapshot.endTimeMs;
  const maxRestSeconds = snapshot.maxRestSeconds;
  const updatedAtMs = snapshot.updatedAtMs;

  return snapshot.version === 1
    && isNonEmptyString(snapshot.sessionId)
    && isNonEmptyString(snapshot.activityId)
    && isNonEmptyString(snapshot.exerciseName)
    && Number.isInteger(setNumber)
    && Number(setNumber) > 0
    && Number.isInteger(totalSets)
    && Number(totalSets) >= Number(setNumber)
    && typeof endTimeMs === 'number'
    && Number.isFinite(endTimeMs)
    && endTimeMs >= 0
    && typeof maxRestSeconds === 'number'
    && Number.isFinite(maxRestSeconds)
    && maxRestSeconds >= 0
    && typeof snapshot.isActive === 'boolean'
    && typeof updatedAtMs === 'number'
    && Number.isFinite(updatedAtMs)
    && updatedAtMs >= 0
    && (snapshot.writer === 'javascript' || snapshot.writer === 'intent');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
