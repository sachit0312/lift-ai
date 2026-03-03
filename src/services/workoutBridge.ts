import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { setItem, removeItem } from '../../modules/shared-user-defaults';

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

// ─── Constants ───

const WORKOUT_STATE_KEY = 'liftai_workout_state';

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

export function clearWidgetState(): void {
  if (Platform.OS !== 'ios') return;
  try {
    removeItem(WORKOUT_STATE_KEY);
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to clear widget state', e);
    Sentry.captureException(e);
  }
}
