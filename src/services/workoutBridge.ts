import { Platform } from 'react-native';
import { setItem, getItem, removeItem } from '../../modules/shared-user-defaults';

// ─── Types ───

export interface WidgetSetState {
  exerciseName: string;
  exerciseBlockIndex: number;
  setNumber: number;
  totalSets: number;
  weight: number;
  reps: number;
  restSeconds: number;
  restEnabled: boolean;
}

export interface WidgetNextSetState {
  exerciseName: string;
  setNumber: number;
  weight: number;
  reps: number;
}

export interface WidgetNextExerciseState {
  exerciseName: string;
  setNumber: number;
  totalSets: number;
  weight: number;
  reps: number;
}

export interface WidgetState {
  current: WidgetSetState;
  next: WidgetNextSetState | null;
  nextExercise: WidgetNextExerciseState | null;
  isResting: boolean;
  restEndTime: number;
  workoutActive: boolean;
}

export interface WidgetAction {
  type: 'completeSet' | 'skipRest' | 'adjustRest';
  weight?: number;
  reps?: number;
  blockIndex?: number;
  setIndex?: number;
  delta?: number;
  ts: number;
}

// ─── Constants ───

const WORKOUT_STATE_KEY = 'liftai_workout_state';
const ACTION_QUEUE_KEY = 'liftai_action_queue';

// ─── Module-level state ───

let pollingInterval: ReturnType<typeof setInterval> | null = null;

// ─── Public API ───

export function syncStateToWidget(state: WidgetState): void {
  if (Platform.OS !== 'ios') return;
  try {
    setItem(WORKOUT_STATE_KEY, JSON.stringify(state));
  } catch (e: unknown) {
    console.error('Failed to sync state to widget', e);
  }
}

export function pollForActions(): WidgetAction[] {
  if (Platform.OS !== 'ios') return [];
  try {
    const raw = getItem(ACTION_QUEUE_KEY);
    if (!raw) return [];
    removeItem(ACTION_QUEUE_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e: unknown) {
    console.error('Failed to poll for widget actions', e);
    return [];
  }
}

export function startPolling(callback: (actions: WidgetAction[]) => void): void {
  if (Platform.OS !== 'ios') return;
  stopPolling();
  pollingInterval = setInterval(() => {
    const actions = pollForActions();
    if (actions.length > 0) {
      callback(actions);
    }
  }, 500);
}

export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export function clearWidgetState(): void {
  if (Platform.OS !== 'ios') return;
  try {
    removeItem(WORKOUT_STATE_KEY);
    removeItem(ACTION_QUEUE_KEY);
  } catch (e: unknown) {
    console.error('Failed to clear widget state', e);
  }
}
