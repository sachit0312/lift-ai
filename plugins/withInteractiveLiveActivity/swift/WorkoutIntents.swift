import AppIntents
import ActivityKit
import WidgetKit

// MARK: - Adjust Weight

@available(iOS 17.0, *)
struct AdjustWeightIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Adjust Weight"

    @Parameter(title: "Delta")
    var delta: Double

    init() {
        self.delta = 2.5
    }

    init(delta: Double) {
        self.delta = delta
    }

    func perform() async throws -> some IntentResult {
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else { return .result() }

        state.current.weight = max(0, state.current.weight + delta)
        helper.writeWorkoutState(state)

        await refreshLiveActivity(state: state)

        return .result()
    }
}

// MARK: - Adjust Reps

@available(iOS 17.0, *)
struct AdjustRepsIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Adjust Reps"

    @Parameter(title: "Delta")
    var delta: Int

    init() {
        self.delta = 1
    }

    init(delta: Int) {
        self.delta = delta
    }

    func perform() async throws -> some IntentResult {
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else { return .result() }

        state.current.reps = max(0, state.current.reps + delta)
        helper.writeWorkoutState(state)

        await refreshLiveActivity(state: state)

        return .result()
    }
}

// MARK: - Complete Set

@available(iOS 17.0, *)
struct CompleteSetIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Complete Set"

    func perform() async throws -> some IntentResult {
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else { return .result() }

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

        helper.writeWorkoutState(state)
        await refreshLiveActivity(state: state)

        return .result()
    }
}

// MARK: - Adjust Rest Timer

@available(iOS 17.0, *)
struct AdjustRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Adjust Rest Timer"

    @Parameter(title: "Delta")
    var delta: Int

    init() {
        self.delta = 15
    }

    init(delta: Int) {
        self.delta = delta
    }

    func perform() async throws -> some IntentResult {
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState(), state.isResting else { return .result() }

        state.restEndTime += Double(delta) * 1000
        let now = Date().timeIntervalSince1970 * 1000
        if state.restEndTime < now {
            state.restEndTime = now
        }

        helper.writeWorkoutState(state)
        await refreshLiveActivity(state: state)

        return .result()
    }
}

// MARK: - Skip Rest

@available(iOS 17.0, *)
struct SkipRestIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Skip Rest"

    func perform() async throws -> some IntentResult {
        let helper = WorkoutUserDefaultsHelper.shared
        guard var state = helper.readWorkoutState() else { return .result() }

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
    guard let activity = Activity<LiveActivityAttributes>.activities.first else { return }

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

    await activity.update(
        ActivityContent(state: contentState, staleDate: nil)
    )
}
