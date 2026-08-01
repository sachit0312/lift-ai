import { Platform } from 'react-native';
import * as LiveActivity from 'expo-live-activity';
import type { LiveActivityState } from 'expo-live-activity';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import { getItem, setItem, removeItem } from '../../modules/shared-user-defaults';
import { colors } from '../theme';

// ─── Module-level state (singleton) ───

let currentActivityId: string | null = null;
let currentNotificationId: string | null = null;
let currentEndTime: number = 0;
let currentExerciseName: string = '';
let currentSetNumber: number = 1;
let currentTotalSets: number = 1;
/** Denominator for the lock-screen rest progress bar. Set once per rest by
 *  updateWorkoutActivityForRest and grown by +15s adjustments (never shrunk, so it matches
 *  the in-app RestTimerBar). Owned entirely in memory — it used to be mirrored to the App
 *  Group and restored from there, but the only writer of that mirror was this module, so the
 *  round-trip could only ever resurrect the PREVIOUS rest's value. */
let currentMaxRestSeconds: number = 0;

// ─── Update deduplication & throttle state ───
let lastContentStateJSON = '';
let lastUpdateTimestamp = 0;
/** Guards against flooding Sentry with repeated ActivityKit throttle errors — see doUpdate. */
let updateErrorReported = false;
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
 * Clears the rest progress-bar denominator so the next rest sets its own baseline.
 *
 * currentMaxRestSeconds was only zeroed on stop, but startRestTimer re-arms without stopping.
 * Resting 150s on one exercise and tapping +15s twice (max 180) then starting a 60s rest on
 * the next exercise left the lock screen drawing 60s against 180s — the bar showed ~33%
 * elapsed at t=0, disagreeing with the in-app bar, which resets correctly.
 */
export function resetRestProgressBaseline(): void {
  currentMaxRestSeconds = 0;
}

