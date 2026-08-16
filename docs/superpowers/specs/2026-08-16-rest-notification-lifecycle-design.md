# Rest Notification Lifecycle Design

## Problem

Each rest timer schedules a local iOS notification without an explicit identifier. iOS therefore assigns a new identifier to every request. The app cancels pending requests when a rest changes or ends, but `cancelScheduledNotificationAsync` cannot remove notifications that have already been delivered. In addition, the foreground notification handler sets `shouldShowList: true`, so a completed rest is deliberately added to Notification Center even while the user is actively using the app. The result is a stack of identical "Rest Complete" notifications over a workout.

## Approved Behavior

- A rest completing while the app is foregrounded uses the existing in-app vibration and does not add an entry to Notification Center.
- A rest completing while the app is backgrounded or the phone is locked continues to play the default sound and use the existing `timeSensitive` interruption level.
- Rest notifications use one stable identifier, `liftai-rest-complete`, so a new request replaces any pending or delivered rest notification instead of accumulating another entry.
- Starting, dismissing, or completing a rest removes both the pending request and any delivered notification with that identifier.
- Cleanup remains scoped to the rest notification and does not remove unrelated notifications from the app.

## Implementation

`src/services/liveActivity.ts` owns the complete notification lifecycle:

1. Define a module-level `REST_NOTIFICATION_ID` constant.
2. Return `shouldShowList: false` from the foreground notification handler while leaving foreground sound/banner suppression unchanged.
3. Pass `identifier: REST_NOTIFICATION_ID` to `scheduleNotificationAsync`.
4. Make `cancelTimerEndNotification` target the stable identifier for both `cancelScheduledNotificationAsync` and `dismissNotificationAsync`. Treat either operation as idempotent cleanup; report unexpected failures through Sentry.
5. Replace blanket orphan cleanup with the same targeted rest-notification cleanup where practical.

No navigation, database, Live Activity rendering, rest duration, or alert copy changes are in scope.

## Testing

- Assert the notification request uses the stable identifier.
- Assert cleanup cancels a pending request and dismisses a delivered notification with that identifier.
- Assert the foreground handler suppresses Notification Center list presentation.
- Preserve the existing rapid-start and adjust/stop tests to ensure serialization still leaves at most one pending request.
- Run the notification-focused suites, TypeScript, and the repository test suite with the worktree-safe Jest ignore override.

## Success Criteria

- Foreground rest completion produces only the existing vibration.
- Background/locked rest completion still produces a time-sensitive audible alert.
- Notification Center contains at most one Lift AI rest-completion notification.
- A delivered rest notification is removed when the rest lifecycle is cleaned up.
- Existing rest timer and Live Activity tests remain green.
