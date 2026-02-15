import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { colors } from '../theme';

// ─── Module-level state (singleton) ───

let currentActivityId: string | null = null;
let currentNotificationId: string | null = null;
let currentEndTime: number = 0;

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

export async function requestNotificationPermissions(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await Notifications.requestPermissionsAsync();
  } catch (e: unknown) {
    console.error('Failed to request notification permissions', e);
  }
}

export function startRestTimerActivity(totalSeconds: number, exerciseName: string): void {
  if (Platform.OS !== 'ios') return;
  try {
    // Stop any existing activity first
    stopRestTimerActivitySync();

    const endTime = Date.now() + totalSeconds * 1000;
    currentEndTime = endTime;

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

    // Schedule notification for when timer ends
    scheduleTimerEndNotification(totalSeconds, exerciseName);
  } catch (e: unknown) {
    console.error('Failed to start Live Activity', e);
  }
}

export function adjustRestTimerActivity(deltaSeconds: number): void {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    const newEndTime = currentEndTime + deltaSeconds * 1000;
    currentEndTime = newEndTime;

    const remainingSeconds = Math.max(0, Math.round((newEndTime - Date.now()) / 1000));

    LiveActivity.updateActivity(currentActivityId, {
      title: currentActivityId ? '' : '', // keep existing title
      progressBar: { date: newEndTime },
    });

    // Reschedule notification
    cancelTimerEndNotification();
    if (remainingSeconds > 0) {
      scheduleTimerEndNotification(remainingSeconds);
    }
  } catch (e: unknown) {
    console.error('Failed to adjust Live Activity', e);
  }
}

export function stopRestTimerActivity(): void {
  if (Platform.OS !== 'ios') return;
  try {
    stopRestTimerActivitySync();
  } catch (e: unknown) {
    console.error('Failed to stop Live Activity', e);
  }
}

// ─── Internal helpers ───

function stopRestTimerActivitySync(): void {
  if (currentActivityId) {
    try {
      LiveActivity.stopActivity(currentActivityId, {
        title: 'Rest Complete',
        subtitle: '',
      });
    } catch {
      // Activity may already be dismissed
    }
    currentActivityId = null;
  }
  currentEndTime = 0;
  cancelTimerEndNotification();
}

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
