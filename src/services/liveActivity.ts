import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import type { LiveActivityState } from 'expo-live-activity';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { getItem, getItemAndRemove, setItem, removeItem } from '../../modules/shared-user-defaults';
import { colors } from '../theme';

// ─── Module-level state (singleton) ───

let currentActivityId: string | null = null;
let currentNotificationId: string | null = null;
let currentEndTime: number = 0;
let currentExerciseName: string = '';
let currentSetNumber: number = 1;
let currentTotalSets: number = 1;
let currentMaxRestSeconds: number = 0;
/** True when currentMaxRestSeconds was zeroed on purpose for a NEW rest, so the persisted
 *  value must not be restored over it. Cleared once a real baseline is set, and on stop, so
 *  a genuine cold start can still adopt the persisted value. */
let baselineExplicitlyCleared = false;

// ─── Update deduplication & throttle state ───
let lastContentStateJSON = '';
let lastUpdateTimestamp = 0;
let pendingUpdate: { contentState: LiveActivityState; timeoutId: ReturnType<typeof setTimeout> } | null = null;
const MIN_UPDATE_INTERVAL_MS = 500;

let pendingNotificationReschedule: { endTime: number; timeoutId: ReturnType<typeof setTimeout> } | null = null;
const NOTIFICATION_DEBOUNCE_MS = 300;

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

/**
 * Clears the rest progress-bar denominator so the next rest sets its own baseline.
 *
 * currentMaxRestSeconds was only zeroed on stop, but startRestTimer re-arms without stopping.
 * Resting 150s on one exercise and tapping +15s twice (max 180) then starting a 60s rest on
 * the next exercise left the lock screen drawing 60s against 180s — the bar showed ~33%
 * elapsed at t=0, disagreeing with the in-app bar, which resets correctly.
 */
export function resetRestProgressBaseline(): void {
  currentMaxRestSeconds = 0;
  // Zeroing the in-memory value alone was a no-op. getCurrentMaxRestSeconds() treats 0 as
  // "cold start, restore from disk" and nothing ever clears the persisted mirror — so the
  // very next widget sync (which runs synchronously from startRestTimer, BEFORE
  // updateWorkoutActivityForRest gets to set the new baseline) resurrected the previous
  // rest's value and re-persisted it. This flag says the zero is deliberate, so the restore
  // is suppressed until a real new baseline is established.
  baselineExplicitlyCleared = true;
}

