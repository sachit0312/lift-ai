import AppIntents
import ActivityKit
import WidgetKit
import os

private let logger = Logger(subsystem: "com.sachitgoyal.liftai.LiveActivity", category: "Intents")

// MARK: - Weight Intents (zero-parameter for reliable Live Activity buttons)

@available(iOS 17.0, *)
struct DecreaseWeightIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Decrease Weight"

    func perform() async throws -> some IntentResult {
        logger.info("DecreaseWeightIntent.perform() called")
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else {
            logger.warning("DecreaseWeightIntent: no workout state found")
            return .result()
        }

        state.current.weight = max(0, state.current.weight - 2.5)
        logger.info("DecreaseWeightIntent: weight now \(state.current.weight)")
        helper.writeWorkoutState(state)

        // Enqueue action for RN to apply delta reliably from main app process
        let action = WorkoutAction(
            type: "adjustWeight",
            weight: nil,
            reps: nil,
            blockIndex: state.current.exerciseBlockIndex,
            setIndex: state.current.setNumber - 1,
            delta: -2.5,
            ts: Date().timeIntervalSince1970 * 1000
        )
        helper.appendAction(action)

        await refreshLiveActivity(state: state)

        return .result()
    }
}

@available(iOS 17.0, *)
struct IncreaseWeightIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Increase Weight"

    func perform() async throws -> some IntentResult {
        logger.info("IncreaseWeightIntent.perform() called")
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else {
            logger.warning("IncreaseWeightIntent: no workout state found")
            return .result()
        }

        state.current.weight = state.current.weight + 2.5
        logger.info("IncreaseWeightIntent: weight now \(state.current.weight)")
        helper.writeWorkoutState(state)

        // Enqueue action for RN to apply delta reliably from main app process
        let action = WorkoutAction(
            type: "adjustWeight",
            weight: nil,
            reps: nil,
            blockIndex: state.current.exerciseBlockIndex,
            setIndex: state.current.setNumber - 1,
            delta: 2.5,
            ts: Date().timeIntervalSince1970 * 1000
        )
        helper.appendAction(action)

        await refreshLiveActivity(state: state)

        return .result()
    }
}

// MARK: - Reps Intents (zero-parameter for reliable Live Activity buttons)

@available(iOS 17.0, *)
struct DecreaseRepsIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Decrease Reps"

    func perform() async throws -> some IntentResult {
        logger.info("DecreaseRepsIntent.perform() called")
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else {
            logger.warning("DecreaseRepsIntent: no workout state found")
            return .result()
        }

        state.current.reps = max(0, state.current.reps - 1)
        logger.info("DecreaseRepsIntent: reps now \(state.current.reps)")
        helper.writeWorkoutState(state)

        // Enqueue action for RN to apply delta reliably from main app process
        let action = WorkoutAction(
            type: "adjustReps",
            weight: nil,
            reps: nil,
            blockIndex: state.current.exerciseBlockIndex,
            setIndex: state.current.setNumber - 1,
            delta: -1.0,
            ts: Date().timeIntervalSince1970 * 1000
        )
        helper.appendAction(action)

        await refreshLiveActivity(state: state)

        return .result()
    }
}

@available(iOS 17.0, *)
struct IncreaseRepsIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Increase Reps"

    func perform() async throws -> some IntentResult {
        logger.info("IncreaseRepsIntent.perform() called")
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else {
            logger.warning("IncreaseRepsIntent: no workout state found")
            return .result()
        }

        state.current.reps = state.current.reps + 1
        logger.info("IncreaseRepsIntent: reps now \(state.current.reps)")
        helper.writeWorkoutState(state)

        // Enqueue action for RN to apply delta reliably from main app process
        let action = WorkoutAction(
            type: "adjustReps",
            weight: nil,
            reps: nil,
            blockIndex: state.current.exerciseBlockIndex,
            setIndex: state.current.setNumber - 1,
            delta: 1.0,
            ts: Date().timeIntervalSince1970 * 1000
        )
        helper.appendAction(action)

        await refreshLiveActivity(state: state)

        return .result()
    }
}

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

    // Include weight/reps in subtitle so the content state actually changes —
    // without this, the system may skip the re-render if title+subtitle are identical
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
        let weightStr = state.current.weight.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(state.current.weight))"
            : String(format: "%.1f", state.current.weight)
        contentState = LiveActivityAttributes.ContentState(
            title: state.current.exerciseName,
            subtitle: "Set \(state.current.setNumber)/\(state.current.totalSets) \u{00B7} \(weightStr) lbs \u{00D7} \(state.current.reps)",
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
