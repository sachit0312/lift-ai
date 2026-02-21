import Foundation

let appGroupID = "group.com.sachitgoyal.liftai"
let workoutStateKey = "liftai_workout_state"
let actionQueueKey = "liftai_action_queue"

// MARK: - Codable Models

struct WorkoutSetState: Codable {
    var exerciseName: String
    var exerciseBlockIndex: Int
    var setNumber: Int
    var totalSets: Int
    var weight: Double
    var reps: Int
    var restSeconds: Int
    var restEnabled: Bool
}

struct NextSetState: Codable {
    var exerciseName: String
    var setNumber: Int
    var weight: Double
    var reps: Int
}

struct NextExerciseState: Codable {
    var exerciseName: String
    var setNumber: Int
    var totalSets: Int
    var weight: Double
    var reps: Int
}

struct WorkoutState: Codable {
    var current: WorkoutSetState
    var next: NextSetState?
    var nextExercise: NextExerciseState?
    var isResting: Bool
    var restEndTime: Double
    var workoutActive: Bool
}

struct WorkoutAction: Codable {
    var type: String
    var weight: Double?
    var reps: Int?
    var blockIndex: Int?
    var setIndex: Int?
    var delta: Double?
    var ts: Double
}

// MARK: - Helper

class WorkoutUserDefaultsHelper {
    static let shared = WorkoutUserDefaultsHelper()

    private let defaults: UserDefaults?

    private init() {
        defaults = UserDefaults(suiteName: appGroupID)
    }

    func readWorkoutState() -> WorkoutState? {
        guard let jsonString = defaults?.string(forKey: workoutStateKey),
              let data = jsonString.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WorkoutState.self, from: data)
    }

    func writeWorkoutState(_ state: WorkoutState) {
        guard let data = try? JSONEncoder().encode(state),
              let jsonString = String(data: data, encoding: .utf8) else { return }
        defaults?.set(jsonString, forKey: workoutStateKey)
    }

    func appendAction(_ action: WorkoutAction) {
        var actions = readActionsInternal()
        guard let actionData = try? JSONEncoder().encode(action),
              let actionDict = try? JSONSerialization.jsonObject(with: actionData) else { return }
        actions.append(actionDict)
        guard let arrayData = try? JSONSerialization.data(withJSONObject: actions),
              let jsonString = String(data: arrayData, encoding: .utf8) else { return }
        defaults?.set(jsonString, forKey: actionQueueKey)
    }

    func readAndClearActions() -> [WorkoutAction] {
        guard let jsonString = defaults?.string(forKey: actionQueueKey),
              let data = jsonString.data(using: .utf8) else { return [] }
        defaults?.removeObject(forKey: actionQueueKey)
        return (try? JSONDecoder().decode([WorkoutAction].self, from: data)) ?? []
    }

    func clearAll() {
        defaults?.removeObject(forKey: workoutStateKey)
        defaults?.removeObject(forKey: actionQueueKey)
    }

    private func readActionsInternal() -> [Any] {
        guard let jsonString = defaults?.string(forKey: actionQueueKey),
              let data = jsonString.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
        return array
    }
}