export function getCurrentMaxRestSeconds(): number {
  if (currentMaxRestSeconds === 0 && !baselineExplicitlyCleared) {
    const persisted = readPersistedMaxRestSeconds();
    if (persisted > 0) currentMaxRestSeconds = persisted;
  }
  return currentMaxRestSeconds;
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

  // Adopt an activity left behind by a previous app process (force-quit / crash) so we update
  // it rather than stacking a second widget beside it. If it is already gone, updateActivity
  // below reports "not found" and we fall through to creating a fresh one.
  if (!currentActivityId) {
    const persisted = readPersistedActivityId();
    if (persisted) currentActivityId = persisted;
  }

  // If we already have an activity, try to update it (idempotent — no stacking)
  if (currentActivityId) {
    try {
      LiveActivity.updateActivity(currentActivityId, { title: exerciseName, subtitle });
      currentExerciseName = exerciseName;
      lastContentStateJSON = JSON.stringify({ title: exerciseName, subtitle });
      lastUpdateTimestamp = Date.now();
      return;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '';
      if (/not found/i.test(message)) {
        currentActivityId = null;
        persistActivityId(null);
      } else {
        return;
      }
    }
  }

  // No existing activity — create fresh
  try {
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
    persistActivityId(currentActivityId);
    lastContentStateJSON = '';
    lastUpdateTimestamp = 0;
    if (pendingUpdate) {
      clearTimeout(pendingUpdate.timeoutId);
      pendingUpdate = null;
    }
    if (pendingNotificationReschedule) {
      clearTimeout(pendingNotificationReschedule.timeoutId);
      pendingNotificationReschedule = null;
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
    // Trigger eager restore from persisted state (no-op if currentMaxRestSeconds is non-zero).
    // After that, this is just the fallback for a fresh rest with no previously-persisted state.
    getCurrentMaxRestSeconds();
    if (currentMaxRestSeconds === 0) currentMaxRestSeconds = totalSeconds;
    baselineExplicitlyCleared = false;

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
    // Clear unconditionally: a persisted id may exist even when currentActivityId is null
    // (activity started by a previous process that was force-quit before finishing).
    persistActivityId(null);
    currentEndTime = 0;
    currentExerciseName = '';
    currentSetNumber = 1;
    currentTotalSets = 1;
    currentMaxRestSeconds = 0;
    baselineExplicitlyCleared = false;
    // Reset dedup/throttle state
    lastContentStateJSON = '';
    lastUpdateTimestamp = 0;
    if (pendingUpdate) {
      clearTimeout(pendingUpdate.timeoutId);
      pendingUpdate = null;
    }
    if (pendingNotificationReschedule) {
      clearTimeout(pendingNotificationReschedule.timeoutId);
      pendingNotificationReschedule = null;
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

    safeUpdateActivity({
      title: currentExerciseName,
      subtitle: `Set ${currentSetNumber}/${currentTotalSets}|${currentMaxRestSeconds}`,
      progressBar: { date: newEndTime },
    });

    // Debounce the notification reschedule. Rapid +/-15s taps would otherwise
    // fire one cancel + one schedule per tap; we only need the FINAL position
    // reflected in the system notification.
    if (pendingNotificationReschedule) {
      clearTimeout(pendingNotificationReschedule.timeoutId);
    }
    const timeoutId = setTimeout(() => {
      pendingNotificationReschedule = null;
      // If stopRestTimerActivity ran between the adjust and this fire,
      // currentEndTime is 0 and there's no rest to schedule for.
      if (!currentEndTime) return;
      const remainingSeconds = Math.max(0, Math.round((currentEndTime - Date.now()) / 1000));
      serializedNotificationOp(async () => {
        await cancelTimerEndNotification();
        if (remainingSeconds > 0) {
          await scheduleTimerEndNotification(remainingSeconds);
        }
      });
    }, NOTIFICATION_DEBOUNCE_MS);
    pendingNotificationReschedule = { endTime: newEndTime, timeoutId };
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to adjust rest timer', e);
    Sentry.captureException(e);
  }
}

export function stopRestTimerActivity(): void {
  if (Platform.OS !== 'ios') return;
  // Cancel notification even if activity was dismissed — must run above !currentActivityId guard
  serializedNotificationOp(() => cancelTimerEndNotification());
  if (pendingNotificationReschedule) {
    clearTimeout(pendingNotificationReschedule.timeoutId);
    pendingNotificationReschedule = null;
  }
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

// ─── Widget action queue ───

/**
 * Read and clear pending widget intent actions from UserDefaults.
 * Called on foreground return to sync RN state with Swift widget adjustments.
 * Returns total delta in seconds (0 = no actions, -Infinity = skip rest).
 */
export function applyPendingWidgetActions(): number {
  if (Platform.OS !== 'ios') return 0;
  try {
    const raw = getItemAndRemove('liftai_action_queue');
    if (!raw) return 0;
    const actions: { type: string; delta?: number; ts: number }[] = JSON.parse(raw);
    let totalDelta = 0;
    for (const action of actions) {
      if (action.type === 'skipRest') return -Infinity;
      if (action.type === 'adjustRest' && action.delta != null) {
        totalDelta += action.delta;
      }
    }
    return totalDelta;
  } catch (e) {
    Sentry.captureException(e);
    return 0;
  }
}

// ─── Notification serialization ───
// Prevents concurrent cancel+schedule calls from interleaving when multiple
// adjustments fire in quick succession (e.g., rapid +15s taps from widget).
let notificationChain: Promise<void> = Promise.resolve();

function serializedNotificationOp(fn: () => Promise<void>): void {
  notificationChain = notificationChain.then(fn).catch(e => { Sentry.captureException(e); });
}

// ─── Internal helpers ───

/**
 * App Group key holding the id of the Live Activity started by a previous app process.
 *
 * currentActivityId is module-level JS state, so it is lost on force-quit or crash — but iOS
 * Live Activities deliberately outlive the process, and expo-live-activity exposes no way to
 * enumerate running activities. The idempotency guard in startWorkoutActivity therefore only
 * held within a single process lifetime: force-quitting mid-workout and reopening created a
 * SECOND widget, and finishing stopped only the second one, leaving the first on the lock
 * screen showing a stale workout until iOS's staleness cutoff. Persisting the id lets a cold
 * start adopt the existing activity instead of stacking a new one on top.
 */
const ACTIVITY_ID_KEY = 'liftai_live_activity_id';

function persistActivityId(activityId: string | null): void {
  try {
    if (activityId) setItem(ACTIVITY_ID_KEY, activityId);
    else removeItem(ACTIVITY_ID_KEY);
  } catch (e) {
    Sentry.captureException(e);
  }
}

function readPersistedActivityId(): string | null {
  try {
    return getItem(ACTIVITY_ID_KEY);
  } catch {
    return null;
  }
}

function readPersistedMaxRestSeconds(): number {
  try {
    const raw = getItem('liftai_workout_state');
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { restMaxSeconds?: number };
    return typeof parsed.restMaxSeconds === 'number' ? parsed.restMaxSeconds : 0;
  } catch {
    return 0;
  }
}

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
