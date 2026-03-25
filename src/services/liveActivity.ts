import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import type { LiveActivityState } from 'expo-live-activity';
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
let currentMaxRestSeconds: number = 0;

// ─── Update deduplication & throttle state ───
let lastContentStateJSON = '';
let lastUpdateTimestamp = 0;
let pendingUpdate: { contentState: LiveActivityState; timeoutId: ReturnType<typeof setTimeout> } | null = null;
const MIN_UPDATE_INTERVAL_MS = 500;

// ─── Configure notification handler ───

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: true,
  }),
});

// ─── Public API ───

/**
 * Returns true if a rest-end notification is currently scheduled.
 * Used by useRestTimer to decide whether to vibrate as fallback —
 * if the notification exists, it handles alerting; otherwise vibrate in-app.
 */
export function isRestNotificationScheduled(): boolean {
  return currentNotificationId !== null;
}

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
    // Reset dedup/throttle state for fresh activity
    lastContentStateJSON = '';
    lastUpdateTimestamp = 0;
    if (pendingUpdate) {
      clearTimeout(pendingUpdate.timeoutId);
      pendingUpdate = null;
    }
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

    safeUpdateActivity({
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
    // Only set on initial rest start — re-syncs from useWidgetBridge pass remaining
    // seconds (not total), which would shrink the progress bar denominator.
    if (currentMaxRestSeconds === 0) currentMaxRestSeconds = totalSeconds;

    safeUpdateActivity({
      title: exerciseName,
      subtitle: `Set ${setNumber}/${totalSets}|${currentMaxRestSeconds}`,
      progressBar: { date: endTime },
    });
    // Notifications are NOT scheduled here — they're managed by useRestTimer.
    // Scheduling here caused duplicates because this function is also called
    // via syncWidgetState on every rest state change.
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
    currentMaxRestSeconds = 0;
    // Reset dedup/throttle state
    lastContentStateJSON = '';
    lastUpdateTimestamp = 0;
    if (pendingUpdate) {
      clearTimeout(pendingUpdate.timeoutId);
      pendingUpdate = null;
    }
    serializedNotificationOp(() => cancelTimerEndNotification());
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to stop workout Live Activity', e);
    Sentry.captureException(e);
  }
}

// ─── Rest Timer Functions (now operate within persistent activity) ───

/**
 * Schedule the initial "Rest Complete" notification via the serialized queue.
 * This prevents a race with adjustRestTimerActivity's cancel+reschedule
 * if the user taps +/-15s immediately after rest starts.
 */
export function scheduleRestNotification(seconds: number): void {
  serializedNotificationOp(async () => {
    await cancelTimerEndNotification();
    await scheduleTimerEndNotification(seconds);
  });
}

export async function adjustRestTimerActivity(deltaSeconds: number): Promise<void> {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    const newEndTime = currentEndTime + deltaSeconds * 1000;
    currentEndTime = newEndTime;
    if (deltaSeconds > 0) currentMaxRestSeconds += deltaSeconds;

    const remainingSeconds = Math.max(0, Math.round((newEndTime - Date.now()) / 1000));

    safeUpdateActivity({
      title: currentExerciseName,
      subtitle: `Set ${currentSetNumber}/${currentTotalSets}|${currentMaxRestSeconds}`,
      progressBar: { date: newEndTime },
    });

    // Reschedule notification via serialized queue to prevent stacking
    serializedNotificationOp(async () => {
      await cancelTimerEndNotification();
      if (remainingSeconds > 0) {
        await scheduleTimerEndNotification(remainingSeconds);
      }
    });
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to adjust rest timer', e);
    Sentry.captureException(e);
  }
}

export function stopRestTimerActivity(): void {
  if (Platform.OS !== 'ios') return;
  // Cancel notification even if activity was dismissed — must run above !currentActivityId guard
  serializedNotificationOp(() => cancelTimerEndNotification());
  currentMaxRestSeconds = 0;
  if (!currentActivityId) return;
  try {
    currentEndTime = 0;

    // Update activity back to set entry view with parseable "Set X/Y" subtitle (no pipe suffix)
    safeUpdateActivity({
      title: currentExerciseName,
      subtitle: `Set ${currentSetNumber}/${currentTotalSets}`,
    });
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to stop rest timer', e);
    Sentry.captureException(e);
  }
}

// ─── Notification serialization ───
// Prevents concurrent cancel+schedule calls from interleaving when multiple
// adjustments fire in quick succession (e.g., rapid +15s taps from widget).
let notificationChain: Promise<void> = Promise.resolve();

function serializedNotificationOp(fn: () => Promise<void>): void {
  notificationChain = notificationChain.then(fn).catch(() => {});
}

// ─── Internal helpers ───

/**
 * Wrapper around LiveActivity.updateActivity with deduplication, throttling,
 * and resilient error handling.
 *
 * - **Deduplication**: Skips update if content state is identical to the last-sent state.
 * - **Trailing-edge throttle**: First update goes through immediately; subsequent updates
 *   within MIN_UPDATE_INTERVAL_MS are coalesced (only the latest fires after cooldown).
 * - **Selective error handling**: Only nulls `currentActivityId` for "not found" errors
 *   (activity dismissed). Rate-limit and transient errors preserve the ID.
 */
function safeUpdateActivity(contentState: LiveActivityState): void {
  if (!currentActivityId) return;

  const json = JSON.stringify(contentState);

  // Dedup: skip if identical to last-sent state
  if (json === lastContentStateJSON) return;

  const now = Date.now();
  const elapsed = now - lastUpdateTimestamp;

  if (elapsed >= MIN_UPDATE_INTERVAL_MS) {
    // Enough time has passed — send immediately
    doUpdate(contentState, json);
  } else {
    // Throttle: coalesce into a pending update (trailing edge)
    if (pendingUpdate) {
      clearTimeout(pendingUpdate.timeoutId);
    }
    const delay = MIN_UPDATE_INTERVAL_MS - elapsed;
    const timeoutId = setTimeout(() => {
      pendingUpdate = null;
      doUpdate(contentState, json);
    }, delay);
    pendingUpdate = { contentState, timeoutId };
  }
}

function doUpdate(contentState: LiveActivityState, json: string): void {
  if (!currentActivityId) return;
  // Re-check dedup in case an identical state was sent while this was pending
  if (json === lastContentStateJSON) return;
  try {
    LiveActivity.updateActivity(currentActivityId, contentState);
    lastContentStateJSON = json;
    lastUpdateTimestamp = Date.now();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '';
    if (/not found/i.test(message)) {
      // Activity was dismissed by user/iOS — null out so future calls short-circuit
      currentActivityId = null;
    }
    // Transient/rate-limit errors: preserve currentActivityId so future updates still work
  }
}

export async function scheduleTimerEndNotification(seconds: number): Promise<void> {
  try {
    currentNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Rest Complete',
        body: 'Time for your next set',
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

export async function cancelTimerEndNotification(): Promise<void> {
  if (currentNotificationId) {
    const idToCancel = currentNotificationId;
    currentNotificationId = null;
    try {
      await Notifications.cancelScheduledNotificationAsync(idToCancel);
    } catch {}
  }
}