export function getCurrentMaxRestSeconds(): number {
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
  let adoptedFromPreviousProcess = false;
  if (!currentActivityId) {
    const persisted = readPersistedActivityId();
    if (persisted) {
      currentActivityId = persisted;
      adoptedFromPreviousProcess = true;
    }
  }

  // A previous process died (force-quit or crash) mid-rest. currentNotificationId is JS module
  // state and went with it, but the scheduled iOS notification did not — and cancel-by-id can
  // no longer reach it. Without this, a "Rest Complete" banner fires with sound minutes later
  // for a rest that no longer exists. Safe here specifically because this branch means no rest
  // is live in THIS process, so there is no legitimate notification to destroy.
  if (adoptedFromPreviousProcess) {
    serializedNotificationOp(() => Notifications.cancelAllScheduledNotificationsAsync());
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
        if (__DEV__) console.error('Failed to adopt existing Live Activity', e);
        Sentry.captureException(e);
        return;
      }
    }
  }

  // No existing activity — create fresh
  try {
    currentEndTime = 0;
    currentExerciseName = exerciseName;
    currentMaxRestSeconds = 0;
    // Same reasoning as the adopt path: starting a workout means no rest is live, so any
    // scheduled rest notification is an orphan from a process that died.
    serializedNotificationOp(() => Notifications.cancelAllScheduledNotificationsAsync());
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
  // A rest is running — this is an incidental sync (add exercise, un-complete a set), not an
  // authoritative rest-state change. Dropping the timer here is what made the lock-screen
  // countdown vanish ~500ms into every rest: useSetCompletion calls syncWidgetState right
  // after startRestTimer, and isRestingRef has not caught up yet, so the non-rest branch ran
  // and pushed a content state with no progressBar. Refresh the labels instead.
  if (currentEndTime > 0) {
    refreshWorkoutActivityDuringRest(exerciseName, setNumber, totalSets);
    return;
  }
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
 * Refresh the exercise/set labels while a rest is running, WITHOUT touching the timing.
 *
 * The countdown and progress bar are driven entirely by the absolute end date already in the
 * content state, and the Swift view keys both on `.id(restEndTime)` — so re-sending a
 * recomputed end date forces SwiftUI to tear down and recreate them, which reads as a flicker
 * and a jumping timer. Reusing currentEndTime keeps the content state byte-identical when
 * nothing meaningful changed, so safeUpdateActivity's dedup drops the push entirely.
 */
export function refreshWorkoutActivityDuringRest(
  exerciseName: string, setNumber: number, totalSets: number
): void {
  if (Platform.OS !== 'ios' || !currentActivityId || currentEndTime <= 0) return;
  try {
    currentExerciseName = exerciseName;
    currentSetNumber = setNumber;
    currentTotalSets = totalSets;

    safeUpdateActivity({
      title: exerciseName,
      subtitle: `Set ${setNumber}/${totalSets}|${currentMaxRestSeconds}`,
      progressBar: { date: currentEndTime },
      staleDate: currentEndTime,
    });
  } catch (e: unknown) {
    if (__DEV__) console.error('Failed to refresh workout activity during rest', e);
    Sentry.captureException(e);
  }
}

/**
 * Arm (or re-arm) the rest countdown on the persistent activity, transitioning the lock
 * screen to the rest timer view.
 *
 * `endTime` is an ABSOLUTE epoch-millis deadline, deliberately not a "remaining seconds"
 * value. Callers used to pass Math.round((end - Date.now())/1000) and this function rebuilt
 * the deadline as Date.now() + seconds*1000, so every sync re-anchored the lock screen up to
 * 500ms away from the in-app timer — and because the recomputed value differed every time,
 * safeUpdateActivity's dedup never hit and the Swift `.id(restEndTime)` recreated the timer
 * views on each push.
 */
export async function updateWorkoutActivityForRest(
  exerciseName: string, endTime: number, setNumber: number, totalSets: number,
  totalSeconds?: number,
): Promise<void> {
  if (Platform.OS !== 'ios' || !currentActivityId) return;
  try {
    currentEndTime = endTime;
    currentExerciseName = exerciseName;
    currentSetNumber = setNumber;
    currentTotalSets = totalSets;
    // The caller owns the denominator (useRestTimer knows the rest duration and how far the
    // user has extended it). Fall back to the time remaining only when it wasn't supplied.
    if (totalSeconds != null && totalSeconds > 0) {
      currentMaxRestSeconds = Math.max(currentMaxRestSeconds, totalSeconds);
    } else if (currentMaxRestSeconds === 0) {
      currentMaxRestSeconds = Math.max(1, Math.round((endTime - Date.now()) / 1000));
    }

    safeUpdateActivity({
      title: exerciseName,
      subtitle: `Set ${setNumber}/${totalSets}|${currentMaxRestSeconds}`,
      progressBar: { date: endTime },
      // Marks the activity stale exactly when the rest ends. The JS runtime is suspended
      // while the phone is locked, so this is the only way the widget can drop the countdown
      // at the deadline — Live Activities have no timeline and no scheduled re-render.
      staleDate: endTime,
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
    // Reset dedup/throttle state
    lastContentStateJSON = '';
    lastUpdateTimestamp = 0;
    updateErrorReported = false;
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
  // Above the guard: currentEndTime is what updateWorkoutActivityForSet reads to decide
  // whether a rest is live, so it must be cleared even when the activity is already gone.
  currentEndTime = 0;
  if (!currentActivityId) return;
  try {
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
      // Activity was dismissed by user/iOS — null out so future calls short-circuit, and drop
      // the persisted id too, or a cold start would adopt an activity that no longer exists.
      currentActivityId = null;
      persistActivityId(null);
      return;
    }
    // Transient/rate-limit errors: preserve currentActivityId so future updates still work.
    // Reported, not swallowed — this is the highest-traffic native call in the feature, and
    // silently dropping ActivityKit throttling here is indistinguishable from a logic bug.
    //
    // Reported at most once per activity, though. This runs synchronously on the checkbox-tap
    // call stack, and ActivityKit throttling tends to arrive in bursts — capturing every one
    // would put stack collection on the JS thread mid-workout and flood the issue for what is,
    // after the first instance, a known condition. The counter resets in stopWorkoutActivity.
    if (__DEV__) console.error('Live Activity update failed', e);
    if (!updateErrorReported) {
      updateErrorReported = true;
      Sentry.captureException(e);
    }
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
