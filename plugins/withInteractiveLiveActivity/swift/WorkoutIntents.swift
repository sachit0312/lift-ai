import AppIntents
import ActivityKit
import WidgetKit
import os

private let logger = Logger(subsystem: "com.sachitgoyal.liftai.LiveActivity", category: "Intents")

// MARK: - Rest Timer Intents (zero-parameter for reliable Live Activity buttons)

@available(iOS 17.0, *)
struct DecreaseRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Decrease Rest Timer"

    func perform() async throws -> some IntentResult {
        logger.info("DecreaseRestIntent.perform() called")
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState(), state.isResting else {
            logger.warning("DecreaseRestIntent: no workout state or not resting")
            return .result()
        }

        state.restEndTime -= 15000
        let now = Date().timeIntervalSince1970 * 1000
        if state.restEndTime <= now {
            // Timer expired — transition out of rest
            state.restEndTime = 0
            state.isResting = false
        }

        helper.writeWorkoutState(state)

        // Enqueue action for RN to apply delta reliably from main app process
        let action = WorkoutAction(
            type: "adjustRest",
            delta: -15.0,
            ts: Date().timeIntervalSince1970 * 1000
        )
        helper.appendAction(action)

        await refreshLiveActivity(state: state)

        return .result()
    }
}

@available(iOS 17.0, *)
struct IncreaseRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Increase Rest Timer"

    func perform() async throws -> some IntentResult {
        logger.info("IncreaseRestIntent.perform() called")
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState(), state.isResting else {
            logger.warning("IncreaseRestIntent: no workout state or not resting")
            return .result()
        }

        state.restEndTime += 15000

        helper.writeWorkoutState(state)

        // Enqueue action for RN to apply delta reliably from main app process
        let action = WorkoutAction(
            type: "adjustRest",
            delta: 15.0,
            ts: Date().timeIntervalSince1970 * 1000
        )
        helper.appendAction(action)

        await refreshLiveActivity(state: state)

        return .result()
    }
}

// MARK: - Skip Rest

@available(iOS 17.0, *)
struct SkipRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Skip Rest"

    func perform() async throws -> some IntentResult {
        logger.info("SkipRestIntent.perform() called")
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else {
            logger.warning("SkipRestIntent: no workout state found")
            return .result()
        }

        let action = WorkoutAction(
            type: "skipRest",
            delta: nil,
            ts: Date().timeIntervalSince1970 * 1000
        )
        helper.appendAction(action)

        state.isResting = false
        state.restEndTime = 0

        helper.writeWorkoutState(state)
        await refreshLiveActivity(state: state)

        return .result()
    }
}

// MARK: - Live Activity Update Helper

@available(iOS 17.0, *)
private func refreshLiveActivity(state: WorkoutState) async {
    let activities = Activity<LiveActivityAttributes>.activities
    logger.info("refreshLiveActivity: found \(activities.count) total activities")

    // Log all activities for debugging
    for (idx, act) in activities.enumerated() {
        logger.info("  activity[\(idx)]: id=\(act.id) state=\(String(describing: act.activityState))")
    }

    // Filter for active activities only
    guard let activity = activities.first(where: { $0.activityState == .active || $0.activityState == .stale }) else {
        logger.warning("refreshLiveActivity: no active/stale Live Activity found, reloading timelines as fallback")
        WidgetCenter.shared.reloadAllTimelines()
        return
    }

    let contentState: LiveActivityAttributes.ContentState
    if state.isResting {
        contentState = LiveActivityAttributes.ContentState(
            title: state.current.exerciseName,
            subtitle: "Set \(state.current.setNumber)/\(state.current.totalSets)",
            timerEndDateInMilliseconds: state.restEndTime,
            progress: nil,
            imageName: nil,
            dynamicIslandImageName: nil
        )
    } else {
        contentState = LiveActivityAttributes.ContentState(
            title: state.current.exerciseName,
            subtitle: "Set \(state.current.setNumber)/\(state.current.totalSets)",
            timerEndDateInMilliseconds: nil,
            progress: nil,
            imageName: nil,
            dynamicIslandImageName: nil
        )
    }

    logger.info("refreshLiveActivity: updating activity \(activity.id) with subtitle=\(contentState.subtitle ?? "nil")")
    await activity.update(
        ActivityContent(state: contentState, staleDate: nil)
    )
}
