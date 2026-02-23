import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { colors } from '../theme';

// ─── Module-level state (singleton) ───

let currentActivityId: string | null = null;
let currentNotificationId: string | null = null;
let currentEndTime: number = 0;
let currentExerciseName: string = '';

// ─── Configure notification handler ───

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
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
    console.error('Failed to request notification permissions', e);
  }
}

// ─── Persistent Workout Activity ───

/**
 * Start a persistent Live Activity for the entire workout.
 * The activity stays active and switches between set entry and rest timer views.
 */
export function startWorkoutActivity(exerciseName: string, subtitle: string): void {
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
    cancelTimerEndNotification();

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
    console.error('Failed to start workout Live Activity', e);
  }
}

/**
 * Update the persistent workout activity for set entry view.
 * The interactive widget reads full state from UserDefaults;
 * this update triggers the SwiftUI re-render.
 */
export function updateWorkoutActivityForSet(
  exerciseName: string, setNumber: number, totalSets: number
): void {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    currentExerciseName = exerciseName;
    currentEndTime = 0;

    LiveActivity.updateActivity(currentActivityId, {
      title: exerciseName,
      subtitle: `Set ${setNumber}/${totalSets}`,
    });

    cancelTimerEndNotification();
  } catch (e: unknown) {
    console.error('Failed to update workout activity for set', e);
  }
}

/**
 * Update the persistent workout activity for rest timer view.
 * Transitions the lock screen to show the rest timer countdown.
 */
export function updateWorkoutActivityForRest(exerciseName: string, totalSeconds: number): void {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    const endTime = Date.now() + totalSeconds * 1000;
    currentEndTime = endTime;
    currentExerciseName = exerciseName;

    LiveActivity.updateActivity(currentActivityId, {
      title: exerciseName,
      subtitle: 'Rest Timer',
      progressBar: { date: endTime },
    });

    // Cancel any existing notification before scheduling new one
    cancelTimerEndNotification();
    scheduleTimerEndNotification(totalSeconds, exerciseName);
  } catch (e: unknown) {
    console.error('Failed to update workout activity for rest', e);
  }
}

/**
 * Stop the persistent workout activity.
 */
export function stopWorkoutActivity(): void {
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
    cancelTimerEndNotification();
  } catch (e: unknown) {
    console.error('Failed to stop workout Live Activity', e);
  }
}

// ─── Rest Timer Functions (now operate within persistent activity) ───

export function startRestTimerActivity(totalSeconds: number, exerciseName: string): void {
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

    // Schedule notification for when timer ends
    scheduleTimerEndNotification(totalSeconds, exerciseName);
  } catch (e: unknown) {
    console.error('Failed to start rest timer', e);
  }
}

export function adjustRestTimerActivity(deltaSeconds: number): void {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    const newEndTime = currentEndTime + deltaSeconds * 1000;
    currentEndTime = newEndTime;

    const remainingSeconds = Math.max(0, Math.round((newEndTime - Date.now()) / 1000));

    LiveActivity.updateActivity(currentActivityId, {
      title: currentExerciseName,
      progressBar: { date: newEndTime },
    });

    // Reschedule notification
    cancelTimerEndNotification();
    if (remainingSeconds > 0) {
      scheduleTimerEndNotification(remainingSeconds);
    }
  } catch (e: unknown) {
    console.error('Failed to adjust rest timer', e);
  }
}

export function stopRestTimerActivity(): void {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    currentEndTime = 0;

    // Update activity back to set entry view (don't stop it)
    LiveActivity.updateActivity(currentActivityId, {
      title: currentExerciseName,
      subtitle: 'Next Set',
    });

    cancelTimerEndNotification();
  } catch (e: unknown) {
    console.error('Failed to stop rest timer', e);
  }
}

// ─── Internal helpers ───

async function scheduleTimerEndNotification(seconds: number, exerciseName?: string): Promise<void> {
  try {
    currentNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest Timer Done',
        body: exerciseName ? `Time for your next set of ${exerciseName}` : 'Time for your next set',
        sound: 'default',
        interruptionLevel: 'timeSensitive',
      },
      trigger: {
        type: SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, seconds),
      },
    });
  } catch (e: unknown) {
    console.error('Failed to schedule timer notification', e);
  }
}

function cancelTimerEndNotification(): void {
  if (currentNotificationId) {
    Notifications.cancelScheduledNotificationAsync(currentNotificationId).catch(() => {});
    currentNotificationId = null;
  }
}
