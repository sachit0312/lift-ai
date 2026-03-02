import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { setItem, getItem, removeItem } from '../../modules/shared-user-defaults';

// ─── Types ───

export interface WidgetSetState {
  exerciseName: string;
  exerciseBlockIndex: number;
  setNumber: number;
  totalSets: number;
  restSeconds: number;
  restEnabled: boolean;
}

export interface WidgetState {
  current: WidgetSetState;
  isResting: boolean;
  restEndTime: number;
  workoutActive: boolean;
}

export interface WidgetAction {
  type: 'skipRest' | 'adjustRest';
  delta?: number;
  ts: number;
}

// ─── Constants ───

const WORKOUT_STATE_KEY = 'liftai_workout_state';
const ACTION_QUEUE_KEY = 'liftai_action_queue';
const POLLING_INTERVAL_MS = 500;

// ─── Module-level state ───

let pollingInterval: ReturnType<typeof setInterval> | null = null;

// ─── Public API ───

export function syncStateToWidget(state: WidgetState): void {
  if (Platform.OS !== 'ios') return;
  try {
    setItem(WORKOUT_STATE_KEY, JSON.stringify(state));
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to sync state to widget', e);
    Sentry.captureException(e);
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
    if (__DEV__) console.error('Failed to poll for widget actions', e);
    Sentry.captureException(e);
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
  }, POLLING_INTERVAL_MS);
}

export function stopPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Read current rest state from UserDefaults (reflects widget-side changes).
 * Used by foreground resync to detect +/-15s adjustments or skips
 * that happened while the app was backgrounded.
 */
export function getWidgetRestState(): { isResting: boolean; restEndTime: number } | null {
  if (Platform.OS !== 'ios') return null;
  try {
    const raw = getItem(WORKOUT_STATE_KEY);
    if (!raw) return null;
    const state: WidgetState = JSON.parse(raw);
    return { isResting: state.isResting, restEndTime: state.restEndTime };
  } catch {
    return null;
  }
}

export function clearWidgetState(): void {
  if (Platform.OS !== 'ios') return;
  try {
    removeItem(WORKOUT_STATE_KEY);
    removeItem(ACTION_QUEUE_KEY);
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to clear widget state', e);
    Sentry.captureException(e);
  }
}
