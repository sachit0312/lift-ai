import AppIntents
import ActivityKit
import WidgetKit
import os

private let logger = Logger(subsystem: "com.sachitgoyal.liftai.LiveActivity", category: "Intents")

// MARK: - Complete Set

@available(iOS 17.0, *)
struct CompleteSetIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Complete Set"

    func perform() async throws -> some IntentResult {
        logger.info("CompleteSetIntent.perform() called")
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else {
            logger.warning("CompleteSetIntent: no workout state found")
            return .result()
        }

        // No-op if no weight/reps data — user should tap Live Activity to open app
        if state.current.weight == 0 && state.current.reps == 0 {
            logger.info("CompleteSetIntent: no weight/reps data, skipping (user should open app)")
            return .result()
        }

        // Enqueue action for RN to process
        let action = WorkoutAction(
            type: "completeSet",
            weight: state.current.weight,
            reps: state.current.reps,
            blockIndex: state.current.exerciseBlockIndex,
            setIndex: state.current.setNumber - 1,
            delta: nil,
            ts: Date().timeIntervalSince1970 * 1000
        )
        helper.appendAction(action)

        // Transition to rest timer if enabled
        if state.current.restEnabled && state.current.restSeconds > 0 {
            state.isResting = true
            state.restEndTime = Date().timeIntervalSince1970 * 1000 + Double(state.current.restSeconds) * 1000
        }

        // Advance to next set or next exercise
        if let next = state.next {
            state.current.setNumber = next.setNumber
            state.current.weight = next.weight
            state.current.reps = next.reps
            // totalSets stays the same within same exercise
            state.next = nil // RN will repopulate on next poll
        } else if let nextEx = state.nextExercise {
            state.current.exerciseName = nextEx.exerciseName
            state.current.exerciseBlockIndex += 1
            state.current.setNumber = nextEx.setNumber
            state.current.totalSets = nextEx.totalSets
            state.current.weight = nextEx.weight
            state.current.reps = nextEx.reps
            state.next = nil
            state.nextExercise = nil // RN will repopulate
        }

        logger.info("CompleteSetIntent: advancing to \(state.current.exerciseName) set \(state.current.setNumber)/\(state.current.totalSets)")
        helper.writeWorkoutState(state)
        await refreshLiveActivity(state: state)

        return .result()
    }
}

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
        if state.restEndTime < now {
            state.restEndTime = now
        }

        helper.writeWorkoutState(state)

        // Enqueue action for RN to apply delta reliably from main app process
        let action = WorkoutAction(
            type: "adjustRest",
            weight: nil,
            reps: nil,
            blockIndex: nil,
            setIndex: nil,
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
            weight: nil,
            reps: nil,
            blockIndex: nil,
            setIndex: nil,
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
            weight: nil,
            reps: nil,
            blockIndex: nil,
            setIndex: nil,
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
    logger.info("refreshLiveActivity: found \(activities.count) activities")

    guard let activity = activities.first else {
        logger.warning("refreshLiveActivity: no active Live Activity found")
        return
    }

    let contentState: LiveActivityAttributes.ContentState
    if state.isResting {
        contentState = LiveActivityAttributes.ContentState(
            title: state.current.exerciseName,
            subtitle: "Rest Timer",
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

    logger.info("refreshLiveActivity: updating activity with subtitle=\(contentState.subtitle ?? "nil")")
    await activity.update(
        ActivityContent(state: contentState, staleDate: nil)
    )
}
