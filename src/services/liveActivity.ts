import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { colors } from '../theme';

// ─── Module-level state (singleton) ───

let currentActivityId: string | null = null;
let currentNotificationId: string | null = null;
let currentEndTime: number = 0;
let currentExerciseName: string = '';
let currentSetNumber: number = 1;
let currentTotalSets: number = 1;

// ─── Configure notification handler ───

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: false,
  }),
});

// ─── Public API ───

// No Platform.OS guard needed: module-level state is only set by functions that
// guard on iOS, so on Android the values are always in their initial (inactive) state.
export function getRestTimerRemainingSeconds(): number | null {
  if (!currentActivityId || currentEndTime === 0) return null;
  return Math.max(0, Math.round((currentEndTime - Date.now()) / 1000));
}

export async function requestNotificationPermissions(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await Notifications.requestPermissionsAsync();
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to request notification permissions', e);
    Sentry.captureException(e);
  }
}

// ─── Persistent Workout Activity ───

/**
 * Start a persistent Live Activity for the entire workout.
 * The activity stays active and switches between set entry and rest timer views.
 */
export async function startWorkoutActivity(exerciseName: string, subtitle: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    // Stop any existing activity first
    if (currentActivityId) {
      try {
        LiveActivity.stopActivity(currentActivityId, { title: 'Done', subtitle: '' });
      } catch {
        // Activity may already be dismissed
      }
    }
    currentEndTime = 0;
    currentExerciseName = exerciseName;
    await cancelTimerEndNotification();

    const activityId = LiveActivity.startActivity(
      {
        title: exerciseName,
        subtitle,
      },
      {
        deepLinkUrl: '/workout',
        backgroundColor: colors.surface,
        titleColor: colors.text,
        subtitleColor: colors.textSecondary,
        progressViewTint: colors.primary,
      },
    );

    currentActivityId = activityId ?? null;
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to start workout Live Activity', e);
    Sentry.captureException(e);
  }
}

/**
 * Update the persistent workout activity for set entry view.
 * The interactive widget reads full state from UserDefaults;
 * this update triggers the SwiftUI re-render.
 */
export async function updateWorkoutActivityForSet(
  exerciseName: string, setNumber: number, totalSets: number
): Promise<void> {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    currentExerciseName = exerciseName;
    currentSetNumber = setNumber;
    currentTotalSets = totalSets;
    currentEndTime = 0;

    LiveActivity.updateActivity(currentActivityId, {
      title: exerciseName,
      subtitle: `Set ${setNumber}/${totalSets}`,
    });

    await cancelTimerEndNotification();
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to update workout activity for set', e);
    Sentry.captureException(e);
  }
}

/**
 * Update the persistent workout activity for rest timer view.
 * Transitions the lock screen to show the rest timer countdown.
 */
export async function updateWorkoutActivityForRest(
  exerciseName: string, totalSeconds: number, setNumber: number, totalSets: number
): Promise<void> {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    const endTime = Date.now() + totalSeconds * 1000;
    currentEndTime = endTime;
    currentExerciseName = exerciseName;
    currentSetNumber = setNumber;
    currentTotalSets = totalSets;

    LiveActivity.updateActivity(currentActivityId, {
      title: exerciseName,
      subtitle: `Set ${setNumber}/${totalSets}`,
      progressBar: { date: endTime },
    });

    // Belt-and-suspenders: cancel ALL scheduled notifications to prevent orphans
    await Notifications.cancelAllScheduledNotificationsAsync();
    await cancelTimerEndNotification();
    await scheduleTimerEndNotification(totalSeconds);
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to update workout activity for rest', e);
    Sentry.captureException(e);
  }
}

/**
 * Stop the persistent workout activity.
 */
export async function stopWorkoutActivity(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    if (currentActivityId) {
      try {
        LiveActivity.stopActivity(currentActivityId, {
          title: 'Workout Complete',
          subtitle: '',
        });
      } catch {
        // Activity may already be dismissed
      }
      currentActivityId = null;
    }
    currentEndTime = 0;
    currentExerciseName = '';
    currentSetNumber = 1;
    currentTotalSets = 1;
    await cancelTimerEndNotification();
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to stop workout Live Activity', e);
    Sentry.captureException(e);
  }
}

// ─── Rest Timer Functions (now operate within persistent activity) ───

export async function startRestTimerActivity(totalSeconds: number, exerciseName: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    currentExerciseName = exerciseName;
    const endTime = Date.now() + totalSeconds * 1000;
    currentEndTime = endTime;

    if (currentActivityId) {
      // Update existing persistent activity to show rest timer
      LiveActivity.updateActivity(currentActivityId, {
        title: exerciseName,
        subtitle: 'Rest Timer',
        progressBar: { date: endTime },
      });
    } else {
      // Fallback: start a new activity if none exists
      const activityId = LiveActivity.startActivity(
        {
          title: exerciseName,
          subtitle: 'Rest Timer',
          progressBar: { date: endTime },
        },
        {
          timerType: 'circular',
          deepLinkUrl: '/workout',
          backgroundColor: colors.surface,
          titleColor: colors.text,
          subtitleColor: colors.textSecondary,
          progressViewTint: colors.primary,
        },
      );
      currentActivityId = activityId ?? null;
    }

    // Cancel any existing then schedule notification for when timer ends
    await cancelTimerEndNotification();
    await scheduleTimerEndNotification(totalSeconds);
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to start rest timer', e);
    Sentry.captureException(e);
  }
}

export async function adjustRestTimerActivity(deltaSeconds: number): Promise<void> {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    const newEndTime = currentEndTime + deltaSeconds * 1000;
    currentEndTime = newEndTime;

    const remainingSeconds = Math.max(0, Math.round((newEndTime - Date.now()) / 1000));

    LiveActivity.updateActivity(currentActivityId, {
      title: currentExerciseName,
      progressBar: { date: newEndTime },
    });

    // Reschedule notification — await cancel to prevent stacking
    await cancelTimerEndNotification();
    if (remainingSeconds > 0) {
      await scheduleTimerEndNotification(remainingSeconds);
    }
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to adjust rest timer', e);
    Sentry.captureException(e);
  }
}

export async function stopRestTimerActivity(): Promise<void> {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    currentEndTime = 0;

    // Update activity back to set entry view with parseable "Set X/Y" subtitle
    LiveActivity.updateActivity(currentActivityId, {
      title: currentExerciseName,
      subtitle: `Set ${currentSetNumber}/${currentTotalSets}`,
    });

    await cancelTimerEndNotification();
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to stop rest timer', e);
    Sentry.captureException(e);
  }
}

// ─── Internal helpers ───

async function scheduleTimerEndNotification(seconds: number): Promise<void> {
  try {
    currentNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        sound: 'default',
        interruptionLevel: 'timeSensitive',
      },
      trigger: {
        type: SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, seconds),
      },
    });
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to schedule timer notification', e);
    Sentry.captureException(e);
  }
}

async function cancelTimerEndNotification(): Promise<void> {
  if (currentNotificationId) {
    const idToCancel = currentNotificationId;
    currentNotificationId = null;
    try {
      await Notifications.cancelScheduledNotificationAsync(idToCancel);
    } catch {}
  }
}
